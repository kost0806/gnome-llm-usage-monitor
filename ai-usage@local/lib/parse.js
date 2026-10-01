// Response → {used, limit, resetsAt} mapping for both providers. Pure functions
// (no gi:// imports) so they can be unit-tested with plain node.
//
// Every parser returns null when the response has no usable used/limit pair;
// the caller turns that into a user-visible error.

function finiteNumber(value) {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function usageOrNull(used, limit, resetsAt = null) {
    if (used === null || limit === null)
        return null;
    return {used, limit, resetsAt};
}

// ── Claude ──────────────────────────────────────────────────────────────────
// `spend.used` / `spend.limit` are money objects:
//   {amount_minor: 2340, currency: 'USD', exponent: 2}  → 23.40
function moneyToMajor(money) {
    if (!money || typeof money !== 'object')
        return null;
    const minor = finiteNumber(money.amount_minor);
    if (minor === null)
        return null;
    const exponent = finiteNumber(money.exponent) ?? 2;
    return minor / 10 ** exponent;
}

function fromSpend(spend) {
    if (!spend || typeof spend !== 'object')
        return null;
    return usageOrNull(moneyToMajor(spend.used), moneyToMajor(spend.limit));
}

// `extra_usage.used_credits` / `monthly_limit` are integers in minor units,
// scaled by `decimal_places` (assumed 2 = cents when the field is null).
function fromExtraUsage(extra) {
    if (!extra || typeof extra !== 'object' || extra.is_enabled !== true)
        return null;
    const scale = 10 ** (finiteNumber(extra.decimal_places) ?? 2);
    const used = finiteNumber(extra.used_credits);
    const limit = finiteNumber(extra.monthly_limit);
    if (used === null || limit === null)
        return null;
    return usageOrNull(used / scale, limit / scale);
}

export function parseClaudeUsage(json) {
    if (!json || typeof json !== 'object')
        return null;
    return fromSpend(json.spend) ?? fromExtraUsage(json.extra_usage);
}

// ── Codex ───────────────────────────────────────────────────────────────────
// `account/rateLimits/read` → RateLimitSnapshot.individualLimit
//   (SpendControlLimitSnapshot: {used: string, limit: string, resetsAt: unix s, remainingPercent})
function fromIndividualLimit(snapshot) {
    const limitSnapshot = snapshot?.individualLimit;
    if (!limitSnapshot || typeof limitSnapshot !== 'object')
        return null;
    const resetsAtSeconds = finiteNumber(limitSnapshot.resetsAt);
    const resetsAt = resetsAtSeconds ? new Date(resetsAtSeconds * 1000) : null;
    return usageOrNull(finiteNumber(limitSnapshot.used), finiteNumber(limitSnapshot.limit), resetsAt);
}

export function parseCodexRateLimits(result) {
    if (!result || typeof result !== 'object')
        return null;
    return fromIndividualLimit(result.rateLimits) ??
        fromIndividualLimit(result.rateLimitsByLimitId?.codex);
}

export function codexPlanType(result) {
    return result?.rateLimits?.planType ?? 'unknown';
}
