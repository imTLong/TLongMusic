using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models;

namespace TLongMusic.Controllers;

public class TrackController : Controller
{
    private readonly TLongMusicDbContext _context;
    private readonly ILogger<TrackController> _logger;

    public TrackController(TLongMusicDbContext context, ILogger<TrackController> logger)
    {
        _context = context;
        _logger = logger;
    }

    [HttpGet("/Track")]
    [HttpGet("/Tracks")]
    [HttpGet("/Track/Index")]
    public async Task<IActionResult> Index(string? date, string? search, string? genre, string? tier)
    {
        var viewModel = new DailyTracksViewModel
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
                .Where(m => m.Type == "Track" && m.Status == "Published");

            if (!string.IsNullOrWhiteSpace(genre))
            {
                query = query.Where(m => m.Genre.ToLower() == genre.ToLower());
            }

            var musics = await query
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync();

            // Lấy danh sách thể loại có sẵn
            viewModel.AvailableGenres = await _context.Musics
                .Where(m => m.Type == "Track" && m.Status == "Published" && !string.IsNullOrEmpty(m.Genre))
                .Select(m => m.Genre)
                .Distinct()
                .ToListAsync();

            if (!musics.Any())
            {
                // Fallback nếu chưa có bài
                LoadFallbackTracks(viewModel);
                return View(viewModel);
            }

            // Map sang Track model
            var trackList = new List<Track>();

            for (int i = 0; i < musics.Count; i++)
            {
                var m = musics[i];
                var t = MapEntityToTrack(m);
                t.ReleaseDate = m.CreatedAt;
                trackList.Add(t);
            }

            // Lọc theo search nếu có
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.ToLower();
                trackList = trackList.Where(t => t.Title.ToLower().Contains(s) || t.Artist.ToLower().Contains(s) || t.Genre.ToLower().Contains(s)).ToList();
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
            viewModel.SelectedTier = tier ?? "all";

            // Lọc theo tier nếu có
            if (!string.IsNullOrWhiteSpace(tier) && tier != "all")
            {
                if (tier.Equals("slot", StringComparison.OrdinalIgnoreCase) || tier.Equals("demo_slot", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị track Slot (Bản đặt VIP)
                    trackList = trackList.Where(IsTrackSlot).ToList();
                }
                else if (tier.Equals("nhom", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị track của Nhóm
                    trackList = trackList.Where(IsTrackNhom).ToList();
                }
                else if (tier.Equals("lot", StringComparison.OrdinalIgnoreCase))
                {
                    // Chỉ hiển thị track Lọt (Free) - Tuyệt đối không lẫn Slot hay Nhóm
                    trackList = trackList.Where(IsTrackLot).ToList();
                }
            }
            else
            {
                // Ở MỤC "TẤT CẢ" (tier == null hoặc tier == "all"):
                // - Tài khoản Standard: Bỏ phần nhạc Slot (chỉ hiện Nhạc Nhóm + Nhạc Lọt)
                // - Tài khoản Free (hoặc chưa đăng nhập): Chỗ Tất Cả chỉ hiện Track Lọt
                // - Tài khoản Premium / Admin / Producer: Hiển thị trọn vẹn toàn bộ
                if (isPremiumUser || isAdminOrProducer)
                {
                    // Giữ nguyên toàn bộ bài (Slot + Nhóm + Lọt)
                }
                else if (currentUserTier == "standard")
                {
                    // Standard: Bỏ phần nhạc slot
                    trackList = trackList.Where(t => !IsTrackSlot(t)).ToList();
                }
                else
                {
                    // Free: Chỉ hiện track lọt
                    trackList = trackList.Where(IsTrackLot).ToList();
                }
            }

            // Lọc theo ngày cụ thể nếu có
            if (!string.IsNullOrWhiteSpace(date))
            {
                trackList = trackList.Where(t => t.ReleaseDate.ToString("yyyy-MM-dd") == date || t.ReleaseDate.ToString("dd/MM/yyyy") == date).ToList();
            }

            viewModel.TotalTracks = trackList.Count;

            // Gom nhóm theo ngày (Giờ Việt Nam UTC+7)
            var todayVn = DateTime.UtcNow.AddHours(7).Date;
            var groups = trackList
                .GroupBy(t => t.ReleaseDate.Date)
                .OrderByDescending(g => g.Key)
                .Select(g => new DailyTrackGroup
                {
                    Date = g.Key,
                    FormattedDate = g.Key.ToString("dd/MM/yyyy"),
                    DayOfWeekName = GetVietnameseDayOfWeek(g.Key, todayVn),
                    Tracks = g.OrderByDescending(t => t.ReleaseDate).ToList()
                })
                .ToList();

            viewModel.DailyGroups = groups;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lỗi khi nạp dữ liệu Kho Track theo ngày");
            LoadFallbackTracks(viewModel);
        }

        return View(viewModel);
    }

    public static bool IsTrackSlot(Track t)
    {
        return (t.CategoryCode != null && t.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Premium
            || t.Type == AudioType.TrackDat;
    }

    public static bool IsTrackNhom(Track t)
    {
        return !IsTrackSlot(t) && (
            (t.CategoryCode != null && t.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase))
            || t.TierRequiredToDownload == RequiredTier.Standard
        );
    }

    public static bool IsTrackLot(Track t)
    {
        return !IsTrackSlot(t) && !IsTrackNhom(t);
    }

    private static Track MapEntityToTrack(Models.Entities.Music m)
    {
        var requiredTier = RequiredTier.Free;
        if (m.Category != null && !string.IsNullOrEmpty(m.Category.RequiredTierToDownload))
        {
            if (m.Category.RequiredTierToDownload == "Premium") requiredTier = RequiredTier.Premium;
            else if (m.Category.RequiredTierToDownload == "Standard") requiredTier = RequiredTier.Standard;
        }
        else if (!string.IsNullOrEmpty(m.CategoryCode))
        {
            if (m.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase)) requiredTier = RequiredTier.Premium;
            else if (m.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase)) requiredTier = RequiredTier.Standard;
        }

