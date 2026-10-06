// Billing-cycle pace (design 04): expected usage so far, gap, daily average.
// Pure functions: no gi:// imports, so they can be unit-tested with plain node.
//
// Both providers reset on the 1st of each month, so the cycle is the calendar
// month and one expected value covers both.

const NONE = '—';

// Calendar month containing `now`. Today counts as elapsed.
export function monthCycle(now) {
    const year = now.getFullYear();
    const month = now.getMonth();
    return {
        elapsedDays: now.getDate(),
        totalDays: new Date(year, month + 1, 0).getDate(),
        endsAt: new Date(year, month + 1, 1),
    };
}

// Share of the cycle elapsed, i.e. where usage would be if spread evenly.
export function expectedPercent(cycle) {
    return Math.round(cycle.elapsedDays / cycle.totalDays * 100);
}

// {expected: '기댓값 45%', gap: '3%p 여유' | '5%p 초과', isOver}
export function paceText(percent, expected) {
    const gap = percent - expected;
    const isOver = gap > 0;
    return {
        expected: `기댓값 ${expected}%`,
        gap: isOver ? `${gap}%p 초과` : `${-gap}%p 여유`,
        isOver,
    };
}

// Claude: "일평균 $7.01", Codex: "일평균 210" (whole credits).
export function dailyAverageText(provider, used, elapsedDays) {
    if (typeof used !== 'number' || elapsedDays <= 0)
        return `일평균 ${NONE}`;
    const perDay = used / elapsedDays;
    return provider === 'claude'
        ? `일평균 $${perDay.toFixed(2)}`
        : `일평균 ${Math.round(perDay)}`;
}

// "14/31일"
export function cycleDaysText(cycle) {
    return `${cycle.elapsedDays}/${cycle.totalDays}일`;
}

// Simple mean of usage percents; null when any is unknown.
export function averagePercent(percents) {
    if (percents.length === 0 || percents.some(p => typeof p !== 'number'))
        return null;
    return Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length);
}
