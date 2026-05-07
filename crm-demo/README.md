# crm-demo

ASP.NET Core MVC + Razor demo project that simulates a real CRM contact list and integrates with **detection-service** to show WhatsApp / Telegram availability per contact.

> **Note about .NET Framework:** The actual production CRM is .NET Framework 4.x (Windows-only). For this **local Mac demo** the project uses **ASP.NET Core (.NET 9)** because .NET Framework does not run natively on macOS. The integration patterns (`HttpClient`, Razor views, `appsettings.json`) translate directly — you can copy `Services/DetectionClient.cs`, `Models/*`, and the Razor markup into a .NET Framework MVC project with minimal changes (only `using` statements and `HttpClient` instantiation differ).

## What it does

- Loads 200 seeded Bangladesh-style dummy contacts (deterministic, reproducible)
- Renders them in a paginated table with search
- For each visible page (default 25 contacts), calls `POST /api/batch` on the detection-service
- Renders **WhatsApp**, **Telegram**, and **Call** buttons conditionally based on detection result
- Shows live "Detection API: connected / offline" status

## Architecture

```
[crm-demo (ASP.NET Core MVC, .NET 9)]
        │
        │ HttpClient.PostAsync /api/batch
        │ Authorization: Bearer <api-key>
        ▼
[detection-service (Node Fastify)]
        │
        ▼
[SQLite cache (cached results)]
        ▲
        │ background workers populate
[WhatsApp pool (5 acc) + Telegram pool (2 acc)]
```

## Prerequisites

- .NET 9 SDK (`dotnet --version`)
- detection-service running locally (see `../detection-service/README.md`)
- An API key from detection-service (`npm run create-api-key`)

## Setup

1. **Configure detection API URL + key**

   Edit `appsettings.json`:

   ```json
   {
     "Detection": {
       "BaseUrl": "http://localhost:4000",
       "ApiKey": "<paste-your-api-key-here>"
     }
   }
   ```

   For local development override only, you can use `appsettings.Development.json` (gitignored if you add it to `.gitignore`).

2. **Restore + build**

   ```bash
   dotnet restore
   dotnet build
   ```

## Run

```bash
dotnet run
```

Open <http://localhost:5000> (port shown in console).

## Demo flow (for client)

```bash
# Terminal 1: detection-service
cd ../detection-service
npm start

# Terminal 2: crm-demo
cd crm-demo
dotnet run
```

1. Open <http://localhost:5000> — table of 200 contacts loads
2. First load: most rows show "…" (status: pending) because detection-service hasn't checked them yet
3. detection-service worker auto-queues the visible page numbers and starts checking in background
4. Refresh after a minute — rows that have been checked now show WhatsApp / Telegram icons next to Call
5. Search box filters by name or number
6. Pagination at the bottom

## Project structure

```
crm-demo/
├── Program.cs                     # Entry, DI registration
├── appsettings.json               # Detection API config
├── crm-demo.csproj
├── Models/
│   ├── Contact.cs                 # Domain model + ContactRow VM
│   ├── DetectionResult.cs         # API response shape
│   └── ErrorViewModel.cs
├── Services/
│   ├── ContactRepository.cs       # In-memory 200 seeded contacts
│   └── DetectionClient.cs         # HttpClient wrapper for detection-service
├── Controllers/
│   └── HomeController.cs          # Index action: pagination, search, batch lookup
├── Views/
│   ├── _ViewImports.cshtml
│   ├── _ViewStart.cshtml
│   ├── Shared/_Layout.cshtml
│   └── Home/Index.cshtml          # Contact table with conditional buttons
└── wwwroot/css/site.css           # Clean, professional styling
```

## Porting to .NET Framework MVC (production CRM)

When integrating the same approach into your actual .NET Framework 4.x MVC application:

| File | Port notes |
|---|---|
| `Models/Contact.cs` | Copy as-is (remove nullable annotations: `string?` → `string`) |
| `Models/DetectionResult.cs` | Replace `System.Text.Json` attributes with `Newtonsoft.Json` `[JsonProperty]` |
| `Services/DetectionClient.cs` | Use `new HttpClient()` directly instead of DI; or inject via your IoC container |
| `Controllers/HomeController.cs` | Replace `IActionResult` with `ActionResult` (`async Task<ActionResult>`) |
| `Views/Home/Index.cshtml` | Razor syntax is identical |
| Pagination, search | Identical LINQ |

The HTTP call pattern (`POST /api/batch` with Bearer token) is exactly the same.

## Testing without detection-service

If detection-service is unreachable, the page still renders — all rows just show "Detection API: offline" and only the Call button per row.
