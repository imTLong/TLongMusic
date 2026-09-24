using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models;

namespace TLongMusic.Controllers;

public class NonstopController : Controller
{
    private readonly TLongMusicDbContext _context;
    private readonly ILogger<NonstopController> _logger;

    public NonstopController(TLongMusicDbContext context, ILogger<NonstopController> logger)
    {
        _context = context;
        _logger = logger;
    }

    [HttpGet("/Nonstop")]
    [HttpGet("/Nonstops")]
    [HttpGet("/Nonstop/Index")]
    public async Task<IActionResult> Index(string? date, string? search, string? genre, string? tier)
    {
        var viewModel = new DailyNonstopsViewModel
        {
            SelectedDate = date,
            SearchQuery = search,
            SelectedGenre = genre,
            SelectedTier = tier
        };

        try
        {
            var query = _context.Musics
                .Include(m => m.Category)
                .Include(m => m.Producer)
                .Where(m => m.Type == "Nonstop" && m.Status == "Published");

            if (!string.IsNullOrWhiteSpace(genre))
            {
                query = query.Where(m => m.Genre.ToLower() == genre.ToLower());
            }

            var musics = await query
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync();

            // Lấy danh sách thể loại có sẵn của Nonstop
            viewModel.AvailableGenres = await _context.Musics
                .Where(m => m.Type == "Nonstop" && m.Status == "Published" && !string.IsNullOrEmpty(m.Genre))
                .Select(m => m.Genre)
                .Distinct()
                .ToListAsync();

            if (!musics.Any())
            {
                // Fallback nếu chưa có bản Nonstop nào
                LoadFallbackNonstops(viewModel);
                return View(viewModel);
            }

            // Map sang Track model
            var nonstopList = new List<Track>();
            int offsetDay = 0;
            var baseDate = DateTime.Now;

            for (int i = 0; i < musics.Count; i++)
            {
                var m = musics[i];
                var t = MapEntityToNonstop(m);

                // Nếu các bản ghi trong DB chênh nhau dưới vài phút, phân bổ theo ngày để hiển thị mẫu
                if (musics.Count > 1 && Math.Abs((m.CreatedAt - musics[0].CreatedAt).TotalHours) < 1)
                {
                    offsetDay = i / 2;
                    t.ReleaseDate = baseDate.AddDays(-offsetDay);
                }
                else
                {
                    t.ReleaseDate = m.CreatedAt;
                }

                nonstopList.Add(t);
            }

            // Lọc theo từ khóa tìm kiếm
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.ToLower();
                nonstopList = nonstopList.Where(t => t.Title.ToLower().Contains(s) || t.Artist.ToLower().Contains(s) || t.Genre.ToLower().Contains(s)).ToList();
            }

            // Kiểm tra gói của user hiện tại
            string? currentUserTier = null;
            bool isPremiumUser = false;
            bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");

            if (User.Identity?.IsAuthenticated == true)
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (Guid.TryParse(userIdClaim, out var userId))
                {
                    var activeSub = await _context.Subscriptions
                        .Where(s => s.UserId == userId && s.Status == "Active" && s.EndDate > DateTime.UtcNow)
                        .OrderByDescending(s => s.EndDate)
                        .FirstOrDefaultAsync();
                    currentUserTier = activeSub?.PackageId?.ToLower();
                }
            }

            if (isAdminOrProducer || currentUserTier == "premium")
            {
                isPremiumUser = true;
            }

            bool isVipUser = isPremiumUser || currentUserTier == "standard";

            viewModel.CurrentUserTier = currentUserTier;
            viewModel.IsPremiumUser = isPremiumUser;
            viewModel.IsVipUser = isVipUser;

            // Nếu tài khoản Standard và chưa chọn tier filter nào: Mặc định hiển thị Nonstop của Nhóm
            if (string.IsNullOrWhiteSpace(tier) && currentUserTier == "standard")
            {
                tier = "nhom";
                viewModel.SelectedTier = "nhom";
            }

