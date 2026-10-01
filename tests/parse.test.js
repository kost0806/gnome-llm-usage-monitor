import {test} from 'node:test';
import assert from 'node:assert/strict';

import {parseClaudeUsage, parseCodexRateLimits} from '../ai-usage@local/lib/parse.js';

// Trimmed copy of a real 200 response from /api/oauth/usage for a Max (non-Enterprise)
// account, captured 2026-10-01. No spend limit is set, so there is nothing to show.
const CLAUDE_MAX_RESPONSE = {
    five_hour: {utilization: 3.0, resets_at: '2026-10-01T11:40:00.150039+00:00', limit_dollars: null, used_dollars: null},
    extra_usage: {
        is_enabled: false, monthly_limit: null, used_credits: null, utilization: null,
        currency: null, decimal_places: null,
    },
    spend: {
        used: {amount_minor: 0, currency: 'USD', exponent: 2},
        limit: null, percent: 0, severity: 'normal', enabled: false,
    },
};

test('parseClaudeUsage returns null when no spend limit exists (real Max response)', () => {
    assert.equal(parseClaudeUsage(CLAUDE_MAX_RESPONSE), null);
});

test('parseClaudeUsage reads spend.used / spend.limit minor units', () => {
    const json = {
        ...CLAUDE_MAX_RESPONSE,
        spend: {
            used: {amount_minor: 2340, currency: 'USD', exponent: 2},
            limit: {amount_minor: 23300, currency: 'USD', exponent: 2},
        },
    };
    assert.deepEqual(parseClaudeUsage(json), {used: 23.4, limit: 233, resetsAt: null});
});

test('parseClaudeUsage defaults exponent to 2 when absent', () => {
    const json = {spend: {used: {amount_minor: 150}, limit: {amount_minor: 1000}}};
    assert.deepEqual(parseClaudeUsage(json), {used: 1.5, limit: 10, resetsAt: null});
});

test('parseClaudeUsage falls back to extra_usage using decimal_places', () => {
    const json = {
        spend: {used: {amount_minor: 0, exponent: 2}, limit: null},
        extra_usage: {is_enabled: true, monthly_limit: 23300, used_credits: 2340, decimal_places: 2},
    };
    assert.deepEqual(parseClaudeUsage(json), {used: 23.4, limit: 233, resetsAt: null});
});

test('parseClaudeUsage ignores disabled extra_usage', () => {
    const json = {extra_usage: {is_enabled: false, monthly_limit: 23300, used_credits: 2340, decimal_places: 2}};
    assert.equal(parseClaudeUsage(json), null);
});

test('parseClaudeUsage tolerates junk input', () => {
    assert.equal(parseClaudeUsage(null), null);
    assert.equal(parseClaudeUsage('nope'), null);
    assert.equal(parseClaudeUsage({spend: {used: 'x', limit: {amount_minor: 'y'}}}), null);
});

// Real account/rateLimits/read result for a Plus account, captured 2026-10-01.
const CODEX_PLUS_RESULT = {
    rateLimits: {
        limitId: 'codex',
        primary: {usedPercent: 0, windowDurationMins: 300, resetsAt: 1790858612},
        secondary: {usedPercent: 0, windowDurationMins: 10080, resetsAt: 1791445412},
        credits: {hasCredits: false, unlimited: false, balance: '0'},
        individualLimit: null,
        planType: 'plus',
    },
    rateLimitsByLimitId: {
        codex: {
            limitId: 'codex',
            credits: {hasCredits: false, unlimited: false, balance: '0'},
            individualLimit: null,
            planType: 'plus',
        },
    },
};

test('parseCodexRateLimits returns null without individualLimit (real Plus result)', () => {
    assert.equal(parseCodexRateLimits(CODEX_PLUS_RESULT), null);
});

test('parseCodexRateLimits reads individualLimit used/limit strings', () => {
    const result = {
        rateLimits: {
            ...CODEX_PLUS_RESULT.rateLimits,
            planType: 'enterprise',
            individualLimit: {used: '121', limit: '5875', remainingPercent: 98, resetsAt: 1791445412},
        },
    };
    assert.deepEqual(parseCodexRateLimits(result), {
        used: 121,
        limit: 5875,
        resetsAt: new Date(1791445412 * 1000),
    });
});

test('parseCodexRateLimits falls back to rateLimitsByLimitId.codex', () => {
    const result = {
        rateLimits: {individualLimit: null},
        rateLimitsByLimitId: {
            codex: {individualLimit: {used: '10.5', limit: '100', remainingPercent: 90, resetsAt: 0}},
        },
    };
    assert.deepEqual(parseCodexRateLimits(result), {used: 10.5, limit: 100, resetsAt: null});
});

test('parseCodexRateLimits rejects non-numeric strings', () => {
    const result = {rateLimits: {individualLimit: {used: 'abc', limit: '100', resetsAt: 1}}};
    assert.equal(parseCodexRateLimits(result), null);
    assert.equal(parseCodexRateLimits(null), null);
});
