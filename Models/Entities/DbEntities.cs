using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace TLongMusic.Models.Entities
{
    // 1. ROLES
    [Table("Roles")]
    public class Role
    {
        [Key]
        [StringLength(20)]
        public string RoleId { get; set; } = string.Empty; // 'Admin', 'Producer', 'Member'

        [Required]
        [StringLength(50)]
        public string RoleName { get; set; } = string.Empty;

        [StringLength(255)]
        public string? Description { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
    }

    // 2. USERS
    [Table("Users")]
    public class User
    {
        [Key]
        public Guid UserId { get; set; } = Guid.NewGuid();

        [Required]
        [StringLength(50)]
        public string Username { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string Email { get; set; } = string.Empty;

        [Required]
        [StringLength(255)]
        public string PasswordHash { get; set; } = string.Empty;

        [StringLength(100)]
        public string? FullName { get; set; }

        [StringLength(20)]
        public string? PhoneNumber { get; set; }

        [StringLength(500)]
        public string? AvatarUrl { get; set; }

        [Required]
        [StringLength(20)]
        public string Status { get; set; } = "Active"; // 'Active', 'Locked', 'Disabled'

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
        public Producer? ProducerProfile { get; set; }
        public ICollection<Subscription> Subscriptions { get; set; } = new List<Subscription>();
        public ICollection<Payment> Payments { get; set; } = new List<Payment>();
        public ICollection<Favorite> Favorites { get; set; } = new List<Favorite>();
        public ICollection<Playlist> Playlists { get; set; } = new List<Playlist>();
        public ICollection<ListeningHistory> ListeningHistories { get; set; } = new List<ListeningHistory>();
        public ICollection<DownloadHistory> DownloadHistories { get; set; } = new List<DownloadHistory>();
        public ICollection<Report> Reports { get; set; } = new List<Report>();
        public ICollection<Notification> Notifications { get; set; } = new List<Notification>();
    }

    // 3. USERROLES (N-N junction)
    [Table("UserRoles")]
    public class UserRole
    {
        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [StringLength(20)]
        public string RoleId { get; set; } = string.Empty;
        [ForeignKey("RoleId")]
        public Role? Role { get; set; }

        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    }

    // 4. PRODUCERS
    [Table("Producers")]
    public class Producer
    {
        [Key]
        public Guid ProducerId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [Required]
        [StringLength(100)]
        public string StageName { get; set; } = string.Empty; // Nghệ danh

        public string? Bio { get; set; }

        [StringLength(20)]
        public string? PhoneNumber { get; set; }

        [StringLength(50)]
        public string? ZaloContact { get; set; }

        [StringLength(255)]
        public string? FacebookUrl { get; set; }

        // SoundCloudUrl removed

        [StringLength(100)]
        public string? BankName { get; set; }

        [StringLength(50)]
        public string? BankAccountNumber { get; set; }

        [StringLength(100)]
        public string? BankAccountHolder { get; set; }

        public bool IsVerified { get; set; } = true;

        public Guid? CreatedByAdminId { get; set; }
        [ForeignKey("CreatedByAdminId")]
        public User? CreatedByAdmin { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Music> Musics { get; set; } = new List<Music>();
    }

    // 5. PACKAGES (Gói thành viên)
    [Table("Packages")]
    public class Package
    {
        [Key]
        [StringLength(20)]
        public string PackageId { get; set; } = string.Empty; // 'Free', 'Standard', 'Premium'

        [Required]
        [StringLength(100)]
        public string Name { get; set; } = string.Empty;

        public decimal Price { get; set; }
        public int DurationDays { get; set; } = 30;

        [StringLength(500)]
        public string? Description { get; set; }

        [StringLength(50)]
        public string? BadgeText { get; set; }

        [StringLength(20)]
        public string ThemeColor { get; set; } = "Default"; // 'Default', 'RubyRed', 'RoyalGold'

        public bool CanDownloadLot { get; set; } = true;
        public bool CanDownloadNhom { get; set; } = false;
        public bool CanDownloadSlot { get; set; } = false;
        public int SlotDemoLimitSeconds { get; set; } = 30;

        [StringLength(20)]
        public string Status { get; set; } = "Active";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Subscription> Subscriptions { get; set; } = new List<Subscription>();
        public ICollection<Payment> Payments { get; set; } = new List<Payment>();
        public ICollection<TrackCategory> AllowedCategories { get; set; } = new List<TrackCategory>();
    }

    // 6. SUBSCRIPTIONS
    [Table("Subscriptions")]
    public class Subscription
    {
        [Key]
        public Guid SubscriptionId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [Required]
        [StringLength(20)]
        public string PackageId { get; set; } = string.Empty;
        [ForeignKey("PackageId")]
        public Package? Package { get; set; }

        public DateTime StartDate { get; set; } = DateTime.UtcNow;
        public DateTime EndDate { get; set; }
        
        [Required]
        [StringLength(20)]
        public string Status { get; set; } = "Active"; // 'Active', 'Expired', 'Cancelled'

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Payment> Payments { get; set; } = new List<Payment>();
    }

    // 7. PAYMENTS
    [Table("Payments")]
    public class Payment
    {
        [Key]
        public Guid PaymentId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [Required]
        [StringLength(20)]
        public string PackageId { get; set; } = string.Empty;
        [ForeignKey("PackageId")]
        public Package? Package { get; set; }

        public Guid? SubscriptionId { get; set; }
        [ForeignKey("SubscriptionId")]
        public Subscription? Subscription { get; set; }

        public decimal Amount { get; set; }

        [StringLength(50)]
        public string Method { get; set; } = "VietQR"; // 'VietQR', 'BankTransfer', 'Momo'

        [Required]
        [StringLength(50)]
        public string OrderCode { get; set; } = string.Empty;

        [StringLength(100)]
        public string? TransactionCode { get; set; }

        [StringLength(20)]
        public string Status { get; set; } = "Pending"; // 'Pending', 'Success', 'Failed', 'Cancelled'

        public DateTime? PaymentDate { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    // 8. TRACKCATEGORIES
    [Table("TrackCategories")]
    public class TrackCategory
    {
        [Key]
        [StringLength(30)]
        public string CategoryCode { get; set; } = string.Empty; // 'TrackLot', 'NonstopLot', 'TrackNhom', 'NonstopNhom', 'TrackSlot', 'NonstopSlot'

        [Required]
        [StringLength(100)]
        public string Name { get; set; } = string.Empty;

        [Required]
        [StringLength(20)]
        public string Kind { get; set; } = "Track"; // 'Track', 'Nonstop'

        [Required]
        [StringLength(20)]
        public string AccessLevel { get; set; } = "Lot"; // 'Lot', 'Nhom', 'Slot'

        [Required]
        [StringLength(20)]
        public string RequiredTierToDownload { get; set; } = "Free";
        [ForeignKey("RequiredTierToDownload")]
        public Package? RequiredPackage { get; set; }

        [StringLength(255)]
        public string? Description { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<Music> Musics { get; set; } = new List<Music>();
    }

    // 9. MUSICS (Tracks & Nonstops)
    [Table("Musics")]
    public class Music
    {
        [Key]
        public Guid MusicId { get; set; } = Guid.NewGuid();

        public Guid ProducerId { get; set; }
        [ForeignKey("ProducerId")]
        public Producer? Producer { get; set; }

        [Required]
        [StringLength(255)]
        public string Title { get; set; } = string.Empty;

        [Required]
        [StringLength(255)]
        public string Artist { get; set; } = string.Empty;

        [StringLength(100)]
        public string Genre { get; set; } = "Vinahouse";

        [Required]
        [StringLength(30)]
        public string CategoryCode { get; set; } = "TrackLot";
        [ForeignKey("CategoryCode")]
        public TrackCategory? Category { get; set; }

        [Required]
        [StringLength(20)]
        public string Type { get; set; } = "Track"; // 'Track' hoặc 'Nonstop'

        public int Bpm { get; set; } = 140;

        [StringLength(10)]
        public string MusicalKey { get; set; } = "8A";

        public int DurationSeconds { get; set; }

        [StringLength(500)]
        public string? CoverUrl { get; set; }

        [StringLength(50)]
        public string SourceType { get; set; } = "DirectFile"; // 'DirectFile', 'CloudflareR2', etc.

        [Required]
        [StringLength(500)]
        public string SourceUrl { get; set; } = string.Empty;

        [StringLength(500)]
        public string? DemoFilePath { get; set; }

        // SoundCloudUrl removed

        [StringLength(50)]
        public string QualityAvailable { get; set; } = "MP3 320kbps";

        public bool IsDemoOnlyForFree { get; set; } = false;
        public int DemoLimitSeconds { get; set; } = 30;

        public int PlaysCount { get; set; }
        public int DownloadsCount { get; set; }

        [StringLength(20)]
        public string Status { get; set; } = "Published"; // 'Draft', 'Pending', 'Published', 'Hidden', 'Expired'

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        [NotMapped]
        public string FormattedDuration
        {
            get
            {
                var ts = TimeSpan.FromSeconds(DurationSeconds);
                return ts.Hours > 0 ? $"{ts.Hours}:{ts.Minutes:D2}:{ts.Seconds:D2}" : $"{ts.Minutes}:{ts.Seconds:D2}";
            }
        }

        // Navigation
        public ICollection<Favorite> Favorites { get; set; } = new List<Favorite>();
        public ICollection<PlaylistTrack> PlaylistTracks { get; set; } = new List<PlaylistTrack>();
        public ICollection<ListeningHistory> ListeningHistories { get; set; } = new List<ListeningHistory>();
        public ICollection<DownloadHistory> DownloadHistories { get; set; } = new List<DownloadHistory>();
        public ICollection<Report> Reports { get; set; } = new List<Report>();
    }

    // 10. FAVORITES
    [Table("Favorites")]
    public class Favorite
    {
        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        public Guid MusicId { get; set; }
        [ForeignKey("MusicId")]
        public Music? Music { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    // 11. PLAYLISTS
    [Table("Playlists")]
    public class Playlist
    {
        [Key]
        public Guid PlaylistId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [Required]
        [StringLength(150)]
        public string Name { get; set; } = string.Empty;

        [StringLength(500)]
        public string? Description { get; set; }

        [StringLength(500)]
        public string? ThumbnailUrl { get; set; }

        public bool IsPublic { get; set; } = true;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public ICollection<PlaylistTrack> PlaylistTracks { get; set; } = new List<PlaylistTrack>();
    }

    // 12. PLAYLISTTRACKS
    [Table("PlaylistTracks")]
    public class PlaylistTrack
    {
        public Guid PlaylistId { get; set; }
        [ForeignKey("PlaylistId")]
        public Playlist? Playlist { get; set; }

        public Guid MusicId { get; set; }
        [ForeignKey("MusicId")]
        public Music? Music { get; set; }

        public int OrderIndex { get; set; } = 0;
        public DateTime AddedAt { get; set; } = DateTime.UtcNow;
    }

    // 13. LISTENINGHISTORIES
    [Table("ListeningHistories")]
    public class ListeningHistory
    {
        [Key]
        public long HistoryId { get; set; }

        public Guid? UserId { get; set; } // Null nếu là Guest
        [ForeignKey("UserId")]
        public User? User { get; set; }

        public Guid MusicId { get; set; }
        [ForeignKey("MusicId")]
        public Music? Music { get; set; }

        public DateTime PlayedAt { get; set; } = DateTime.UtcNow;
        public int DurationPlayedSeconds { get; set; }
        
        [StringLength(50)]
        public string? IpAddress { get; set; }
    }

    // 14. DOWNLOADHISTORIES
    [Table("DownloadHistories")]
    public class DownloadHistory
    {
        [Key]
        public long DownloadId { get; set; }

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        public Guid MusicId { get; set; }
        [ForeignKey("MusicId")]
        public Music? Music { get; set; }

        public DateTime DownloadedAt { get; set; } = DateTime.UtcNow;

        [Required]
        [StringLength(20)]
        public string DownloadedTier { get; set; } = "Free";

        [StringLength(50)]
        public string? DownloadQuality { get; set; }

        [StringLength(50)]
        public string? IpAddress { get; set; }
    }

    // 15. REPORTS
    [Table("Reports")]
    public class Report
    {
        [Key]
        public Guid ReportId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        public Guid MusicId { get; set; }
        [ForeignKey("MusicId")]
        public Music? Music { get; set; }

        [Required]
        [StringLength(500)]
        public string Reason { get; set; } = string.Empty;

        [StringLength(20)]
        public string Status { get; set; } = "Pending"; // 'Pending', 'Reviewed', 'Resolved', 'Dismissed'

        [StringLength(500)]
        public string? AdminNote { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    // 16. NOTIFICATIONS
    [Table("Notifications")]
    public class Notification
    {
        [Key]
        public Guid NotificationId { get; set; } = Guid.NewGuid();

        public Guid UserId { get; set; }
        [ForeignKey("UserId")]
        public User? User { get; set; }

        [Required]
        [StringLength(150)]
        public string Title { get; set; } = string.Empty;

        [Required]
        [StringLength(500)]
        public string Content { get; set; } = string.Empty;

        [StringLength(50)]
        public string Type { get; set; } = "System"; // 'Payment', 'Subscription', 'Music', 'System'

        public bool IsRead { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
