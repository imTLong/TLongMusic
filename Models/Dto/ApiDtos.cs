using System.ComponentModel.DataAnnotations;

namespace TLongMusic.Models.Dto
{
    public class LoginDto
    {
        [Required(ErrorMessage = "Vui lòng nhập tên đăng nhập hoặc email")]
        public string UsernameOrEmail { get; set; } = string.Empty;

        [Required(ErrorMessage = "Vui lòng nhập mật khẩu")]
        public string Password { get; set; } = string.Empty;
    }

    public class RegisterDto
    {
        [Required(ErrorMessage = "Vui lòng nhập tên đăng nhập")]
        [StringLength(50, MinimumLength = 3)]
        public string Username { get; set; } = string.Empty;

        [Required(ErrorMessage = "Vui lòng nhập email")]
        [EmailAddress(ErrorMessage = "Email không đúng định dạng")]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "Vui lòng nhập mật khẩu")]
        [StringLength(100, MinimumLength = 6)]
        public string Password { get; set; } = string.Empty;

        [Required(ErrorMessage = "Vui lòng nhập họ và tên")]
        public string FullName { get; set; } = string.Empty;

        public string? PhoneNumber { get; set; }
    }

    public class UserSessionDto
    {
        public Guid UserId { get; set; }
        public string Username { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? AvatarUrl { get; set; }
        public List<string> Roles { get; set; } = new List<string>();
        public string PrimaryRole { get; set; } = "Member";
        public string Tier { get; set; } = "Free"; // 'Free', 'Standard', 'Premium'
        public DateTime? TierExpiresAt { get; set; }
        public bool IsVipActive { get; set; } = false;
        public string? PhoneNumber { get; set; }
        public string? BankName { get; set; }
        public string? BankAccountNumber { get; set; }
        public string? BankAccountHolder { get; set; }
        public bool CanDownloadLot { get; set; } = true;
        public bool CanDownloadNhom { get; set; } = false;
        public bool CanDownloadSlot { get; set; } = false;
        public int SlotDemoLimitSeconds { get; set; } = 30;
    }

    public class UpdateProfileDto
    {
        [Required(ErrorMessage = "Vui lòng nhập họ và tên")]
        public string FullName { get; set; } = string.Empty;

        public string? PhoneNumber { get; set; }

        [EmailAddress(ErrorMessage = "Email không đúng định dạng")]
        public string? Email { get; set; }

        public string? AvatarUrl { get; set; }
        public IFormFile? AvatarFile { get; set; }

        public string? BankName { get; set; }
        public string? BankAccountNumber { get; set; }
        public string? BankAccountHolder { get; set; }

        public string? OldPassword { get; set; }
        public string? NewPassword { get; set; }
    }

    public class CreateOrderDto
    {
        [Required]
        public string PackageId { get; set; } = string.Empty;
    }

    public class ConfirmPaymentDto
    {
        [Required]
        public string OrderCode { get; set; } = string.Empty;
    }

    public class UploadMusicDto
    {
        [Required(ErrorMessage = "Vui lòng nhập tiêu đề bài hát")]
        public string Title { get; set; } = string.Empty;

        [Required(ErrorMessage = "Vui lòng nhập tên nghệ sĩ")]
        public string Artist { get; set; } = string.Empty;

        public string Genre { get; set; } = "Vinahouse";

        [Required(ErrorMessage = "Vui lòng chọn danh mục (Lọt, Nhóm, Slot)")]
        public string CategoryCode { get; set; } = "TrackLot";

        public string Type { get; set; } = "Track"; // 'Track' hoặc 'Nonstop'
        public int Bpm { get; set; } = 140;
        public string MusicalKey { get; set; } = "8A";
        public int DurationSeconds { get; set; } = 240;
        public string? SourceType { get; set; } = "DirectFile";
        public string? SourceUrl { get; set; }
        public string? DownloadedAudioUrl { get; set; }
        public string? CoverUrl { get; set; }
        public string QualityAvailable { get; set; } = "MP3 320kbps";
        public bool IsDemoOnlyForFree { get; set; } = false;
        public int DemoLimitSeconds { get; set; } = 30;
        // SoundCloud integration removed — use direct file upload or provide SourceUrl for hosted files
    }

    public class UploadMusicFormDto
    {
        public string Title { get; set; } = string.Empty;
        public string Artist { get; set; } = string.Empty;
        public string Genre { get; set; } = "Vinahouse";
        public string CategoryCode { get; set; } = "TrackLot";
        public string Type { get; set; } = "Track"; // 'Track' hoặc 'Nonstop'
        public int Bpm { get; set; } = 140;
        public string MusicalKey { get; set; } = "8A";
        public int DurationSeconds { get; set; } = 240;
        public string? SourceType { get; set; } // 'DirectFile' or other hosted source
        public string? SourceUrl { get; set; }
        // SoundCloud integration removed
        public string? CoverUrl { get; set; }
        public string? QualityAvailable { get; set; }
        public bool IsDemoOnlyForFree { get; set; } = false;
        public int DemoLimitSeconds { get; set; } = 30;
        public string? DownloadedAudioUrl { get; set; }
        public IFormFile? AudioFile { get; set; }
        public IFormFile? CoverFile { get; set; }
    }

    // FetchSoundCloudDto removed with SoundCloud support

    public class CreateProducerDto
    {
        [Required]
        public string Username { get; set; } = string.Empty;

        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required]
        public string Password { get; set; } = "123456";

        [Required]
        public string FullName { get; set; } = string.Empty;

        [Required]
        public string StageName { get; set; } = string.Empty;

        public string? Bio { get; set; }
        public string? PhoneNumber { get; set; }
        public string? ZaloContact { get; set; }
        public string? BankName { get; set; }
        public string? BankAccountNumber { get; set; }
        public string? BankAccountHolder { get; set; }
    }

    public class AdminStatsDto
    {
        public int TotalUsers { get; set; }
        public int TotalProducers { get; set; }
        public int TotalMusics { get; set; }
        public int TotalDownloads { get; set; }
        public int TotalPlays { get; set; }
        public decimal TotalRevenue { get; set; }
        public int ActiveVipSubscriptions { get; set; }
    }

    public class AdminExtendSubscriptionDto
    {
        [Required(ErrorMessage = "Vui lòng chọn tài khoản người dùng")]
        public Guid UserId { get; set; }

        [Required(ErrorMessage = "Vui lòng chọn gói cước")]
        public string PackageId { get; set; } = "Standard"; // 'Standard', 'Premium'

        [Range(1, 3650, ErrorMessage = "Số ngày gia hạn phải từ 1 đến 3650 ngày")]
        public int DurationDays { get; set; } = 30;

        public string? Reason { get; set; }
    }

    public class PaymentWebhookDto
    {
        public string? OrderCode { get; set; }
        public string? Content { get; set; }
        public decimal? Amount { get; set; }
        public string? TransactionNumber { get; set; }
    }

    public class BulkDeleteMusicDto
    {
        [Required(ErrorMessage = "Danh sách ID bài hát không được để trống")]
        public List<Guid> MusicIds { get; set; } = new List<Guid>();
    }
}
