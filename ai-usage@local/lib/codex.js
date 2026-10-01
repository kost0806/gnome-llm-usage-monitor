// Codex Enterprise credits via a long-lived `codex app-server` child process
// owned by the extension (no systemd unit).
//
// Protocol: newline-delimited JSON, no LSP headers, `jsonrpc` field optional.
//   → {"id":1,"method":"initialize","params":{"clientInfo":{...}}}
//   → {"method":"initialized"}
//   → {"id":N,"method":"account/read","params":{}}            account null → auth error
//   → {"id":N,"method":"account/rateLimits/read","params":{}}
//
// Field paths (see parse.js): rateLimits.individualLimit.{used, limit, resetsAt}
//   (SpendControlLimitSnapshot; used/limit are decimal strings, resetsAt unix seconds),
//   falling back to rateLimitsByLimitId.codex.individualLimit.
// Verified 2026-10-01 with codex-cli 0.148.0 (`generate-json-schema` + a live
// session). That account was `plus`, where individualLimit is null; the
// Enterprise-populated shape is taken from the schema only. `credits.balance`
// alone has no limit, so it is not used.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {codexCandidates} from './codexPath.js';
import {ErrorKind, ProviderError} from './errors.js';
import {codexPlanType, parseCodexRateLimits} from './parse.js';

Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async');

const REQUEST_TIMEOUT_SECONDS = 15;
const BACKOFF_SECONDS = [5, 30, 300];
const KILL_GRACE_SECONDS = 2;
const MAX_CONSECUTIVE_TIMEOUTS = 2;
const SIGTERM = 15;
const CLIENT_INFO = Object.freeze({name: 'ai-usage', title: 'AI Usage', version: '1.0.0'});

const MSG_NOT_INSTALLED = 'codex를 찾을 수 없음';
const MSG_DISCONNECTED = 'codex app-server 연결 끊김 (재시작 중)';
const MSG_AUTH = '로그인 안 됨 — codex login 실행';
const MSG_TIMEOUT = 'codex 응답 시간 초과';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isExecutable(path) {
    return GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE);
}

function listNvmVersions(home) {
    const dir = Gio.File.new_for_path(`${home}/.nvm/versions/node`);
    const names = [];
    try {
        const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = children.next_file(null); info; info = children.next_file(null))
            names.push(info.get_name());
        children.close(null);
    } catch {
        // No nvm install: nothing to add.
    }
    return names;
}

function findCodex() {
    const inPath = GLib.find_program_in_path('codex');
    if (inPath)
        return inPath;
    const home = GLib.get_home_dir();
    return codexCandidates(home, listNvmVersions(home)).find(isExecutable) ?? null;
}

function closeQuietly(stream) {
    stream?.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.close_finish(result);
        } catch {
            // already closed or process gone
        }
    });
}

