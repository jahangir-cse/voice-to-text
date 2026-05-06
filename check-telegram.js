const fs = require('fs');
const path = require('path');
const input = require('input');
const bigInt = require('big-integer');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
} catch (e) { console.warn('Could not load .env:', e.message); }

const SESSION_PATH = path.join(__dirname, '.session');
const CONTACTS_PATH = path.join(__dirname, 'contacts.json');
const TTL_DAYS = 30;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1500;

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const apiHash = process.env.TELEGRAM_API_HASH || '';

if (!apiId || !apiHash) {
    console.error('\nERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH required.');
    console.error('1. Visit https://my.telegram.org and login with your phone');
    console.error('2. API development tools → Create application');
    console.error('3. Add to .env file in project root:');
    console.error('   TELEGRAM_API_ID=12345');
    console.error('   TELEGRAM_API_HASH=abcd1234efgh...\n');
    process.exit(1);
}

function loadSession() {
    try { return fs.readFileSync(SESSION_PATH, 'utf8'); } catch { return ''; }
}

function saveSession(s) {
    fs.writeFileSync(SESSION_PATH, s, { mode: 0o600 });
}

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

async function detectFloodWait(err) {
    const msg = (err && (err.errorMessage || err.message)) || '';
    const m = msg.match(/FLOOD_WAIT_(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (err && typeof err.seconds === 'number') return err.seconds;
    return null;
}

(async () => {
    const session = new StringSession(loadSession());
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

    console.log('Connecting to Telegram...');
    await client.start({
        phoneNumber: async () => await input.text('Phone number (international, e.g., +8801XXXXXXXXX): '),
        password: async () => await input.text('2FA password (if enabled, otherwise leave blank): '),
        phoneCode: async () => await input.text('Code received via SMS/Telegram: '),
        onError: (err) => console.error('Login error:', err.message || err),
    });

    saveSession(client.session.save());
    const me = await client.getMe();
    console.log(`\nLogged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || me.phone})\n`);

    const contacts = loadContacts();
    const targets = contacts.filter((c) =>
        c.hasTelegram === undefined || c.hasTelegram === null || isStale(c.telegramCheckedAt)
    );

    if (targets.length === 0) {
        console.log('Nothing to check (all entries fresh). Exiting.');
        await client.disconnect();
        process.exit(0);
    }

    console.log(`Checking ${targets.length} of ${contacts.length} numbers in batches of ${BATCH_SIZE}...\n`);

    let processed = 0;
    let matched = 0;
    const cleanupUsers = [];

    for (let i = 0; i < targets.length; ) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        const inputContacts = batch.map((c, idx) =>
            new Api.InputPhoneContact({
                clientId: bigInt(i + idx),
                phone: '+' + c.number,
                firstName: 'Lookup_' + (i + idx),
                lastName: '',
            })
        );

        try {
            const result = await client.invoke(
                new Api.contacts.ImportContacts({ contacts: inputContacts })
            );

            const matchedClientIds = new Set(
                (result.imported || []).map((imp) => imp.clientId.toString())
            );

            const now = new Date().toISOString();
            for (let idx = 0; idx < batch.length; idx++) {
                const cid = (i + idx).toString();
                const isMatched = matchedClientIds.has(cid);
                batch[idx].hasTelegram = isMatched;
                batch[idx].telegramCheckedAt = now;
                if (isMatched) matched++;
            }

            for (const u of (result.users || [])) {
                if (u && u.id && u.accessHash) {
                    cleanupUsers.push({ userId: u.id, accessHash: u.accessHash });
                }
            }

            console.log(
                `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${
                    (result.imported || []).length
                } of ${batch.length} matched`
            );

            saveContacts(contacts);
            processed += batch.length;
            i += BATCH_SIZE;
        } catch (err) {
            const wait = await detectFloodWait(err);
            if (wait != null) {
                console.warn(`  FloodWait: sleeping ${wait}s before retry...`);
                await sleep((wait + 1) * 1000);
                continue;
            }
            console.error(`  Batch failed:`, err.message || err);
            i += BATCH_SIZE;
        }

        if (i < targets.length) await sleep(BATCH_DELAY_MS);
    }

    saveContacts(contacts);
    console.log(`\nDone. Checked ${processed}, matched ${matched} on Telegram.`);

    if (cleanupUsers.length > 0) {
        try {
            console.log(`Cleaning up ${cleanupUsers.length} imported contacts...`);
            const inputUsers = cleanupUsers.map(
                (u) => new Api.InputUser({ userId: u.userId, accessHash: u.accessHash })
            );
            for (let j = 0; j < inputUsers.length; j += 100) {
                await client.invoke(
                    new Api.contacts.DeleteContacts({ id: inputUsers.slice(j, j + 100) })
                );
            }
            console.log('Cleanup done.');
        } catch (err) {
            console.warn('Cleanup failed (non-critical):', err.message || err);
        }
    }

    await client.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
