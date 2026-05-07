using Microsoft.AspNetCore.Mvc;

namespace CrmDemo.Controllers;

public class DeveloperController : Controller
{
    public IActionResult Index() => View();
}
