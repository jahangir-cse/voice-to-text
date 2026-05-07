const bcrypt = require('bcryptjs');
const { stmts } = require('../db');

// In-memory cache: plaintext-key -> { keyHash, branch, dailyQuota, isAdmin }
const cache = new Map();
const CACHE_MAX = 1000;

function extractKey(req) {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
    const xkey = req.headers['x-api-key'];
    if (xkey) return String(xkey).trim();
    return null;
}

async function lookupKey(plain) {
    if (cache.has(plain)) return cache.get(plain);
    const all = stmts.getAllApiKeys.all();
    for (const row of all) {
        if (await bcrypt.compare(plain, row.key_hash)) {
            const entry = {
                keyHash: row.key_hash,
                branch: row.branch_name,
                dailyQuota: row.daily_quota,
                isAdmin: !!row.is_admin,
            };
            if (cache.size >= CACHE_MAX) cache.clear();
            cache.set(plain, entry);
            return entry;
        }
    }
    return null;
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

function checkQuota(keyHash, dailyQuota) {
    if (!dailyQuota || dailyQuota <= 0) return { ok: true, used: 0 };
    const day = todayUtc();
    const row = stmts.getApiUsage.get(keyHash, day);
    const used = row ? row.count : 0;
    return { ok: used < dailyQuota, used };
}

function bumpQuota(keyHash) {
    const day = todayUtc();
    stmts.incrementApiUsage.run(keyHash, day);
}

async function authenticate(req, reply) {
    const plain = extractKey(req);
    if (!plain) {
        return reply.code(401).send({ error: 'Missing API key. Provide Authorization: Bearer <key>' });
    }
    const entry = await lookupKey(plain);
    if (!entry) {
        return reply.code(401).send({ error: 'Invalid API key' });
    }
    const quota = checkQuota(entry.keyHash, entry.dailyQuota);
    if (!quota.ok) {
        return reply.code(429).send({ error: 'Daily quota exceeded', used: quota.used, limit: entry.dailyQuota });
    }
    bumpQuota(entry.keyHash);
    stmts.touchApiKey.run(entry.keyHash);
    req.apiKey = entry;
}

async function requireAdmin(req, reply) {
    if (!req.apiKey || !req.apiKey.isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
    }
}

module.exports = { authenticate, requireAdmin };
