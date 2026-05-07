# detection-service

Production microservice for detecting whether phone numbers have **WhatsApp** or **Telegram** registered. Designed for high-concurrency consumption from CRM and other backend services.

## Capabilities

- HTTP API: single + batch number lookup
- Multi-account pool (5 WhatsApp + 2 Telegram by default) for throughput and ban-tolerance
- SQLite cache: sub-millisecond reads, handles 400+ concurrent requests easily
- Background detection workers — never block API requests
- API key authentication, per-key rate limiting, daily quotas
- Auto-disable banned accounts, alert via logs
- Deployment-agnostic: Docker, pm2 cluster, any VPS or PaaS

## Architecture

```
[Multiple consumers (CRM branches)]
            │
            ▼ HTTP (Authorization: Bearer <api_key>)
   [Fastify (pm2 cluster)]
            │
            ▼ sub-ms read
       [SQLite cache]
            ▲
            │ writes
   [Worker process]
       ├── WhatsApp pool (5 accounts, round-robin)
       └── Telegram pool (2 accounts, round-robin)
```

API process and worker process run separately (pm2 manages both). API never does live detection — only DB reads. Workers poll DB for `NULL` flags and dispatch to account pools.

## Quick start (local)

```bash
cd detection-service
cp .env.example .env
# edit .env: set TELEGRAM_API_ID, TELEGRAM_API_HASH (from my.telegram.org)
npm install
npm run init-db

# Create an API key for your CRM
npm run create-api-key -- --branch crm-main --quota 50000
# saves to DB and prints the key — copy and store securely

# Login each WhatsApp account (interactive QR scan)
npm run login-whatsapp -- --account wa-1
# scan with phone WhatsApp > Linked Devices
# repeat for wa-2, wa-3, wa-4, wa-5

# Login each Telegram account
npm run login-telegram -- --account tg-1
# enter phone number + OTP
# repeat for tg-2

# Run development (single process, both API and worker in foreground)
npm run dev      # API on PORT (default 4000)
# in another terminal:
npm run worker   # background detection

# Or run production (pm2 cluster + worker)
npm start
```

## API

All endpoints require `Authorization: Bearer <api_key>` header.

### `POST /api/check`
Single number lookup (cache only — instant).

```json
// Request
{ "number": "8801712345678" }

// Response
{
    "number": "8801712345678",
    "hasWhatsApp": true,
    "hasTelegram": false,
    "whatsappCheckedAt": "2026-05-06T10:30:00Z",
    "telegramCheckedAt": "2026-05-06T10:30:01Z",
    "status": "cached"
}
```

`status` is `"cached"` (data exists) or `"unknown"` (queued for detection, retry shortly).

### `POST /api/batch`
Up to 100 numbers in one request.

```json
// Request
{ "numbers": ["8801712345678", "8801823456789"] }

// Response
{
    "results": [...],
    "queued": 12
}
```

### `POST /api/queue`
Pre-queue numbers without waiting for a check.

```json
{ "numbers": ["8801..."], "priority": "normal" }
```

### `GET /health`
Liveness probe (no auth).

### `GET /admin/stats`
Admin-only (requires admin API key). Returns queue depth, account health, totals.

## .NET CRM integration sample

```csharp
public class DetectionClient
{
    private readonly HttpClient _http;
    private readonly string _apiKey;

    public DetectionClient(HttpClient http, string apiKey, string baseUrl)
    {
        _http = http;
        _http.BaseAddress = new Uri(baseUrl);
        _apiKey = apiKey;
    }

    public async Task<CheckResult> CheckAsync(string number)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/check");
        req.Headers.Add("Authorization", $"Bearer {_apiKey}");
        req.Content = new StringContent(
            JsonConvert.SerializeObject(new { number }),
            Encoding.UTF8, "application/json");
        var res = await _http.SendAsync(req);
        res.EnsureSuccessStatusCode();
        return JsonConvert.DeserializeObject<CheckResult>(
            await res.Content.ReadAsStringAsync());
    }
}

public class CheckResult
{
    public string Number { get; set; }
    public bool? HasWhatsApp { get; set; }
    public bool? HasTelegram { get; set; }
    public DateTime? WhatsappCheckedAt { get; set; }
    public DateTime? TelegramCheckedAt { get; set; }
    public string Status { get; set; }
}
```

## Docker deployment

```bash
docker-compose up -d
# logs:
docker-compose logs -f
```

Volumes: `./data` and `./sessions` are mounted persistently. Sessions survive container restarts (no need to re-scan QR / re-OTP).

## Production deployment (any VPS)

1. Provision Linux VPS (2 GB RAM minimum), install Docker
2. `git clone <this-repo>` and `cd detection-service`
3. `cp .env.example .env`, set values
4. Run setup scripts via `docker-compose run --rm app npm run init-db` etc., or run locally first and copy `data/`, `sessions/` to server
5. `docker-compose up -d`
6. Reverse proxy (nginx/Caddy) for TLS termination on port 443
7. Point CRM `DETECTION_API_URL` to your `https://detection.yourdomain.com`

## Security notes

- API keys are bcrypt-hashed in DB; only the plaintext from `create-api-key` is shown once
- `.env` and `sessions/` are gitignored — never commit
- WhatsApp / Telegram session files are sensitive (full account access). Restrict file permissions and host security
- Rotate API keys regularly with `create-api-key` + `delete-api-key` scripts

## Limits & honest framing

- WhatsApp/Telegram daily detection quotas are **community heuristics**, not Meta-published rules. The pool architecture (5 accounts) provides headroom and resilience but cannot eliminate ban risk entirely
- For very large initial backfill (millions of numbers), expect timelines in days/weeks
- Cache reads are sub-ms; detection latency for new numbers is bounded by queue depth × per-check time
