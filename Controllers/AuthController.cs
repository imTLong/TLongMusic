using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
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
    public class AuthController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;

        public AuthController(TLongMusicDbContext context)
        {
            _context = context;
        }

        [HttpPost("Login")]
        public async Task<IActionResult> Login([FromBody] LoginDto model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(new { success = false, message = "Dữ liệu đăng nhập không hợp lệ" });
            }

            var user = await _context.Users
                .Include(u => u.UserRoles)
                    .ThenInclude(ur => ur.Role)
                .Include(u => u.Subscriptions)
                    .ThenInclude(s => s.Package)
                .FirstOrDefaultAsync(u => u.Username == model.UsernameOrEmail || u.Email == model.UsernameOrEmail);

            if (user == null || !SecurityHelper.VerifyPassword(model.Password, user.PasswordHash))
            {
                return Unauthorized(new { success = false, message = "Tên đăng nhập hoặc mật khẩu không chính xác!" });
            }

            if (user.Status != "Active")
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = $"Tài khoản đang ở trạng thái: {user.Status}. Vui lòng liên hệ Admin!" });
            }

            // Get Roles
            var roles = user.UserRoles.Select(ur => ur.RoleId).ToList();
            var primaryRole = roles.Contains("Admin") ? "Admin" 
                            : roles.Contains("Producer") ? "Producer" 
                            : "Member";

            // Get Active Subscription (Prioritize VIP packages over Free)
            var activeSub = user.Subscriptions
                .Where(s => s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                .OrderByDescending(s => s.Package != null ? s.Package.Price : (s.PackageId == "Premium" ? 199000 : s.PackageId == "Standard" ? 99000 : 0))
                .ThenByDescending(s => s.EndDate)
                .FirstOrDefault();

            var tier = activeSub?.PackageId ?? "Free";
            var pkg = activeSub?.Package ?? await _context.Packages.FindAsync("Free");

            // Build Claims
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, user.UserId.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.GivenName, user.FullName ?? user.Username),
                new Claim(ClaimTypes.Email, user.Email),
                new Claim("Tier", tier)
            };

            foreach (var r in roles)
            {
                claims.Add(new Claim(ClaimTypes.Role, r));
            }

            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            var principal = new ClaimsPrincipal(identity);

            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTime.UtcNow.AddDays(30)
            });

            var sessionData = new UserSessionDto
            {
                UserId = user.UserId,
                Username = user.Username,
                FullName = user.FullName ?? user.Username,
                Email = user.Email,
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

            return Ok(new
            {
                success = true,
                message = $"Đăng nhập thành công! Chào mừng {sessionData.FullName} ({primaryRole} - Gói {tier})",
                user = sessionData
            });
        }

        [HttpPost("Register")]
        public async Task<IActionResult> Register([FromBody] RegisterDto model)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(new { success = false, message = "Vui lòng kiểm tra lại thông tin đăng ký!" });
            }

            var existsUsername = await _context.Users.AnyAsync(u => u.Username == model.Username);
            if (existsUsername)
            {
                return BadRequest(new { success = false, message = "Tên đăng nhập này đã được sử dụng!" });
            }

            var existsEmail = await _context.Users.AnyAsync(u => u.Email == model.Email);
            if (existsEmail)
            {
                return BadRequest(new { success = false, message = "Email này đã được sử dụng!" });
            }

            var newUser = new User
            {
                UserId = Guid.NewGuid(),
                Username = model.Username.Trim(),
                Email = model.Email.Trim().ToLower(),
                PasswordHash = SecurityHelper.HashPassword(model.Password),
                FullName = model.FullName.Trim(),
                PhoneNumber = model.PhoneNumber?.Trim(),
                AvatarUrl = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
                Status = "Active",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _context.Users.Add(newUser);

            // Assign Member Role
            _context.UserRoles.Add(new UserRole
            {
                UserId = newUser.UserId,
                RoleId = "Member",
                AssignedAt = DateTime.UtcNow
            });

            // Assign Default Free Subscription
            _context.Subscriptions.Add(new Subscription
            {
                SubscriptionId = Guid.NewGuid(),
                UserId = newUser.UserId,
                PackageId = "Free",
                StartDate = DateTime.UtcNow,
                EndDate = DateTime.UtcNow.AddYears(10),
                Status = "Active",
                CreatedAt = DateTime.UtcNow
            });

            // Create Welcome Notification
            _context.Notifications.Add(new Notification
            {
                NotificationId = Guid.NewGuid(),
                UserId = newUser.UserId,
                Title = "Chào mừng bạn đến với TLongMusic!",
                Content = "Tài khoản của bạn đã được khởi tạo thành công với gói Free Member. Bạn có thể nghe và tải nhạc Track Lọt & Nonstop Lọt hoàn toàn miễn phí!",
                Type = "System",
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            });

            await _context.SaveChangesAsync();

            // Auto Sign-in upon Registration
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, newUser.UserId.ToString()),
                new Claim(ClaimTypes.Name, newUser.Username),
                new Claim(ClaimTypes.Email, newUser.Email),
                new Claim("Tier", "Free"),
                new Claim(ClaimTypes.Role, "Member")
            };

            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            var principal = new ClaimsPrincipal(identity);

            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTime.UtcNow.AddDays(30)
            });

            var sessionData = new UserSessionDto
            {
                UserId = newUser.UserId,
                Username = newUser.Username,
                FullName = newUser.FullName,
                Email = newUser.Email,
                AvatarUrl = newUser.AvatarUrl,
                Roles = new List<string> { "Member" },
                PrimaryRole = "Member",
                Tier = "Free",
                TierExpiresAt = DateTime.UtcNow.AddYears(10),
                IsVipActive = false,
                CanDownloadLot = true,
                CanDownloadNhom = false,
                CanDownloadSlot = false,
                SlotDemoLimitSeconds = 30
            };

            return Ok(new
            {
                success = true,
                message = "Đăng ký tài khoản thành công! Chào mừng bạn gia nhập TLongMusic (Gói Free Member).",
                user = sessionData
            });
        }

        [HttpPost("Logout")]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            HttpContext.Session.Clear();
            return Ok(new { success = true, message = "Đã đăng xuất thành công." });
        }

        [HttpGet("CurrentUser")]
        public async Task<IActionResult> GetCurrentUser()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Ok(new { isAuthenticated = false });
            }

            var user = await _context.Users
                .Include(u => u.UserRoles)
                .Include(u => u.Subscriptions)
                    .ThenInclude(s => s.Package)
                .FirstOrDefaultAsync(u => u.UserId == userId);

            if (user == null || user.Status != "Active")
            {
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Ok(new { isAuthenticated = false });
            }

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

            var sessionData = new UserSessionDto
            {
                UserId = user.UserId,
                Username = user.Username,
                FullName = user.FullName ?? user.Username,
                Email = user.Email,
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

            return Ok(new
            {
                isAuthenticated = true,
                user = sessionData
            });
        }
    }
}
