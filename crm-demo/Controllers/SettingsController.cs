using CrmDemo.Models;
using CrmDemo.Services;
using Microsoft.AspNetCore.Mvc;

namespace CrmDemo.Controllers;

public class SettingsController : Controller
{
    private readonly DetectionClient _detection;

    public SettingsController(DetectionClient detection)
    {
        _detection = detection;
    }

    public async Task<IActionResult> Index(CancellationToken ct = default)
    {
        var accounts = await _detection.GetAccountsAsync(ct);
        return View(accounts);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> WhatsAppConnect(string id, CancellationToken ct = default)
    {
        await _detection.WhatsAppConnectAsync(id, ct);
        return RedirectToAction(nameof(WhatsAppQr), new { id });
    }

    public async Task<IActionResult> WhatsAppQr(string id, CancellationToken ct = default)
    {
        var status = await _detection.WhatsAppStatusAsync(id, ct);
        ViewBag.AccountId = id;
        return View(status);
    }

    [HttpGet]
    public async Task<IActionResult> WhatsAppStatusJson(string id, CancellationToken ct = default)
    {
        var status = await _detection.WhatsAppStatusAsync(id, ct);
        return Json(status);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> TelegramConnect(string id, string phone, CancellationToken ct = default)
    {
        try
        {
            await _detection.TelegramConnectAsync(id, phone, ct);
            return RedirectToAction(nameof(TelegramVerify), new { id });
        }
        catch (Exception ex)
        {
            TempData["FlashMessage"] = "Telegram connect failed: " + ex.Message;
            TempData["FlashKind"] = "err";
            return RedirectToAction(nameof(Index));
        }
    }

    public async Task<IActionResult> TelegramVerify(string id, CancellationToken ct = default)
    {
        var accounts = await _detection.GetAccountsAsync(ct);
        var acc = accounts.Telegram.FirstOrDefault(a => a.Id == id);
        ViewBag.AccountId = id;
        ViewBag.Pending = acc;
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> TelegramSubmitCode(string id, string code, string? password, CancellationToken ct = default)
    {
        var result = await _detection.TelegramVerifyAsync(id, code, password, ct);
        if (result == null)
        {
            TempData["FlashMessage"] = "Telegram verify failed.";
            TempData["FlashKind"] = "err";
            return RedirectToAction(nameof(TelegramVerify), new { id });
        }
        if (result.Ok)
        {
            TempData["FlashMessage"] = $"Telegram account {id} connected successfully.";
            TempData["FlashKind"] = "ok";
            return RedirectToAction(nameof(Index));
        }
        if (result.Awaiting2fa)
        {
            TempData["FlashMessage"] = "2FA password required.";
            TempData["FlashKind"] = "err";
            return RedirectToAction(nameof(TelegramVerify), new { id });
        }
        TempData["FlashMessage"] = "Verify failed: " + (result.Error ?? "unknown");
        TempData["FlashKind"] = "err";
        return RedirectToAction(nameof(TelegramVerify), new { id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Disconnect(string id, CancellationToken ct = default)
    {
        await _detection.DisconnectAsync(id, ct);
        TempData["FlashMessage"] = $"Account {id} disconnected.";
        TempData["FlashKind"] = "ok";
        return RedirectToAction(nameof(Index));
    }
}
