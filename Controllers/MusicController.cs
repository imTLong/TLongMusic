using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models.Entities;
using TLongMusic.Services;


namespace TLongMusic.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class MusicController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;

        public MusicController(TLongMusicDbContext context)
        {
            _context = context;
        }

        // 1. PLAY / STREAM (Logs history & enforces 30s demo on Slot for non-premium)
        [HttpGet("Play/{id}")]
        public async Task<IActionResult> Play(Guid id)
        {
            var music = await _context.Musics
                .Include(m => m.Category)
                .Include(m => m.Producer)
                .FirstOrDefaultAsync(m => m.MusicId == id && m.Status == "Published");

            if (music == null)
            {
                return NotFound(new { success = false, message = "Bài hát không tồn tại hoặc đã bị ẩn!" });
            }

            // Identify User & Active Subscription
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            Guid? userId = Guid.TryParse(userIdClaim, out var parsedGuid) ? parsedGuid : null;
            string userTier = "Free";

            if (userId.HasValue)
            {
                var activeSub = await _context.Subscriptions
                    .Include(s => s.Package)
                    .Where(s => s.UserId == userId.Value && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                    .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                    .ThenByDescending(s => s.EndDate)
                    .FirstOrDefaultAsync();

                if (activeSub != null)
                {
                    userTier = activeSub.PackageId;
                }
            }

            // Check Demo rule for Slot & VIP Tracks (SRS: Standard & Free only get 30s demo on Slot)
            bool isDemo = false;
            int demoLimit = 0;

            bool isSlotTrack = music.CategoryCode == "TrackSlot" || 
                               music.CategoryCode == "NonstopSlot" || 
                               (music.Category != null && (music.Category.RequiredTierToDownload == "Premium" || music.Category.AccessLevel == "Slot")) ||
                               (music.CategoryCode != null && music.CategoryCode.Contains("Slot", StringComparison.OrdinalIgnoreCase));

            bool isNhomTrack = !isSlotTrack && (music.CategoryCode == "TrackNhom" || 
                               music.CategoryCode == "NonstopNhom" || 
                               (music.Category != null && (music.Category.RequiredTierToDownload == "Standard" || music.Category.AccessLevel == "Nhom")) ||
                               (music.CategoryCode != null && music.CategoryCode.Contains("Nhom", StringComparison.OrdinalIgnoreCase)));

            bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");

            if (!isAdminOrProducer)
            {
                bool isNonstop = music.CategoryCode == "NonstopSlot" || 
                                 music.CategoryCode == "NonstopNhom" || 
                                 music.Type == "Nonstop" || 
                                 (music.CategoryCode != null && music.CategoryCode.StartsWith("Nonstop", StringComparison.OrdinalIgnoreCase)) ||
                                 (!string.IsNullOrEmpty(music.Title) && music.Title.ToLower().Contains("nonstop"));

                if (isSlotTrack)
                {
                    // Kho Slot VIP: Chỉ duy nhất Premium được nghe full, Standard và Free chỉ được nghe Demo (30s)
                    if (userTier != "Premium")
                    {
                        isDemo = true;
                        demoLimit = music.DemoLimitSeconds > 0 ? music.DemoLimitSeconds : 30;
                    }
                }
                else if (isNhomTrack)
                {
                    // Kho Nhóm VIP: Standard và Premium được nghe full, Free chỉ được nghe Demo (30s)
                    if (userTier == "Free")
                    {
                        isDemo = true;
                        demoLimit = music.DemoLimitSeconds > 0 ? music.DemoLimitSeconds : 30;
                    }
                }
                else if (userTier == "Free" && music.IsDemoOnlyForFree)
                {
                    isDemo = true;
                    demoLimit = music.DemoLimitSeconds > 0 ? music.DemoLimitSeconds : 30;
                }
            }

            // Increment plays count
            music.PlaysCount += 1;

            // Log listening history
            _context.ListeningHistories.Add(new ListeningHistory
            {
                UserId = userId,
                MusicId = music.MusicId,
                PlayedAt = DateTime.UtcNow,
                DurationPlayedSeconds = isDemo ? demoLimit : music.DurationSeconds,
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString()
            });

            await _context.SaveChangesAsync();

            // Stream URL uses the authentic uploaded file directly (MP3 stays MP3, WAV stays WAV)
            var streamUrl = music.SourceUrl;

            return Ok(new
            {
                success = true,
                musicId = music.MusicId,
                title = music.Title,
                artist = music.Artist,
                coverUrl = music.CoverUrl,
                audioUrl = streamUrl,
                bpm = music.Bpm,
                musicalKey = music.MusicalKey,
                durationSeconds = music.DurationSeconds,
                categoryCode = music.CategoryCode,
                isDemo = isDemo,
                demoLimit = demoLimit,
                qualityAvailable = music.QualityAvailable,
                tierRequired = isSlotTrack ? "Premium" : (isNhomTrack ? "Standard" : (music.Category?.RequiredTierToDownload ?? "Free"))
            });
        }

        // 2. DOWNLOAD AUTHORIZATION (Server-Side Enforcement per BR-08)
        [HttpGet("Download/{id}")]
        public async Task<IActionResult> Download(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                // Guest is strictly forbidden from downloading (BR-01, FR-DL-02)
                return StatusCode(StatusCodes.Status401Unauthorized, new
                {
                    success = false,
                    code = "GUEST_FORBIDDEN",
                    message = "NGHIÊM CẤM TẢI VỀ KHI CHƯA ĐĂNG NHẬP! Khách vãng lai chỉ có quyền nghe trực tuyến. Vui lòng đăng nhập hoặc tạo tài khoản để tải nhạc."
                });
            }

            var music = await _context.Musics
                .Include(m => m.Category)
                .FirstOrDefaultAsync(m => m.MusicId == id && m.Status == "Published");

            if (music == null)
            {
                return NotFound(new { success = false, message = "Bài hát không tồn tại hoặc đã bị ẩn!" });
            }

            // Get User Active Subscription (Prioritize VIP packages over Free)
            var activeSub = await _context.Subscriptions
                .Include(s => s.Package)
                .Where(s => s.UserId == userId && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                .ThenByDescending(s => s.EndDate)
                .FirstOrDefaultAsync();

            string userTier = activeSub?.PackageId ?? "Free";
            bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");

            var requiredTier = music.Category?.RequiredTierToDownload ?? "Free";

            // FREE TIER RULE: Only downloads Lọt
            if (!isAdminOrProducer && userTier == "Free" && (requiredTier == "Standard" || requiredTier == "Premium"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    code = requiredTier == "Premium" ? "UPGRADE_PREMIUM" : "UPGRADE_STANDARD",
                    requiredTier = requiredTier,
                    message = $"Bài hát '{music.Title}' yêu cầu gói {requiredTier} VIP. Tài khoản Free chỉ được tải Track Lọt và Nonstop Lọt. Vui lòng nâng cấp gói!"
                });
            }

            // STANDARD TIER RULE: Cannot download Slot
            if (!isAdminOrProducer && userTier == "Standard" && requiredTier == "Premium")
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = false,
                    code = "UPGRADE_PREMIUM",
                    requiredTier = "Premium",
                    message = $"Bài hát '{music.Title}' là bản Master Slot VIP độc quyền phòng thu. Gói Standard chỉ được nghe thử demo 30s. Vui lòng nâng cấp lên Premium VIP để tải Full Master WAV 24-Bit!"
                });
            }

            // Authorized! Increment Download count and record DownloadHistory
            music.DownloadsCount += 1;

            string downloadQuality = (userTier == "Premium" || isAdminOrProducer) ? "WAV Master 24-Bit" : (userTier == "Standard" ? "MP3 320kbps" : "MP3 128kbps Standard");
            string ext = (userTier == "Premium" || isAdminOrProducer) ? ".wav" : ".mp3";
            string qualitySuffix = (userTier == "Premium" || isAdminOrProducer) ? "_Master_WAV" : (userTier == "Standard" ? "_320kbps" : "");
            var safeTitle = string.Concat(music.Title.Split(Path.GetInvalidFileNameChars())).Replace(" ", "_");

            _context.DownloadHistories.Add(new DownloadHistory
            {
                UserId = userId,
                MusicId = music.MusicId,
                DownloadedAt = DateTime.UtcNow,
                DownloadedTier = userTier,
                DownloadQuality = downloadQuality,
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString()
            });

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Đã xác thực quyền tải thành công ({userTier} - {downloadQuality})!",
                downloadUrl = $"/Music/DownloadFile/{music.MusicId}",
                fileName = $"{safeTitle}{qualitySuffix}_TLongMusic{ext}",
                quality = downloadQuality,
                tier = userTier
            });
        }

        // FR-DL-01..06: DIRECT PHYSICAL FILE DOWNLOAD (Never navigates to external URLs/SoundCloud)
        [HttpGet("DownloadFile/{id}")]
        public async Task<IActionResult> DownloadFile(Guid id, [FromQuery] string? format = null)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return StatusCode(StatusCodes.Status401Unauthorized, "Vui lòng đăng nhập để tải bài hát!");
            }

            var music = await _context.Musics
                .Include(m => m.Category)
                .FirstOrDefaultAsync(m => m.MusicId == id && m.Status == "Published");

            if (music == null)
            {
                return NotFound("Bài hát không tồn tại hoặc đã bị ẩn!");
            }

            var activeSub = await _context.Subscriptions
                .Include(s => s.Package)
                .Where(s => s.UserId == userId && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                .ThenByDescending(s => s.EndDate)
                .FirstOrDefaultAsync();

            string userTier = activeSub?.PackageId ?? "Free";
            bool isAdminOrProducer = User.IsInRole("Admin") || User.IsInRole("Producer");
            var requiredTier = music.Category?.RequiredTierToDownload ?? "Free";

            if (!isAdminOrProducer && userTier == "Free" && (requiredTier == "Standard" || requiredTier == "Premium"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, $"Bài hát '{music.Title}' yêu cầu gói {requiredTier} VIP.");
            }

            if (!isAdminOrProducer && userTier == "Standard" && requiredTier == "Premium")
            {
                return StatusCode(StatusCodes.Status403Forbidden, $"Bài hát '{music.Title}' yêu cầu gói Premium VIP.");
            }

            var uploadsFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "music");
            if (!Directory.Exists(uploadsFolder)) Directory.CreateDirectory(uploadsFolder);

            string filePath = "";
            string fileExt = ".mp3";
            string mimeType = "audio/mpeg";

            // Chỉ phục vụ file local trực tiếp (không còn SoundCloud)
            // 1. If music.SourceUrl is already a valid local file on disk
            if (!string.IsNullOrWhiteSpace(music.SourceUrl) && music.SourceUrl.StartsWith("/uploads/music/"))
            {
                var localPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", music.SourceUrl.TrimStart('/'));
                if (System.IO.File.Exists(localPath) && new FileInfo(localPath).Length > 1000)
                {
                    filePath = localPath;
                    fileExt = Path.GetExtension(localPath).ToLowerInvariant();
                    mimeType = fileExt == ".wav" ? "audio/wav" : fileExt == ".flac" ? "audio/flac" : "audio/mpeg";
                }
            }

            // 2. File not found - return 404
            if (string.IsNullOrEmpty(filePath) || !System.IO.File.Exists(filePath))
            {
                return NotFound(new { success = false, message = "File âm thanh chưa được tải lên máy chủ. Vui lòng liên hệ Producer để cập nhật file!" });
            }


            var safeTitle = string.Concat(music.Title.Split(Path.GetInvalidFileNameChars())).Replace(" ", "_");
            var downloadFileName = $"{safeTitle}_TLongMusic{fileExt}";
            return PhysicalFile(filePath, mimeType, downloadFileName, enableRangeProcessing: true);
        }

        // 3. TOGGLE FAVORITE
        [HttpPost("ToggleFavorite")]
        public async Task<IActionResult> ToggleFavorite([FromBody] Guid musicId)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập để lưu bài hát yêu thích!" });
            }

            var existing = await _context.Favorites.FindAsync(userId, musicId);
            bool isFavorited = false;

            if (existing != null)
            {
                _context.Favorites.Remove(existing);
                isFavorited = false;
            }
            else
            {
                _context.Favorites.Add(new Favorite
                {
                    UserId = userId,
                    MusicId = musicId,
                    CreatedAt = DateTime.UtcNow
                });
                isFavorited = true;
            }

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                isFavorited = isFavorited,
                message = isFavorited ? "Đã thêm bài hát vào danh sách yêu thích ❤️" : "Đã bỏ yêu thích bài hát"
            });
        }

        // 4. GET FAVORITES LIST
        [HttpGet("Favorites")]
        public async Task<IActionResult> GetFavorites()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập!" });
            }

            var favs = await _context.Favorites
                .Where(f => f.UserId == userId)
                .Include(f => f.Music)
                    .ThenInclude(m => m.Producer)
                .Select(f => new
                {
                    f.Music.MusicId,
                    f.Music.Title,
                    f.Music.Artist,
                    f.Music.Genre,
                    f.Music.CoverUrl,
                    f.Music.DurationSeconds,
                    f.Music.Bpm,
                    f.Music.MusicalKey,
                    f.Music.QualityAvailable,
                    Category = f.Music.CategoryCode,
                    f.CreatedAt
                })
                .ToListAsync();

            return Ok(new { success = true, data = favs });
        }
    }
}
