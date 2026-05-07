const { runMigrations } = require('../db');
const { logger } = require('../utils/logger');
const { WhatsAppPool } = require('./whatsapp-pool');
const { TelegramPool } = require('./telegram-pool');
const { runWhatsAppLoop, runTelegramLoop } = require('./queue-runner');

(async () => {
    runMigrations();
    logger.info('Worker starting up');

    const wa = new WhatsAppPool();
    const tg = new TelegramPool();

    await Promise.all([wa.start(), tg.start()]);

    if (wa.activeAccountCount() === 0 && tg.activeAccountCount() === 0) {
        logger.warn('No active detection accounts. Worker will idle. Run login scripts to set up sessions.');
    }

    runWhatsAppLoop(wa).catch((err) => logger.error({ err: err.message }, 'WhatsApp loop crashed'));
    runTelegramLoop(tg).catch((err) => logger.error({ err: err.message }, 'Telegram loop crashed'));

    const shutdown = async (sig) => {
        logger.info({ sig }, 'Worker shutting down');
        await Promise.all([wa.stop(), tg.stop()]);
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('Worker running');
})().catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'Worker fatal');
    process.exit(1);
});
