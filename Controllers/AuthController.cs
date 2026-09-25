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
                .Include(u => u.ProducerProfile)
                .Include(u => u.Subscriptions)
                    .ThenInclude(s => s.Package)
                .FirstOrDefaultAsync(u => u.Username == model.UsernameOrEmail || u.Email == model.UsernameOrEmail);

            if (user == null || !SecurityHelper.VerifyPassword(model.Password, user.PasswordHash))
            {
                return Unauthorized(new { success = false, message = "Sai tài khoản hoặc mật khẩu" });
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
                PhoneNumber = user.PhoneNumber ?? user.ProducerProfile?.PhoneNumber,
                BankName = user.BankName ?? user.ProducerProfile?.BankName,
                BankAccountNumber = user.BankAccountNumber ?? user.ProducerProfile?.BankAccountNumber,
                BankAccountHolder = user.BankAccountHolder ?? user.ProducerProfile?.BankAccountHolder,
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
                PhoneNumber = newUser.PhoneNumber,
                BankName = newUser.BankName,
                BankAccountNumber = newUser.BankAccountNumber,
                BankAccountHolder = newUser.BankAccountHolder,
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
        [HttpGet("Logout")]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            HttpContext.Session.Clear();
            if (Request.Headers["Accept"].ToString().Contains("text/html"))
            {
                return Redirect("/");
            }
            return Ok(new { success = true, message = "Đã đăng xuất thành công khỏi phiên làm việc." });
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
                .Include(u => u.ProducerProfile)
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
                PhoneNumber = user.PhoneNumber ?? user.ProducerProfile?.PhoneNumber,
                BankName = user.BankName ?? user.ProducerProfile?.BankName,
                BankAccountNumber = user.BankAccountNumber ?? user.ProducerProfile?.BankAccountNumber,
                BankAccountHolder = user.BankAccountHolder ?? user.ProducerProfile?.BankAccountHolder,
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

        [HttpPost("UpdateProfile")]
        public async Task<IActionResult> UpdateProfile()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Bạn chưa đăng nhập!" });
            }

            UpdateProfileDto model;
            IFormFile? avatarFile = null;

            if (Request.HasFormContentType)
            {
                var form = await Request.ReadFormAsync();
                model = new UpdateProfileDto
                {
                    Username = form["username"].ToString(),
                    FullName = form["fullName"].ToString(),
                    Email = form["email"].ToString(),
                    PhoneNumber = form["phoneNumber"].ToString(),
                    AvatarUrl = form["avatarUrl"].ToString(),
                    BankName = form["bankName"].ToString(),
                    BankAccountNumber = form["bankAccountNumber"].ToString(),
                    BankAccountHolder = form["bankAccountHolder"].ToString(),
                    OldPassword = form["oldPassword"].ToString(),
                    NewPassword = form["newPassword"].ToString()
                };
                if (form.Files.Count > 0)
                {
                    avatarFile = form.Files["avatarFile"] ?? form.Files.FirstOrDefault();
                }
            }
            else
            {
                model = await Request.ReadFromJsonAsync<UpdateProfileDto>() ?? new UpdateProfileDto();
            }

            if (string.IsNullOrWhiteSpace(model.FullName))
            {
                return BadRequest(new { success = false, message = "Vui lòng nhập họ và tên!" });
            }

            var user = await _context.Users
                .Include(u => u.UserRoles)
                    .ThenInclude(ur => ur.Role)
                .Include(u => u.Subscriptions)
                    .ThenInclude(s => s.Package)
                .Include(u => u.ProducerProfile)
                .FirstOrDefaultAsync(u => u.UserId == userId);

            if (user == null || user.Status != "Active")
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Tài khoản không tồn tại hoặc đã bị khóa!" });
            }

            // Check and update username if changed
            if (!string.IsNullOrWhiteSpace(model.Username) && !model.Username.Trim().Equals(user.Username, StringComparison.OrdinalIgnoreCase))
            {
                var cleanUsername = model.Username.Trim();
                if (cleanUsername.Length < 3 || cleanUsername.Length > 50)
                {
                    return BadRequest(new { success = false, message = "Tên đăng nhập phải có độ dài từ 3 đến 50 ký tự!" });
                }

                if (cleanUsername.Contains(" ") || !System.Text.RegularExpressions.Regex.IsMatch(cleanUsername, @"^[a-zA-Z0-9_\.]+$"))
                {
                    return BadRequest(new { success = false, message = "Tên đăng nhập chỉ được chứa chữ cái, chữ số, dấu gạch dưới (_) hoặc dấu chấm (.), không chứa khoảng trắng!" });
                }

                var usernameExists = await _context.Users.AnyAsync(u => u.UserId != userId && u.Username == cleanUsername);
                if (usernameExists)
                {
                    return BadRequest(new { success = false, message = "Tên đăng nhập này đã được sử dụng bởi tài khoản khác!" });
                }

                user.Username = cleanUsername;
            }

            // Check email uniqueness if changed
            if (!string.IsNullOrWhiteSpace(model.Email) && !model.Email.Equals(user.Email, StringComparison.OrdinalIgnoreCase))
            {
                var emailExists = await _context.Users.AnyAsync(u => u.UserId != userId && u.Email == model.Email.Trim().ToLower());
                if (emailExists)
                {
                    return BadRequest(new { success = false, message = "Email này đã được sử dụng bởi tài khoản khác!" });
                }
                user.Email = model.Email.Trim().ToLower();
            }

            // Change password if provided
            if (!string.IsNullOrWhiteSpace(model.NewPassword))
            {
                if (string.IsNullOrWhiteSpace(model.OldPassword))
                {
                    return BadRequest(new { success = false, message = "Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới!" });
                }

                if (!SecurityHelper.VerifyPassword(model.OldPassword, user.PasswordHash))
                {
                    return BadRequest(new { success = false, message = "Mật khẩu hiện tại không chính xác!" });
                }

                if (model.NewPassword.Length < 6)
                {
                    return BadRequest(new { success = false, message = "Mật khẩu mới phải có ít nhất 6 ký tự!" });
                }

                user.PasswordHash = SecurityHelper.HashPassword(model.NewPassword);
            }

            // Handle optional Avatar file upload
            if (avatarFile != null && avatarFile.Length > 0)
            {
                var allowedExts = new[] { ".jpg", ".jpeg", ".png", ".webp", ".gif" };
                var ext = Path.GetExtension(avatarFile.FileName).ToLowerInvariant();
                if (!allowedExts.Contains(ext))
                {
                    return BadRequest(new { success = false, message = "Định dạng ảnh không hợp lệ! Vui lòng chọn file .jpg, .png, .webp hoặc .gif" });
                }

                if (avatarFile.Length > 10 * 1024 * 1024)
                {
                    return BadRequest(new { success = false, message = "Kích thước ảnh đại diện không được vượt quá 10MB!" });
                }

                var avatarFolder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "avatars");
                if (!Directory.Exists(avatarFolder)) Directory.CreateDirectory(avatarFolder);

                var avatarFileName = $"{Guid.NewGuid():N}{ext}";
                var avatarFilePath = Path.Combine(avatarFolder, avatarFileName);

                using (var stream = new FileStream(avatarFilePath, FileMode.Create))
                {
                    await avatarFile.CopyToAsync(stream);
                }

                user.AvatarUrl = $"/uploads/avatars/{avatarFileName}";
            }
            else if (!string.IsNullOrWhiteSpace(model.AvatarUrl))
            {
                user.AvatarUrl = model.AvatarUrl.Trim();
            }

            // Update basic info
            user.FullName = model.FullName.Trim();
            user.PhoneNumber = string.IsNullOrWhiteSpace(model.PhoneNumber) ? null : model.PhoneNumber.Trim();

            // Update bank info
            user.BankName = string.IsNullOrWhiteSpace(model.BankName) ? null : model.BankName.Trim();
            user.BankAccountNumber = string.IsNullOrWhiteSpace(model.BankAccountNumber) ? null : model.BankAccountNumber.Trim();
            user.BankAccountHolder = string.IsNullOrWhiteSpace(model.BankAccountHolder) ? null : model.BankAccountHolder.Trim().ToUpper();

            user.UpdatedAt = DateTime.UtcNow;

            // If user has Producer profile, sync bank and phone info
            if (user.ProducerProfile != null)
            {
                user.ProducerProfile.BankName = user.BankName;
                user.ProducerProfile.BankAccountNumber = user.BankAccountNumber;
                user.ProducerProfile.BankAccountHolder = user.BankAccountHolder;
                user.ProducerProfile.PhoneNumber = user.PhoneNumber;
                user.ProducerProfile.UpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync();

            // Refresh Session Data
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

            // Refresh cookie claims with updated username / profile
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
                PhoneNumber = user.PhoneNumber ?? user.ProducerProfile?.PhoneNumber,
                BankName = user.BankName ?? user.ProducerProfile?.BankName,
                BankAccountNumber = user.BankAccountNumber ?? user.ProducerProfile?.BankAccountNumber,
                BankAccountHolder = user.BankAccountHolder ?? user.ProducerProfile?.BankAccountHolder,
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
                message = "Cập nhật thông tin cá nhân và tài khoản ngân hàng thành công!",
                user = sessionData
            });
        }
    }
}
