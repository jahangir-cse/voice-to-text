const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { stmts } = require('../db');
const { logger } = require('../utils/logger');
const { config } = require('../config');

class WhatsAppAccount {
    constructor(id) {
        this.id = id;
        this.dataPath = path.join(config.sessionsDir, 'whatsapp', id);
        this.status = 'starting';
        this.todayCount = 0;
        this.todayDate = todayUtc();
        this.client = null;
    }

    async start() {
        if (!fs.existsSync(this.dataPath)) {
            this.status = 'no-session';
            logger.warn({ id: this.id, dataPath: this.dataPath }, 'WhatsApp session missing — run npm run login-whatsapp -- --account ' + this.id);
            return false;
        }
        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: this.id, dataPath: this.dataPath }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            },
        });

        return new Promise((resolve) => {
            this.client.on('ready', () => {
                this.status = 'active';
                stmts.upsertAccount.run(this.id, 'whatsapp', this.todayDate);
                logger.info({ id: this.id }, 'WhatsApp account ready');
                resolve(true);
            });
            this.client.on('auth_failure', (msg) => {
                this.status = 'banned';
                stmts.setAccountStatus.run('banned', `auth_failure: ${msg}`, this.id);
                logger.error({ id: this.id, msg }, 'WhatsApp auth_failure');
                resolve(false);
            });
            this.client.on('disconnected', (reason) => {
                this.status = 'disconnected';
                stmts.setAccountStatus.run('disconnected', `disconnected: ${reason}`, this.id);
                logger.warn({ id: this.id, reason }, 'WhatsApp disconnected');
            });
            this.client.initialize().catch((err) => {
                this.status = 'error';
                stmts.setAccountStatus.run('error', err.message, this.id);
                logger.error({ id: this.id, err: err.message }, 'WhatsApp init error');
                resolve(false);
            });
        });
    }

    isHealthy() {
        if (this.status !== 'active') return false;
        const day = todayUtc();
        if (day !== this.todayDate) {
            this.todayDate = day;
            this.todayCount = 0;
        }
        return this.todayCount < config.pool.whatsappDailyLimit;
    }

    async checkOne(number) {
        if (!this.isHealthy()) throw new Error('account not healthy');
        const result = await this.client.isRegisteredUser(`${number}@c.us`);
        this.todayCount++;
        stmts.bumpAccountToday.run(this.todayDate, 1, 1, this.todayDate, this.id);
        return !!result;
    }

    async stop() {
        if (this.client) {
            try { await this.client.destroy(); } catch (_) {}
        }
    }
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

module.exports = { WhatsAppAccount };
