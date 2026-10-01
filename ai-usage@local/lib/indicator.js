// Panel button (two icon+label groups) and its dropdown menu.
// Rendering only: state, timers and fetching live in extension.js.
//
// Provider state shape: {data: {used, limit, resetsAt} | null, error: string | null, loading: boolean}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    footerText,
    menuAmountText,
    menuPercentText,
    panelText,
    percentOf,
    resetText,
    severityColor,
    severityOf,
} from './format.js';

const ICON_SIZE = 16;
const BAR_WIDTH_PX = 300;
const STALE_OPACITY = 128; // 50%
const LOADING_TEXT = '…';
const MISSING_TEXT = '—';

export const PROVIDERS = Object.freeze([
    Object.freeze({key: 'claude', title: 'Claude', icon: 'claude.svg'}),
    Object.freeze({key: 'codex', title: 'Codex', icon: 'codex.svg'}),
]);

// Missing icon file must not break the extension: fall back to a themed icon.
function createIcon(iconDir, fileName) {
    const file = iconDir.get_child(fileName);
    const gicon = file.query_exists(null)
        ? new Gio.FileIcon({file})
        : new Gio.ThemedIcon({name: 'dialog-question-symbolic'});
    return new St.Icon({gicon, icon_size: ICON_SIZE, y_align: Clutter.ActorAlign.CENTER});
}

function isStale(state) {
    return state.error !== null && state.data !== null;
}

class PanelGroup {
    constructor(provider, iconDir) {
        this._provider = provider;
        this.actor = new St.BoxLayout({style_class: 'ai-usage-group'});
        this.actor.add_child(createIcon(iconDir, provider.icon));
        this._label = new St.Label({
            text: LOADING_TEXT,
            style_class: 'ai-usage-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._label);
    }

    update(state) {
        if (!state.data) {
            this._label.text = state.error ? MISSING_TEXT : LOADING_TEXT;
            this._label.set_style(null);
            this.actor.opacity = 255;
            return;
        }
        this._label.text = panelText(this._provider.key, state.data);
        const color = severityColor(severityOf(percentOf(state.data)));
        this._label.set_style(color ? `color: ${color};` : null);
        this.actor.opacity = isStale(state) ? STALE_OPACITY : 255;
    }
}

class ProgressBar {
    constructor() {
        this.actor = new St.Widget({
            style_class: 'ai-usage-bar',
            style: `width: ${BAR_WIDTH_PX}px;`,
            layout_manager: new Clutter.BinLayout(),
        });
        this._fill = new St.Widget({style_class: 'ai-usage-bar-fill', x_align: Clutter.ActorAlign.START});
        this.actor.add_child(this._fill);
        this.setPercent(0);
    }

    setPercent(percent) {
        const clamped = Math.max(0, Math.min(100, percent ?? 0));
        // CSS px so St applies the display scale factor.
        this._fill.set_style(`width: ${Math.round(BAR_WIDTH_PX * clamped / 100)}px;`);
    }
}

class ProviderBlock {
    constructor(provider, iconDir) {
        this._provider = provider;
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});

        const column = new St.BoxLayout({
            style_class: 'ai-usage-block',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        const header = new St.BoxLayout({style_class: 'ai-usage-block-header'});
        header.add_child(createIcon(iconDir, provider.icon));
        header.add_child(new St.Label({text: provider.title, y_align: Clutter.ActorAlign.CENTER}));

        const amountRow = new St.BoxLayout({x_expand: true});
        this._amount = new St.Label({text: LOADING_TEXT, style_class: 'ai-usage-value', x_expand: true});
        this._percent = new St.Label({text: '', style_class: 'ai-usage-value'});
        amountRow.add_child(this._amount);
        amountRow.add_child(this._percent);

        this._bar = new ProgressBar();
        this._reset = new St.Label({style_class: 'ai-usage-dim', visible: false});
        this._error = new St.Label({style_class: 'ai-usage-error', visible: false});

        [header, amountRow, this._bar.actor, this._reset, this._error].forEach(child => column.add_child(child));
        this.item.add_child(column);
    }

    update(state) {
        const {data, error} = state;
        if (data) {
            this._amount.text = menuAmountText(this._provider.key, data);
            this._percent.text = menuPercentText(data);
        } else {
            this._amount.text = error ? MISSING_TEXT : LOADING_TEXT;
            this._percent.text = '';
        }
        this._bar.setPercent(data ? percentOf(data) : 0);

        const reset = data ? resetText(data.resetsAt) : null;
        this._reset.text = reset ?? '';
        this._reset.visible = reset !== null;

        this._error.text = error ?? '';
        this._error.visible = error !== null;
    }
}

export const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    _init(iconDir, onRefresh) {
        super._init(0.5, 'AI Usage', false);

        const panelBox = new St.BoxLayout({style_class: 'ai-usage-panel'});
        this._groups = {};
        this._blocks = {};
        for (const provider of PROVIDERS) {
            this._groups[provider.key] = new PanelGroup(provider, iconDir);
            panelBox.add_child(this._groups[provider.key].actor);

            this._blocks[provider.key] = new ProviderBlock(provider, iconDir);
            this.menu.addMenuItem(this._blocks[provider.key].item);
        }
        this.add_child(panelBox);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._footer = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this._footer.label.add_style_class_name('ai-usage-dim');
        this.menu.addMenuItem(this._footer);

        const refreshItem = new PopupMenu.PopupMenuItem('지금 새로고침');
        refreshItem.connect('activate', () => onRefresh());
        this.menu.addMenuItem(refreshItem);
    }

    // states: {claude: ProviderState, codex: ProviderState}
    update(states, lastRefreshAt, nextRefreshAt) {
        for (const {key} of PROVIDERS) {
            this._groups[key].update(states[key]);
            this._blocks[key].update(states[key]);
        }
        this._footer.label.text = footerText(lastRefreshAt, nextRefreshAt);
    }
});
