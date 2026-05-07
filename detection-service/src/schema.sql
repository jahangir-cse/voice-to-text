-- Core lookup table
CREATE TABLE IF NOT EXISTS numbers (
    number TEXT PRIMARY KEY,
    has_whatsapp INTEGER,
    whatsapp_checked_at INTEGER,
    has_telegram INTEGER,
    telegram_checked_at INTEGER,
    source TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_wa_pending
    ON numbers(whatsapp_checked_at)
    WHERE has_whatsapp IS NULL;

CREATE INDEX IF NOT EXISTS idx_tg_pending
    ON numbers(telegram_checked_at)
    WHERE has_telegram IS NULL;

CREATE INDEX IF NOT EXISTS idx_wa_stale ON numbers(whatsapp_checked_at);
CREATE INDEX IF NOT EXISTS idx_tg_stale ON numbers(telegram_checked_at);

-- API authentication
CREATE TABLE IF NOT EXISTS api_keys (
    key_hash TEXT PRIMARY KEY,
    branch_name TEXT NOT NULL,
    daily_quota INTEGER NOT NULL DEFAULT 100000,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER
);

-- Detection account health
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    today_count INTEGER NOT NULL DEFAULT 0,
    today_date TEXT,
    last_active_at INTEGER,
    last_error TEXT,
    last_error_at INTEGER
);

-- Per-API-key daily usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
    key_hash TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key_hash, day)
);
