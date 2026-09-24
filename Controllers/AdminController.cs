using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Common;
using TLongMusic.Data;
using TLongMusic.Models.Dto;
using TLongMusic.Models.Entities;
using TLongMusic.Services;

namespace TLongMusic.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AdminController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;
        private readonly IWebHostEnvironment _env;

        public AdminController(TLongMusicDbContext context, IWebHostEnvironment env)
        {
            _context = context;
            _env = env;
        }

        // FR-ADM-05: VIEW DASHBOARD STATS
        [HttpGet("Stats")]
        public async Task<IActionResult> GetStats()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền xem thống kê toàn hệ thống!" });
            }

            var totalUsers = await _context.Users.CountAsync();
            var totalProducers = await _context.Producers.CountAsync();
            var totalMusics = await _context.Musics.CountAsync();
            var totalDownloads = await _context.Musics.SumAsync(m => m.DownloadsCount);
            var totalPlays = await _context.Musics.SumAsync(m => m.PlaysCount);
            var totalRevenue = await _context.Payments.Where(p => p.Status == "Success").SumAsync(p => p.Amount);
            var activeVip = await _context.Subscriptions
                .CountAsync(s => s.Status == "Active" && (s.PackageId == "Standard" || s.PackageId == "Premium") && s.EndDate >= DateTime.UtcNow);

            var stats = new AdminStatsDto
            {
                TotalUsers = totalUsers,
                TotalProducers = totalProducers,
                TotalMusics = totalMusics,
                TotalDownloads = totalDownloads,
                TotalPlays = totalPlays,
                TotalRevenue = totalRevenue,
                ActiveVipSubscriptions = activeVip
            };

            return Ok(new { success = true, data = stats });
        }

        // FR-ADM-01: LIST PRODUCERS
        [HttpGet("Producers")]
        public async Task<IActionResult> GetProducers()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền xem danh sách Producer!" });
            }

            var list = await _context.Producers
                .Include(p => p.User)
                .Include(p => p.Musics)
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new
                {
                    p.ProducerId,
                    p.UserId,
                    Username = p.User.Username,
                    FullName = p.User.FullName,
                    p.StageName,
                    PhoneNumber = p.PhoneNumber ?? p.User.PhoneNumber,
                    p.ZaloContact,
                    BankName = p.BankName ?? p.User.BankName,
                    BankAccountNumber = p.BankAccountNumber ?? p.User.BankAccountNumber,
                    BankAccountHolder = p.BankAccountHolder ?? p.User.BankAccountHolder,
                    p.IsVerified,
                    UserStatus = p.User.Status,
                    IsLocked = p.User.Status == "Locked",
                    TracksCount = p.Musics.Count,
                    p.CreatedAt
                })
                .ToListAsync();

            return Ok(new { success = true, data = list });
        }

        // FR-ADM-02: CREATE NEW PRODUCER
        [HttpPost("CreateProducer")]
        public async Task<IActionResult> CreateProducer([FromBody] CreateProducerDto model)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
            }

            Guid? adminId = Guid.TryParse(userIdClaim, out var guid) ? guid : null;

            // Check if user already exists
            var existingUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == model.Username || u.Email == model.Email);
            User user;

            if (existingUser != null)
            {
                user = existingUser;
                user.FullName = string.IsNullOrWhiteSpace(model.FullName) ? user.FullName : model.FullName.Trim();
                user.PhoneNumber = string.IsNullOrWhiteSpace(model.PhoneNumber) ? user.PhoneNumber : model.PhoneNumber.Trim();
                user.BankName = string.IsNullOrWhiteSpace(model.BankName) ? user.BankName : model.BankName.Trim();
                user.BankAccountNumber = string.IsNullOrWhiteSpace(model.BankAccountNumber) ? user.BankAccountNumber : model.BankAccountNumber.Trim();
                user.BankAccountHolder = string.IsNullOrWhiteSpace(model.BankAccountHolder) ? user.BankAccountHolder : model.BankAccountHolder.Trim().ToUpper();

                // Add Producer role if missing
                var hasRole = await _context.UserRoles.AnyAsync(ur => ur.UserId == user.UserId && ur.RoleId == "Producer");
                if (!hasRole)
                {
                    _context.UserRoles.Add(new UserRole { UserId = user.UserId, RoleId = "Producer" });
                }
            }
            else
            {
                user = new User
                {
                    UserId = Guid.NewGuid(),
                    Username = model.Username.Trim(),
                    Email = model.Email.Trim().ToLower(),
                    PasswordHash = SecurityHelper.HashPassword(string.IsNullOrWhiteSpace(model.Password) ? "123456" : model.Password),
                    FullName = string.IsNullOrWhiteSpace(model.FullName) ? model.StageName.Trim() : model.FullName.Trim(),
                    PhoneNumber = model.PhoneNumber?.Trim(),
                    BankName = model.BankName?.Trim(),
                    BankAccountNumber = model.BankAccountNumber?.Trim(),
                    BankAccountHolder = (model.BankAccountHolder ?? model.FullName ?? model.StageName)?.Trim()?.ToUpper(),
                    Status = "Active",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.Users.Add(user);
                _context.UserRoles.Add(new UserRole { UserId = user.UserId, RoleId = "Producer" });
            }

            // Create Producer profile
            var existingProducer = await _context.Producers.FirstOrDefaultAsync(p => p.UserId == user.UserId);
            if (existingProducer != null)
            {
                existingProducer.StageName = model.StageName.Trim();
                existingProducer.Bio = model.Bio;
                existingProducer.PhoneNumber = model.PhoneNumber;
                existingProducer.ZaloContact = model.ZaloContact ?? model.PhoneNumber;
                existingProducer.BankName = model.BankName;
                existingProducer.BankAccountNumber = model.BankAccountNumber;
                existingProducer.BankAccountHolder = (model.BankAccountHolder ?? model.FullName ?? model.StageName)?.Trim()?.ToUpper();
                existingProducer.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                var newProducer = new Producer
                {
                    ProducerId = Guid.NewGuid(),
                    UserId = user.UserId,
                    StageName = model.StageName.Trim(),
                    Bio = model.Bio,
                    PhoneNumber = model.PhoneNumber?.Trim(),
                    ZaloContact = (model.ZaloContact ?? model.PhoneNumber)?.Trim(),
                    BankName = model.BankName?.Trim(),
                    BankAccountNumber = model.BankAccountNumber?.Trim(),
                    BankAccountHolder = (model.BankAccountHolder ?? model.FullName ?? model.StageName)?.Trim()?.ToUpper(),
                    IsVerified = true,
                    CreatedByAdminId = adminId,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.Producers.Add(newProducer);
            }

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"✅ Đã thêm và phân quyền Producer thành công cho nghệ sĩ '{model.StageName}'!"
            });
        }

        // LOCK / UNLOCK PRODUCER
        [HttpPost("ToggleLockProducer/{id}")]
        public async Task<IActionResult> ToggleLockProducer(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
            }

            var producer = await _context.Producers
                .Include(p => p.User)
                .FirstOrDefaultAsync(p => p.ProducerId == id);

            if (producer == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy Producer!" });
            }

            if (producer.User == null)
            {
                return BadRequest(new { success = false, message = "Producer không gắn với tài khoản người dùng hợp lệ!" });
            }

            // Prevent Admin from locking self
            if (Guid.TryParse(userIdClaim, out var adminGuid) && producer.UserId == adminGuid)
            {
                return BadRequest(new { success = false, message = "Bạn không thể tự khóa tài khoản của chính mình!" });
            }

            var isCurrentlyLocked = producer.User.Status == "Locked";
            producer.User.Status = isCurrentlyLocked ? "Active" : "Locked";
            producer.User.UpdatedAt = DateTime.UtcNow;

            producer.IsVerified = !isCurrentlyLocked;
            producer.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            var newStatus = producer.User.Status;
            var message = newStatus == "Locked"
                ? $"🔒 Đã khóa tài khoản Producer '{producer.StageName}' thành công!"
                : $"🔓 Đã mở khóa tài khoản Producer '{producer.StageName}' thành công!";

            return Ok(new
            {
                success = true,
                isLocked = (newStatus == "Locked"),
                status = newStatus,
                message
            });
        }

        // DELETE PRODUCER
        [HttpPost("DeleteProducer/{id}")]
        public async Task<IActionResult> DeleteProducer(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
            }

            var producer = await _context.Producers
                .Include(p => p.User)
                .Include(p => p.Musics)
                .FirstOrDefaultAsync(p => p.ProducerId == id);

            if (producer == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy Producer!" });
            }

            // Prevent Admin from deleting self
            if (Guid.TryParse(userIdClaim, out var adminGuid) && producer.UserId == adminGuid)
            {
                return BadRequest(new { success = false, message = "Bạn không thể xóa tài khoản của chính mình!" });
            }

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var stageName = producer.StageName;
                var user = producer.User;

                // 1. Delete all musics belonging to this producer and their FK dependencies
                var musics = await _context.Musics.Where(m => m.ProducerId == id).ToListAsync();
                foreach (var music in musics)
                {
                    var favorites = _context.Favorites.Where(f => f.MusicId == music.MusicId);
                    _context.Favorites.RemoveRange(favorites);

                    var playlistTracks = _context.PlaylistTracks.Where(pt => pt.MusicId == music.MusicId);
                    _context.PlaylistTracks.RemoveRange(playlistTracks);

                    var listeningHistories = _context.ListeningHistories.Where(lh => lh.MusicId == music.MusicId);
                    _context.ListeningHistories.RemoveRange(listeningHistories);

                    var downloadHistories = _context.DownloadHistories.Where(dh => dh.MusicId == music.MusicId);
                    _context.DownloadHistories.RemoveRange(downloadHistories);

                    var reports = _context.Reports.Where(r => r.MusicId == music.MusicId);
                    _context.Reports.RemoveRange(reports);

                    _context.Musics.Remove(music);

                    // Clean physical audio and all transcoded/derivative files
                    AudioProcessingService.DeletePhysicalAudioAndRelatedFiles(_env.WebRootPath, music.SourceUrl, music.CoverUrl, music.DemoFilePath);
                }

                // 2. Remove the Producer record
                _context.Producers.Remove(producer);

                // 3. Remove Producer role from User, or delete user if dedicated producer account
                if (user != null)
                {
                    var isUserAdmin = await _context.UserRoles.AnyAsync(ur => ur.UserId == user.UserId && ur.RoleId == "Admin");
                    if (!isUserAdmin)
                    {
                        var userRoles = _context.UserRoles.Where(ur => ur.UserId == user.UserId);
                        _context.UserRoles.RemoveRange(userRoles);

                        var subs = _context.Subscriptions.Where(s => s.UserId == user.UserId);
                        _context.Subscriptions.RemoveRange(subs);

                        var payments = _context.Payments.Where(p => p.UserId == user.UserId);
                        _context.Payments.RemoveRange(payments);

                        var userFavs = _context.Favorites.Where(f => f.UserId == user.UserId);
                        _context.Favorites.RemoveRange(userFavs);

                        var userPlaylists = _context.Playlists.Where(pl => pl.UserId == user.UserId);
                        _context.Playlists.RemoveRange(userPlaylists);

                        var userNotifs = _context.Notifications.Where(n => n.UserId == user.UserId);
                        _context.Notifications.RemoveRange(userNotifs);

                        _context.Users.Remove(user);
                    }
                    else
                    {
                        var prodRole = await _context.UserRoles.FirstOrDefaultAsync(ur => ur.UserId == user.UserId && ur.RoleId == "Producer");
                        if (prodRole != null)
                        {
                            _context.UserRoles.Remove(prodRole);
                        }
                    }
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return Ok(new
                {
                    success = true,
                    message = $"🗑️ Đã xóa Producer '{stageName}' và toàn bộ bài hát/dữ liệu liên quan thành công!"
                });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    success = false,
                    message = $"Lỗi khi xóa Producer: {ex.Message}"
                });
            }
        }

        // FR-ADM-04: MODERATE / TOGGLE MUSIC STATUS
        [HttpPost("ToggleMusicStatus/{id}")]
        public async Task<IActionResult> ToggleMusicStatus(Guid id)
        {
            var music = await _context.Musics.FindAsync(id);
            if (music == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy bài hát!" });
            }

            music.Status = music.Status == "Published" ? "Hidden" : "Published";
            music.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                status = music.Status,
                message = $"Đã chuyển trạng thái bài hát '{music.Title}' sang: {music.Status}"
            });
        }

        // FR-ADM-03: LIST ALL MUSICS FOR ADMIN MODERATION
        [HttpGet("Musics")]
        public async Task<IActionResult> GetAllMusics()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền truy cập kho nhạc hệ thống!" });
            }

            var rawList = await _context.Musics
                .Include(m => m.Producer)
                .Include(m => m.Category)
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync();

            var list = rawList.Select(m => new
            {
                m.MusicId,
                m.Title,
                m.Artist,
                ProducerName = m.Producer != null ? m.Producer.StageName : "DJ TLong",
                m.CategoryCode,
                CategoryName = m.Category != null ? m.Category.Name : m.CategoryCode,
                AccessLevel = m.Category != null ? m.Category.AccessLevel : (m.CategoryCode.Contains("Slot") ? "Slot" : (m.CategoryCode.Contains("Nhom") ? "Nhom" : "Lot")),
                m.Type, // 'Track' hoặc 'Nonstop'
                m.Genre,
                m.Bpm,
                m.MusicalKey,
                m.DurationSeconds,
                FormattedDuration = m.FormattedDuration,
                m.CoverUrl,
                m.SourceUrl,
                AudioUrl = m.SourceUrl,
                m.QualityAvailable,
                m.PlaysCount,
                m.DownloadsCount,
                m.Status,
                m.CreatedAt
            }).ToList();

            return Ok(new { success = true, data = list });
        }

        // FR-ADM-06: DELETE ANY MUSIC AS ADMIN
        [HttpPost("DeleteMusic/{id}")]
        public async Task<IActionResult> DeleteMusic(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
            }

            var music = await _context.Musics.FindAsync(id);
            if (music == null)
            {
                return NotFound(new { success = false, message = "Bài hát không tồn tại!" });
            }

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // 1. Remove all foreign key references to this track
                var favorites = _context.Favorites.Where(f => f.MusicId == id);
                _context.Favorites.RemoveRange(favorites);

                var playlistTracks = _context.PlaylistTracks.Where(pt => pt.MusicId == id);
                _context.PlaylistTracks.RemoveRange(playlistTracks);

                var listeningHistories = _context.ListeningHistories.Where(lh => lh.MusicId == id);
                _context.ListeningHistories.RemoveRange(listeningHistories);

                var downloadHistories = _context.DownloadHistories.Where(dh => dh.MusicId == id);
                _context.DownloadHistories.RemoveRange(downloadHistories);

                var reports = _context.Reports.Where(r => r.MusicId == id);
                _context.Reports.RemoveRange(reports);

                // 2. Remove the music entity
                _context.Musics.Remove(music);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // 3. Clean up physical audio, transcoded versions (_320k, _master), and cover files from disk
                AudioProcessingService.DeletePhysicalAudioAndRelatedFiles(_env.WebRootPath, music.SourceUrl, music.CoverUrl, music.DemoFilePath);

                return Ok(new { success = true, message = $"Admin đã xóa vĩnh viễn bài hát '{music.Title}' khỏi hệ thống thành công!" });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    success = false,
                    message = $"Không thể xóa bài hát: {ex.Message}"
                });
            }
        }

        // FR-ADM-06B: BULK DELETE MUSICS AS ADMIN
        [HttpPost("DeleteMusicsBatch")]
        public async Task<IActionResult> DeleteMusicsBatch([FromBody] BulkDeleteMusicDto request)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
            }

            if (request == null || request.MusicIds == null || !request.MusicIds.Any())
            {
                return BadRequest(new { success = false, message = "Vui lòng chọn ít nhất một bản thu để xóa!" });
            }

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var musics = await _context.Musics
                    .Where(m => request.MusicIds.Contains(m.MusicId))
                    .ToListAsync();

                if (!musics.Any())
                {
                    return NotFound(new { success = false, message = "Không tìm thấy bài hát nào tương ứng với danh sách đã chọn!" });
                }

                var musicIds = musics.Select(m => m.MusicId).ToList();

                // 1. Remove all foreign key references
                var favorites = _context.Favorites.Where(f => musicIds.Contains(f.MusicId));
                _context.Favorites.RemoveRange(favorites);

                var playlistTracks = _context.PlaylistTracks.Where(pt => musicIds.Contains(pt.MusicId));
                _context.PlaylistTracks.RemoveRange(playlistTracks);

                var listeningHistories = _context.ListeningHistories.Where(lh => musicIds.Contains(lh.MusicId));
                _context.ListeningHistories.RemoveRange(listeningHistories);

                var downloadHistories = _context.DownloadHistories.Where(dh => musicIds.Contains(dh.MusicId));
                _context.DownloadHistories.RemoveRange(downloadHistories);

                var reports = _context.Reports.Where(r => musicIds.Contains(r.MusicId));
                _context.Reports.RemoveRange(reports);

                // 2. Remove musics
                _context.Musics.RemoveRange(musics);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // 3. Clean up physical audio files
                foreach (var music in musics)
                {
                    AudioProcessingService.DeletePhysicalAudioAndRelatedFiles(_env.WebRootPath, music.SourceUrl, music.CoverUrl, music.DemoFilePath);
                }

                return Ok(new { success = true, count = musics.Count, message = $"Admin đã xóa thành công {musics.Count} bản thu được chọn khỏi hệ thống!" });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    success = false,
                    message = $"Không thể xóa danh sách bài hát: {ex.Message}"
                });
            }
        }

        // FR-ADM-07: CLEAN ORPHANED AUDIO FILES FROM UPLOADS
        [HttpPost("CleanOrphanedFiles")]
        public async Task<IActionResult> CleanOrphanedFiles()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Admin mới có quyền thực hiện dọn dẹp file hệ thống!" });
            }

            var activeUrls = await _context.Musics.Select(m => m.SourceUrl).ToListAsync();
            var deletedCount = AudioProcessingService.CleanOrphanedMusicFiles(_env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"), activeUrls);

            return Ok(new { success = true, message = $"Đã quét và dọn dẹp thành công {deletedCount} file mồ côi khỏi thư mục uploads/music!" });
        }

        // ==========================================
        // QUẢN LÝ & GIA HẠN TÀI KHOẢN USERS CHO ADMIN
        // ==========================================

        [HttpGet("Users")]
        public async Task<IActionResult> GetUsers()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền xem danh sách người dùng!" });
            }

            var users = await _context.Users
                .Include(u => u.UserRoles)
                    .ThenInclude(ur => ur.Role)
                .Include(u => u.Subscriptions)
                    .ThenInclude(s => s.Package)
                .Include(u => u.Payments)
                .OrderBy(u => u.CreatedAt)
                .ToListAsync();

            var result = users.Select(u =>
            {
                var roles = u.UserRoles.Select(ur => ur.RoleId).ToList();
                string primaryRole = roles.Contains("Admin") ? "Admin" : (roles.Contains("Producer") ? "Producer" : "Member");

                // Tìm gói VIP còn hạn sử dụng gần nhất (ưu tiên Premium > Standard)
                var activeSub = u.Subscriptions
                    .Where(s => s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                    .OrderByDescending(s => s.PackageId == "Premium" ? 2 : (s.PackageId == "Standard" ? 1 : 0))
                    .ThenByDescending(s => s.EndDate)
                    .FirstOrDefault();

                // Nếu không có sub active, lấy sub gần nhất để xem lịch sử
                var latestSub = activeSub ?? u.Subscriptions
                    .OrderByDescending(s => s.EndDate)
                    .FirstOrDefault();

                string currentTier = activeSub != null ? activeSub.PackageId : "Free";
                bool isVipActive = activeSub != null;
                DateTime? expiresAt = isVipActive ? activeSub?.EndDate : null;
                decimal totalSpent = u.Payments.Where(p => p.Status == "Success").Sum(p => p.Amount);

                int daysRemaining = 0;
                if (expiresAt.HasValue && expiresAt.Value > DateTime.UtcNow)
                {
                    daysRemaining = (int)Math.Ceiling((expiresAt.Value - DateTime.UtcNow).TotalDays);
                }

                string tierExpiresAtFormatted = expiresAt.HasValue 
                    ? expiresAt.Value.ToString("dd/MM/yyyy HH:mm") 
                    : null;

                return new
                {
                    userId = u.UserId,
                    username = u.Username,
                    fullName = u.FullName,
                    email = u.Email,
                    phoneNumber = u.PhoneNumber,
                    avatarUrl = u.AvatarUrl,
                    status = u.Status,
                    isLocked = u.Status == "Locked",
                    roles = roles,
                    primaryRole = primaryRole,
                    currentTier = currentTier,
                    tierExpiresAt = tierExpiresAtFormatted,
                    tierExpiresAtRaw = expiresAt,
                    daysRemaining = daysRemaining,
                    isVipActive = isVipActive,
                    totalSpent = totalSpent,
                    createdAt = u.CreatedAt.ToString("dd/MM/yyyy HH:mm"),
                    createdAtRaw = u.CreatedAt
                };
            }).ToList();

            return Ok(new { success = true, data = result });
        }

        [HttpPost("ToggleLockUser/{id}")]
        public async Task<IActionResult> ToggleLockUser(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền khóa/mở khóa tài khoản!" });
            }

            if (Guid.TryParse(userIdClaim, out var adminGuid) && adminGuid == id)
            {
                return BadRequest(new { success = false, message = "Bạn không thể tự khóa tài khoản Admin đang đăng nhập!" });
            }

            var user = await _context.Users.FindAsync(id);
            if (user == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy người dùng!" });
            }

            user.Status = (user.Status == "Active") ? "Locked" : "Active";
            user.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            string statusText = user.Status == "Active" ? "ĐÃ MỞ KHÓA" : "ĐÃ KHÓA";
            return Ok(new
            {
                success = true,
                message = $"Tài khoản '{user.Username}' hiện {statusText} thành công!",
                status = user.Status,
                isLocked = user.Status == "Locked"
            });
        }

        [HttpPost("ExtendSubscription")]
        public async Task<IActionResult> ExtendSubscription([FromBody] AdminExtendSubscriptionDto model)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !User.IsInRole("Admin"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Chỉ Quản Trị Viên (Admin) mới có quyền gia hạn gói hội viên!" });
            }

            if (!ModelState.IsValid)
            {
                return BadRequest(new { success = false, message = "Dữ liệu gia hạn không hợp lệ!" });
            }

            var user = await _context.Users.FindAsync(model.UserId);
            if (user == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy tài khoản người dùng!" });
            }

            var package = await _context.Packages.FindAsync(model.PackageId);
            if (package == null)
            {
                return NotFound(new { success = false, message = "Gói hội viên không tồn tại!" });
            }

            // Tìm Subscription Active hiện tại của User
            var currentSub = await _context.Subscriptions
                .Where(s => s.UserId == model.UserId && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                .OrderByDescending(s => s.EndDate)
                .FirstOrDefaultAsync();

            DateTime newStartDate = DateTime.UtcNow;
            DateTime newEndDate = DateTime.UtcNow.AddDays(model.DurationDays);

            if (currentSub != null)
            {
                // Nếu cùng gói -> Cộng dồn ngày vào EndDate
                if (currentSub.PackageId == model.PackageId)
                {
                    newStartDate = currentSub.StartDate;
                    newEndDate = currentSub.EndDate.AddDays(model.DurationDays);
                    currentSub.EndDate = newEndDate;
                }
                else
                {
                    // Đổi sang gói khác (ví dụ Standard lên Premium) -> Kéo dài từ thời điểm hiện tại
                    newStartDate = DateTime.UtcNow;
                    newEndDate = DateTime.UtcNow.AddDays(model.DurationDays);
                    currentSub.PackageId = model.PackageId;
                    currentSub.EndDate = newEndDate;
                }
            }
            else
            {
                // Tạo mới Subscription
                var newSub = new Subscription
                {
                    SubscriptionId = Guid.NewGuid(),
                    UserId = model.UserId,
                    PackageId = model.PackageId,
                    StartDate = newStartDate,
                    EndDate = newEndDate,
                    Status = "Active",
                    CreatedAt = DateTime.UtcNow
                };
                _context.Subscriptions.Add(newSub);
                currentSub = newSub;
            }

            // Ghi nhận thông báo cho User
            _context.Notifications.Add(new Notification
            {
                NotificationId = Guid.NewGuid(),
                UserId = model.UserId,
                Title = $"Admin đã gia hạn gói {package.Name}!",
                Content = $"Tài khoản của bạn đã được Admin gia hạn thêm {model.DurationDays} ngày gói {package.Name}. Hạn sử dụng mới đến: {newEndDate:dd/MM/yyyy HH:mm}.{(string.IsNullOrWhiteSpace(model.Reason) ? "" : $" (Lý do: {model.Reason})")}",
                Type = "Subscription",
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            });

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"Đã gia hạn thành công gói {package.Name} cho '{user.FullName}' thêm {model.DurationDays} ngày! Hạn dùng mới: {newEndDate:dd/MM/yyyy HH:mm}." + (string.IsNullOrWhiteSpace(model.Reason) ? "" : $" (Lý do: {model.Reason})"),
                userId = user.UserId,
                tier = model.PackageId,
                endDate = newEndDate
            });
        }
    }
}
