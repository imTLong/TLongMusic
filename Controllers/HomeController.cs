using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models;

namespace TLongMusic.Controllers;

public class HomeController : Controller
{
    private readonly TLongMusicDbContext _context;
    private readonly ILogger<HomeController> _logger;

    public HomeController(TLongMusicDbContext context, ILogger<HomeController> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<IActionResult> Index()
    {
        var model = new HomeViewModel();

        try
        {
            // 1. Load Published Musics from SQL Server TLongMusicDb
            var allMusics = await _context.Musics
                .Include(m => m.Category)
                .Include(m => m.Producer)
                .Where(m => m.Status == "Published")
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync();

            // Hot Nonstops (Nonstop Lọt)
            model.HotNonstops = allMusics
                .Where(m => m.CategoryCode == "NonstopLot" || (m.Type == "Nonstop" && m.Category?.AccessLevel == "Lot"))
                .Select(MapEntityToViewModel)
                .ToList();

            // VIP Nonstops (Nonstop Slot / Nonstop Nhóm)
            model.VipNonstops = allMusics
                .Where(m => m.CategoryCode == "NonstopSlot" || (m.Type == "Nonstop" && m.Category?.AccessLevel == "Slot"))
                .Select(MapEntityToViewModel)
                .ToList();

            // Latest Tracks (Track Lọt, Track Nhóm, Track Slot)
            model.LatestTracks = allMusics
                .Where(m => m.Type == "Track")
                .Select(MapEntityToViewModel)
                .ToList();

            // 2. Load Packages from Database
            var dbPackages = await _context.Packages
                .Where(p => p.Status == "Active")
                .OrderBy(p => p.Price)
                .ToListAsync();

            if (dbPackages.Any())
            {
                model.Plans = dbPackages.Select(p => new SubscriptionPlan
                {
                    Name = p.Name,
                    TierCode = p.PackageId.ToLower(),
                    Price = p.Price,
                    BillingPeriod = p.DurationDays > 0 ? $"/ {p.DurationDays} ngày" : "/ vĩnh viễn",
                    BadgeText = p.BadgeText ?? (p.PackageId == "Standard" ? "PHỔ BIẾN NHẤT" : p.PackageId == "Premium" ? "DÀNH CHO PRO DJ" : "MẶC ĐỊNH"),
                    IsPopular = p.PackageId == "Standard",
                    Features = GetFeaturesForPackage(p),
                    ButtonText = p.PackageId == "Free" ? "Đang Sử Dụng" : $"Nâng Cấp {p.Name}"
                }).ToList();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi nạp dữ liệu từ SQL Server TLongMusicDb");
        }

        // Fallback if database is not reachable yet
        if (!model.HotNonstops.Any() && !model.LatestTracks.Any())
        {
            LoadFallbackData(model);
        }

        return View(model);
    }

    private static Track MapEntityToViewModel(Models.Entities.Music m)
    {
        var requiredTier = RequiredTier.Free;
        if (m.Category != null)
        {
            if (m.Category.RequiredTierToDownload == "Premium") requiredTier = RequiredTier.Premium;
            else if (m.Category.RequiredTierToDownload == "Standard") requiredTier = RequiredTier.Standard;
        }

        var audioType = AudioType.TrackLe;
        if (m.CategoryCode == "NonstopLot") audioType = AudioType.NonstopLot;
        else if (m.CategoryCode == "NonstopSlot") audioType = AudioType.NonstopDat;
        else if (m.CategoryCode == "TrackSlot") audioType = AudioType.TrackDat;

        return new Track
        {
            Id = m.MusicId.ToString(),
            Title = m.Title,
            Artist = m.Artist,
            Genre = m.Genre,
            Type = audioType,
            Bpm = m.Bpm,
            MusicalKey = m.MusicalKey,
            DurationSeconds = m.DurationSeconds,
            CoverUrl = m.CoverUrl ?? "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80",
            AudioUrl = (!string.IsNullOrWhiteSpace(m.SourceUrl) && System.IO.File.Exists(Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "music", $"{Path.GetFileNameWithoutExtension(m.SourceUrl).Replace("_320k", "")}_320k.mp3")))
                ? $"/uploads/music/{Path.GetFileNameWithoutExtension(m.SourceUrl).Replace("_320k", "")}_320k.mp3"
                : m.SourceUrl,
            SourceType = m.SourceType ?? "DirectFile",
            TierRequiredToDownload = requiredTier,
            IsDemoOnlyForFree = m.IsDemoOnlyForFree,
            DemoLimitSeconds = m.DemoLimitSeconds,
            QualityAvailable = m.QualityAvailable,
            PlaysCount = m.PlaysCount,
            DownloadsCount = m.DownloadsCount,
            ReleaseDate = m.CreatedAt
        };
    }

    private static List<string> GetFeaturesForPackage(Models.Entities.Package p)
    {
        var list = new List<string>();
        if (p.PackageId == "Free")
        {
            list.Add("Nghe toàn bộ Nonstop lọt chất lượng chuẩn (128kbps)");
            list.Add("Nghe thử Demo Track Slot & Nonstop đặt (30 giây)");
            list.Add("TẢI MIỄN PHÍ Track Lọt & Nonstop Lọt");
            list.Add("Xem thông số cơ bản (BPM, Tác giả)");
            list.Add("Không hỗ trợ tải kho Track Nhóm & Slot");
        }
        else if (p.PackageId == "Standard")
        {
            list.Add("Điểm nhấn ĐỎ Ruby rực rỡ và nổi bật");
            list.Add("Nghe và TẢI KHÔNG GIỚI HẠN kho Track Nhóm & Nonstop Nhóm");
            list.Add("Định dạng MP3 320kbps chuẩn DJ biểu diễn");
            list.Add("Nghe thử Demo Track Slot 30 giây");
            list.Add("Xem đầy đủ Tone Key Camelot (8A, 11B...) để mix nhạc");
            list.Add("Tốc độ tải nhanh qua máy chủ riêng");
        }
        else if (p.PackageId == "Premium")
        {
            list.Add("👑 Điểm nhấn VÀNG Hoàng Gia vương giả");
            list.Add("ĐẶC QUYỀN TOÀN DIỆN: Tải Full Track Slot & Nonstop Slot độc quyền");
            list.Add("Chất lượng cao nhất: Master WAV 24-Bit / FLAC Lossless phòng thu");
            list.Add("Toàn quyền nghe và tải cả kho Nhóm & Lọt");
            list.Add("Không giới hạn số lượt tải hàng ngày");
            list.Add("Hỗ trợ kỹ thuật và âm thanh ưu tiên từ DJ TLong");
        }
        return list;
    }

    private static void LoadFallbackData(HomeViewModel model)
    {
        model.Plans = new List<SubscriptionPlan>
        {
            new() { Name = "TÀI KHOẢN FREE", TierCode = "free", Price = 0, BillingPeriod = "/ vĩnh viễn", BadgeText = "MẶC ĐỊNH", IsPopular = false, Features = new() { "Nghe Nonstop lọt", "Tải Track Lọt", "Demo 30s Slot" }, ButtonText = "Đang Sử Dụng" },
            new() { Name = "STANDARD VIP", TierCode = "standard", Price = 99000, BillingPeriod = "/ 30 ngày", BadgeText = "PHỔ BIẾN NHẤT", IsPopular = true, Features = new() { "Điểm nhấn ĐỎ Ruby", "Tải Track Nhóm MP3 320k", "Demo 30s Track Slot" }, ButtonText = "Nâng Cấp Standard" },
            new() { Name = "PREMIUM VIP ĐỘC QUYỀN", TierCode = "premium", Price = 199000, BillingPeriod = "/ 30 ngày", BadgeText = "DÀNH CHO PRO DJ", IsPopular = false, Features = new() { "👑 Điểm nhấn VÀNG Hoàng Gia", "Tải Full WAV 24-Bit Track Slot", "Toàn quyền kho Nhóm & Lọt" }, ButtonText = "Nâng Cấp Premium" }
        };
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
