const fs = require('fs');
const path = require('path');
const express = require('express');

// Minimal .env loader (no external dep)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
} catch (e) { console.warn('Could not load .env:', e.message); }

const PORT = process.env.PORT || 3000;
const CONTACTS_API_URL = process.env.CONTACTS_API_URL || '';
const CONTACTS_PATH = path.join(__dirname, 'contacts.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const app = express();

app.use(express.json({ limit: '256kb' }));
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

app.post('/api/summarize', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        }
        const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
        if (!text) return res.status(400).json({ error: 'text required' });
        if (text.length > 20000) return res.status(413).json({ error: 'text too long' });

        const prompt =
            'Summarize the following text in 2-3 short sentences. ' +
            'CRITICAL: Write the summary in the SAME language as the input. ' +
            'If the input is in Bengali, reply in Bengali. ' +
            'If the input is in English, reply in English. ' +
            'Do not translate. Output ONLY the summary — no preamble, labels, bullets, or quotes.\n\n' +
            '---INPUT---\n' + text + '\n---END---';

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1024,
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
        });

        if (!upstream.ok) {
            const errBody = await upstream.text();
            console.error('Gemini error', upstream.status, errBody);
            return res.status(502).json({ error: `Gemini ${upstream.status}` });
        }
        const data = await upstream.json();
        const summary = (data.candidates?.[0]?.content?.parts || [])
            .map((p) => p.text || '')
            .join('')
            .trim();
        if (!summary) return res.status(502).json({ error: 'empty summary' });
        res.json({ summary });
    } catch (err) {
        console.error('summarize failed:', err);
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
    console.log(
        GEMINI_API_KEY
            ? `Gemini summarize: enabled (${GEMINI_MODEL})`
            : 'Gemini summarize: disabled (set GEMINI_API_KEY in .env)'
    );
});