        var isSlot = (m.CategoryCode != null && m.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase)) || requiredTier == RequiredTier.Premium;
        var cleanQuality = (isSlot || (m.QualityAvailable != null && m.QualityAvailable.ToUpperInvariant().Contains("WAV"))) ? "WAV" : "MP3";

        return new Track
        {
            Id = m.MusicId.ToString(),
            Title = m.Title,
            Artist = m.Artist,
            Genre = m.Genre,
            Type = isSlot ? AudioType.TrackDat : AudioType.TrackLe,
            CategoryCode = m.CategoryCode ?? "TrackLot",
            Bpm = m.Bpm,
            MusicalKey = m.MusicalKey,
            DurationSeconds = m.DurationSeconds,
            CoverUrl = m.CoverUrl ?? "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80",
            AudioUrl = m.SourceUrl,
            SourceType = m.SourceType ?? "DirectFile",
            TierRequiredToDownload = requiredTier,
            IsDemoOnlyForFree = m.IsDemoOnlyForFree,
            DemoLimitSeconds = m.DemoLimitSeconds,
            QualityAvailable = cleanQuality,
            PlaysCount = m.PlaysCount,
            DownloadsCount = m.DownloadsCount,
            ReleaseDate = m.CreatedAt
        };
    }

    private static string GetVietnameseDayOfWeek(DateTime dt, DateTime? todayVn = null)
    {
        var refToday = todayVn ?? DateTime.UtcNow.AddHours(7).Date;
        if (dt.Date == refToday) return "Hôm Nay";
        if (dt.Date == refToday.AddDays(-1)) return "Hôm Qua";
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

    private static void LoadFallbackTracks(DailyTracksViewModel viewModel)
    {
        var today = DateTime.Today;
        var sampleTracks = new List<Track>
        {
            new() { Id = "fb1", Title = "[DUBPLATE] Vũ Điệu Hoang Dã (Exclusive VIP Master)", Artist = "DJ TLong Private Dubplate", Genre = "Vinahouse Dubplate", CategoryCode = "TrackSlot", TierRequiredToDownload = RequiredTier.Premium, Bpm = 142, MusicalKey = "11B", DurationSeconds = 260, CoverUrl = "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80", AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3", QualityAvailable = "WAV", ReleaseDate = today },
            new() { Id = "fb2", Title = "Tình Nhạt Phai (TLong Remix Intro Club)", Artist = "TLong Music x Đan Trường", Genre = "Vinahouse Intro", CategoryCode = "TrackNhom", TierRequiredToDownload = RequiredTier.Standard, Bpm = 140, MusicalKey = "8A", DurationSeconds = 245, CoverUrl = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80", AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3", QualityAvailable = "MP3", ReleaseDate = today },
            new() { Id = "fb3", Title = "[TRACK ĐẶT] Bass Drop Đỉnh Cao - Show Sân Vận Động", Artist = "DJ TLong x DJ Quốc Tế", Genre = "Festival Bounce", CategoryCode = "TrackSlot", TierRequiredToDownload = RequiredTier.Premium, Bpm = 145, MusicalKey = "12A", DurationSeconds = 295, CoverUrl = "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=600&auto=format&fit=crop&q=80", AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", QualityAvailable = "WAV", ReleaseDate = today.AddDays(-1) },
            new() { Id = "fb4", Title = "Cắt Đôi Nỗi Sầu (TLong x Hưng Bass Extended Mix)", Artist = "TLong Producer", Genre = "Vinahouse Bassline", CategoryCode = "TrackNhom", TierRequiredToDownload = RequiredTier.Standard, Bpm = 138, MusicalKey = "5A", DurationSeconds = 280, CoverUrl = "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80", AudioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3", QualityAvailable = "MP3", ReleaseDate = today.AddDays(-1) }
        };

        viewModel.TotalTracks = sampleTracks.Count;
        viewModel.DailyGroups = sampleTracks
            .GroupBy(t => t.ReleaseDate.Date)
            .OrderByDescending(g => g.Key)
            .Select(g => new DailyTrackGroup
            {
                Date = g.Key,
                FormattedDate = g.Key.ToString("dd/MM/yyyy"),
                DayOfWeekName = GetVietnameseDayOfWeek(g.Key),
            })
            .ToList();
    }

    [HttpGet("/Track/Detail/{id}")]
    [HttpGet("/Nonstop/Detail/{id}")]
    [HttpGet("/Music/Detail/{id}")]
    [HttpGet("/Song/{id}")]
    public async Task<IActionResult> Detail(string id)
    {
        if (string.IsNullOrEmpty(id)) return RedirectToAction("Index", "Home");

        Guid musicGuid;
        Models.Entities.Music? music = null;

        if (Guid.TryParse(id, out musicGuid))
        {
            music = await _context.Musics
                .Include(m => m.Category)
                .Include(m => m.Producer)
                    .ThenInclude(p => p.User)
                .Include(m => m.Favorites)
                .FirstOrDefaultAsync(m => m.MusicId == musicGuid && m.Status == "Published");
        }

        if (music == null)
        {
            music = await _context.Musics
                .Include(m => m.Category)
                .Include(m => m.Producer)
                    .ThenInclude(p => p.User)
                .Include(m => m.Favorites)
                .FirstOrDefaultAsync(m => m.Status == "Published");

            if (music == null) return RedirectToAction("Index", "Home");
        }

        // Determine permissions
        string? currentUserTier = null;
        bool isPremiumUser = false;
        bool isStandardUser = false;
        bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");
        string currentUserName = User.Identity?.Name ?? "Khách";
        string currentUserAvatar = "/images/logo.png";
        Guid? currentUserId = null;

        if (User.Identity?.IsAuthenticated == true)
        {
            var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(userIdClaim, out var uGuid))
            {
                currentUserId = uGuid;
                var dbUser = await _context.Users.FindAsync(uGuid);
                if (dbUser != null)
                {
                    currentUserAvatar = !string.IsNullOrEmpty(dbUser.AvatarUrl) ? dbUser.AvatarUrl : "/images/logo.png";
                    currentUserName = dbUser.FullName ?? dbUser.Username;
                }

                var activeSub = await _context.Subscriptions
                    .Include(s => s.Package)
                    .Where(s => s.UserId == uGuid && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                    .OrderByDescending(s => s.Package != null ? s.Package.Price : 0)
                    .FirstOrDefaultAsync();

                if (activeSub != null)
                {
                    currentUserTier = activeSub.PackageId;
                }
            }
        }

        if (isAdminOrProducer)
        {
            isPremiumUser = true;
            isStandardUser = true;
        }
        else if (currentUserTier == "Premium")
        {
            isPremiumUser = true;
            isStandardUser = true;
        }
        else if (currentUserTier == "Standard")
        {
            isStandardUser = true;
        }

        var trackModel = MapEntityToTrack(music);
        var cleanQuality = (music.QualityAvailable != null && music.QualityAvailable.ToUpperInvariant().Contains("WAV")) ? "WAV" : "MP3";
        bool isWav = cleanQuality == "WAV";

        bool isSlot = music.CategoryCode == "TrackSlot" || music.CategoryCode == "NonstopSlot" || (music.Category != null && music.Category.RequiredTierToDownload == "Premium");
        bool isNhom = music.CategoryCode == "TrackNhom" || music.CategoryCode == "NonstopNhom" || (music.Category != null && music.Category.RequiredTierToDownload == "Standard");
        bool isLot = !isSlot && !isNhom;

        bool isUnlocked = isAdminOrProducer || (isSlot && isPremiumUser) || (isNhom && isStandardUser) || isLot;
        bool isNonstop = music.Type == "Nonstop" || (music.CategoryCode != null && music.CategoryCode.ToLower().Contains("nonstop"));

        bool isDemo = !isUnlocked;
        int demoLimit = 30;
        if (music.DemoLimitSeconds > 0) demoLimit = music.DemoLimitSeconds;

        // Calculate time ago
        var span = DateTime.UtcNow - music.CreatedAt;
        string timeAgo = span.TotalDays >= 30 ? $"{(int)(span.TotalDays / 30)} tháng trước" :
                         span.TotalDays >= 1 ? $"{(int)span.TotalDays} ngày trước" :
                         span.TotalHours >= 1 ? $"{(int)span.TotalHours} giờ trước" :
                         span.TotalMinutes >= 1 ? $"{(int)span.TotalMinutes} phút trước" : "Vừa xong";

        // Related Tracks/Nonstops
        var relatedEntities = await _context.Musics
            .Include(m => m.Category)
            .Where(m => m.MusicId != music.MusicId && m.Status == "Published" && (m.Genre == music.Genre || m.ProducerId == music.ProducerId || m.Type == music.Type))
            .OrderByDescending(m => m.PlaysCount)
            .Take(6)
            .ToListAsync();

        var relatedTracks = relatedEntities.Select(MapEntityToTrack).ToList();

        // Sample initial comments
        var comments = new List<SongCommentItem>
        {
            new() { UserName = "DJ Hoàng Bass", UserAvatar = "/images/logo.png", Content = "Bản mix đánh căng đét, bass drop cực uy lực! 🔥", TimeAgo = "2 giờ trước" },
            new() { UserName = "Minh Tuấn Club", UserAvatar = "/images/logo.png", Content = "Tone key và BPM quá chuẩn để xếp set nhạc tối nay.", TimeAgo = "5 giờ trước" },
            new() { UserName = "TLong Fan Club", UserAvatar = "/images/logo.png", Content = "Nhạc của Producer TLong chưa bao giờ làm anh em thất vọng!", TimeAgo = "1 ngày trước" }
        };

        var vm = new SongDetailViewModel
        {
            Music = trackModel,
            CleanQuality = cleanQuality,
            IsWav = isWav,
            IsNonstop = isNonstop,
            IsSlot = isSlot,
            IsNhom = isNhom,
            IsLot = isLot,
            IsUnlocked = isUnlocked,
            IsDemo = isDemo,
            DemoLimit = demoLimit,
            TimeAgo = timeAgo,
            FavoritesCount = music.Favorites?.Count ?? 0,
            IsFavorite = currentUserId.HasValue && (music.Favorites?.Any(f => f.UserId == currentUserId.Value) == true),
            Producer = music.Producer,
            RelatedMusics = relatedTracks,
            Comments = comments,
            CurrentUserTier = currentUserTier,
            IsPremiumUser = isPremiumUser,
            IsStandardUser = isStandardUser,
            IsAdminOrProducer = isAdminOrProducer,
            CurrentUserAvatar = currentUserAvatar,
            CurrentUserName = currentUserName
        };

        return View("~/Views/Track/Detail.cshtml", vm);
    }
}

public class DailyTrackGroup
{
    public DateTime Date { get; set; }
    public string FormattedDate { get; set; } = string.Empty;
    public string DayOfWeekName { get; set; } = string.Empty;
    public List<Track> Tracks { get; set; } = new();
}

public class DailyTracksViewModel
{
    public List<DailyTrackGroup> DailyGroups { get; set; } = new();
    public int TotalTracks { get; set; }
    public string? SelectedDate { get; set; }
    public string? SearchQuery { get; set; }
    public string? SelectedGenre { get; set; }
    public string? SelectedTier { get; set; }
    public List<string> AvailableGenres { get; set; } = new();
    public string? CurrentUserTier { get; set; }
    public bool IsPremiumUser { get; set; }
    public bool IsVipUser { get; set; }
}