            // Lọc theo tier nếu có
            if (!string.IsNullOrWhiteSpace(tier) && tier != "all")
            {
                if (tier.Equals("slot", StringComparison.OrdinalIgnoreCase) || tier.Equals("demo_slot", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị Nonstop Slot (Bản đặt VIP)
                    nonstopList = nonstopList.Where(IsNonstopSlot).ToList();
                }
                else if (tier.Equals("nhom", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị Nonstop Nhóm
                    nonstopList = nonstopList.Where(IsNonstopNhom).ToList();
                }
                else if (tier.Equals("lot", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị Nonstop Lọt (Free) - Tuyệt đối không lẫn Slot hay Nhóm
                    nonstopList = nonstopList.Where(IsNonstopLot).ToList();
                }
            }

            // Lọc theo ngày cụ thể nếu có
            if (!string.IsNullOrWhiteSpace(date))
            {
                nonstopList = nonstopList.Where(t => t.ReleaseDate.ToString("yyyy-MM-dd") == date || t.ReleaseDate.ToString("dd/MM/yyyy") == date).ToList();
            }

            viewModel.TotalNonstops = nonstopList.Count;

            // Gom nhóm theo ngày
            var groups = nonstopList
                .GroupBy(t => t.ReleaseDate.Date)
                .OrderByDescending(g => g.Key)
                .Select(g => new DailyNonstopGroup
                {
                    Date = g.Key,
                    FormattedDate = g.Key.ToString("dd/MM/yyyy"),
                    DayOfWeekName = GetVietnameseDayOfWeek(g.Key),
                    Nonstops = g.OrderByDescending(IsNonstopSlot).ThenByDescending(IsNonstopNhom).ToList()
                })
                .ToList();

            viewModel.DailyGroups = groups;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi nạp dữ liệu Kho Nonstop theo ngày");
            LoadFallbackNonstops(viewModel);
        }

        return View(viewModel);
    }

    public static bool IsNonstopSlot(Track t)
    {
        return (t.CategoryCode != null && t.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Premium
            || t.Type == AudioType.NonstopDat;
    }

    public static bool IsNonstopNhom(Track t)
    {
        return !IsNonstopSlot(t) && (
            (t.CategoryCode != null && t.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Standard
        );
    }

    public static bool IsNonstopLot(Track t)
    {
        return !IsNonstopSlot(t) && !IsNonstopNhom(t);
    }

    private static Track MapEntityToNonstop(Models.Entities.Music m)
    {
        var requiredTier = RequiredTier.Free;
        if (m.Category != null)
        {
            if (m.Category.RequiredTierToDownload == "Premium") requiredTier = RequiredTier.Premium;
            else if (m.Category.RequiredTierToDownload == "Standard") requiredTier = RequiredTier.Standard;
        }

        var isSlot = (m.CategoryCode != null && m.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase)) || requiredTier == RequiredTier.Premium;
        var cleanQuality = (isSlot || (m.QualityAvailable != null && m.QualityAvailable.ToUpperInvariant().Contains("WAV"))) ? "WAV" : "MP3";

        return new Track
        {
            Id = m.MusicId.ToString(),
            Title = m.Title,
            Artist = m.Artist,
            Genre = m.Genre,
            Type = isSlot ? AudioType.NonstopDat : AudioType.NonstopLot,
            CategoryCode = m.CategoryCode ?? "NonstopLot",
            Bpm = m.Bpm,
            MusicalKey = m.MusicalKey,
            DurationSeconds = m.DurationSeconds > 0 ? m.DurationSeconds : 3600,
            CoverUrl = m.CoverUrl ?? "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80",
            AudioUrl = m.SourceUrl,
            SourceType = m.SourceType ?? "DirectFile",
            TierRequiredToDownload = requiredTier,
            IsDemoOnlyForFree = m.IsDemoOnlyForFree,
            DemoLimitSeconds = m.DemoLimitSeconds > 0 ? m.DemoLimitSeconds : (isSlot ? 45 : 0),
            QualityAvailable = cleanQuality,
            PlaysCount = m.PlaysCount,
            DownloadsCount = m.DownloadsCount,
            ReleaseDate = m.CreatedAt
        };
    }

    private static string GetVietnameseDayOfWeek(DateTime dt)
    {
        if (dt.Date == DateTime.Today) return "Hôm Nay";
        if (dt.Date == DateTime.Today.AddDays(-1)) return "Hôm Qua";
        return dt.DayOfWeek switch
        {
            DayOfWeek.Monday => "Thứ Hai",
            DayOfWeek.Tuesday => "Thứ Ba",
            DayOfWeek.Wednesday => "Thứ Tư",
            DayOfWeek.Thursday => "Thứ Năm",
            DayOfWeek.Friday => "Thứ Sáu",
            DayOfWeek.Saturday => "Thứ Bảy",
            DayOfWeek.Sunday => "Chủ Nhật",
            _ => ""
        };
    }

    private static void LoadFallbackNonstops(DailyNonstopsViewModel viewModel)
    {
        var today = DateTime.Today;
        var sampleNonstops = new List<Track>
        {
            new() { 
                Id = "fb-ns1", 
                Title = "[NONSTOP VIP] ĐẲNG CẤP DÂN CHƠI HÀ THÀNH (BẢN ĐẶT PHÒNG THU LOSSLESS)", 
                Artist = "DJ TLong Private Exclusive", 
                Genre = "Vinahouse Club", 
                CategoryCode = "NonstopSlot", 
                TierRequiredToDownload = RequiredTier.Premium, 
                Bpm = 142, 
                MusicalKey = "8A", 
                DurationSeconds = 3420, 
                CoverUrl = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80", 
                AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", 
                QualityAvailable = "WAV", 
                IsDemoOnlyForFree = true,
                DemoLimitSeconds = 45,
                ReleaseDate = today 
            },
            new() { 
                Id = "fb-ns2", 
                Title = "[NONSTOP NHÓM] VINAHOUSE VIỆT MIX CỰC CĂNG - CHÀO HÈ RỰC RỠ 2026", 
                Artist = "TLong Music x DJ Team", 
                Genre = "Vinahouse Bass", 
                CategoryCode = "NonstopNhom", 
                TierRequiredToDownload = RequiredTier.Standard, 
                Bpm = 140, 
                MusicalKey = "11B", 
                DurationSeconds = 2850, 
                CoverUrl = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80", 
                AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", 
                QualityAvailable = "MP3", 
                ReleaseDate = today 
            },
            new() { 
                Id = "fb-ns3", 
                Title = "[NONSTOP LỌT HOT] ĐÊM MÊ SAY - TỰ DO BAY PHÒNG (BẢN FULL MIỄN PHÍ)", 
                Artist = "DJ TLong", 
                Genre = "Electro House", 
                CategoryCode = "NonstopLot", 
                TierRequiredToDownload = RequiredTier.Free, 
                Bpm = 138, 
                MusicalKey = "5A", 
                DurationSeconds = 3900, 
                CoverUrl = "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=600&auto=format&fit=crop&q=80", 
                AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", 
                QualityAvailable = "MP3", 
                ReleaseDate = today.AddDays(-1) 
            },
            new() { 
                Id = "fb-ns4", 
                Title = "[NONSTOP ĐẶT BAR CLUB] SHOW SÂN VẬN ĐỘNG - PRIVATE SET VIP", 
                Artist = "TLong Sound Studio", 
                Genre = "Festival Bounce", 
                CategoryCode = "NonstopSlot", 
                TierRequiredToDownload = RequiredTier.Premium, 
                Bpm = 144, 
                MusicalKey = "9B", 
                DurationSeconds = 4200, 
                CoverUrl = "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80", 
                AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", 
                QualityAvailable = "WAV", 
                IsDemoOnlyForFree = true,
                DemoLimitSeconds = 45,
                ReleaseDate = today.AddDays(-1) 
            }
        };

        viewModel.TotalNonstops = sampleNonstops.Count;
        viewModel.DailyGroups = sampleNonstops
            .GroupBy(t => t.ReleaseDate.Date)
            .OrderByDescending(g => g.Key)
            .Select(g => new DailyNonstopGroup
            {
                Date = g.Key,
                FormattedDate = g.Key.ToString("dd/MM/yyyy"),
                DayOfWeekName = GetVietnameseDayOfWeek(g.Key),
                Nonstops = g.ToList()
            })
            .ToList();
    }
}

public class DailyNonstopGroup
{
    public DateTime Date { get; set; }
    public string FormattedDate { get; set; } = string.Empty;
    public string DayOfWeekName { get; set; } = string.Empty;
    public List<Track> Nonstops { get; set; } = new();
}

public class DailyNonstopsViewModel
{
    public List<DailyNonstopGroup> DailyGroups { get; set; } = new();
    public int TotalNonstops { get; set; }
    public string? SelectedDate { get; set; }
    public string? SearchQuery { get; set; }
    public string? SelectedGenre { get; set; }
    public string? SelectedTier { get; set; }
    public List<string> AvailableGenres { get; set; } = new();
    public string? CurrentUserTier { get; set; }
    public bool IsPremiumUser { get; set; }
    public bool IsVipUser { get; set; }
}
