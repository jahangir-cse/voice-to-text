using CrmDemo.Models;

namespace CrmDemo.Services;

public class ContactRepository
{
    private readonly List<Contact> _contacts;

    public ContactRepository()
    {
        _contacts = SeedContacts();
    }

    public IReadOnlyList<Contact> All() => _contacts;

    public Contact? FindById(int id) => _contacts.FirstOrDefault(c => c.Id == id);

    private static List<Contact> SeedContacts()
    {
        // Reproducible random for stable demo
        var rng = new Random(42);

        var firstNames = new[] {
            "Mehedy", "Shayan", "Masum", "Arif", "Nadia", "Tasnim", "Rakib", "Sharmin",
            "Imran", "Faria", "Nayeem", "Sumaiya", "Tanvir", "Mahmuda", "Sajid", "Rumana",
            "Fahim", "Sadia", "Rifat", "Anika", "Hasan", "Nusrat", "Sabbir", "Tanjila",
            "Mahin", "Tahsin", "Saif", "Lamia", "Rashed", "Mehnaz", "Ruhul", "Rabeya",
            "Asif", "Tania", "Shakib", "Rumi", "Faisal", "Sumona", "Zubair", "Mim",
            "Naimur", "Sadia", "Tariq", "Jannatul", "Ariful", "Nipa", "Saiful", "Munia",
            "Riad", "Mahbuba", "Shihab", "Rownak", "Tonmoy", "Farjana", "Imtiaz", "Maliha",
            "Tofazzal", "Naznin", "Alvee", "Tamanna", "Akib", "Nawshin", "Neyamul", "Tisha",
            "Robin", "Sanjida", "Mahdi", "Kashfi", "Nahid", "Ratri", "Saimon", "Tushi",
            "Niloy", "Pinky", "Sumit", "Dipa", "Polash", "Lina", "Khaled", "Sumi",
            "Jasim", "Mim", "Akash", "Sumaiya", "Shifat", "Ananya", "Russell", "Nodi",
            "Fardin", "Sayma", "Sajjad", "Tonima", "Walid", "Mahima", "Ayan", "Nilima",
            "Nayan", "Snigdha", "Pranto", "Trina", "Riyad", "Bushra", "Sami", "Rumana"
        };
        var lastNames = new[] {
            "Hossain", "Rahman", "Islam", "Karim", "Akter", "Ahmed", "Khan", "Bhuiyan",
            "Mia", "Begum", "Sarker", "Talukder", "Chowdhury", "Mondol", "Khatun",
            "Uddin", "Haque", "Sultana", "Choudhury", "Rashid", "Ali", "Mahmud"
        };
        var operatorPrefixes = new[] { "13", "14", "15", "16", "17", "18", "19" };
        var prefixWeights = new[] { 5, 8, 5, 18, 35, 18, 11 }; // approximate market share

        string PickPrefix()
        {
            int total = prefixWeights.Sum();
            int r = rng.Next(total);
            int acc = 0;
            for (int i = 0; i < operatorPrefixes.Length; i++)
            {
                acc += prefixWeights[i];
                if (r < acc) return operatorPrefixes[i];
            }
            return operatorPrefixes[4]; // fallback "17"
        }

        string GenerateNumber()
        {
            var prefix = PickPrefix();
            var rest = string.Concat(Enumerable.Range(0, 8).Select(_ => rng.Next(0, 10)));
            return $"880{prefix[0]}{prefix[1]}{rest}";
        }

        string PickName()
        {
            return $"{firstNames[rng.Next(firstNames.Length)]} {lastNames[rng.Next(lastNames.Length)]}";
        }

        var seen = new HashSet<string>();
        var list = new List<Contact>(200);
        for (int i = 1; i <= 200; i++)
        {
            string num;
            do { num = GenerateNumber(); } while (!seen.Add(num));

            list.Add(new Contact
            {
                Id = i,
                Name = PickName(),
                Number = num,
                Email = rng.NextDouble() < 0.6
                    ? $"user{i}@example.com"
                    : null,
                Note = rng.NextDouble() < 0.3
                    ? new[] { "VIP Customer", "Lead - follow up", "Inactive", "Repeat buyer", "Referral" }[rng.Next(5)]
                    : null,
            });
        }

        return list;
    }
}
