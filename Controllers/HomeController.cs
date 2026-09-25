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

            // Kho Track DJ: Gợi ý 5 bản Track mới nhất
            model.LatestTracks = allMusics
                .Where(m => m.Type == "Track" || (m.CategoryCode != null && m.CategoryCode.StartsWith("Track")))
                .Select(MapEntityToViewModel)
                .Take(5)
                .ToList();

            // Kho Nonstop Dài: (Type == "Nonstop" hoặc CategoryCode bắt đầu bằng Nonstop)
            var allNonstops = allMusics
                .Where(m => m.Type == "Nonstop" || (m.CategoryCode != null && m.CategoryCode.StartsWith("Nonstop")))
                .Select(MapEntityToViewModel)
                .ToList();

            model.AllNonstops = allNonstops;
            model.SlotNonstops = allNonstops.Where(IsMusicSlot).ToList();
            model.NhomNonstops = allNonstops.Where(IsMusicNhom).ToList();
            model.LotNonstops = allNonstops.Where(IsMusicLot).ToList();

            // Tương thích các danh sách cũ
            model.HotNonstops = model.LotNonstops;
            model.VipNonstops = model.SlotNonstops.Concat(model.NhomNonstops).ToList();

            // 2. Identify Current User Subscription & Privileges
            string? currentUserTier = null;
            bool isPremiumUser = false;
            bool isStandardUser = false;
            bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");

            if (User.Identity?.IsAuthenticated == true)
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (Guid.TryParse(userIdClaim, out var userId))
                {
                    var activeSub = await _context.Subscriptions
                        .Include(s => s.Package)
                        .Where(s => s.UserId == userId && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                        .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                        .ThenByDescending(s => s.EndDate)
                        .FirstOrDefaultAsync();

                    currentUserTier = activeSub?.PackageId?.ToLower();
                }
            }

            if (isAdminOrProducer || currentUserTier == "premium")
            {
                isPremiumUser = true;
                isStandardUser = true;
            }
            else if (currentUserTier == "standard")
            {
                isStandardUser = true;
            }

            model.CurrentUserTier = currentUserTier;
            model.IsPremiumUser = isPremiumUser;
            model.IsStandardUser = isStandardUser;
            model.IsAdminOrProducer = isAdminOrProducer;

            // 3. Load Packages from Database
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
        if (!model.AllNonstops.Any() && !model.LatestTracks.Any())
        {
            LoadFallbackData(model);
        }

        return View(model);
    }

    public static bool IsMusicSlot(Track t)
    {
        return (t.CategoryCode != null && t.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Premium
            || t.Type == AudioType.NonstopDat
            || t.Type == AudioType.TrackDat;
    }

    public static bool IsMusicNhom(Track t)
    {
        return !IsMusicSlot(t) && (
            (t.CategoryCode != null && t.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Standard
        );
    }

    public static bool IsMusicLot(Track t)
    {
        return !IsMusicSlot(t) && !IsMusicNhom(t);
    }

    private static Track MapEntityToViewModel(Models.Entities.Music m)
    {
        var requiredTier = RequiredTier.Free;
        if (m.Category != null)
        {
            if (m.Category.RequiredTierToDownload == "Premium" || m.Category.AccessLevel == "Slot") requiredTier = RequiredTier.Premium;
            else if (m.Category.RequiredTierToDownload == "Standard" || m.Category.AccessLevel == "Nhom") requiredTier = RequiredTier.Standard;
        }
        else if (!string.IsNullOrEmpty(m.CategoryCode))
        {
            if (m.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase)) requiredTier = RequiredTier.Premium;
            else if (m.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase)) requiredTier = RequiredTier.Standard;
        }

        var isSlot = (m.CategoryCode != null && m.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase)) || requiredTier == RequiredTier.Premium;
        var isNhom = !isSlot && ((m.CategoryCode != null && m.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase)) || requiredTier == RequiredTier.Standard);
        var isNonstop = m.Type == "Nonstop" || (m.CategoryCode != null && m.CategoryCode.StartsWith("Nonstop", StringComparison.OrdinalIgnoreCase));

        var audioType = isNonstop
            ? (isSlot ? AudioType.NonstopDat : AudioType.NonstopLot)
            : (isSlot ? AudioType.TrackDat : AudioType.TrackLe);

        var cleanQuality = (isSlot || (m.QualityAvailable != null && m.QualityAvailable.ToUpperInvariant().Contains("WAV"))) ? "WAV" : "MP3";

        return new Track
        {
            Id = m.MusicId.ToString(),
            Title = m.Title,
            Artist = m.Artist,
            Genre = m.Genre,
            Type = audioType,
            CategoryCode = m.CategoryCode ?? (isNonstop ? (isSlot ? "NonstopSlot" : (isNhom ? "NonstopNhom" : "NonstopLot")) : (isSlot ? "TrackSlot" : (isNhom ? "TrackNhom" : "TrackLot"))),
            Bpm = m.Bpm,
            MusicalKey = isNonstop ? "Nonstop" : m.MusicalKey,
            DurationSeconds = m.DurationSeconds,
            CoverUrl = m.CoverUrl ?? (isNonstop ? "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80" : "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80"),
            AudioUrl = m.SourceUrl,
            SourceType = m.SourceType ?? "DirectFile",
            TierRequiredToDownload = requiredTier,
            IsDemoOnlyForFree = isSlot || isNhom || m.IsDemoOnlyForFree,
            DemoLimitSeconds = m.DemoLimitSeconds > 0 ? m.DemoLimitSeconds : ((isSlot || isNhom) ? 30 : 0),
            QualityAvailable = cleanQuality,
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

    [HttpGet("/Profile")]
    [HttpGet("/Account/Profile")]
    public async Task<IActionResult> Profile()
    {
        TLongMusic.Models.Dto.UserSessionDto? sessionData = null;
        if (User.Identity?.IsAuthenticated == true)
        {
            var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(userIdClaim, out var userId))
            {
                var user = await _context.Users
                    .Include(u => u.UserRoles)
                    .Include(u => u.ProducerProfile)
                    .Include(u => u.Subscriptions)
                        .ThenInclude(s => s.Package)
                    .FirstOrDefaultAsync(u => u.UserId == userId);

                if (user != null && user.Status == "Active")
                {
                    var roles = user.UserRoles.Select(ur => ur.RoleId).ToList();
                    var primaryRole = roles.Contains("Admin") ? "Admin" 
                                    : roles.Contains("Producer") ? "Producer" 
                                    : "Member";

                    var activeSub = user.Subscriptions
                        .Where(s => s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                        .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                        .ThenByDescending(s => s.EndDate)
                        .FirstOrDefault();

                    var tier = activeSub?.PackageId ?? "Free";
                    var pkg = activeSub?.Package ?? await _context.Packages.FindAsync("Free");

                    sessionData = new TLongMusic.Models.Dto.UserSessionDto
                    {
                        UserId = user.UserId,
                        Username = user.Username,
                        FullName = user.FullName ?? user.Username,
                        Email = user.Email,
                        PhoneNumber = user.PhoneNumber ?? user.ProducerProfile?.PhoneNumber,
                        BankName = user.BankName ?? user.ProducerProfile?.BankName,
                        BankAccountNumber = user.BankAccountNumber ?? user.ProducerProfile?.BankAccountNumber,
                        BankAccountHolder = user.BankAccountHolder ?? user.ProducerProfile?.BankAccountHolder,
                        AvatarUrl = user.AvatarUrl ?? "/images/logo.png",
                        Roles = roles,
                        PrimaryRole = primaryRole,
                        Tier = tier,
                        TierExpiresAt = activeSub?.EndDate,
                        IsVipActive = tier == "Standard" || tier == "Premium",
                        CanDownloadLot = pkg?.CanDownloadLot ?? true,
                        CanDownloadNhom = pkg?.CanDownloadNhom ?? false,
                        CanDownloadSlot = pkg?.CanDownloadSlot ?? false,
                        SlotDemoLimitSeconds = pkg?.SlotDemoLimitSeconds ?? 30
                    };
                }
            }
        }

        return View(sessionData);
    }

    [HttpGet("/Admin")]
    [HttpGet("/Admin/Index")]
    public IActionResult AdminPortal()
    {
        return View("~/Views/Admin/Index.cshtml");
    }

    [HttpGet("/Producer/UploadTrack")]
    [HttpGet("/UploadTrack")]
    public IActionResult ProducerUploadTrack()
    {
        return View("~/Views/Producer/UploadTrack.cshtml");
    }

    [HttpGet("/Producer/UploadNonstop")]
    [HttpGet("/UploadNonstop")]
    public IActionResult ProducerUploadNonstop()
    {
        return View("~/Views/Producer/UploadNonstop.cshtml");
    }

    [HttpGet("/Producer/Upload")]
    [HttpGet("/Upload")]
    [HttpGet("/Producer/Index")]
    public IActionResult ProducerUpload()
    {
        return Redirect("/Producer/UploadTrack");
    }

    [HttpGet("/Producer/ManageMusic")]
    [HttpGet("/Producer/Manage")]
    public IActionResult ProducerManageMusic()
    {
        return View("~/Views/Producer/ManageMusic.cshtml");
    }

    [HttpGet("/Goi-Hoi-Vien")]
    [HttpGet("/Membership")]
    public async Task<IActionResult> Membership()
    {
        var model = new MembershipViewModel();

        string? currentUserTier = null;
        bool isPremiumUser = false;
        bool isStandardUser = false;
        bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");

        if (User.Identity?.IsAuthenticated == true)
        {
            var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(userIdClaim, out var userId))
            {
                var activeSub = await _context.Subscriptions
                    .Include(s => s.Package)
                    .Where(s => s.UserId == userId && s.Status == "Active" && s.EndDate > DateTime.UtcNow)
                    .OrderByDescending(s => s.EndDate)
                    .FirstOrDefaultAsync();

                if (activeSub != null)
                {
                    currentUserTier = activeSub.PackageId.ToLowerInvariant();
                }
            }
        }

        if (isAdminOrProducer)
        {
            isPremiumUser = true;
            isStandardUser = true;
        }
        else if (currentUserTier == "premium")
        {
            isPremiumUser = true;
            isStandardUser = true;
        }
        else if (currentUserTier == "standard")
        {
            isStandardUser = true;
        }

        model.CurrentUserTier = currentUserTier;
        model.IsPremiumUser = isPremiumUser;
        model.IsStandardUser = isStandardUser;
        model.IsAdminOrProducer = isAdminOrProducer;

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
        else
        {
            model.Plans = new List<SubscriptionPlan>
            {
                new() { Name = "TÀI KHOẢN FREE", TierCode = "free", Price = 0, BillingPeriod = "/ vĩnh viễn", BadgeText = "MẶC ĐỊNH", IsPopular = false, Features = new() { "Nghe Nonstop lọt", "Tải Track Lọt", "Demo 30s Slot & Nhóm" }, ButtonText = "Đang Sử Dụng" },
                new() { Name = "STANDARD VIP", TierCode = "standard", Price = 99000, BillingPeriod = "/ 30 ngày", BadgeText = "PHỔ BIẾN NHẤT", IsPopular = true, Features = new() { "Điểm nhấn ĐỎ Ruby", "Tải Track Nhóm MP3 320k", "Nghe & tải Nonstop Nhóm", "Demo 30s Track Slot" }, ButtonText = "Nâng Cấp Standard" },
                new() { Name = "PREMIUM VIP ĐỘC QUYỀN", TierCode = "premium", Price = 199000, BillingPeriod = "/ 30 ngày", BadgeText = "DÀNH CHO PRO DJ", IsPopular = false, Features = new() { "Điểm nhấn VÀNG Hoàng Gia", "Tải Full WAV 24-Bit Track Slot", "Toàn quyền kho Nhóm & Lọt", "Băng thông Ultra-Fast VIP" }, ButtonText = "Nâng Cấp Premium" }
            };
        }

        return View(model);
    }

    [HttpGet("/Checkout")]
    [HttpGet("/Payment/Checkout")]
    public IActionResult Checkout(string? package)
    {
        ViewBag.SelectedPackage = !string.IsNullOrWhiteSpace(package) ? package : "Standard";
        return View("~/Views/Payment/Checkout.cshtml");
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
