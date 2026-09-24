namespace TLongMusic.Models
{
    public enum AudioType
    {
        NonstopLot,     // Nonstop lọt (Free nghe full)
        NonstopDat,     // Nonstop đặt (Chỉ demo cho Free/Standard, Full cho Premium)
        TrackLe,        // Track lẻ thông thường (Standard tải được)
        TrackDat        // Track đặt VIP (Chỉ Premium tải được)
    }

    public enum RequiredTier
    {
        Free,
        Standard,
        Premium
    }

    public class Track
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Title { get; set; } = string.Empty;
        public string Artist { get; set; } = string.Empty;
        public string Genre { get; set; } = "Vinahouse";
        public AudioType Type { get; set; }
        public string CategoryCode { get; set; } = "TrackLot";
        public int Bpm { get; set; }
        public string MusicalKey { get; set; } = "8A"; // Camelot Key
        public int DurationSeconds { get; set; }
        public string CoverUrl { get; set; } = string.Empty;
        public string AudioUrl { get; set; } = string.Empty;
        public string SourceType { get; set; } = "DirectFile"; // 'DirectFile' or other hosted source
        public RequiredTier TierRequiredToDownload { get; set; } = RequiredTier.Standard;
        public bool IsDemoOnlyForFree { get; set; } = false;
        public int DemoLimitSeconds { get; set; } = 45;
        public string QualityAvailable { get; set; } = "320kbps MP3";
        public int PlaysCount { get; set; }
        public int DownloadsCount { get; set; }
        public DateTime ReleaseDate { get; set; } = DateTime.Now;

        public string FormattedDuration
        {
            get
            {
                var ts = TimeSpan.FromSeconds(DurationSeconds);
                return ts.Hours > 0 ? $"{ts.Hours}:{ts.Minutes:D2}:{ts.Seconds:D2}" : $"{ts.Minutes}:{ts.Seconds:D2}";
            }
        }
    }

    public class SubscriptionPlan
    {
        public string Name { get; set; } = string.Empty;
        public string TierCode { get; set; } = string.Empty; // free, standard, premium
        public decimal Price { get; set; }
        public string BillingPeriod { get; set; } = "/ tháng";
        public string BadgeText { get; set; } = string.Empty;
        public bool IsPopular { get; set; }
        public List<string> Features { get; set; } = new();
        public string ButtonText { get; set; } = "Chọn Gói";
    }

    public class HomeViewModel
    {
        public List<Track> AllNonstops { get; set; } = new();
        public List<Track> SlotNonstops { get; set; } = new();
        public List<Track> NhomNonstops { get; set; } = new();
        public List<Track> LotNonstops { get; set; } = new();
        public List<Track> HotNonstops { get; set; } = new();
        public List<Track> VipNonstops { get; set; } = new();
        public List<Track> LatestTracks { get; set; } = new();
        public List<SubscriptionPlan> Plans { get; set; } = new();

        // Current User Permissions
        public string? CurrentUserTier { get; set; }
        public bool IsPremiumUser { get; set; }
        public bool IsStandardUser { get; set; }
        public bool IsAdminOrProducer { get; set; }
    }

    public class SongCommentItem
    {
        public string UserName { get; set; } = string.Empty;
        public string UserAvatar { get; set; } = "/images/logo.png";
        public string Content { get; set; } = string.Empty;
        public string TimeAgo { get; set; } = "Vừa xong";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class SongDetailViewModel
    {
        public Track Music { get; set; } = new();
        public string TimeAgo { get; set; } = "Mới phát hành";
        public string CleanQuality { get; set; } = "MP3";
        public bool IsWav { get; set; }
        public bool IsNonstop { get; set; }
        public bool IsSlot { get; set; }
        public bool IsNhom { get; set; }
        public bool IsLot { get; set; }
        public bool IsUnlocked { get; set; }
        public bool IsDemo { get; set; }
        public int DemoLimit { get; set; } = 30;
        public int FavoritesCount { get; set; }
        public bool IsFavorite { get; set; }
        public Entities.Producer? Producer { get; set; }
        public List<Track> RelatedMusics { get; set; } = new();
        public List<SongCommentItem> Comments { get; set; } = new();

        // User info
        public string? CurrentUserTier { get; set; }
        public bool IsPremiumUser { get; set; }
        public bool IsStandardUser { get; set; }
        public bool IsAdminOrProducer { get; set; }
        public string CurrentUserAvatar { get; set; } = "/images/logo.png";
        public string CurrentUserName { get; set; } = "Khách";
    }
}

