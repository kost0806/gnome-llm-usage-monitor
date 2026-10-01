// Claude Enterprise spend via the OAuth usage endpoint (the one Claude Code's
// /usage uses), authenticated with Claude Code's own login token. No Admin key.
//
//   GET https://api.anthropic.com/api/oauth/usage
//   Authorization: Bearer <~/.claude/.credentials.json → claudeAiOauth.accessToken>
//   anthropic-beta: oauth-2025-04-20
//
// Field paths (see parse.js):
//   1st: spend.used / spend.limit        {amount_minor, currency, exponent}  → dollars
//   2nd: extra_usage.used_credits / .monthly_limit  (minor units, decimal_places)
//
// Verified 2026-10-01 against a Max account: endpoint returns 200 with `spend`
// present but `spend.limit: null`. The Enterprise-populated shape of
// `spend.limit` was NOT observable from that account — if values never appear
// on the Enterprise login, dump the response (curl from IMPLEMENTATION.md §1-1)
// and adjust parse.js. The Admin API fallback (spend_limits/effective) is not
// implemented.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {ErrorKind, ProviderError} from './errors.js';
import {parseClaudeUsage} from './parse.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const TIMEOUT_SECONDS = 15;
const MSG_AUTH = '토큰 만료 — claude 실행 후 재로그인';
const MSG_NO_LOGIN = 'Claude Code 로그인 정보 없음 — claude 실행 후 로그인';
const MSG_NETWORK = '네트워크 오류';
const MSG_NO_DATA = 'Enterprise 사용 금액 정보 없음';

const decoder = new TextDecoder();

function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// Re-read on every call: Claude Code refreshes the token, so never cache it.
async function readAccessToken(cancellable) {
    const path = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
    try {
        const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
        const token = JSON.parse(decoder.decode(contents))?.claudeAiOauth?.accessToken;
        if (typeof token === 'string' && token.length > 0)
            return token;
    } catch (error) {
        if (isCancelled(error))
            throw new ProviderError(ErrorKind.CANCELLED, 'cancelled');
    }
    throw new ProviderError(ErrorKind.AUTH, MSG_NO_LOGIN);
}

export class ClaudeClient {
    constructor() {
        this._session = new Soup.Session({timeout: TIMEOUT_SECONDS});
        this._cancellable = null;
    }

    // → {used, limit, resetsAt} in dollars. Throws ProviderError.
    async fetch() {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const token = await readAccessToken(cancellable);
        if (cancellable.is_cancelled() || !this._session)
            throw new ProviderError(ErrorKind.CANCELLED, 'cancelled');
        const message = Soup.Message.new('GET', USAGE_URL);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('anthropic-beta', OAUTH_BETA);

        let bytes;
        try {
            bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (error) {
            if (isCancelled(error))
                throw new ProviderError(ErrorKind.CANCELLED, 'cancelled');
            throw new ProviderError(ErrorKind.NETWORK, MSG_NETWORK);
        }

        const status = message.get_status();
        if (status === Soup.Status.UNAUTHORIZED || status === Soup.Status.FORBIDDEN)
            throw new ProviderError(ErrorKind.AUTH, MSG_AUTH);
        if (status !== Soup.Status.OK)
            throw new ProviderError(ErrorKind.NETWORK, `${MSG_NETWORK} (HTTP ${status})`);

        let json;
        try {
            json = JSON.parse(decoder.decode(bytes.toArray()));
        } catch {
            throw new ProviderError(ErrorKind.NO_DATA, `${MSG_NO_DATA} (응답 해석 실패)`);
        }
        const usage = parseClaudeUsage(json);
        if (!usage)
            throw new ProviderError(ErrorKind.NO_DATA, MSG_NO_DATA);
        return usage;
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._session.abort();
        this._session = null;
    }
}
