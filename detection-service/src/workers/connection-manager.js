const fs = require('fs');
const path = require('path');
const bigInt = require('big-integer');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { config } = require('../config');
const { stmts } = require('../db');
const { logger } = require('../utils/logger');

// Connection lifecycle states for an account.
const STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    AWAITING_QR: 'awaiting_qr',
    AWAITING_OTP: 'awaiting_otp',
    AWAITING_2FA: 'awaiting_2fa',
    READY: 'ready',
    ERROR: 'error',
};

class WhatsAppAccountState {
    constructor(id) {
        this.id = id;
        this.type = 'whatsapp';
        this.dataPath = path.join(config.sessionsDir, 'whatsapp', id);
        this.client = null;
        this.state = STATES.DISCONNECTED;
        this.qr = null;
        this.error = null;
        this.todayCount = 0;
        this.todayDate = todayUtc();
    }

    isReady() { return this.state === STATES.READY; }

    isHealthy() {
        if (!this.isReady()) return false;
        const day = todayUtc();
        if (day !== this.todayDate) {
            this.todayDate = day;
            this.todayCount = 0;
        }
        return this.todayCount < config.pool.whatsappDailyLimit;
    }

    async startConnect() {
        if (this.state === STATES.CONNECTING || this.state === STATES.AWAITING_QR || this.state === STATES.READY) {
            return; // already in progress
        }
        this.state = STATES.CONNECTING;
        this.qr = null;
        this.error = null;

        fs.mkdirSync(this.dataPath, { recursive: true });
        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: this.id, dataPath: this.dataPath }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            },
        });

        this.client.on('qr', (qr) => {
            this.qr = qr;
            this.state = STATES.AWAITING_QR;
            logger.info({ id: this.id }, 'WhatsApp QR ready, awaiting scan');
        });
        this.client.on('authenticated', () => {
            logger.info({ id: this.id }, 'WhatsApp authenticated');
        });
        this.client.on('ready', () => {
            this.state = STATES.READY;
            this.qr = null;
            stmts.upsertAccount.run(this.id, 'whatsapp', this.todayDate);
            logger.info({ id: this.id }, 'WhatsApp account ready');
        });
        this.client.on('auth_failure', (msg) => {
            this.state = STATES.ERROR;
            this.error = `auth_failure: ${msg}`;
            stmts.setAccountStatus.run('banned', this.error, this.id);
            logger.error({ id: this.id, msg }, 'WhatsApp auth_failure');
        });
        this.client.on('disconnected', (reason) => {
            this.state = STATES.DISCONNECTED;
            this.error = `disconnected: ${reason}`;
            stmts.setAccountStatus.run('disconnected', this.error, this.id);
            logger.warn({ id: this.id, reason }, 'WhatsApp disconnected');
        });

        this.client.initialize().catch((err) => {
            this.state = STATES.ERROR;
            this.error = err.message;
            stmts.setAccountStatus.run('error', err.message, this.id);
            logger.error({ id: this.id, err: err.message }, 'WhatsApp init error');
        });
    }

    async checkOne(number) {
        if (!this.isHealthy()) throw new Error('account not ready');
        const result = await this.client.isRegisteredUser(`${number}@c.us`);
        this.todayCount++;
        stmts.bumpAccountToday.run(this.todayDate, 1, 1, this.todayDate, this.id);
        return !!result;
    }

    async disconnect() {
        try { if (this.client) await this.client.destroy(); } catch (_) {}
        try { fs.rmSync(this.dataPath, { recursive: true, force: true }); } catch (_) {}
        this.client = null;
        this.state = STATES.DISCONNECTED;
        this.qr = null;
        this.error = null;
        stmts.setAccountStatus.run('disconnected', null, this.id);
    }

    summary() {
        return {
            id: this.id, type: this.type, state: this.state,
            qr: this.qr, error: this.error,
            todayCount: this.todayCount,
        };
    }
}

class TelegramAccountState {
    constructor(id) {
        this.id = id;
        this.type = 'telegram';
        this.sessionPath = path.join(config.sessionsDir, 'telegram', `${id}.session`);
        this.client = null;
        this.state = STATES.DISCONNECTED;
        this.error = null;
        this.todayCount = 0;
        this.todayDate = todayUtc();
        // Pending login state:
        this.pendingPhone = null;
        this.pendingPhoneCodeHash = null;
        this.pendingResolvers = null; // resolves the ongoing client.start() callbacks
    }

    isReady() { return this.state === STATES.READY; }

    isHealthy() {
        if (!this.isReady()) return false;
        const day = todayUtc();
        if (day !== this.todayDate) {
            this.todayDate = day;
            this.todayCount = 0;
        }
        return this.todayCount < config.pool.telegramDailyLimit;
    }

    async tryRestoreSession() {
        try {
            if (!fs.existsSync(this.sessionPath)) return false;
            const sessionStr = fs.readFileSync(this.sessionPath, 'utf8');
            if (!sessionStr) return false;
            const { apiId, apiHash } = config.telegram;
            this.client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
            await this.client.connect();
            const me = await this.client.getMe();
            if (!me) return false;
            this.state = STATES.READY;
            stmts.upsertAccount.run(this.id, 'telegram', this.todayDate);
            logger.info({ id: this.id, user: me.username || me.phone }, 'Telegram session restored');
            return true;
        } catch (err) {
            logger.warn({ id: this.id, err: err.message }, 'Telegram session restore failed');
            this.state = STATES.DISCONNECTED;
            return false;
        }
    }

