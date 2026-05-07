using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CrmDemo.Models;

namespace CrmDemo.Services;

public class DetectionOptions
{
    public string BaseUrl { get; set; } = "http://localhost:4000";
    public string ApiKey { get; set; } = "";
}

public class DetectionClient
{
    private readonly HttpClient _http;
    private readonly DetectionOptions _opts;
    private readonly ILogger<DetectionClient> _log;

    public DetectionClient(HttpClient http, IConfiguration config, ILogger<DetectionClient> log)
    {
        _http = http;
        _log = log;
        _opts = config.GetSection("Detection").Get<DetectionOptions>() ?? new DetectionOptions();
        _http.BaseAddress = new Uri(_opts.BaseUrl);
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _opts.ApiKey);
        _http.Timeout = TimeSpan.FromSeconds(10);
    }

    public async Task<DetectionResult?> CheckAsync(string number, CancellationToken ct = default)
    {
        try
        {
            var res = await _http.PostAsJsonAsync("/api/check", new { number }, ct);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Detection /api/check failed: {Status}", res.StatusCode);
                return null;
            }
            return await res.Content.ReadFromJsonAsync<DetectionResult>(cancellationToken: ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Detection /api/check error for {Number}", number);
            return null;
        }
    }

    public async Task<List<DetectionResult>> CheckBatchAsync(IEnumerable<string> numbers, CancellationToken ct = default)
    {
        var list = numbers.ToList();
        if (list.Count == 0) return new List<DetectionResult>();

        try
        {
            var res = await _http.PostAsJsonAsync("/api/batch", new { numbers = list }, ct);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Detection /api/batch failed: {Status}", res.StatusCode);
                return list.Select(n => new DetectionResult { Number = n, Status = "unknown" }).ToList();
            }
            var body = await res.Content.ReadFromJsonAsync<BatchResponse>(cancellationToken: ct);
            return body?.Results ?? new List<DetectionResult>();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Detection /api/batch error");
            return list.Select(n => new DetectionResult { Number = n, Status = "unknown" }).ToList();
        }
    }

    public async Task<List<DetectionResult>> SimulateAsync(IEnumerable<string> numbers, string platform, CancellationToken ct = default)
    {
        var list = numbers.ToList();
        if (list.Count == 0) return new List<DetectionResult>();

        try
        {
            var res = await _http.PostAsJsonAsync("/api/demo-simulate", new { numbers = list, platform }, ct);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Detection /api/demo-simulate failed: {Status}", res.StatusCode);
                return new List<DetectionResult>();
            }
            var body = await res.Content.ReadFromJsonAsync<SimulateResponse>(cancellationToken: ct);
            return body?.Results ?? new List<DetectionResult>();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Detection /api/demo-simulate error");
            return new List<DetectionResult>();
        }
    }

    public async Task<bool> IsHealthyAsync(CancellationToken ct = default)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, "/health");
            req.Headers.Authorization = null;
            var res = await _http.SendAsync(req, ct);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }
}
