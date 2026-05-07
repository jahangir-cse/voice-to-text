const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Run schema before preparing statements (idempotent CREATE IF NOT EXISTS)
{
    const schemaPath = path.join(__dirname, 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

const stmts = {
    getNumber: db.prepare(`
        SELECT number, has_whatsapp, whatsapp_checked_at, has_telegram, telegram_checked_at
        FROM numbers WHERE number = ?
    `),

    getNumbers: db.prepare(`
        SELECT number, has_whatsapp, whatsapp_checked_at, has_telegram, telegram_checked_at
        FROM numbers WHERE number IN (SELECT value FROM json_each(?))
    `),

    insertOrIgnore: db.prepare(`
        INSERT OR IGNORE INTO numbers (number, source)
        VALUES (?, ?)
    `),

    updateWhatsApp: db.prepare(`
        UPDATE numbers
        SET has_whatsapp = ?, whatsapp_checked_at = ?, updated_at = unixepoch()
        WHERE number = ?
    `),

    updateTelegram: db.prepare(`
        UPDATE numbers
        SET has_telegram = ?, telegram_checked_at = ?, updated_at = unixepoch()
        WHERE number = ?
    `),

    pendingWhatsApp: db.prepare(`
        SELECT number FROM numbers
        WHERE has_whatsapp IS NULL
           OR whatsapp_checked_at < unixepoch() - ?
        ORDER BY COALESCE(whatsapp_checked_at, 0) ASC
        LIMIT ?
    `),

    pendingTelegram: db.prepare(`
        SELECT number FROM numbers
        WHERE has_telegram IS NULL
           OR telegram_checked_at < unixepoch() - ?
        ORDER BY COALESCE(telegram_checked_at, 0) ASC
        LIMIT ?
    `),

    countTotal: db.prepare(`SELECT COUNT(*) AS c FROM numbers`),
    countCheckedWA: db.prepare(`SELECT COUNT(*) AS c FROM numbers WHERE has_whatsapp IS NOT NULL`),
    countCheckedTG: db.prepare(`SELECT COUNT(*) AS c FROM numbers WHERE has_telegram IS NOT NULL`),
    countQueueWA: db.prepare(`SELECT COUNT(*) AS c FROM numbers WHERE has_whatsapp IS NULL`),
    countQueueTG: db.prepare(`SELECT COUNT(*) AS c FROM numbers WHERE has_telegram IS NULL`),

    insertApiKey: db.prepare(`
        INSERT INTO api_keys (key_hash, branch_name, daily_quota, is_admin)
        VALUES (?, ?, ?, ?)
    `),
    listApiKeys: db.prepare(`
        SELECT branch_name, daily_quota, is_admin, created_at, last_used_at
        FROM api_keys ORDER BY created_at DESC
    `),
    getApiKeyByHash: db.prepare(`
        SELECT key_hash, branch_name, daily_quota, is_admin
        FROM api_keys WHERE key_hash = ?
    `),
    getAllApiKeys: db.prepare(`
        SELECT key_hash, branch_name, daily_quota, is_admin
        FROM api_keys
    `),
    touchApiKey: db.prepare(`
        UPDATE api_keys SET last_used_at = unixepoch() WHERE key_hash = ?
    `),

    getApiUsage: db.prepare(`
        SELECT count FROM api_usage WHERE key_hash = ? AND day = ?
    `),
    incrementApiUsage: db.prepare(`
        INSERT INTO api_usage (key_hash, day, count) VALUES (?, ?, 1)
        ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1
    `),

    upsertAccount: db.prepare(`
        INSERT INTO accounts (id, type, status, today_date, last_active_at)
        VALUES (?, ?, 'active', ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET last_active_at = unixepoch()
    `),
    getAccount: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
    getAllAccounts: db.prepare(`SELECT * FROM accounts ORDER BY id`),
    setAccountStatus: db.prepare(`
        UPDATE accounts SET status = ?, last_error = ?, last_error_at = unixepoch() WHERE id = ?
    `),
    bumpAccountToday: db.prepare(`
        UPDATE accounts
        SET today_count = CASE WHEN today_date = ? THEN today_count + ? ELSE ? END,
            today_date = ?,
            last_active_at = unixepoch()
        WHERE id = ?
    `),
};

function runMigrations() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(sql);
}

const insertOrIgnoreMany = db.transaction((numbers, source) => {
    let inserted = 0;
    for (const n of numbers) {
        const r = stmts.insertOrIgnore.run(n, source);
        inserted += r.changes;
    }
    return inserted;
});

module.exports = {
    db,
    stmts,
    runMigrations,
    insertOrIgnoreMany,
};