// SIGTERM first so an npm/node wrapper can forward it to the native binary,
// then SIGKILL if it is still alive. Closing stdin gives any orphaned child EOF.
function terminate(proc, stdin) {
    let killId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, KILL_GRACE_SECONDS, () => {
        killId = 0;
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    proc.wait_async(null, () => {
        if (killId)
            GLib.Source.remove(killId);
        killId = 0;
    });
    proc.send_signal(SIGTERM);
    closeQuietly(stdin);
}

export class CodexClient {
    constructor() {
        this._proc = null;
        this._stdin = null;
        this._stdout = null;
        this._ready = null;
        this._consecutiveTimeouts = 0;
        this._pending = new Map();
        this._nextId = 1;
        this._writeChain = Promise.resolve();
        this._backoffIndex = 0;
        this._restartId = 0;
        this._notInstalled = false;
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        this._spawn();
    }

    // → {used, limit, resetsAt} in credits. Throws ProviderError.
    async fetch() {
        if (this._notInstalled)
            this._spawn(); // codex may have been installed since the last attempt
        if (this._notInstalled)
            throw new ProviderError(ErrorKind.NOT_INSTALLED, MSG_NOT_INSTALLED);
        if (!this._proc)
            throw new ProviderError(ErrorKind.DISCONNECTED, MSG_DISCONNECTED);

        await this._ready;
        const {account} = await this._request('account/read', {}) ?? {};
        if (!account)
            throw new ProviderError(ErrorKind.AUTH, MSG_AUTH);

        const result = await this._request('account/rateLimits/read', {});
        const usage = parseCodexRateLimits(result);
        if (!usage)
            throw new ProviderError(ErrorKind.NO_DATA, `크레딧 한도 정보 없음 (plan: ${codexPlanType(result)})`);
        this._backoffIndex = 0; // a full round trip worked: this process is healthy
        return usage;
    }

    destroy() {
        this._cancellable.cancel();
        if (this._restartId)
            GLib.Source.remove(this._restartId);
        this._restartId = 0;
        this._rejectAll(new ProviderError(ErrorKind.CANCELLED, 'cancelled'));
        if (this._proc)
            terminate(this._proc, this._stdin);
        closeQuietly(this._stdout);
        this._proc = null;
        this._stdin = null;
        this._stdout = null;
    }

    _spawn() {
        const codexPath = findCodex();
        this._notInstalled = codexPath === null;
        if (this._notInstalled)
            return;

        // A node-based codex (npm/nvm) needs `node` on PATH; it sits next to codex.
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_SILENCE,
        });
        launcher.setenv('PATH', `${GLib.path_get_dirname(codexPath)}:${GLib.getenv('PATH') ?? ''}`, true);

        let proc;
        try {
            proc = launcher.spawnv([codexPath, 'app-server']);
        } catch (error) {
            console.error(`ai-usage: failed to start ${codexPath}: ${error.message}`);
            this._scheduleRestart();
            return;
        }

        this._proc = proc;
        // stdin is never closed while running: EOF makes app-server abort in-flight requests.
        this._stdin = proc.get_stdin_pipe();
        this._stdout = new Gio.DataInputStream({
            base_stream: proc.get_stdout_pipe(),
            close_base_stream: true,
        });
        this._writeChain = Promise.resolve();
        this._consecutiveTimeouts = 0;
        this._readLoop(proc, this._stdout);
        proc.wait_async(null, () => this._onExit(proc));

        this._ready = this._handshake();
        // Error is surfaced through fetch(). A process that never completes the
        // handshake is useless, so recycle it.
        this._ready.catch(() => this._recycle(proc));
    }

    async _handshake() {
        await this._request('initialize', {clientInfo: CLIENT_INFO});
        await this._send({method: 'initialized'});
    }

    // Kill a live but unusable process; _onExit then restarts it with backoff.
    _recycle(proc) {
        if (this._proc === proc && !this._cancellable.is_cancelled())
            terminate(proc, null);
    }

    _onExit(proc) {
        if (proc !== this._proc)
            return;
        this._proc = null;
        closeQuietly(this._stdin);
        closeQuietly(this._stdout);
        this._stdin = null;
        this._stdout = null;
        this._rejectAll(new ProviderError(ErrorKind.DISCONNECTED, MSG_DISCONNECTED));
        if (!this._cancellable.is_cancelled())
            this._scheduleRestart();
    }

    _scheduleRestart() {
        const delay = BACKOFF_SECONDS[Math.min(this._backoffIndex, BACKOFF_SECONDS.length - 1)];
        this._backoffIndex += 1;
        this._restartId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._restartId = 0;
            this._spawn();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _readLoop(proc, stdout) {
        try {
            for (;;) {
                const [line] = await stdout.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable);
                if (line === null)
                    return; // EOF; wait_async handles the restart
                this._handleLine(decoder.decode(line));
            }
        } catch (error) {
            if (this._cancellable.is_cancelled() || this._proc !== proc)
                return;
            console.error(`ai-usage: codex stdout read failed: ${error.message}`);
            this._recycle(proc);
        }
    }

    _handleLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            return; // not protocol output
        }
        // Notifications and server→client requests carry `method`; only our responses matter.
        if (typeof message !== 'object' || message === null || 'method' in message || message.id == null)
            return;
        const entry = this._pending.get(message.id);
        if (!entry)
            return;
        this._consecutiveTimeouts = 0;
        this._settle(message.id);
        if (message.error)
            entry.reject(new ProviderError(ErrorKind.NETWORK, `codex 오류: ${message.error.message ?? 'unknown'}`));
        else
            entry.resolve(message.result);
    }

    _request(method, params) {
        if (!this._stdin)
            return Promise.reject(new ProviderError(ErrorKind.DISCONNECTED, MSG_DISCONNECTED));
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            const proc = this._proc;
            const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REQUEST_TIMEOUT_SECONDS, () => {
                this._pending.delete(id);
                reject(new ProviderError(ErrorKind.TIMEOUT, MSG_TIMEOUT));
                this._onTimeout(proc);
                return GLib.SOURCE_REMOVE;
            });
            this._pending.set(id, {resolve, reject, timeoutId});
            this._send({id, method, params}).catch(() => {
                if (this._settle(id))
                    reject(new ProviderError(ErrorKind.DISCONNECTED, MSG_DISCONNECTED));
            });
        });
    }

    // A process that stops answering but stays alive is hung: recycle it.
    _onTimeout(proc) {
        this._consecutiveTimeouts += 1;
        if (this._consecutiveTimeouts < MAX_CONSECUTIVE_TIMEOUTS)
            return;
        this._consecutiveTimeouts = 0;
        this._recycle(proc);
    }

    // Serialise writes: Gio rejects overlapping async operations on one stream.
    _send(message) {
        const stdin = this._stdin;
        const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
        const write = this._writeChain.then(() => {
            if (!stdin)
                throw new ProviderError(ErrorKind.DISCONNECTED, MSG_DISCONNECTED);
            return stdin.write_all_async(bytes, GLib.PRIORITY_DEFAULT, this._cancellable);
        });
        this._writeChain = write.catch(() => {});
        return write;
    }

    // Remove a pending request and its timeout. Returns true if it was still pending.
    _settle(id) {
        const entry = this._pending.get(id);
        if (!entry)
            return false;
        GLib.Source.remove(entry.timeoutId);
        this._pending.delete(id);
        return true;
    }

    _rejectAll(error) {
        for (const [id, entry] of [...this._pending]) {
            this._settle(id);
            entry.reject(error);
        }
    }
}
