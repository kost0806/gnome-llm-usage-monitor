// Display strings, percentages and severity. Pure functions: no gi:// imports,
// so they can be unit-tested with plain node (see tests/format.test.js).

const WARNING_PERCENT = 75;
const CRITICAL_PERCENT = 95;
const NONE = '—';

const NORMAL_FILL = '#ffffff';

const SEVERITY_COLORS = Object.freeze({
    normal: null,
    warning: '#f5c26b',
    critical: '#ff8a7a',
});

function hasLimit(usage) {
    return typeof usage.limit === 'number' && usage.limit > 0;
}

export function percentOf(usage) {
    return hasLimit(usage) ? Math.round(usage.used / usage.limit * 100) : null;
}

export function severityOf(percent) {
    if (percent === null)
        return 'normal';
    if (percent >= CRITICAL_PERCENT)
        return 'critical';
    if (percent >= WARNING_PERCENT)
        return 'warning';
    return 'normal';
}

export function severityColor(severity) {
    return SEVERITY_COLORS[severity] ?? null;
}

// Bar/capsule fill: severity color, plain white while normal.
export function fillColor(percent) {
    return severityColor(severityOf(percent)) ?? NORMAL_FILL;
}

// Filled width in px; overuse (>100%) fills the track, unknown is empty.
export function fillWidthPx(percent, trackWidth) {
    const clamped = Math.max(0, Math.min(100, percent ?? 0));
    return Math.round(trackWidth * clamped / 100);
}

function wholeUnits(value, suffix) {
    return typeof value === 'number' ? `${Math.floor(value)}${suffix}` : NONE;
}

function dollars(value) {
    return typeof value === 'number' ? `$${value.toFixed(2)}` : NONE;
}

// Claude: "$23.40 / $233.00", Codex: "121 / 5875 크레딧"
export function menuAmountText(provider, usage) {
    if (provider === 'claude')
        return `${dollars(usage.used)} / ${dollars(usage.limit)}`;
    return `${wholeUnits(usage.used, '')} / ${wholeUnits(usage.limit, '')} 크레딧`;
}

// Panel capsule and menu: "10%", or "—" without a usable limit.
export function percentText(usage) {
    const percent = percentOf(usage);
    return percent === null ? NONE : `${percent}%`;
}

export function resetText(date) {
    if (!(date instanceof Date))
        return null;
    return `초기화 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function clockText(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function footerText(lastRefreshAt, nextRefreshAt) {
    const last = lastRefreshAt ? clockText(lastRefreshAt) : NONE;
    const next = nextRefreshAt ? clockText(nextRefreshAt) : NONE;
    return `마지막 갱신 ${last} · 다음 ${next}`;
}
