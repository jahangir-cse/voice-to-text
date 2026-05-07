const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
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
        console.error('Usage: npm run login-whatsapp -- --account wa-1');
        process.exit(1);
    }

    const dataPath = path.join(config.sessionsDir, 'whatsapp', account);
    fs.mkdirSync(dataPath, { recursive: true });

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: account, dataPath }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    });

    client.on('qr', (qr) => {
        console.log(`\nScan QR with WhatsApp > Linked Devices (account: ${account}):\n`);
        qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
        console.log('Authenticated. Saving session...');
    });

    client.on('ready', async () => {
        const info = client.info;
        console.log(`\n✅ Ready. Logged in as: ${info.pushname || info.wid?._serialized}`);
        console.log(`Session saved to: ${dataPath}`);
        await client.destroy();
        process.exit(0);
    });

    client.on('auth_failure', (msg) => {
        console.error('Auth failed:', msg);
        process.exit(1);
    });

    console.log(`Initializing WhatsApp client for ${account}...`);
    client.initialize();
})().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
});
