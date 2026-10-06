// Panel button (two icon+capsule groups) and its dropdown menu.
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
    fillColor,
    fillWidthPx,
    footerText,
    menuAmountText,
    percentOf,
    percentText,
    resetText,
} from './format.js';
import {
    averagePercent,
    cycleDaysText,
    dailyAverageText,
    expectedPercent,
    monthCycle,
    paceText,
} from './pace.js';

const ICON_SIZE = 16;
const BAR_WIDTH_PX = 300;
const TICK_WIDTH_PX = 2; // must match .ai-usage-bar-tick width in stylesheet.css
const TICK_TOP_PX = -3;
const CAPSULE_WIDTH_PX = 60; // must match .ai-usage-capsule width in stylesheet.css
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

// One capsule-sized layer holding a centered label.
function createCapsuleLayer(labelClass) {
    const label = new St.Label({
        style_class: labelClass,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const layer = new St.Widget({
        style_class: 'ai-usage-capsule-layer',
        layout_manager: new Clutter.BinLayout(),
    });
    layer.add_child(label);
    return [layer, label];
}

// Fill capsule (design 2d): the pill itself is the bar. The same label is
// drawn twice: white on the track, and black inside the fill, which clips it
// to the filled width so the text color flips exactly at the fill edge.
class UsageCapsule {
    constructor() {
        // St.Widget's default FixedLayout stacks the layers at (0,0) at their
        // CSS size, so the narrow fill never squeezes (and re-centers) its label.
        // Explicit x/y_expand stops the labels' expand from stretching the pill.
        this.actor = new St.Widget({
            style_class: 'ai-usage-capsule',
            clip_to_allocation: true,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const [base, baseLabel] = createCapsuleLayer('ai-usage-capsule-text');
        const [front, frontLabel] = createCapsuleLayer('ai-usage-capsule-text ai-usage-capsule-text-filled');
        this._fill = new St.Widget({style_class: 'ai-usage-capsule-fill', clip_to_allocation: true});
        this._fill.add_child(front);
        this.actor.add_child(base);
        this.actor.add_child(this._fill);
        this._labels = [baseLabel, frontLabel];
    }

    // percent null → empty track.
    set(text, percent) {
        this._labels.forEach(label => {
            label.text = text;
        });
        const width = fillWidthPx(percent, CAPSULE_WIDTH_PX);
        this._fill.visible = width > 0;
        if (width === 0)
            return;
        this._fill.set_style(`width: ${width}px; background-color: ${fillColor(percent)};`);
        // Square right edge while partial; fully rounded once it reaches the end.
        if (width >= CAPSULE_WIDTH_PX)
            this._fill.add_style_class_name('ai-usage-capsule-fill-full');
        else
            this._fill.remove_style_class_name('ai-usage-capsule-fill-full');
    }
}

class PanelGroup {
    constructor(provider, iconDir) {
        this.actor = new St.BoxLayout({style_class: 'ai-usage-group'});
        this.actor.add_child(createIcon(iconDir, provider.icon));
        this._capsule = new UsageCapsule();
        this._capsule.set(LOADING_TEXT, null);
        this.actor.add_child(this._capsule.actor);
    }

    update(state) {
        if (!state.data) {
            this._capsule.set(state.error ? MISSING_TEXT : LOADING_TEXT, null);
            this.actor.opacity = 255;
            return;
        }
        this._capsule.set(percentText(state.data), percentOf(state.data));
        this.actor.opacity = isStale(state) ? STALE_OPACITY : 255;
    }
}

// Menu bar with the expected-pace tick (design F). Default FixedLayout so the
// fill stays anchored at x=0 and the tick can stick out above the 4px track.
class ProgressBar {
    constructor() {
        this.actor = new St.Widget({
            style_class: 'ai-usage-bar',
            style: `width: ${BAR_WIDTH_PX}px;`,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });
        this._fill = new St.Widget({style_class: 'ai-usage-bar-fill'});
        this._tick = new St.Widget({style_class: 'ai-usage-bar-tick', visible: false});
        this.actor.add_child(this._fill);
        this.actor.add_child(this._tick);
        this.set(null, null);
    }

    // percent null → empty track; expected null → no tick.
    set(percent, expected) {
        // CSS px so St applies the display scale factor.
        this._fill.set_style(
            `width: ${fillWidthPx(percent, BAR_WIDTH_PX)}px; background-color: ${fillColor(percent)};`);

        this._tick.visible = expected !== null;
        if (expected === null)
            return;
        // set_position takes actor pixels, not CSS px: apply the scale by hand.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const x = fillWidthPx(expected, BAR_WIDTH_PX) - TICK_WIDTH_PX / 2;
        this._tick.set_position(x * scale, TICK_TOP_PX * scale);
    }
}

// "기댓값 45% · 3%p 여유" on the left (overage highlighted), optional extra text on the right.
class PaceRow {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'ai-usage-dim', x_expand: true});
        this._expected = new St.Label();
        this._gap = new St.Label({x_expand: true});
        this._extra = new St.Label();
        [this._expected, this._gap, this._extra].forEach(label => this.actor.add_child(label));
    }

    // percent null → row hidden.
    set(percent, expected, extraText = '') {
        this.actor.visible = percent !== null;
        if (percent === null)
            return;
        const pace = paceText(percent, expected);
        this._expected.text = `${pace.expected} · `;
        this._gap.text = pace.gap;
        if (pace.isOver)
            this._gap.add_style_class_name('ai-usage-over');
        else
            this._gap.remove_style_class_name('ai-usage-over');
        this._extra.text = extraText;
    }
}

function createMenuBlock() {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const column = new St.BoxLayout({
        style_class: 'ai-usage-block',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    item.add_child(column);
    return [item, column];
}

class ProviderBlock {
    constructor(provider, iconDir) {
        this._provider = provider;
        const [item, column] = createMenuBlock();
        this.item = item;

        const header = new St.BoxLayout({style_class: 'ai-usage-block-header'});
        header.add_child(createIcon(iconDir, provider.icon));
        header.add_child(new St.Label({text: provider.title, y_align: Clutter.ActorAlign.CENTER}));

        const amountRow = new St.BoxLayout({x_expand: true});
        this._amount = new St.Label({text: LOADING_TEXT, style_class: 'ai-usage-value', x_expand: true});
        this._percent = new St.Label({text: '', style_class: 'ai-usage-value'});
        amountRow.add_child(this._amount);
        amountRow.add_child(this._percent);

        this._bar = new ProgressBar();
        this._pace = new PaceRow();
        this._reset = new St.Label({style_class: 'ai-usage-dim', visible: false});
        this._error = new St.Label({style_class: 'ai-usage-error', visible: false});

        [header, amountRow, this._bar.actor, this._pace.actor, this._reset, this._error]
            .forEach(child => column.add_child(child));
    }

    update(state, cycle) {
        const {data, error} = state;
        const percent = data ? percentOf(data) : null;
        const expected = expectedPercent(cycle);
        if (data) {
            this._amount.text = menuAmountText(this._provider.key, data);
            this._percent.text = percentText(data);
        } else {
            this._amount.text = error ? MISSING_TEXT : LOADING_TEXT;
            this._percent.text = '';
        }
        this._bar.set(percent, percent !== null ? expected : null);
        this._pace.set(percent, expected,
            data ? dailyAverageText(this._provider.key, data.used, cycle.elapsedDays) : '');

        // Codex reports its own reset time; otherwise the cycle ends on the next 1st.
        this._reset.text = data
            ? `${resetText(data.resetsAt ?? cycle.endsAt)} · ${cycleDaysText(cycle)}`
            : '';
        this._reset.visible = data !== null;

        this._error.text = error ?? '';
        this._error.visible = error !== null;
    }
}

// "두 AI 평균": mean of both percents against the shared expected value.
// Hidden unless every provider has a fresh (non-error) value.
class AverageBlock {
    constructor() {
        const [item, column] = createMenuBlock();
        this.item = item;

        const header = new St.BoxLayout({x_expand: true});
        header.add_child(new St.Label({text: '두 AI 평균', style_class: 'ai-usage-block-header', x_expand: true}));
        this._percent = new St.Label({style_class: 'ai-usage-value'});
        header.add_child(this._percent);

        this._bar = new ProgressBar();
        this._pace = new PaceRow();
        [header, this._bar.actor, this._pace.actor].forEach(child => column.add_child(child));
    }

    // → whether the block is shown.
    update(states, cycle) {
        const all = Object.values(states);
        const isFresh = all.every(state => state.data && state.error === null);
        const percent = isFresh ? averagePercent(all.map(state => percentOf(state.data))) : null;
        this.item.visible = percent !== null;
        if (percent === null)
            return false;
        const expected = expectedPercent(cycle);
        this._percent.text = `${percent}%`;
        this._bar.set(percent, expected);
        this._pace.set(percent, expected);
        return true;
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

        this._averageSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._averageSeparator);
        this._average = new AverageBlock();
        this.menu.addMenuItem(this._average.item);

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
        const cycle = monthCycle(new Date());
        for (const {key} of PROVIDERS) {
            this._groups[key].update(states[key]);
            this._blocks[key].update(states[key], cycle);
        }
        this._averageSeparator.visible = this._average.update(states, cycle);
        this._footer.label.text = footerText(lastRefreshAt, nextRefreshAt);
    }
});
