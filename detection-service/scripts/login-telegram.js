const fs = require('fs');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { config } = require('../src/config');

function parseArgs() {
    const args = { account: null };
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === '--account') args.account = process.argv[++i];
    }
    return args;
}

(async () => {
    const { account } = parseArgs();
    if (!account) {
        console.error('Usage: npm run login-telegram -- --account tg-1');
        process.exit(1);
    }

    const { apiId, apiHash } = config.telegram;
    if (!apiId || !apiHash) {
        console.error('TELEGRAM_API_ID / TELEGRAM_API_HASH not set in .env. Get them from https://my.telegram.org');
        process.exit(1);
    }

    const sessionPath = path.join(config.sessionsDir, 'telegram', `${account}.session`);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

    const existing = fs.existsSync(sessionPath) ? fs.readFileSync(sessionPath, 'utf8') : '';
    const client = new TelegramClient(new StringSession(existing), apiId, apiHash, { connectionRetries: 5 });

    console.log(`Logging in Telegram account ${account}...`);
    await client.start({
        phoneNumber: async () => await input.text('Phone number (international, e.g., +8801XXXXXXXXX): '),
        password: async () => await input.text('2FA password (blank if none): '),
        phoneCode: async () => await input.text('Code received via Telegram/SMS: '),
        onError: (err) => console.error('Login error:', err.message || err),
    });

    fs.writeFileSync(sessionPath, client.session.save(), { mode: 0o600 });
    const me = await client.getMe();
    console.log(`\n✅ Logged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || me.phone})`);
    console.log(`Session saved to: ${sessionPath}`);
    await client.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
});
