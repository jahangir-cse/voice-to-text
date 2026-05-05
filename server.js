const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const CONTACTS_API_URL = process.env.CONTACTS_API_URL || '';
const CONTACTS_PATH = path.join(__dirname, 'contacts.json');

const app = express();

app.use(express.static(__dirname, { index: false }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index2.html'));
});

function loadLocalCache() {
    try {
        return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function saveLocalCache(contacts) {
    fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2) + '\n');
}

async function fetchUpstreamContacts() {
    if (!CONTACTS_API_URL) return null;
    const res = await fetch(CONTACTS_API_URL);
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    return data.map((c) => ({
        name: c.name || c.Name || '',
        number: String(c.number || c.Number || c.phone || c.Phone || ''),
    }));
}

function mergeUpstreamWithCache(upstream, cache) {
    const cacheByNumber = new Map(cache.map((c) => [c.number, c]));
    const merged = upstream.map((u) => {
        const cached = cacheByNumber.get(u.number);
        return {
            name: u.name,
            number: u.number,
            hasWhatsApp: cached ? cached.hasWhatsApp : null,
            checkedAt: cached ? cached.checkedAt : null,
        };
    });
    const upstreamNumbers = new Set(upstream.map((u) => u.number));
    for (const c of cache) {
        if (!upstreamNumbers.has(c.number)) merged.push(c);
    }
    return merged;
}

app.get('/api/contacts', async (req, res) => {
    try {
        const cache = loadLocalCache();
        if (!CONTACTS_API_URL) return res.json(cache);

        let upstream;
        try {
            upstream = await fetchUpstreamContacts();
        } catch (err) {
            console.warn('Upstream fetch failed, serving cache:', err.message);
            return res.json(cache);
        }

        const merged = mergeUpstreamWithCache(upstream, cache);
        saveLocalCache(merged);
        res.json(merged);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    const cache = loadLocalCache();
    const checked = cache.filter((c) => c.hasWhatsApp !== null).length;
    res.json({
        ok: true,
        total: cache.length,
        checked,
        unchecked: cache.length - checked,
        upstreamConfigured: !!CONTACTS_API_URL,
    });
});

app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
    console.log(
        CONTACTS_API_URL
            ? `Upstream contacts API: ${CONTACTS_API_URL}`
            : 'No upstream configured — serving local contacts.json only'
    );
});
