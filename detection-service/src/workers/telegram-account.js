const fs = require('fs');
const path = require('path');
const bigInt = require('big-integer');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { config } = require('../config');
const { stmts } = require('../db');
const { logger } = require('../utils/logger');

class TelegramAccount {
    constructor(id) {
        this.id = id;
        this.sessionPath = path.join(config.sessionsDir, 'telegram', `${id}.session`);
        this.status = 'starting';
        this.todayCount = 0;
        this.todayDate = todayUtc();
        this.client = null;
    }

    loadSession() {
        try { return fs.readFileSync(this.sessionPath, 'utf8'); } catch { return ''; }
    }

    async start() {
        const sessionStr = this.loadSession();
        if (!sessionStr) {
            this.status = 'no-session';
            logger.warn({ id: this.id }, 'Telegram session missing — run npm run login-telegram -- --account ' + this.id);
            return false;
        }
        const { apiId, apiHash } = config.telegram;
        if (!apiId || !apiHash) {
            this.status = 'misconfigured';
            logger.error({ id: this.id }, 'TELEGRAM_API_ID / TELEGRAM_API_HASH missing in .env');
            return false;
        }
        this.client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
        try {
            await this.client.connect();
            const me = await this.client.getMe();
            this.status = 'active';
            stmts.upsertAccount.run(this.id, 'telegram', this.todayDate);
            logger.info({ id: this.id, user: me.username || me.phone }, 'Telegram account ready');
            return true;
        } catch (err) {
            this.status = 'error';
            stmts.setAccountStatus.run('error', err.message, this.id);
            logger.error({ id: this.id, err: err.message }, 'Telegram connect failed');
            return false;
        }
    }

    isHealthy() {
        if (this.status !== 'active') return false;
        const day = todayUtc();
        if (day !== this.todayDate) {
            this.todayDate = day;
            this.todayCount = 0;
        }
        return this.todayCount < config.pool.telegramDailyLimit;
    }

    async checkBatch(numbers) {
        if (!this.isHealthy()) throw new Error('account not healthy');
        const inputContacts = numbers.map((n, idx) =>
            new Api.InputPhoneContact({
                clientId: bigInt(idx),
                phone: '+' + n,
                firstName: 'Lookup_' + idx,
                lastName: '',
            })
        );

        const result = await this.client.invoke(
            new Api.contacts.ImportContacts({ contacts: inputContacts })
        );

        const matchedClientIds = new Set(
            (result.imported || []).map((imp) => imp.clientId.toString())
        );

        const cleanupUsers = (result.users || [])
            .filter((u) => u && u.id && u.accessHash)
            .map((u) => new Api.InputUser({ userId: u.id, accessHash: u.accessHash }));

        if (cleanupUsers.length > 0) {
            try {
                await this.client.invoke(new Api.contacts.DeleteContacts({ id: cleanupUsers }));
            } catch (e) {
                logger.warn({ id: this.id, err: e.message }, 'Telegram cleanup contacts failed (non-critical)');
            }
        }

        this.todayCount += numbers.length;
        stmts.bumpAccountToday.run(this.todayDate, numbers.length, numbers.length, this.todayDate, this.id);

        return numbers.map((n, idx) => ({ number: n, hasTelegram: matchedClientIds.has(idx.toString()) }));
    }

    async stop() {
        if (this.client) {
            try { await this.client.disconnect(); } catch (_) {}
        }
    }
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

module.exports = { TelegramAccount };
