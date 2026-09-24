using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models.Dto;
using TLongMusic.Models.Entities;
using TLongMusic.Services;

namespace TLongMusic.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class ProducerController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;
        private readonly IWebHostEnvironment _env;

        public ProducerController(TLongMusicDbContext context, IWebHostEnvironment env)
        {
            _context = context;
            _env = env;
        }

        // FR-PRO-01A: DEDICATED UPLOAD TRACK (Strictly Type = "Track", BPM & Musical Key required)
        [HttpPost("UploadTrack")]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = 524288000, ValueLengthLimit = int.MaxValue)]
        public async Task<IActionResult> UploadTrack()
        {
            return await ProcessUploadInternal(isNonstopUpload: false);
        }

        // FR-PRO-01B: DEDICATED UPLOAD NONSTOP (Strictly Type = "Nonstop", No BPM / No Key)
        [HttpPost("UploadNonstop")]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = 524288000, ValueLengthLimit = int.MaxValue)]
        public async Task<IActionResult> UploadNonstop()
        {
            return await ProcessUploadInternal(isNonstopUpload: true);
        }

        // FR-PRO-01: UPLOAD MUSIC (Legacy Fallback with strict routing)
        [HttpPost("Upload")]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = 524288000, ValueLengthLimit = int.MaxValue)]
        public async Task<IActionResult> Upload()
        {
            return await ProcessUploadInternal(isNonstopUpload: null);
        }

        private async Task<IActionResult> ProcessUploadInternal(bool? isNonstopUpload)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập tài khoản Producer!" });
            }

            // CHỈ PRODUCER MỚI CÓ QUYỀN ĐĂNG NHẠC - ADMIN KHÔNG ĐĂNG NHẠC
            if (!User.IsInRole("Producer"))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Tài khoản Admin và Member không có quyền đăng nhạc! Quyền này chỉ dành riêng cho Producer." });
            }

            var producer = await _context.Producers.FirstOrDefaultAsync(p => p.UserId == userId);
            if (producer == null)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Không tìm thấy hồ sơ Producer của bạn trong hệ thống!" });
            }

            UploadMusicFormDto formModel = new();
            if (Request.HasFormContentType)
            {
                var form = await Request.ReadFormAsync();
                formModel.Title = form["title"].ToString();
                formModel.Artist = form["artist"].ToString();
                formModel.Genre = form["genre"].ToString();
                formModel.CategoryCode = form["categoryCode"].ToString();
                formModel.Type = form["type"].ToString();
                formModel.Bpm = int.TryParse(form["bpm"], out var b) ? b : 140;
                formModel.MusicalKey = form["musicalKey"].ToString();
                formModel.DurationSeconds = int.TryParse(form["durationSeconds"], out var d) ? d : 240;
                formModel.SourceType = form["sourceType"].ToString();
                formModel.SourceUrl = form["sourceUrl"].ToString();
                formModel.CoverUrl = form["coverUrl"].ToString();
                formModel.QualityAvailable = form["qualityAvailable"].ToString();
                formModel.DownloadedAudioUrl = form["downloadedAudioUrl"].ToString();
                formModel.IsDemoOnlyForFree = bool.TryParse(form["isDemoOnlyForFree"], out var isDemo) && isDemo;
                formModel.DemoLimitSeconds = int.TryParse(form["demoLimitSeconds"], out var dl) ? dl : 30;
                formModel.AudioFile = form.Files["audioFile"];
                formModel.CoverFile = form.Files["coverFile"];
            }
            else
            {
                var jsonDto = await System.Text.Json.JsonSerializer.DeserializeAsync<UploadMusicDto>(
                    Request.Body,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (jsonDto != null)
                {
                    formModel.Title = jsonDto.Title;
                    formModel.Artist = jsonDto.Artist;
                    formModel.Genre = jsonDto.Genre;
                    formModel.CategoryCode = jsonDto.CategoryCode;
                    formModel.Type = jsonDto.Type;
                    formModel.Bpm = jsonDto.Bpm;
                    formModel.MusicalKey = jsonDto.MusicalKey;
                    formModel.DurationSeconds = jsonDto.DurationSeconds;
                    formModel.SourceType = jsonDto.SourceType;
                    formModel.SourceUrl = jsonDto.SourceUrl;
                    formModel.DownloadedAudioUrl = jsonDto.DownloadedAudioUrl;
                    formModel.CoverUrl = jsonDto.CoverUrl;
                    formModel.QualityAvailable = jsonDto.QualityAvailable;
                    formModel.IsDemoOnlyForFree = jsonDto.IsDemoOnlyForFree;
                    formModel.DemoLimitSeconds = jsonDto.DemoLimitSeconds;
                }
            }

            if (string.IsNullOrWhiteSpace(formModel.Title))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập tiêu đề bản thu!" });
            }

            // XÁC ĐỊNH LOẠI SẢN PHẨM RÕ RÀNG (ISOLATION)
            bool isNonstop;
            if (isNonstopUpload.HasValue)
            {
                isNonstop = isNonstopUpload.Value;
            }
            else
            {
                isNonstop = string.Equals(formModel.Type, "Nonstop", StringComparison.OrdinalIgnoreCase)
                    || (!string.IsNullOrEmpty(formModel.CategoryCode) && formModel.CategoryCode.StartsWith("Nonstop", StringComparison.OrdinalIgnoreCase));
            }

            // CHUẨN HÓA CATEGORY CODE THEO ĐÚNG LOẠI ĐÃ CHỌN
            string categoryCode = formModel.CategoryCode?.Trim() ?? "";
            if (isNonstop)
            {
                var validNonstopCats = new[] { "NonstopLot", "NonstopNhom", "NonstopSlot" };
                if (!validNonstopCats.Contains(categoryCode))
                {
                    categoryCode = "NonstopNhom"; // Default safe Nonstop category
                }
            }
            else
            {
                var validTrackCats = new[] { "TrackLot", "TrackNhom", "TrackSlot" };
                if (!validTrackCats.Contains(categoryCode))
                {
                    categoryCode = "TrackNhom"; // Default safe Track category
                }
            }

            var category = await _context.TrackCategories.FindAsync(categoryCode);
            if (category == null)
            {
                // Fallback nếu chưa có trong DB
                category = await _context.TrackCategories.FirstOrDefaultAsync(c => c.CategoryCode == categoryCode);
                if (category == null)
                {
                    categoryCode = isNonstop ? "NonstopNhom" : "TrackNhom";
                    category = await _context.TrackCategories.FindAsync(categoryCode);
                }
            }

            // Determine SourceType & URLs
            string sourceType = "DirectFile";
            string sourceUrl = "";
            string quality = string.IsNullOrWhiteSpace(formModel.QualityAvailable) ? "MP3 320kbps" : formModel.QualityAvailable;

            // 1. Audio File upload takes precedence
            if (formModel.AudioFile != null && formModel.AudioFile.Length > 0)
            {
                var allowedExts = new[] { ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac" };
                var ext = Path.GetExtension(formModel.AudioFile.FileName).ToLowerInvariant();
                if (!allowedExts.Contains(ext))
                {
                    return BadRequest(new { success = false, message = $"Định dạng file '{ext}' không được hỗ trợ. Vui lòng tải lên MP3, WAV, FLAC, M4A hoặc OGG!" });
                }

                var uploadsFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "music");
                if (!Directory.Exists(uploadsFolder)) Directory.CreateDirectory(uploadsFolder);

                var uniqueFileName = $"{Guid.NewGuid():N}{ext}";
                var filePath = Path.Combine(uploadsFolder, uniqueFileName);

                using (var stream = new FileStream(filePath, FileMode.Create))
                {
                    await formModel.AudioFile.CopyToAsync(stream);
                }

                sourceUrl = $"/uploads/music/{uniqueFileName}";
                if (ext == ".wav") quality = "WAV Lossless 24-Bit";
                else if (ext == ".flac") quality = "FLAC 24-Bit Lossless";
                else quality = "MP3 320kbps";

                sourceType = "DirectFile";
            }
            // 2. Fallback to SourceUrl text field
            else if (!string.IsNullOrWhiteSpace(formModel.SourceUrl))
            {
                sourceUrl = formModel.SourceUrl.Trim();
                sourceType = "DirectFile";
            }
            else
            {
                return BadRequest(new { success = false, message = "Vui lòng chọn tải lên file âm thanh bản thu (MP3/WAV/FLAC)!" });
            }

            // Handle optional Cover Image upload
            string coverUrl = isNonstop 
                ? "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80"
                : "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80";

            if (formModel.CoverFile != null && formModel.CoverFile.Length > 0)
            {
                var coverFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "covers");
                if (!Directory.Exists(coverFolder)) Directory.CreateDirectory(coverFolder);

                var coverFileName = $"{Guid.NewGuid():N}_{Path.GetFileName(formModel.CoverFile.FileName)}";
                var coverFilePath = Path.Combine(coverFolder, coverFileName);

                using (var stream = new FileStream(coverFilePath, FileMode.Create))
                {
                    await formModel.CoverFile.CopyToAsync(stream);
                }
                coverUrl = $"/uploads/covers/{coverFileName}";
            }
            else if (!string.IsNullOrWhiteSpace(formModel.CoverUrl))
            {
                coverUrl = formModel.CoverUrl.Trim();
            }

            var newMusic = new Music
            {
                MusicId = Guid.NewGuid(),
                ProducerId = producer.ProducerId, // STRICTLY OWN PRODUCER ID
                Title = formModel.Title.Trim(),
                Artist = string.IsNullOrWhiteSpace(formModel.Artist) ? producer.StageName : formModel.Artist.Trim(),
                Genre = string.IsNullOrWhiteSpace(formModel.Genre) ? "Vinahouse" : formModel.Genre.Trim(),
                CategoryCode = categoryCode,
                Type = isNonstop ? "Nonstop" : "Track",
                // NONSTOP: Luôn luôn Bpm = 0, MusicalKey = "Nonstop"
                Bpm = isNonstop ? 0 : (formModel.Bpm > 0 ? formModel.Bpm : 140),
                MusicalKey = isNonstop ? "Nonstop" : (string.IsNullOrWhiteSpace(formModel.MusicalKey) ? "8A" : formModel.MusicalKey.Trim().ToUpper()),
                DurationSeconds = formModel.DurationSeconds > 0 ? formModel.DurationSeconds : (isNonstop ? 3600 : 240),
                CoverUrl = coverUrl,
                SourceType = sourceType,
                SourceUrl = sourceUrl,
                QualityAvailable = quality,
                IsDemoOnlyForFree = formModel.IsDemoOnlyForFree || categoryCode.Contains("Slot") || categoryCode.Contains("Nhom"),
                DemoLimitSeconds = formModel.DemoLimitSeconds > 0 ? formModel.DemoLimitSeconds : 30,
                Status = "Published",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _context.Musics.Add(newMusic);
            await _context.SaveChangesAsync();

            var categoryName = category?.Name ?? categoryCode;
            var typeLabel = isNonstop ? "bản Nonstop" : "bản Track";

            return Ok(new
            {
                success = true,
                message = $"🎧 Đã đăng tải thành công {typeLabel} '{newMusic.Title}' vào danh mục {categoryName}!",
                musicId = newMusic.MusicId,
                type = newMusic.Type,
                categoryCode = newMusic.CategoryCode,
                sourceType = newMusic.SourceType,
                sourceUrl = newMusic.SourceUrl
            });
        }

        // FR-PRO-02: VIEW OWN MUSIC (Strictly Own Producer Tracks Only, Supports Filtering by Type)
        [HttpGet("MyTracks")]
        public async Task<IActionResult> MyTracks([FromQuery] string? type = null)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập!" });
            }

            var producer = await _context.Producers.FirstOrDefaultAsync(p => p.UserId == userId);
            if (producer == null)
            {
                // Non-producers have 0 personal tracks
                return Ok(new { success = true, data = new List<object>(), message = "Chưa có hồ sơ Producer." });
            }

            var query = _context.Musics
                .Include(m => m.Category)
                .Where(m => m.ProducerId == producer.ProducerId); // STRICT ISOLATION

            if (!string.IsNullOrWhiteSpace(type))
            {
                query = query.Where(m => m.Type == type);
            }

            var list = await query
                .OrderByDescending(m => m.CreatedAt)
                .Select(m => new
                {
                    m.MusicId,
                    m.Title,
                    m.Artist,
                    m.Genre,
                    m.CategoryCode,
                    CategoryName = m.Category != null ? m.Category.Name : m.CategoryCode,
                    m.Type,
                    m.Bpm,
                    m.MusicalKey,
                    m.DurationSeconds,
                    m.QualityAvailable,
                    m.SourceType,
                    m.SourceUrl,
                    m.PlaysCount,
                    m.DownloadsCount,
                    m.Status,
                    m.CreatedAt
                })
                .ToListAsync();

            return Ok(new { success = true, data = list, stageName = producer.StageName });
        }

        // FR-PRO-03 & 05: DELETE OWN MUSIC (Cannot delete others' music)
        [HttpPost("DeleteTrack/{id}")]
        public async Task<IActionResult> DeleteTrack(Guid id)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập!" });
            }

            var music = await _context.Musics.FindAsync(id);
            if (music == null)
            {
                return NotFound(new { success = false, message = "Bài hát không tồn tại!" });
            }

            var producer = await _context.Producers.FirstOrDefaultAsync(p => p.UserId == userId);
            if (!User.IsInRole("Admin") && (producer == null || music.ProducerId != producer.ProducerId))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Bạn chỉ có quyền xóa bài nhạc do chính mình đăng tải (BR-07)!" });
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

                return Ok(new { success = true, message = $"Đã xóa vĩnh viễn bài hát '{music.Title}' khỏi hệ thống thành công!" });
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

        // GET PRODUCER PROFILE
        [HttpGet("Profile")]
        public async Task<IActionResult> GetProfile()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập!" });
            }

            var producer = await _context.Producers
                .Include(p => p.User)
                .FirstOrDefaultAsync(p => p.UserId == userId);

            if (producer == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy hồ sơ Producer!" });
            }

            return Ok(new
            {
                success = true,
                data = new
                {
                    producer.ProducerId,
                    producer.StageName,
                    producer.Bio,
                    producer.PhoneNumber,
                    producer.ZaloContact,
                    producer.BankName,
                    producer.BankAccountNumber,
                    producer.BankAccountHolder,
                    producer.IsVerified,
                    producer.CreatedAt
                }
            });
        }

        // SoundCloud fetch/download endpoint removed
    }
}
