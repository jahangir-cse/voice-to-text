const { WhatsAppAccount } = require('./whatsapp-account');
const { config } = require('../config');
const { logger } = require('../utils/logger');
const { stmts } = require('../db');

class WhatsAppPool {
    constructor() {
        this.accounts = [];
        this.cursor = 0;
    }

    async start() {
        const ids = Array.from({ length: config.pool.whatsappSize }, (_, i) => `wa-${i + 1}`);
        for (const id of ids) {
            const acc = new WhatsAppAccount(id);
            const ok = await acc.start();
            if (ok) this.accounts.push(acc);
            else logger.warn({ id }, 'WhatsApp account failed to start, skipping');
        }
        logger.info({ ready: this.accounts.length, total: ids.length }, 'WhatsApp pool started');
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

    async checkOne(number) {
        const acc = this.pickHealthy();
        if (!acc) return { ok: false, reason: 'no-healthy-account' };
        try {
            const has = await acc.checkOne(number);
            stmts.updateWhatsApp.run(has ? 1 : 0, Math.floor(Date.now() / 1000), number);
            return { ok: true, has };
        } catch (err) {
            const msg = (err && err.message) || String(err);
            logger.warn({ id: acc.id, number, err: msg }, 'WhatsApp check failed');
            if (/banned|auth_failure/i.test(msg)) {
                acc.status = 'banned';
                stmts.setAccountStatus.run('banned', msg, acc.id);
            }
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

module.exports = { WhatsAppPool };
