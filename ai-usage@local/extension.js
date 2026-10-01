// AI Usage: Claude Enterprise spend and Codex credits in the top bar.
// Lifecycle, 5-minute refresh timer and per-provider state.

import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClaudeClient} from './lib/claude.js';
import {CodexClient} from './lib/codex.js';
import {ErrorKind, toProviderError} from './lib/errors.js';
import {UsageIndicator} from './lib/indicator.js';

const REFRESH_INTERVAL_SECONDS = 300;
const MSG_UNEXPECTED = '알 수 없는 오류';

const INITIAL_STATE = Object.freeze({data: null, error: null, loading: true});

export default class AiUsageExtension extends Extension {
    enable() {
        this._clients = {claude: new ClaudeClient(), codex: new CodexClient()};
        this._clients.codex.start();
        this._states = {claude: INITIAL_STATE, codex: INITIAL_STATE};
        this._generation = 0;
        this._timerId = 0;
        this._lastRefreshAt = null;
        this._nextRefreshAt = null;

        this._indicator = new UsageIndicator(this.dir.get_child('icons'), () => this._refresh());
        Main.panel.addToStatusArea('ai-usage', this._indicator, 0, 'right');

        this._refresh();
    }

    disable() {
        if (this._timerId)
            GLib.Source.remove(this._timerId);
        this._timerId = 0;
        this._generation += 1; // drop results of in-flight fetches

        Object.values(this._clients).forEach(client => client.destroy());
        this._clients = null;

        this._indicator.destroy();
        this._indicator = null;
        this._states = null;
    }

    // Fetch both providers now and restart the 5-minute timer.
    _refresh() {
        this._scheduleNext();
        const generation = ++this._generation;
        const fetches = Object.keys(this._clients).map(key => this._fetchProvider(key, generation));
        Promise.allSettled(fetches).then(() => {
            if (generation !== this._generation)
                return;
            this._lastRefreshAt = new Date();
            this._render();
        });
    }

    _scheduleNext() {
        if (this._timerId)
            GLib.Source.remove(this._timerId);
        this._nextRefreshAt = new Date(Date.now() + REFRESH_INTERVAL_SECONDS * 1000);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
            this._timerId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        this._render();
    }

    // Providers are independent: one failing never touches the other's state.
    async _fetchProvider(key, generation) {
        this._setState(key, {...this._states[key], loading: true});
        try {
            const data = await this._clients[key].fetch();
            if (generation === this._generation)
                this._setState(key, {data, error: null, loading: false});
        } catch (error) {
            const providerError = toProviderError(error, MSG_UNEXPECTED);
            if (providerError !== error)
                console.error(`ai-usage: ${key} fetch failed: ${error}`);
            if (generation !== this._generation || providerError.kind === ErrorKind.CANCELLED)
                return;
            // Keep the last good value; the panel dims it while an error is set.
            this._setState(key, {...this._states[key], error: providerError.message, loading: false});
        }
    }

    _setState(key, state) {
        this._states = {...this._states, [key]: state};
        this._render();
    }

    _render() {
        this._indicator?.update(this._states, this._lastRefreshAt, this._nextRefreshAt);
    }
}
