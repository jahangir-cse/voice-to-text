const Fastify = require('fastify');
const helmet = require('@fastify/helmet');
const sensible = require('@fastify/sensible');
const { config } = require('./config');
const { runMigrations } = require('./db');
const { logger } = require('./utils/logger');
const { setErrorHandler } = require('./middleware/error');
const { registerCheckRoutes } = require('./routes/check');
const { registerHealthRoutes } = require('./routes/health');
const { registerAdminRoutes } = require('./routes/admin');
const { registerAccountRoutes } = require('./routes/accounts');
const { ConnectionManager } = require('./workers/connection-manager');

async function buildApp() {
    runMigrations();

    const manager = new ConnectionManager();
    await manager.start();

    const app = Fastify({
        loggerInstance: logger,
        trustProxy: true,
        bodyLimit: 256 * 1024,
        disableRequestLogging: false,
    });

    await app.register(helmet);
    await app.register(sensible);

    setErrorHandler(app);

    await registerHealthRoutes(app);
    await registerCheckRoutes(app, manager);
    await registerAccountRoutes(app, manager);
    await registerAdminRoutes(app);

    return { app, manager };
}

async function main() {
    const { app, manager } = await buildApp();
    try {
        await app.listen({ host: '0.0.0.0', port: config.port });
        logger.info({ port: config.port }, 'detection-service API running');
    } catch (err) {
        logger.error({ err }, 'Failed to start');
        process.exit(1);
    }

    const shutdown = async (sig) => {
        logger.info({ sig }, 'Shutting down API');
        try { await app.close(); } catch (_) {}
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
    main();
}

module.exports = { buildApp };
