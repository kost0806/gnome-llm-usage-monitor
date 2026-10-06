import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    monthCycle,
    expectedPercent,
    paceText,
    dailyAverageText,
    cycleDaysText,
    averagePercent,
} from '../ai-usage@local/lib/pace.js';

test('monthCycle counts today as elapsed and ends on the next 1st', () => {
    const cycle = monthCycle(new Date(2026, 9, 14, 14, 32));
    assert.equal(cycle.elapsedDays, 14);
    assert.equal(cycle.totalDays, 31);
    assert.deepEqual(cycle.endsAt, new Date(2026, 10, 1));
});

test('monthCycle handles short months and year end', () => {
    assert.equal(monthCycle(new Date(2026, 1, 1)).totalDays, 28);
    assert.equal(monthCycle(new Date(2028, 1, 29)).totalDays, 29);
    assert.deepEqual(monthCycle(new Date(2026, 11, 31)).endsAt, new Date(2027, 0, 1));
});

test('expectedPercent rounds elapsed/total', () => {
    assert.equal(expectedPercent({elapsedDays: 14, totalDays: 31}), 45);
    assert.equal(expectedPercent({elapsedDays: 1, totalDays: 30}), 3);
    assert.equal(expectedPercent({elapsedDays: 31, totalDays: 31}), 100);
});

test('paceText reports headroom when at or under expected', () => {
    assert.deepEqual(paceText(42, 45), {expected: '기댓값 45%', gap: '3%p 여유', isOver: false});
    assert.deepEqual(paceText(45, 45), {expected: '기댓값 45%', gap: '0%p 여유', isOver: false});
});

test('paceText reports overage when above expected', () => {
    assert.deepEqual(paceText(50, 45), {expected: '기댓값 45%', gap: '5%p 초과', isOver: true});
});

test('dailyAverageText formats dollars for Claude and whole credits for Codex', () => {
    assert.equal(dailyAverageText('claude', 98.2, 14), '일평균 $7.01');
    assert.equal(dailyAverageText('codex', 2940, 14), '일평균 210');
    assert.equal(dailyAverageText('codex', 100, 3), '일평균 33');
});

test('dailyAverageText falls back to a dash without usable input', () => {
    assert.equal(dailyAverageText('claude', null, 14), '일평균 —');
    assert.equal(dailyAverageText('codex', 10, 0), '일평균 —');
});

test('cycleDaysText shows elapsed/total days', () => {
    assert.equal(cycleDaysText({elapsedDays: 14, totalDays: 31}), '14/31일');
});

test('averagePercent is the rounded mean, null if any value is missing', () => {
    assert.equal(averagePercent([42, 50]), 46);
    assert.equal(averagePercent([42, 49]), 46);
    assert.equal(averagePercent([42, null]), null);
    assert.equal(averagePercent([]), null);
});
