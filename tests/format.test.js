import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
    percentOf,
    severityOf,
    severityColor,
    panelText,
    menuAmountText,
    menuPercentText,
    resetText,
    clockText,
    footerText,
} from '../ai-usage@local/lib/format.js';

test('percentOf rounds used/limit*100', () => {
    assert.equal(percentOf({used: 23.4, limit: 233}), 10);
    assert.equal(percentOf({used: 121, limit: 5875}), 2);
    assert.equal(percentOf({used: 5640, limit: 5875}), 96);
});

test('percentOf returns null when limit is 0 or missing', () => {
    assert.equal(percentOf({used: 5, limit: 0}), null);
    assert.equal(percentOf({used: 5, limit: null}), null);
    assert.equal(percentOf({used: 5}), null);
});

test('severityOf uses 75 / 95 thresholds', () => {
    assert.equal(severityOf(null), 'normal');
    assert.equal(severityOf(0), 'normal');
    assert.equal(severityOf(74), 'normal');
    assert.equal(severityOf(75), 'warning');
    assert.equal(severityOf(94), 'warning');
    assert.equal(severityOf(95), 'critical');
    assert.equal(severityOf(120), 'critical');
});

test('severityColor maps to design colors, null for normal', () => {
    assert.equal(severityColor('normal'), null);
    assert.equal(severityColor('warning'), '#f5c26b');
    assert.equal(severityColor('critical'), '#ff8a7a');
});

test('panelText formats Claude dollars floored', () => {
    assert.equal(panelText('claude', {used: 23.4, limit: 233}), '23$ / 233$ (10%)');
    assert.equal(panelText('claude', {used: 23.99, limit: 233.5}), '23$ / 233$ (10%)');
    assert.equal(panelText('claude', {used: 186.7, limit: 233}), '186$ / 233$ (80%)');
});

test('panelText formats Codex credits without thousands separator', () => {
    assert.equal(panelText('codex', {used: 121, limit: 5875}), '121c / 5875c (2%)');
    assert.equal(panelText('codex', {used: 12345.6, limit: 20000}), '12345c / 20000c (62%)');
});

test('panelText shows (—) when limit is unusable', () => {
    assert.equal(panelText('claude', {used: 23, limit: 0}), '23$ / 0$ (—)');
    assert.equal(panelText('codex', {used: 7, limit: null}), '7c / — (—)');
});

test('menuAmountText uses two decimals for Claude and credits label for Codex', () => {
    assert.equal(menuAmountText('claude', {used: 23.4, limit: 233}), '$23.40 / $233.00');
    assert.equal(menuAmountText('codex', {used: 121, limit: 5875}), '121 / 5875 크레딧');
    assert.equal(menuAmountText('codex', {used: 121, limit: null}), '121 / — 크레딧');
});

test('menuPercentText', () => {
    assert.equal(menuPercentText({used: 23.4, limit: 233}), '10%');
    assert.equal(menuPercentText({used: 1, limit: 0}), '—');
});

test('resetText renders Korean month/day, null without date', () => {
    assert.equal(resetText(new Date(2026, 10, 1)), '초기화 11월 1일');
    assert.equal(resetText(new Date(2026, 9, 8, 23, 59)), '초기화 10월 8일');
    assert.equal(resetText(null), null);
    assert.equal(resetText(undefined), null);
});

test('clockText pads hours and minutes', () => {
    assert.equal(clockText(new Date(2026, 9, 1, 14, 30)), '14:30');
    assert.equal(clockText(new Date(2026, 9, 1, 9, 5)), '09:05');
});

test('footerText shows last and next refresh', () => {
    const last = new Date(2026, 9, 1, 14, 30);
    const next = new Date(2026, 9, 1, 14, 35);
    assert.equal(footerText(last, next), '마지막 갱신 14:30 · 다음 14:35');
    assert.equal(footerText(null, next), '마지막 갱신 — · 다음 14:35');
});
