using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Common;
using TLongMusic.Data;
using TLongMusic.Models.Dto;
using TLongMusic.Models.Entities;

namespace TLongMusic.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class AdminController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;

        public AdminController(TLongMusicDbContext context)
        {
            _context = context;
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

                    // Clean physical files
                    if (!string.IsNullOrWhiteSpace(music.SourceUrl) && music.SourceUrl.StartsWith("/uploads/music/"))
                    {
                        var physicalAudioPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", music.SourceUrl.TrimStart('/'));
                        if (System.IO.File.Exists(physicalAudioPath) && !physicalAudioPath.EndsWith("template_track.mp3"))
                        {
                            try { System.IO.File.Delete(physicalAudioPath); } catch { }
                        }
                    }

                    if (!string.IsNullOrWhiteSpace(music.CoverUrl) && music.CoverUrl.StartsWith("/uploads/covers/"))
                    {
                        var physicalCoverPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", music.CoverUrl.TrimStart('/'));
                        if (System.IO.File.Exists(physicalCoverPath))
                        {
                            try { System.IO.File.Delete(physicalCoverPath); } catch { }
                        }
                    }
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

            var list = await _context.Musics
                .Include(m => m.Producer)
                .Include(m => m.Category)
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => new
                {
                    m.MusicId,
                    m.Title,
                    m.Artist,
                    ProducerName = m.Producer.StageName,
                    m.CategoryCode,
                    CategoryName = m.Category.Name,
                    m.Type,
                    m.QualityAvailable,
                    m.PlaysCount,
                    m.DownloadsCount,
                    m.Status,
                    m.CreatedAt
                })

                .ToListAsync();

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

                // 3. Clean up physical audio and cover files from disk (excluding template)
                if (!string.IsNullOrWhiteSpace(music.SourceUrl) && music.SourceUrl.StartsWith("/uploads/music/"))
                {
                    var physicalAudioPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", music.SourceUrl.TrimStart('/'));
                    if (System.IO.File.Exists(physicalAudioPath) && !physicalAudioPath.EndsWith("template_track.mp3"))
                    {
                        try { System.IO.File.Delete(physicalAudioPath); } catch { }
                    }
                }

                if (!string.IsNullOrWhiteSpace(music.CoverUrl) && music.CoverUrl.StartsWith("/uploads/covers/"))
                {
                    var physicalCoverPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", music.CoverUrl.TrimStart('/'));
                    if (System.IO.File.Exists(physicalCoverPath))
                    {
                        try { System.IO.File.Delete(physicalCoverPath); } catch { }
                    }
                }

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
    }
}
