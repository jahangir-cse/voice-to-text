// Normalize a phone number to E.164 without "+" prefix.
// Examples:
//   "+8801712345678" -> "8801712345678"
//   "01712345678"    -> "8801712345678"   (BD default country code)
//   " 880 17123 ..." -> "8801712345678"
function normalize(input, defaultCountry = '880') {
    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s) return null;
    s = s.replace(/[\s\-()]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('00')) s = s.slice(2);
    if (!/^\d+$/.test(s)) return null;
    if (s.startsWith('0') && defaultCountry) {
        s = defaultCountry + s.slice(1);
    }
    if (s.length < 8 || s.length > 15) return null;
    return s;
}

function normalizeMany(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const x of arr) {
        const n = normalize(x);
        if (n && !seen.has(n)) {
            seen.add(n);
            out.push(n);
        }
    }
    return out;
}

module.exports = { normalize, normalizeMany };
