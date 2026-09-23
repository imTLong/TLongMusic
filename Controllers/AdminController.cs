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
                    p.PhoneNumber,
                    p.ZaloContact,
                    p.BankName,
                    p.BankAccountNumber,
                    p.BankAccountHolder,
                    p.IsVerified,
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
            Guid? adminId = Guid.TryParse(userIdClaim, out var guid) ? guid : null;

            // Check if user already exists
            var existingUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == model.Username || u.Email == model.Email);
            User user;

            if (existingUser != null)
            {
                user = existingUser;
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
                    FullName = model.FullName.Trim(),
                    PhoneNumber = model.PhoneNumber?.Trim(),
                    Status = "Active",
                    CreatedAt = DateTime.UtcNow
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
                existingProducer.ZaloContact = model.ZaloContact;
                existingProducer.BankName = model.BankName;
                existingProducer.BankAccountNumber = model.BankAccountNumber;
                existingProducer.BankAccountHolder = model.BankAccountHolder;
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
                    ZaloContact = model.ZaloContact?.Trim(),
                    BankName = model.BankName?.Trim(),
                    BankAccountNumber = model.BankAccountNumber?.Trim(),
                    BankAccountHolder = model.BankAccountHolder?.Trim(),
                    IsVerified = true,
                    CreatedByAdminId = adminId,
                    CreatedAt = DateTime.UtcNow
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
