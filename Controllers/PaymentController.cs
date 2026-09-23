using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TLongMusic.Data;
using TLongMusic.Models.Dto;
using TLongMusic.Models.Entities;

namespace TLongMusic.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class PaymentController : ControllerBase
    {
        private readonly TLongMusicDbContext _context;

        public PaymentController(TLongMusicDbContext context)
        {
            _context = context;
        }

        [HttpPost("CreateOrder")]
        public async Task<IActionResult> CreateOrder([FromBody] CreateOrderDto model)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new { success = false, message = "Vui lòng đăng nhập để nâng cấp gói VIP!" });
            }

            var package = await _context.Packages.FindAsync(model.PackageId);
            if (package == null || package.Status != "Active")
            {
                return NotFound(new { success = false, message = "Gói hội viên không tồn tại hoặc đã ngừng hoạt động!" });
            }

            // Generate OrderCode
            var randomNum = new Random().Next(100000, 999999);
            var orderCode = $"TL{randomNum}";

            var payment = new Payment
            {
                PaymentId = Guid.NewGuid(),
                UserId = userId,
                PackageId = package.PackageId,
                Amount = package.Price,
                Method = "VietQR",
                OrderCode = orderCode,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow
            };

            _context.Payments.Add(payment);
            await _context.SaveChangesAsync();

            // Lấy thông tin tài khoản ngân hàng của Admin từ hệ thống CSDL
            var adminUser = await _context.Users
                .Include(u => u.UserRoles)
                .Where(u => u.UserRoles.Any(ur => ur.RoleId == "Admin"))
                .OrderBy(u => u.CreatedAt)
                .FirstOrDefaultAsync();

            if (adminUser == null)
            {
                adminUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == "admin");
            }

            var bankName = !string.IsNullOrWhiteSpace(adminUser?.BankName)
                ? adminUser.BankName.Trim()
                : "MB Bank (Quân Đội)";

            var bankAccount = !string.IsNullOrWhiteSpace(adminUser?.BankAccountNumber)
                ? adminUser.BankAccountNumber.Trim()
                : "0988888888";

            var accountHolder = !string.IsNullOrWhiteSpace(adminUser?.BankAccountHolder)
                ? adminUser.BankAccountHolder.Trim().ToUpperInvariant()
                : (!string.IsNullOrWhiteSpace(adminUser?.FullName) ? adminUser.FullName.Trim().ToUpperInvariant() : "NGUYEN THANH LONG");

            // Tự động gán mặc định vào DB nếu admin chưa từng cập nhật thông tin ngân hàng
            if (adminUser != null && (string.IsNullOrWhiteSpace(adminUser.BankName) || string.IsNullOrWhiteSpace(adminUser.BankAccountNumber)))
            {
                adminUser.BankName = bankName;
                adminUser.BankAccountNumber = bankAccount;
                adminUser.BankAccountHolder = accountHolder;
                await _context.SaveChangesAsync();
            }

            var bankCode = GetVietQrBankCode(bankName);
            var cleanAccount = bankAccount.Replace(".", "").Replace(" ", "").Replace("-", "");

            // Link mã QR chuẩn ngân hàng VietQR
            var qrUrl = $"https://img.vietqr.io/image/{bankCode}-{cleanAccount}-qr_only.png?amount={(int)package.Price}&addInfo={Uri.EscapeDataString(orderCode)}&accountName={Uri.EscapeDataString(accountHolder)}";

            return Ok(new
            {
                success = true,
                orderCode = orderCode,
                packageName = package.Name,
                amount = package.Price,
                qrUrl = qrUrl,
                bankName = bankName,
                bankAccount = bankAccount,
                accountHolder = accountHolder,
                description = orderCode
            });
        }

        [HttpPost("ConfirmPayment")]
        public async Task<IActionResult> ConfirmPayment([FromBody] ConfirmPaymentDto model)
        {
            var payment = await _context.Payments
                .Include(p => p.Package)
                .Include(p => p.User)
                .FirstOrDefaultAsync(p => p.OrderCode == model.OrderCode);

            if (payment == null)
            {
                return NotFound(new { success = false, message = "Không tìm thấy giao dịch với mã này!" });
            }

            if (payment.Status == "Success")
            {
                return Ok(new
                {
                    success = true,
                    message = "Giao dịch này đã được kích hoạt thành công từ trước!",
                    tier = payment.PackageId
                });
            }

            // 1. Update Payment status
            payment.Status = "Success";
            payment.PaymentDate = DateTime.UtcNow;
            payment.TransactionCode = $"TXN_{payment.OrderCode}_{DateTime.UtcNow.Ticks % 1000000}";

            // 2. Activate / Renew 30-Day Subscription (SRS BR-02, BR-03, 3.5)
            var currentSub = await _context.Subscriptions
                .Where(s => s.UserId == payment.UserId && s.PackageId == payment.PackageId && s.Status == "Active" && s.EndDate >= DateTime.UtcNow)
                .OrderByDescending(s => s.EndDate)
                .FirstOrDefaultAsync();

            DateTime newStartDate = DateTime.UtcNow;
            DateTime newEndDate = DateTime.UtcNow.AddDays(payment.Package.DurationDays > 0 ? payment.Package.DurationDays : 30);

            if (currentSub != null)
            {
                // Extension
                newStartDate = currentSub.StartDate;
                newEndDate = currentSub.EndDate.AddDays(payment.Package.DurationDays > 0 ? payment.Package.DurationDays : 30);
                currentSub.EndDate = newEndDate;
                payment.SubscriptionId = currentSub.SubscriptionId;
            }
            else
            {
                // New Subscription
                var newSub = new Subscription
                {
                    SubscriptionId = Guid.NewGuid(),
                    UserId = payment.UserId,
                    PackageId = payment.PackageId,
                    StartDate = newStartDate,
                    EndDate = newEndDate,
                    Status = "Active",
                    CreatedAt = DateTime.UtcNow
                };

                _context.Subscriptions.Add(newSub);
                payment.SubscriptionId = newSub.SubscriptionId;
            }

            // 3. Create Notification
            _context.Notifications.Add(new Notification
            {
                NotificationId = Guid.NewGuid(),
                UserId = payment.UserId,
                Title = $"Kích hoạt thành công gói {payment.Package.Name}!",
                Content = $"Giao dịch {payment.OrderCode} ({payment.Amount:N0}đ) đã được xác nhận. Gói VIP của bạn có hiệu lực đến ngày {newEndDate:dd/MM/yyyy}.",
                Type = "Payment",
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            });

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                message = $"🎉 Kích hoạt thành công gói {payment.Package.Name}! Hạn dùng đến ngày {newEndDate:dd/MM/yyyy}.",
                tier = payment.PackageId,
                endDate = newEndDate
            });
        }
        
        private static string GetVietQrBankCode(string bankName)
        {
            if (string.IsNullOrWhiteSpace(bankName)) return "MB";
            var b = bankName.ToUpperInvariant();
            if (b.Contains("VIETCOMBANK") || b.Contains("VCB")) return "VCB";
            if (b.Contains("TECHCOMBANK") || b.Contains("TCB")) return "TCB";
            if (b.Contains("MB") || b.Contains("QUÂN ĐỘI") || b.Contains("QUAN DOI")) return "MB";
            if (b.Contains("BIDV")) return "BIDV";
            if (b.Contains("VIETINBANK") || b.Contains("CTG") || b.Contains("ICB")) return "ICB";
            if (b.Contains("AGRIBANK") || b.Contains("VBA")) return "VBA";
            if (b.Contains("ACB")) return "ACB";
            if (b.Contains("VPBANK") || b.Contains("VPB")) return "VPB";
            if (b.Contains("TPBANK") || b.Contains("TPB")) return "TPB";
            if (b.Contains("SACOMBANK") || b.Contains("STB")) return "STB";
            if (b.Contains("HDBANK") || b.Contains("HDB")) return "HDB";
            if (b.Contains("VIB")) return "VIB";
            if (b.Contains("SHB")) return "SHB";
            if (b.Contains("SEABANK") || b.Contains("SEAB")) return "SEAB";
            if (b.Contains("MSB") || b.Contains("HÀNG HẢI") || b.Contains("HANG HAI")) return "MSB";
            if (b.Contains("LPBANK") || b.Contains("LIENVIET") || b.Contains("LPB")) return "LPB";
            if (b.Contains("OCB")) return "OCB";
            if (b.Contains("NAM A") || b.Contains("NAB")) return "NAB";
            if (b.Contains("BAC A") || b.Contains("BAB")) return "BAB";
            if (b.Contains("BAOVIET") || b.Contains("BVB")) return "BVB";
            if (b.Contains("KIENLONG") || b.Contains("KLB")) return "KLB";
            if (b.Contains("SAIGONBANK") || b.Contains("SGB")) return "SGB";
            if (b.Contains("PGBANK") || b.Contains("PGB")) return "PGB";
            if (b.Contains("BẢN VIỆT") || b.Contains("BAN VIET") || b.Contains("BVBANK") || b.Contains("VCCB")) return "VCCB";
            if (b.Contains("VIETBANK") || b.Contains("VBB")) return "VBB";
            if (b.Contains("ABBANK") || b.Contains("AN BÌNH") || b.Contains("ABB")) return "ABB";
            if (b.Contains("SHINHAN")) return "SHBVN";
            if (b.Contains("WOORI")) return "WOO";
            if (b.Contains("PUBLIC")) return "PBVN";
            if (b.Contains("HSBC")) return "HSBC";
            if (b.Contains("STANDARD")) return "SCVN";
            return "MB";
        }
    }
}
