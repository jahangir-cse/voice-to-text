const { config } = require('../config');
const { stmts, insertOrIgnoreMany, db } = require('../db');
const { normalize, normalizeMany } = require('../utils/normalize');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

function rowToResponse(row, number) {
    if (!row) {
        return {
            number,
            hasWhatsApp: null,
            hasTelegram: null,
            whatsappCheckedAt: null,
            telegramCheckedAt: null,
            status: 'unknown',
        };
    }
    const isCached = row.has_whatsapp !== null || row.has_telegram !== null;
    return {
        number: row.number,
        hasWhatsApp: row.has_whatsapp === null ? null : !!row.has_whatsapp,
        hasTelegram: row.has_telegram === null ? null : !!row.has_telegram,
        whatsappCheckedAt: row.whatsapp_checked_at
            ? new Date(row.whatsapp_checked_at * 1000).toISOString()
            : null,
        telegramCheckedAt: row.telegram_checked_at
            ? new Date(row.telegram_checked_at * 1000).toISOString()
            : null,
        status: isCached ? 'cached' : 'unknown',
    };
}

async function registerCheckRoutes(app, manager) {
    app.post('/api/check', {
        preHandler: [authenticate, rateLimit],
        schema: {
            body: {
                type: 'object',
                required: ['number'],
                properties: { number: { type: 'string', minLength: 8, maxLength: 20 } },
            },
        },
        handler: async (req, reply) => {
            const number = normalize(req.body.number);
            if (!number) return reply.code(400).send({ error: 'Invalid phone number' });
            let row = stmts.getNumber.get(number);
            if (!row) {
                stmts.insertOrIgnore.run(number, req.apiKey.branch);
                row = stmts.getNumber.get(number);
            }
            return rowToResponse(row, number);
        },
    });

    app.post('/api/batch', {
        preHandler: [authenticate, rateLimit],
        config: {
            rateCost: (req) =>
                Math.max(1, Math.ceil((req.body && Array.isArray(req.body.numbers) ? req.body.numbers.length : 1) / 10)),
        },
        schema: {
            body: {
                type: 'object',
                required: ['numbers'],
                properties: {
                    numbers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: config.batchMaxSize,
                        items: { type: 'string', minLength: 8, maxLength: 20 },
                    },
                },
            },
        },
        handler: async (req, reply) => {
            const numbers = normalizeMany(req.body.numbers);
            if (numbers.length === 0) return reply.code(400).send({ error: 'No valid numbers' });

            const rows = stmts.getNumbers.all(JSON.stringify(numbers));
            const byNumber = new Map(rows.map((r) => [r.number, r]));

            const missing = numbers.filter((n) => !byNumber.has(n));
            if (missing.length > 0) {
                insertOrIgnoreMany(missing, req.apiKey.branch);
            }

            return {
                results: numbers.map((n) => rowToResponse(byNumber.get(n) || null, n)),
                queued: missing.length,
            };
        },
    });

    app.post('/api/queue', {
        preHandler: [authenticate, rateLimit],
        schema: {
            body: {
                type: 'object',
                required: ['numbers'],
                properties: {
                    numbers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 1000,
                        items: { type: 'string' },
                    },
                    priority: { type: 'string', enum: ['normal', 'high'] },
                },
            },
        },
        handler: async (req, reply) => {
            const numbers = normalizeMany(req.body.numbers);
            if (numbers.length === 0) return reply.code(400).send({ error: 'No valid numbers' });
            const queued = insertOrIgnoreMany(numbers, req.apiKey.branch);
            return { received: numbers.length, queued, alreadyKnown: numbers.length - queued };
        },
    });

    // Real synchronous detection via in-process pool.
    // Performs live check against WhatsApp/Telegram via connected accounts and writes
    // results back to the SQLite cache before responding.
    app.post('/api/check-now', {
        preHandler: [authenticate, rateLimit],
        config: {
            rateCost: (req) =>
                Math.max(1, Math.ceil((req.body && Array.isArray(req.body.numbers) ? req.body.numbers.length : 1) / 5)),
        },
        schema: {
            body: {
                type: 'object',
                required: ['numbers', 'platform'],
                properties: {
                    numbers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        items: { type: 'string', minLength: 8, maxLength: 20 },
                    },
                    platform: { type: 'string', enum: ['whatsapp', 'telegram'] },
                },
            },
        },
        handler: async (req, reply) => {
            if (!manager) return reply.code(503).send({ error: 'Detection pool not initialized' });

            const numbers = normalizeMany(req.body.numbers);
            if (numbers.length === 0) return reply.code(400).send({ error: 'No valid numbers' });
            const platform = req.body.platform;

            insertOrIgnoreMany(numbers, req.apiKey.branch);

            if (platform === 'telegram') {
                const acc = manager.pickHealthyTelegram();
                if (!acc) return reply.code(503).send({ error: 'No connected Telegram account. Connect one in Settings.' });
                try {
                    const results = await acc.checkBatch(numbers);
                    const ts = Math.floor(Date.now() / 1000);
                    const tx = db.transaction(() => {
                        for (const r of results) {
                            stmts.updateTelegram.run(r.hasTelegram ? 1 : 0, ts, r.number);
                        }
                    });
                    tx();
                    const matched = results.filter((r) => r.hasTelegram).length;
                    return { ok: true, platform, scanned: results.length, matched, accountId: acc.id };
                } catch (err) {
                    return reply.code(502).send({ error: err.message || 'Telegram check failed' });
                }
            }

            // platform === 'whatsapp'
            const acc = manager.pickHealthyWhatsApp();
            if (!acc) return reply.code(503).send({ error: 'No connected WhatsApp account. Connect one in Settings.' });
            const ts = Math.floor(Date.now() / 1000);
            let matched = 0;
            const errors = [];
            req.log.info({ id: acc.id, total: numbers.length }, 'WhatsApp check-now start');
            for (let i = 0; i < numbers.length; i++) {
                const n = numbers[i];
                try {
                    const has = await acc.checkOne(n);
                    stmts.updateWhatsApp.run(has ? 1 : 0, ts, n);
                    if (has) matched++;
                    req.log.info({ id: acc.id, idx: i + 1, total: numbers.length, number: n, has }, 'WhatsApp checked');
                } catch (err) {
                    errors.push({ number: n, error: err.message });
                    req.log.warn({ id: acc.id, number: n, err: err.message }, 'WhatsApp check failed');
                }
                if (i < numbers.length - 1) {
                    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
                }
            }
            req.log.info({ id: acc.id, scanned: numbers.length, matched }, 'WhatsApp check-now done');
            return { ok: true, platform, scanned: numbers.length, matched, errors, accountId: acc.id };
        },
    });

    // DEMO endpoint — randomly assigns flags for demo/testing.
    // NOT a real detection. Useful when WhatsApp/Telegram pool sessions
    // are not yet logged in but a visual demo is needed.
    app.post('/api/demo-simulate', {
        preHandler: [authenticate, rateLimit],
        schema: {
            body: {
                type: 'object',
                required: ['numbers'],
                properties: {
                    numbers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 1000,
                        items: { type: 'string' },
                    },
                    platform: { type: 'string', enum: ['whatsapp', 'telegram', 'both'] },
                    waProbability: { type: 'number', minimum: 0, maximum: 1 },
                    tgProbability: { type: 'number', minimum: 0, maximum: 1 },
                },
            },
        },
        handler: async (req, reply) => {
            const numbers = normalizeMany(req.body.numbers);
            if (numbers.length === 0) return reply.code(400).send({ error: 'No valid numbers' });

            const platform = req.body.platform || 'both';
            const waProb = typeof req.body.waProbability === 'number' ? req.body.waProbability : 0.7;
            const tgProb = typeof req.body.tgProbability === 'number' ? req.body.tgProbability : 0.25;

            insertOrIgnoreMany(numbers, req.apiKey.branch);

            const ts = Math.floor(Date.now() / 1000);
            const tx = db.transaction(() => {
                for (const n of numbers) {
                    if (platform === 'whatsapp' || platform === 'both') {
                        const has = Math.random() < waProb ? 1 : 0;
                        stmts.updateWhatsApp.run(has, ts, n);
                    }
                    if (platform === 'telegram' || platform === 'both') {
                        const has = Math.random() < tgProb ? 1 : 0;
                        stmts.updateTelegram.run(has, ts, n);
                    }
                }
            });
            tx();

            const rows = stmts.getNumbers.all(JSON.stringify(numbers));
            const byNumber = new Map(rows.map((r) => [r.number, r]));
            return {
                simulated: true,
                platform,
                count: numbers.length,
                results: numbers.map((n) => rowToResponse(byNumber.get(n) || null, n)),
            };
        },
    });
}

module.exports = { registerCheckRoutes };
