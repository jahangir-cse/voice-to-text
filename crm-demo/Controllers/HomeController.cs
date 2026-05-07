using CrmDemo.Models;
using CrmDemo.Services;
using Microsoft.AspNetCore.Mvc;

namespace CrmDemo.Controllers;

public class HomeController : Controller
{
    private readonly ContactRepository _contacts;
    private readonly DetectionClient _detection;

    public HomeController(ContactRepository contacts, DetectionClient detection)
    {
        _contacts = contacts;
        _detection = detection;
    }

    public async Task<IActionResult> Index(int page = 1, int pageSize = 25, string? q = null, CancellationToken ct = default)
    {
        var (rows, total) = await BuildPageAsync(page, pageSize, q, ct);

        var accounts = await _detection.GetAccountsAsync(ct);
        var waReady = accounts.WhatsApp.Any(a => a.State == "ready");
        var tgReady = accounts.Telegram.Any(a => a.State == "ready");

        ViewBag.Page = page;
        ViewBag.PageSize = pageSize;
        ViewBag.Total = total;
        ViewBag.Query = q ?? "";
        ViewBag.DetectionHealthy = await _detection.IsHealthyAsync(ct);
        ViewBag.WaReady = waReady;
        ViewBag.TgReady = tgReady;

        return View(rows);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CheckWhatsApp(int page = 1, int pageSize = 25, string? q = null, CancellationToken ct = default)
    {
        var pageNumbers = GetPageNumbers(page, pageSize, q);
        if (pageNumbers.Count == 0)
        {
            TempData["FlashMessage"] = "No contacts to check on this page.";
            TempData["FlashKind"] = "info";
            return RedirectToAction(nameof(Index), new { page, pageSize, q });
        }

        var result = await _detection.CheckNowAsync(pageNumbers, "whatsapp", ct);
        if (result == null || !result.Ok)
        {
            TempData["FlashMessage"] = "WhatsApp check failed: " + (result?.Error ?? "no response");
            TempData["FlashKind"] = "err";
        }
        else
        {
            TempData["FlashMessage"] = $"✅ Real WhatsApp check via {result.AccountId}: scanned {result.Scanned}, matched {result.Matched}.";
            TempData["FlashKind"] = "wa";
        }
        return RedirectToAction(nameof(Index), new { page, pageSize, q });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CheckTelegram(int page = 1, int pageSize = 25, string? q = null, CancellationToken ct = default)
    {
        var pageNumbers = GetPageNumbers(page, pageSize, q);
        if (pageNumbers.Count == 0)
        {
            TempData["FlashMessage"] = "No contacts to check on this page.";
            TempData["FlashKind"] = "info";
            return RedirectToAction(nameof(Index), new { page, pageSize, q });
        }

        var result = await _detection.CheckNowAsync(pageNumbers, "telegram", ct);
        if (result == null || !result.Ok)
        {
            TempData["FlashMessage"] = "Telegram check failed: " + (result?.Error ?? "no response");
            TempData["FlashKind"] = "err";
        }
        else
        {
            TempData["FlashMessage"] = $"✅ Real Telegram check via {result.AccountId}: scanned {result.Scanned}, matched {result.Matched}.";
            TempData["FlashKind"] = "tg";
        }
        return RedirectToAction(nameof(Index), new { page, pageSize, q });
    }

    private async Task<(List<ContactRow> rows, int total)> BuildPageAsync(int page, int pageSize, string? q, CancellationToken ct)
    {
        var pageItems = GetPageContacts(page, pageSize, q, out var total);

        var numbers = pageItems.Select(c => c.Number).ToList();
        var detections = await _detection.CheckBatchAsync(numbers, ct);
        var byNumber = detections.ToDictionary(d => d.Number, d => d);

        var rows = pageItems.Select(c => new ContactRow
        {
            Contact = c,
            Detection = byNumber.TryGetValue(c.Number, out var d) ? d : null,
        }).ToList();

        return (rows, total);
    }

    private List<Contact> GetPageContacts(int page, int pageSize, string? q, out int total)
    {
        var all = _contacts.All();
        var filtered = string.IsNullOrWhiteSpace(q)
            ? all.ToList()
            : all.Where(c =>
                c.Name.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                c.Number.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
        total = filtered.Count;
        return filtered.Skip((page - 1) * pageSize).Take(pageSize).ToList();
    }

    private List<string> GetPageNumbers(int page, int pageSize, string? q)
    {
        return GetPageContacts(page, pageSize, q, out _)
            .Select(c => c.Number)
            .ToList();
    }

    [Route("/health")]
    public IActionResult Health() => Ok(new { ok = true, contacts = _contacts.All().Count });
}
