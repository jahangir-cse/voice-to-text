const { stmts } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');
const { normalizeMany } = require('../utils/normalize');
const { logger } = require('../utils/logger');

async function registerAccountRoutes(app, manager) {

    app.get('/api/accounts', {
        preHandler: [authenticate, rateLimit],
        handler: async () => manager.listAll(),
    });

    // ---------- WhatsApp ----------

    app.post('/api/accounts/:id/whatsapp/connect', {
        preHandler: [authenticate, rateLimit],
        handler: async (req, reply) => {
            const acc = manager.getWhatsApp(req.params.id);
            if (!acc) return reply.code(404).send({ error: 'Account not found' });
            await acc.startConnect();
            return acc.summary();
        },
    });

    app.get('/api/accounts/:id/whatsapp/status', {
        preHandler: [authenticate, rateLimit],
        handler: async (req, reply) => {
            const acc = manager.getWhatsApp(req.params.id);
            if (!acc) return reply.code(404).send({ error: 'Account not found' });
            return acc.summary();
        },
    });

    // ---------- Telegram ----------

    app.post('/api/accounts/:id/telegram/connect', {
        preHandler: [authenticate, rateLimit],
        schema: {
            body: {
                type: 'object',
                required: ['phone'],
                properties: { phone: { type: 'string', minLength: 8, maxLength: 20 } },
            },
        },
        handler: async (req, reply) => {
            const acc = manager.getTelegram(req.params.id);
            if (!acc) return reply.code(404).send({ error: 'Account not found' });
            try {
                let phone = String(req.body.phone).trim();
                if (!phone.startsWith('+')) phone = '+' + phone;
                await acc.startConnect(phone);
                return acc.summary();
            } catch (err) {
                logger.error({ id: acc.id, err: err.message }, 'Telegram connect failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    app.post('/api/accounts/:id/telegram/verify', {
        preHandler: [authenticate, rateLimit],
        schema: {
            body: {
                type: 'object',
                required: ['code'],
                properties: {
                    code: { type: 'string', minLength: 1, maxLength: 20 },
                    password: { type: 'string', maxLength: 200 },
                },
            },
        },
        handler: async (req, reply) => {
            const acc = manager.getTelegram(req.params.id);
            if (!acc) return reply.code(404).send({ error: 'Account not found' });
            const result = await acc.submitCode(req.body.code, req.body.password || '');
            return { ...result, account: acc.summary() };
        },
    });

    // ---------- Generic ----------

    app.post('/api/accounts/:id/disconnect', {
        preHandler: [authenticate, rateLimit],
        handler: async (req, reply) => {
            const id = req.params.id;
            const acc = manager.getWhatsApp(id) || manager.getTelegram(id);
            if (!acc) return reply.code(404).send({ error: 'Account not found' });
            await acc.disconnect();
            return acc.summary();
        },
    });
}

module.exports = { registerAccountRoutes };
