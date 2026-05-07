const { config } = require('../config');
const { stmts } = require('../db');
const { logger } = require('../utils/logger');

const MIN_WA_DELAY_MS = 5000;
const WA_JITTER_MS = 2000;
const TG_BATCH_SIZE = 100;
const TG_BATCH_DELAY_MS = 1500;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function staleSeconds() {
    return config.cache.ttlDays * 24 * 60 * 60;
}

async function runWhatsAppLoop(pool) {
    while (true) {
        if (pool.activeAccountCount() === 0) {
            await sleep(60_000);
            continue;
        }

        const limit = Math.max(1, pool.activeAccountCount() * 5);
        const rows = stmts.pendingWhatsApp.all(staleSeconds(), limit);
        if (rows.length === 0) {
            await sleep(config.queue.pollIntervalSec * 1000);
            continue;
        }

        for (const { number } of rows) {
            await pool.checkOne(number);
            await sleep(MIN_WA_DELAY_MS + Math.random() * WA_JITTER_MS);
        }
    }
}

async function runTelegramLoop(pool) {
    while (true) {
        if (pool.activeAccountCount() === 0) {
            await sleep(60_000);
            continue;
        }

        const rows = stmts.pendingTelegram.all(staleSeconds(), TG_BATCH_SIZE);
        if (rows.length === 0) {
            await sleep(config.queue.pollIntervalSec * 1000);
            continue;
        }

        const numbers = rows.map((r) => r.number);
        const result = await pool.checkBatch(numbers);
        if (!result.ok) {
            logger.warn({ reason: result.reason, count: numbers.length }, 'Telegram batch failed, backing off');
            await sleep(10_000);
            continue;
        }
        await sleep(TG_BATCH_DELAY_MS);
    }
}

module.exports = { runWhatsAppLoop, runTelegramLoop };