    async startConnect(phoneNumber) {
        const { apiId, apiHash } = config.telegram;
        if (!apiId || !apiHash) throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH not set');

        // Always start fresh
        try { if (this.client) await this.client.disconnect(); } catch (_) {}
        this.client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
        this.state = STATES.CONNECTING;
        this.error = null;
        this.pendingPhone = phoneNumber;

        await this.client.connect();
        const codeResult = await this.client.sendCode(
            { apiId, apiHash },
            phoneNumber
        );
        this.pendingPhoneCodeHash = codeResult.phoneCodeHash;
        this.state = STATES.AWAITING_OTP;
        logger.info({ id: this.id, phone: phoneNumber }, 'Telegram OTP sent, awaiting code');
    }

    async submitCode(code, password) {
        if (this.state !== STATES.AWAITING_OTP && this.state !== STATES.AWAITING_2FA) {
            throw new Error('Not awaiting code');
        }
        try {
            if (this.state === STATES.AWAITING_OTP) {
                await this.client.invoke(new Api.auth.SignIn({
                    phoneNumber: this.pendingPhone,
                    phoneCodeHash: this.pendingPhoneCodeHash,
                    phoneCode: code,
                }));
            }
            // After successful sign in or already past OTP
            await this.finalizeReady();
            return { ok: true };
        } catch (err) {
            const msg = err && (err.errorMessage || err.message) || String(err);
            if (msg.includes('SESSION_PASSWORD_NEEDED') || msg.includes('PASSWORD_HASH_INVALID')) {
                if (!password) {
                    this.state = STATES.AWAITING_2FA;
                    return { ok: false, awaiting2fa: true };
                }
                try {
                    const pwd = await this.client.invoke(new Api.account.GetPassword());
                    const { computeCheck } = require('telegram/Password');
                    const passwordSrpCheck = await computeCheck(pwd, password);
                    await this.client.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }));
                    await this.finalizeReady();
                    return { ok: true };
                } catch (e2) {
                    this.state = STATES.AWAITING_2FA;
                    this.error = e2.message;
                    return { ok: false, awaiting2fa: true, error: e2.message };
                }
            }
            this.state = STATES.ERROR;
            this.error = msg;
            return { ok: false, error: msg };
        }
    }

    async finalizeReady() {
        const sessionStr = this.client.session.save();
        fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
        fs.writeFileSync(this.sessionPath, sessionStr, { mode: 0o600 });
        this.state = STATES.READY;
        this.pendingPhone = null;
        this.pendingPhoneCodeHash = null;
        stmts.upsertAccount.run(this.id, 'telegram', this.todayDate);
        const me = await this.client.getMe();
        logger.info({ id: this.id, user: me.username || me.phone }, 'Telegram account ready');
    }

    async checkBatch(numbers) {
        if (!this.isHealthy()) throw new Error('account not ready');
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
            } catch (_) {}
        }

        this.todayCount += numbers.length;
        stmts.bumpAccountToday.run(this.todayDate, numbers.length, numbers.length, this.todayDate, this.id);

        return numbers.map((n, idx) => ({
            number: n, hasTelegram: matchedClientIds.has(idx.toString())
        }));
    }

    async disconnect() {
        try { if (this.client) await this.client.disconnect(); } catch (_) {}
        try { fs.rmSync(this.sessionPath, { force: true }); } catch (_) {}
        this.client = null;
        this.state = STATES.DISCONNECTED;
        this.error = null;
        this.pendingPhone = null;
        this.pendingPhoneCodeHash = null;
        stmts.setAccountStatus.run('disconnected', null, this.id);
    }

    summary() {
        return {
            id: this.id, type: this.type, state: this.state,
            error: this.error,
            todayCount: this.todayCount,
            pendingPhone: this.pendingPhone,
        };
    }
}

class ConnectionManager {
    constructor() {
        this.whatsapp = new Map();
        this.telegram = new Map();
    }

    async start() {
        const waIds = Array.from({ length: config.pool.whatsappSize }, (_, i) => `wa-${i + 1}`);
        const tgIds = Array.from({ length: config.pool.telegramSize }, (_, i) => `tg-${i + 1}`);

        for (const id of waIds) {
            const acc = new WhatsAppAccountState(id);
            this.whatsapp.set(id, acc);
            // Try to auto-restore if session exists
            if (fs.existsSync(acc.dataPath) && fs.readdirSync(acc.dataPath).length > 0) {
                acc.startConnect().catch(() => {});
            }
        }
        for (const id of tgIds) {
            const acc = new TelegramAccountState(id);
            this.telegram.set(id, acc);
            await acc.tryRestoreSession();
        }
        logger.info({ wa: this.whatsapp.size, tg: this.telegram.size }, 'ConnectionManager started');
    }

    listAll() {
        const wa = Array.from(this.whatsapp.values()).map((a) => a.summary());
        const tg = Array.from(this.telegram.values()).map((a) => a.summary());
        return { whatsapp: wa, telegram: tg };
    }

    getWhatsApp(id) { return this.whatsapp.get(id); }
    getTelegram(id) { return this.telegram.get(id); }

    pickHealthyWhatsApp() {
        for (const acc of this.whatsapp.values()) {
            if (acc.isHealthy()) return acc;
        }
        return null;
    }
    pickHealthyTelegram() {
        for (const acc of this.telegram.values()) {
            if (acc.isHealthy()) return acc;
        }
        return null;
    }
}

function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

module.exports = { ConnectionManager, STATES };
