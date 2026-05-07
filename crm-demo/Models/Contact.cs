namespace CrmDemo.Models;

public class Contact
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Number { get; set; } = "";        // International format without "+", e.g. 8801712345678
    public string? Email { get; set; }
    public string? Note { get; set; }
}

public class ContactRow
{
    public Contact Contact { get; set; } = new();
    public DetectionResult? Detection { get; set; }
}
