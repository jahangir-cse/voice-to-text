const { config } = require('../config');

// In-memory token bucket per API key (process-local).
// pm2 cluster: each worker has its own bucket — effective limit = perMinute × workers.
const buckets = new Map();
const PER_MINUTE = config.rateLimit.perMinute;
const BURST_PER_SECOND = config.rateLimit.burstPerSecond;

function getBucket(keyHash) {
    let b = buckets.get(keyHash);
    if (!b) {
        b = {
            minuteTokens: PER_MINUTE,
            secondTokens: BURST_PER_SECOND,
            minuteResetAt: Date.now() + 60_000,
            secondResetAt: Date.now() + 1_000,
        };
        buckets.set(keyHash, b);
    }
    const now = Date.now();
    if (now >= b.minuteResetAt) {
        b.minuteTokens = PER_MINUTE;
        b.minuteResetAt = now + 60_000;
    }
    if (now >= b.secondResetAt) {
        b.secondTokens = BURST_PER_SECOND;
        b.secondResetAt = now + 1_000;
    }
    return b;
}

async function rateLimit(req, reply) {
    if (!req.apiKey) return; // auth runs before; skip if no key
    const cost = req.routeOptions && req.routeOptions.config && req.routeOptions.config.rateCost
        ? req.routeOptions.config.rateCost(req)
        : 1;
    const b = getBucket(req.apiKey.keyHash);
    if (b.minuteTokens < cost || b.secondTokens < cost) {
        const retryAfterSec = Math.max(
            Math.ceil((b.minuteResetAt - Date.now()) / 1000),
            Math.ceil((b.secondResetAt - Date.now()) / 1000),
            1
        );
        reply.header('Retry-After', String(retryAfterSec));
        return reply.code(429).send({ error: 'Rate limit exceeded', retryAfter: retryAfterSec });
    }
    b.minuteTokens -= cost;
    b.secondTokens -= cost;
}

// Periodic cleanup of stale buckets to avoid unbounded memory
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets.entries()) {
        if (now - v.minuteResetAt > 5 * 60_000) buckets.delete(k);
    }
}, 60_000).unref();

module.exports = { rateLimit };
