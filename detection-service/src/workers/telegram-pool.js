const { TelegramAccount } = require('./telegram-account');
const { config } = require('../config');
const { logger } = require('../utils/logger');
const { stmts } = require('../db');

async function detectFloodWait(err) {
    const msg = (err && (err.errorMessage || err.message)) || '';
    const m = msg.match(/FLOOD_WAIT_(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (err && typeof err.seconds === 'number') return err.seconds;
    return null;
}

class TelegramPool {
    constructor() {
        this.accounts = [];
        this.cursor = 0;
    }

    async start() {
        const ids = Array.from({ length: config.pool.telegramSize }, (_, i) => `tg-${i + 1}`);
        for (const id of ids) {
            const acc = new TelegramAccount(id);
            const ok = await acc.start();
            if (ok) this.accounts.push(acc);
            else logger.warn({ id }, 'Telegram account failed to start, skipping');
        }
        logger.info({ ready: this.accounts.length, total: ids.length }, 'Telegram pool started');
    }

    pickHealthy() {
        const n = this.accounts.length;
        if (n === 0) return null;
        for (let i = 0; i < n; i++) {
            const acc = this.accounts[(this.cursor + i) % n];
            if (acc.isHealthy()) {
                this.cursor = (this.cursor + i + 1) % n;
                return acc;
            }
        }
        return null;
    }

    async checkBatch(numbers) {
        const acc = this.pickHealthy();
        if (!acc) return { ok: false, reason: 'no-healthy-account' };
        try {
            const results = await acc.checkBatch(numbers);
            const ts = Math.floor(Date.now() / 1000);
            for (const { number, hasTelegram } of results) {
                stmts.updateTelegram.run(hasTelegram ? 1 : 0, ts, number);
            }
            return { ok: true, results };
        } catch (err) {
            const wait = await detectFloodWait(err);
            if (wait != null) {
                logger.warn({ id: acc.id, wait }, 'Telegram FloodWait — pausing this account');
                acc.status = `cooldown:${Date.now() + (wait + 1) * 1000}`;
                setTimeout(() => {
                    if (typeof acc.status === 'string' && acc.status.startsWith('cooldown:')) {
                        acc.status = 'active';
                    }
                }, (wait + 1) * 1000).unref();
                return { ok: false, reason: `flood_wait_${wait}` };
            }
            const msg = (err && err.message) || String(err);
            logger.error({ id: acc.id, err: msg }, 'Telegram batch failed');
            return { ok: false, reason: msg };
        }
    }

    activeAccountCount() {
        return this.accounts.filter((a) => a.isHealthy()).length;
    }

    async stop() {
        await Promise.all(this.accounts.map((a) => a.stop()));
    }
}

module.exports = { TelegramPool };
