using System.Text.Json.Serialization;

namespace CrmDemo.Models;

public class AccountSummary
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";          // "whatsapp" | "telegram"
    [JsonPropertyName("state")] public string State { get; set; } = "";        // disconnected | connecting | awaiting_qr | awaiting_otp | awaiting_2fa | ready | error
    [JsonPropertyName("qr")] public string? Qr { get; set; }
    [JsonPropertyName("qrPng")] public string? QrPng { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("todayCount")] public int TodayCount { get; set; }
    [JsonPropertyName("pendingPhone")] public string? PendingPhone { get; set; }
}

public class AccountListResponse
{
    [JsonPropertyName("whatsapp")] public List<AccountSummary> WhatsApp { get; set; } = new();
    [JsonPropertyName("telegram")] public List<AccountSummary> Telegram { get; set; } = new();
}

public class CheckNowResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("scanned")] public int Scanned { get; set; }
    [JsonPropertyName("matched")] public int Matched { get; set; }
    [JsonPropertyName("accountId")] public string? AccountId { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

public class TelegramVerifyResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("awaiting2fa")] public bool Awaiting2fa { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("account")] public AccountSummary? Account { get; set; }
}
