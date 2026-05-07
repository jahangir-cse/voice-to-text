const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function int(name, fallback) {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid integer for env ${name}: ${v}`);
    return n;
}

function str(name, fallback) {
    const v = process.env[name];
    return v === undefined || v === '' ? fallback : v;
}

function required(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env ${name}`);
    return v;
}

const config = {
    port: int('PORT', 4000),
    nodeEnv: str('NODE_ENV', 'production'),
    logLevel: str('LOG_LEVEL', 'info'),

    dbPath: path.resolve(__dirname, '..', str('DB_PATH', './data/numbers.db')),
    sessionsDir: path.resolve(__dirname, '..', 'sessions'),

    telegram: {
        apiId: int('TELEGRAM_API_ID', 0),
        apiHash: str('TELEGRAM_API_HASH', ''),
    },

    pool: {
        whatsappSize: int('WHATSAPP_POOL_SIZE', 5),
        telegramSize: int('TELEGRAM_POOL_SIZE', 2),
        whatsappDailyLimit: int('WHATSAPP_DAILY_LIMIT', 1000),
        telegramDailyLimit: int('TELEGRAM_DAILY_LIMIT', 10000),
    },

    cache: {
        ttlDays: int('CACHE_TTL_DAYS', 30),
    },

    queue: {
        pollIntervalSec: int('QUEUE_POLL_INTERVAL', 30),
    },

    rateLimit: {
        perMinute: int('RATE_LIMIT_PER_MINUTE', 600),
        burstPerSecond: int('RATE_LIMIT_BURST_PER_SECOND', 20),
    },

    batchMaxSize: int('BATCH_MAX_SIZE', 100),
};

module.exports = { config, required };
