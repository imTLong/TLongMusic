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

            // Generate VietQR URL
            // MB Bank (970422), STK: 0988888888, Chủ TK: NGUYEN THANH LONG
            var qrUrl = $"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=2|99|0988888888|NGUYEN%20THANH%20LONG|long@tlongmusic.vn|0|0|{(int)package.Price}|{orderCode}|transfer_myqr";

            return Ok(new
            {
                success = true,
                orderCode = orderCode,
                packageName = package.Name,
                amount = package.Price,
                qrUrl = qrUrl,
                bankName = "MB Bank (Ngân Hàng Quân Đội)",
                bankAccount = "0988.888.888",
                accountHolder = "NGUYEN THANH LONG (TLONGMUSIC)",
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
    }
}
