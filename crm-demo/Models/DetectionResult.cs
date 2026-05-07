using System.Text.Json.Serialization;

namespace CrmDemo.Models;

public class DetectionResult
{
    [JsonPropertyName("number")]
    public string Number { get; set; } = "";

    [JsonPropertyName("hasWhatsApp")]
    public bool? HasWhatsApp { get; set; }

    [JsonPropertyName("hasTelegram")]
    public bool? HasTelegram { get; set; }

    [JsonPropertyName("whatsappCheckedAt")]
    public DateTime? WhatsappCheckedAt { get; set; }

    [JsonPropertyName("telegramCheckedAt")]
    public DateTime? TelegramCheckedAt { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "unknown";   // "cached" | "unknown"
}

public class BatchResponse
{
    [JsonPropertyName("results")]
    public List<DetectionResult> Results { get; set; } = new();

    [JsonPropertyName("queued")]
    public int Queued { get; set; }
}

public class SimulateResponse
{
    [JsonPropertyName("simulated")]
    public bool Simulated { get; set; }

    [JsonPropertyName("platform")]
    public string Platform { get; set; } = "";

    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("results")]
    public List<DetectionResult> Results { get; set; } = new();
}
