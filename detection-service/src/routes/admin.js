const { stmts } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');

async function registerAdminRoutes(app) {
    app.get('/admin/stats', {
        preHandler: [authenticate, requireAdmin, rateLimit],
        handler: async () => {
            const totals = {
                totalNumbers: stmts.countTotal.get().c,
                checked: {
                    whatsapp: stmts.countCheckedWA.get().c,
                    telegram: stmts.countCheckedTG.get().c,
                },
                queue: {
                    whatsapp: stmts.countQueueWA.get().c,
                    telegram: stmts.countQueueTG.get().c,
                },
                accounts: stmts.getAllAccounts.all().map((a) => ({
                    id: a.id,
                    type: a.type,
                    status: a.status,
                    todayCount: a.today_count,
                    todayDate: a.today_date,
                    lastActiveAt: a.last_active_at
                        ? new Date(a.last_active_at * 1000).toISOString()
                        : null,
                    lastError: a.last_error,
                })),
            };
            return totals;
        },
    });

    app.get('/admin/keys', {
        preHandler: [authenticate, requireAdmin, rateLimit],
        handler: async () => ({ keys: stmts.listApiKeys.all() }),
    });
}

module.exports = { registerAdminRoutes };
