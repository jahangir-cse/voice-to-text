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

        ViewBag.Page = page;
        ViewBag.PageSize = pageSize;
        ViewBag.Total = total;
        ViewBag.Query = q ?? "";
        ViewBag.DetectionHealthy = await _detection.IsHealthyAsync(ct);

        return View(rows);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CheckWhatsApp(int page = 1, int pageSize = 25, string? q = null, CancellationToken ct = default)
    {
        var pageNumbers = GetPageNumbers(page, pageSize, q);
        var checkedCount = 0;
        var matchedCount = 0;
        if (pageNumbers.Count > 0)
        {
            var results = await _detection.SimulateAsync(pageNumbers, "whatsapp", ct);
            checkedCount = results.Count;
            matchedCount = results.Count(r => r.HasWhatsApp == true);
        }
        TempData["FlashMessage"] = $"WhatsApp check: scanned {checkedCount}, matched {matchedCount}";
        TempData["FlashKind"] = "wa";
        return RedirectToAction(nameof(Index), new { page, pageSize, q });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CheckTelegram(int page = 1, int pageSize = 25, string? q = null, CancellationToken ct = default)
    {
        var pageNumbers = GetPageNumbers(page, pageSize, q);
        var checkedCount = 0;
        var matchedCount = 0;
        if (pageNumbers.Count > 0)
        {
            var results = await _detection.SimulateAsync(pageNumbers, "telegram", ct);
            checkedCount = results.Count;
            matchedCount = results.Count(r => r.HasTelegram == true);
        }
        TempData["FlashMessage"] = $"Telegram check: scanned {checkedCount}, matched {matchedCount}";
        TempData["FlashKind"] = "tg";
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
