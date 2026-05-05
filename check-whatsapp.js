const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const CONTACTS_PATH = path.join(__dirname, 'contacts.json');
const TTL_DAYS = 30;
const MIN_DELAY_MS = 5000;
const JITTER_MS = 2000;
const FLUSH_EVERY = 10;

function loadContacts() {
    return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf8'));
}

function saveContacts(contacts) {
    fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2) + '\n');
}

function isStale(checkedAt) {
    if (!checkedAt) return true;
    const ageMs = Date.now() - new Date(checkedAt).getTime();
    return ageMs > TTL_DAYS * 24 * 60 * 60 * 1000;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

client.on('qr', (qr) => {
    console.log('\nScan this QR with WhatsApp > Linked Devices:');
    qrcode.generate(qr, { small: true });
});

client.on('auth_failure', (msg) => {
    console.error('Auth failed:', msg);
    process.exit(1);
});

client.on('ready', async () => {
    console.log(`\nLogged in as: ${client.info.pushname}`);

    const contacts = loadContacts();
    const targets = contacts.filter(
        (c) => c.hasWhatsApp === null || isStale(c.checkedAt)
    );

    if (targets.length === 0) {
        console.log('Nothing to check (all entries fresh). Exiting.');
        await client.destroy();
        process.exit(0);
    }

    console.log(`Checking ${targets.length} of ${contacts.length} numbers...\n`);

    let processed = 0;
    for (const contact of targets) {
        const wid = `${contact.number}@c.us`;
        try {
            const registered = await client.isRegisteredUser(wid);
            contact.hasWhatsApp = !!registered;
            contact.checkedAt = new Date().toISOString();
            console.log(
                `  ${contact.number}  ${contact.name || ''}  -> ${
                    registered ? 'WhatsApp' : 'no WhatsApp'
                }`
            );
        } catch (err) {
            console.error(`  ${contact.number} failed:`, err.message);
        }

        processed += 1;
        if (processed % FLUSH_EVERY === 0) saveContacts(contacts);

        if (processed < targets.length) {
            await sleep(MIN_DELAY_MS + Math.random() * JITTER_MS);
        }
    }

    saveContacts(contacts);
    console.log(`\nDone. ${processed} numbers checked.`);
    await client.destroy();
    process.exit(0);
});

console.log('Initializing WhatsApp client...');
client.initialize();
