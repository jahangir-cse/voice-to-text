const startedAt = Date.now();
const pkg = require('../../package.json');

async function registerHealthRoutes(app) {
    app.get('/health', async () => ({
        ok: true,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        version: pkg.version,
    }));

    app.get('/ready', async () => ({ ok: true }));
}

module.exports = { registerHealthRoutes };
