-- =========================================================================================
-- TLONGMUSIC DATABASE CREATION & SEEDING SCRIPT
-- Standards compliant with Software Requirements Specification (SRS_TlongMusic.docx)
-- Database Engine: Microsoft SQL Server (2019 / 2022 / SQLEXPRESS)
-- Collation: Vietnamese_CI_AS (Support Unicode and Vietnamese search)
-- =========================================================================================

USE master;
GO

-- 1. TẠO CƠ SỞ DỮ LIỆU NẾU CHƯA TỒN TẠI
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'TLongMusicDb')
BEGIN
    CREATE DATABASE TLongMusicDb COLLATE Vietnamese_CI_AS;
    PRINT N'>>> Đã tạo mới cơ sở dữ liệu TLongMusicDb thành công.';
END
ELSE
BEGIN
    PRINT N'>>> Cơ sở dữ liệu TLongMusicDb đã tồn tại. Tiến hành cập nhật cấu trúc...';
END
GO

USE TLongMusicDb;
GO

-- 2. XÓA CÁC BẢNG THEO THỨ TỰ PHỤ THUỘC (IF EXISTS) ĐỂ KHỞI TẠO LẠI CHUẨN XÁC
IF OBJECT_ID(N'dbo.PlaylistTracks', N'U') IS NOT NULL DROP TABLE dbo.PlaylistTracks;
IF OBJECT_ID(N'dbo.Playlists', N'U') IS NOT NULL DROP TABLE dbo.Playlists;
IF OBJECT_ID(N'dbo.Favorites', N'U') IS NOT NULL DROP TABLE dbo.Favorites;
IF OBJECT_ID(N'dbo.ListeningHistories', N'U') IS NOT NULL DROP TABLE dbo.ListeningHistories;
IF OBJECT_ID(N'dbo.DownloadHistories', N'U') IS NOT NULL DROP TABLE dbo.DownloadHistories;
IF OBJECT_ID(N'dbo.Reports', N'U') IS NOT NULL DROP TABLE dbo.Reports;
IF OBJECT_ID(N'dbo.Notifications', N'U') IS NOT NULL DROP TABLE dbo.Notifications;
IF OBJECT_ID(N'dbo.Payments', N'U') IS NOT NULL DROP TABLE dbo.Payments;
IF OBJECT_ID(N'dbo.Subscriptions', N'U') IS NOT NULL DROP TABLE dbo.Subscriptions;
IF OBJECT_ID(N'dbo.Musics', N'U') IS NOT NULL DROP TABLE dbo.Musics;
IF OBJECT_ID(N'dbo.TrackCategories', N'U') IS NOT NULL DROP TABLE dbo.TrackCategories;
IF OBJECT_ID(N'dbo.Packages', N'U') IS NOT NULL DROP TABLE dbo.Packages;
IF OBJECT_ID(N'dbo.Producers', N'U') IS NOT NULL DROP TABLE dbo.Producers;
IF OBJECT_ID(N'dbo.UserRoles', N'U') IS NOT NULL DROP TABLE dbo.UserRoles;
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL DROP TABLE dbo.Users;
IF OBJECT_ID(N'dbo.Roles', N'U') IS NOT NULL DROP TABLE dbo.Roles;

-- Bỏ các bảng phiên bản cũ nếu có
IF OBJECT_ID(N'dbo.DownloadLogs', N'U') IS NOT NULL DROP TABLE dbo.DownloadLogs;
IF OBJECT_ID(N'dbo.ListeningLogs', N'U') IS NOT NULL DROP TABLE dbo.ListeningLogs;
IF OBJECT_ID(N'dbo.Transactions', N'U') IS NOT NULL DROP TABLE dbo.Transactions;
IF OBJECT_ID(N'dbo.Tracks', N'U') IS NOT NULL DROP TABLE dbo.Tracks;
IF OBJECT_ID(N'dbo.SubscriptionTiers', N'U') IS NOT NULL DROP TABLE dbo.SubscriptionTiers;
GO

-- =========================================================================================
-- 3. TẠO CÁC BẢNG CHÍNH (THEO SECTION 6.1 SRS_TlongMusic.docx)
-- =========================================================================================

-- 3.1 BẢNG ROLES (Vai trò người dùng: Admin, Producer, Member)
CREATE TABLE dbo.Roles (
    RoleId NVARCHAR(20) NOT NULL,
    RoleName NVARCHAR(50) NOT NULL,
    Description NVARCHAR(255) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Roles PRIMARY KEY CLUSTERED (RoleId)
);
GO

-- 3.2 BẢNG USERS (Tài khoản người dùng)
CREATE TABLE dbo.Users (
    UserId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    Username NVARCHAR(50) NOT NULL,
    Email NVARCHAR(100) NOT NULL,
    PasswordHash NVARCHAR(255) NOT NULL,
    FullName NVARCHAR(100) NULL,
    PhoneNumber NVARCHAR(20) NULL,
    AvatarUrl NVARCHAR(500) NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Active', -- 'Active', 'Locked', 'Disabled'
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (UserId),
    CONSTRAINT UQ_Users_Username UNIQUE (Username),
    CONSTRAINT UQ_Users_Email UNIQUE (Email)
);
GO

-- 3.3 BẢNG USERROLES (Liên kết N-N giữa User và Role)
CREATE TABLE dbo.UserRoles (
    UserId UNIQUEIDENTIFIER NOT NULL,
    RoleId NVARCHAR(20) NOT NULL,
    AssignedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserRoles PRIMARY KEY CLUSTERED (UserId, RoleId),
    CONSTRAINT FK_UserRoles_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_UserRoles_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId) ON DELETE CASCADE
);
GO

-- 3.4 BẢNG PRODUCERS (Hồ sơ Nhà sản xuất âm nhạc / DJ)
CREATE TABLE dbo.Producers (
    ProducerId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    StageName NVARCHAR(100) NOT NULL, -- Nghệ danh
    Bio NVARCHAR(MAX) NULL,
    PhoneNumber NVARCHAR(20) NULL,
    ZaloContact NVARCHAR(50) NULL,
    FacebookUrl NVARCHAR(255) NULL,
    SoundCloudUrl NVARCHAR(255) NULL,
    BankName NVARCHAR(100) NULL,
    BankAccountNumber NVARCHAR(50) NULL,
    BankAccountHolder NVARCHAR(100) NULL,
    IsVerified BIT NOT NULL DEFAULT 1,
    CreatedByAdminId UNIQUEIDENTIFIER NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Producers PRIMARY KEY CLUSTERED (ProducerId),
    CONSTRAINT UQ_Producers_UserId UNIQUE (UserId),
    CONSTRAINT FK_Producers_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_Producers_Admin FOREIGN KEY (CreatedByAdminId) REFERENCES dbo.Users(UserId) ON DELETE NO ACTION
);
GO

-- 3.5 BẢNG PACKAGES (Gói thành viên: Free, Standard VIP, Premium VIP)
CREATE TABLE dbo.Packages (
    PackageId NVARCHAR(20) NOT NULL, -- 'Free', 'Standard', 'Premium'
    Name NVARCHAR(100) NOT NULL,
    Price DECIMAL(18, 2) NOT NULL DEFAULT 0,
    DurationDays INT NOT NULL DEFAULT 30, -- 1 tháng = 30 ngày (Free = 0: vô thời hạn)
    Description NVARCHAR(500) NULL,
    BadgeText NVARCHAR(50) NULL,
    ThemeColor NVARCHAR(20) NOT NULL DEFAULT N'Default', -- 'Default', 'RubyRed', 'RoyalGold'
    CanDownloadLot BIT NOT NULL DEFAULT 1,
    CanDownloadNhom BIT NOT NULL DEFAULT 0,
    CanDownloadSlot BIT NOT NULL DEFAULT 0,
    SlotDemoLimitSeconds INT NOT NULL DEFAULT 30,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Active', -- 'Active', 'Inactive'
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Packages PRIMARY KEY CLUSTERED (PackageId)
);
GO

-- 3.6 BẢNG SUBSCRIPTIONS (Quản lý gói thuê bao đã kích hoạt của User)
CREATE TABLE dbo.Subscriptions (
    SubscriptionId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    PackageId NVARCHAR(20) NOT NULL,
    StartDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    EndDate DATETIME2 NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Active', -- 'Active', 'Expired', 'Cancelled'
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Subscriptions PRIMARY KEY CLUSTERED (SubscriptionId),
    CONSTRAINT FK_Subscriptions_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_Subscriptions_Packages FOREIGN KEY (PackageId) REFERENCES dbo.Packages(PackageId) ON DELETE CASCADE
);
GO

-- 3.7 BẢNG PAYMENTS (Lịch sử giao dịch thanh toán mua gói VIP)
CREATE TABLE dbo.Payments (
    PaymentId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    PackageId NVARCHAR(20) NOT NULL,
    SubscriptionId UNIQUEIDENTIFIER NULL,
    Amount DECIMAL(18, 2) NOT NULL,
    Method NVARCHAR(50) NOT NULL DEFAULT N'VietQR', -- 'VietQR', 'BankTransfer', 'Momo'
    OrderCode NVARCHAR(50) NOT NULL,
    TransactionCode NVARCHAR(100) NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Pending', -- 'Pending', 'Success', 'Failed', 'Cancelled'
    PaymentDate DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Payments PRIMARY KEY CLUSTERED (PaymentId),
    CONSTRAINT UQ_Payments_OrderCode UNIQUE (OrderCode),
    CONSTRAINT FK_Payments_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_Payments_Packages FOREIGN KEY (PackageId) REFERENCES dbo.Packages(PackageId) ON DELETE NO ACTION,
    CONSTRAINT FK_Payments_Subscriptions FOREIGN KEY (SubscriptionId) REFERENCES dbo.Subscriptions(SubscriptionId) ON DELETE NO ACTION
);
GO

-- 3.8 BẢNG TRACKCATEGORIES (6 Phân loại nội dung âm nhạc chuẩn SRS)
-- 6 loại: Track Lọt, Nonstop Lọt, Track Nhóm, Nonstop Nhóm, Track Slot, Nonstop Slot
CREATE TABLE dbo.TrackCategories (
    CategoryCode NVARCHAR(30) NOT NULL,
    Name NVARCHAR(100) NOT NULL,
    Kind NVARCHAR(20) NOT NULL, -- 'Track' hoặc 'Nonstop'
    AccessLevel NVARCHAR(20) NOT NULL, -- 'Lot', 'Nhom', 'Slot'
    RequiredTierToDownload NVARCHAR(20) NOT NULL, -- 'Free', 'Standard', 'Premium'
    Description NVARCHAR(255) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TrackCategories PRIMARY KEY CLUSTERED (CategoryCode),
    CONSTRAINT FK_TrackCategories_Packages FOREIGN KEY (RequiredTierToDownload) REFERENCES dbo.Packages(PackageId) ON DELETE CASCADE
);
GO

-- 3.9 BẢNG MUSICS (Kho bài nhạc & Nonstop)
CREATE TABLE dbo.Musics (
    MusicId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    ProducerId UNIQUEIDENTIFIER NOT NULL,
    Title NVARCHAR(255) NOT NULL,
    Artist NVARCHAR(255) NOT NULL,
    Genre NVARCHAR(100) NOT NULL DEFAULT N'Vinahouse',
    CategoryCode NVARCHAR(30) NOT NULL,
    Type NVARCHAR(20) NOT NULL, -- 'Track' hoặc 'Nonstop'
    Bpm INT NOT NULL DEFAULT 140,
    MusicalKey NVARCHAR(10) NOT NULL DEFAULT N'8A', -- Tone Camelot (8A, 11B, ...)
    DurationSeconds INT NOT NULL DEFAULT 0,
    CoverUrl NVARCHAR(500) NULL,
    SourceType NVARCHAR(50) NOT NULL DEFAULT N'DirectFile', -- 'DirectFile', 'SoundCloud', 'CloudflareR2'
    SourceUrl NVARCHAR(500) NOT NULL,
    DemoFilePath NVARCHAR(500) NULL,
    SoundCloudUrl NVARCHAR(500) NULL,
    QualityAvailable NVARCHAR(50) NOT NULL DEFAULT N'MP3 320kbps', -- 'MP3 320kbps', 'WAV Master 24-Bit', 'FLAC'
    IsDemoOnlyForFree BIT NOT NULL DEFAULT 0,
    DemoLimitSeconds INT NOT NULL DEFAULT 30, -- 30s cho Track Slot
    PlaysCount INT NOT NULL DEFAULT 0,
    DownloadsCount INT NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Published', -- 'Draft', 'Pending', 'Published', 'Hidden', 'Expired'
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Musics PRIMARY KEY CLUSTERED (MusicId),
    CONSTRAINT FK_Musics_Producers FOREIGN KEY (ProducerId) REFERENCES dbo.Producers(ProducerId) ON DELETE CASCADE,
    CONSTRAINT FK_Musics_Categories FOREIGN KEY (CategoryCode) REFERENCES dbo.TrackCategories(CategoryCode) ON DELETE CASCADE
);
GO

-- 3.10 BẢNG FAVORITES (Danh sách bài hát yêu thích của người dùng)
CREATE TABLE dbo.Favorites (
    UserId UNIQUEIDENTIFIER NOT NULL,
    MusicId UNIQUEIDENTIFIER NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Favorites PRIMARY KEY CLUSTERED (UserId, MusicId),
    CONSTRAINT FK_Favorites_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_Favorites_Musics FOREIGN KEY (MusicId) REFERENCES dbo.Musics(MusicId) ON DELETE NO ACTION
);
GO

-- 3.11 BẢNG PLAYLISTS (Danh sách phát cá nhân của người dùng)
CREATE TABLE dbo.Playlists (
    PlaylistId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    Name NVARCHAR(150) NOT NULL,
    Description NVARCHAR(500) NULL,
    ThumbnailUrl NVARCHAR(500) NULL,
    IsPublic BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Playlists PRIMARY KEY CLUSTERED (PlaylistId),
    CONSTRAINT FK_Playlists_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE
);
GO

-- 3.12 BẢNG PLAYLISTTRACKS (Các bài hát trong danh sách phát)
CREATE TABLE dbo.PlaylistTracks (
    PlaylistId UNIQUEIDENTIFIER NOT NULL,
    MusicId UNIQUEIDENTIFIER NOT NULL,
    OrderIndex INT NOT NULL DEFAULT 0,
    AddedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_PlaylistTracks PRIMARY KEY CLUSTERED (PlaylistId, MusicId),
    CONSTRAINT FK_PlaylistTracks_Playlists FOREIGN KEY (PlaylistId) REFERENCES dbo.Playlists(PlaylistId) ON DELETE CASCADE,
    CONSTRAINT FK_PlaylistTracks_Musics FOREIGN KEY (MusicId) REFERENCES dbo.Musics(MusicId) ON DELETE NO ACTION
);
GO

-- 3.13 BẢNG LISTENINGHISTORIES (Lịch sử nghe nhạc)
CREATE TABLE dbo.ListeningHistories (
    HistoryId BIGINT IDENTITY(1, 1) NOT NULL,
    UserId UNIQUEIDENTIFIER NULL, -- NULL nếu là khách vãng lai (Guest)
    MusicId UNIQUEIDENTIFIER NOT NULL,
    PlayedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    DurationPlayedSeconds INT NOT NULL DEFAULT 0,
    IpAddress NVARCHAR(50) NULL,
    CONSTRAINT PK_ListeningHistories PRIMARY KEY CLUSTERED (HistoryId),
    CONSTRAINT FK_ListeningHistories_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE SET NULL,
    CONSTRAINT FK_ListeningHistories_Musics FOREIGN KEY (MusicId) REFERENCES dbo.Musics(MusicId) ON DELETE NO ACTION
);
GO

-- 3.14 BẢNG DOWNLOADHISTORIES (Lịch sử tải bài hát)
CREATE TABLE dbo.DownloadHistories (
    DownloadId BIGINT IDENTITY(1, 1) NOT NULL,
    UserId UNIQUEIDENTIFIER NOT NULL,
    MusicId UNIQUEIDENTIFIER NOT NULL,
    DownloadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    DownloadedTier NVARCHAR(20) NOT NULL DEFAULT N'Free',
    DownloadQuality NVARCHAR(50) NULL,
    IpAddress NVARCHAR(50) NULL,
    CONSTRAINT PK_DownloadHistories PRIMARY KEY CLUSTERED (DownloadId),
    CONSTRAINT FK_DownloadHistories_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_DownloadHistories_Musics FOREIGN KEY (MusicId) REFERENCES dbo.Musics(MusicId) ON DELETE NO ACTION
);
GO

-- 3.15 BẢNG REPORTS (Báo cáo vi phạm / lỗi bài nhạc)
CREATE TABLE dbo.Reports (
    ReportId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    MusicId UNIQUEIDENTIFIER NOT NULL,
    Reason NVARCHAR(500) NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'Pending', -- 'Pending', 'Reviewed', 'Resolved', 'Dismissed'
    AdminNote NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Reports PRIMARY KEY CLUSTERED (ReportId),
    CONSTRAINT FK_Reports_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_Reports_Musics FOREIGN KEY (MusicId) REFERENCES dbo.Musics(MusicId) ON DELETE NO ACTION
);
GO

-- 3.16 BẢNG NOTIFICATIONS (Thông báo hệ thống cho người dùng)
CREATE TABLE dbo.Notifications (
    NotificationId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    Title NVARCHAR(150) NOT NULL,
    Content NVARCHAR(500) NOT NULL,
    Type NVARCHAR(50) NOT NULL DEFAULT N'System', -- 'Payment', 'Subscription', 'Music', 'System'
    IsRead BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Notifications PRIMARY KEY CLUSTERED (NotificationId),
    CONSTRAINT FK_Notifications_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE
);
GO

-- =========================================================================================
-- 4. TẠO INDEXES TỐI ƯU HIỆU NĂNG TÌM KIẾM & TRUY VẤN
-- =========================================================================================
CREATE NONCLUSTERED INDEX IX_Musics_CategoryCode ON dbo.Musics(CategoryCode);
CREATE NONCLUSTERED INDEX IX_Musics_ProducerId ON dbo.Musics(ProducerId);
CREATE NONCLUSTERED INDEX IX_Musics_Status ON dbo.Musics(Status);
CREATE NONCLUSTERED INDEX IX_Musics_CreatedAt ON dbo.Musics(CreatedAt DESC);
CREATE NONCLUSTERED INDEX IX_Subscriptions_UserId_Status ON dbo.Subscriptions(UserId, Status);
CREATE NONCLUSTERED INDEX IX_ListeningHistories_PlayedAt ON dbo.ListeningHistories(PlayedAt DESC);
CREATE NONCLUSTERED INDEX IX_DownloadHistories_DownloadedAt ON dbo.DownloadHistories(DownloadedAt DESC);
CREATE NONCLUSTERED INDEX IX_Payments_UserId ON dbo.Payments(UserId);
GO

-- =========================================================================================
-- 5. NẠP DỮ LIỆU BAN ĐẦU (SEED DATA CHUẨN SRS)
-- =========================================================================================

-- 5.1 Roles
INSERT INTO dbo.Roles (RoleId, RoleName, Description)
VALUES
(N'Admin', N'Quản Trị Viên Hệ Thống', N'Toàn quyền quản trị hệ thống, duyệt Producer và điều hành'),
(N'Producer', N'Nhà Sản Xuất Âm Nhạc / DJ', N'Upload và quản lý CRUD các bài nhạc Lọt, Nhóm, Slot theo thời gian'),
(N'Member', N'Hội Viên / Thính Giả', N'Người dùng nghe nhạc và tải nhạc theo gói tài khoản sở hữu');
GO

-- 5.2 Packages (Gói Hội Viên: Free, Standard VIP - Đỏ, Premium VIP - Vàng)
INSERT INTO dbo.Packages (PackageId, Name, Price, DurationDays, Description, BadgeText, ThemeColor, CanDownloadLot, CanDownloadNhom, CanDownloadSlot, SlotDemoLimitSeconds, Status)
VALUES
(N'Free', N'TÀI KHOẢN FREE', 0, 0, N'Dành cho người nghe trải nghiệm các bản lọt thông thường.', N'MẶC ĐỊNH', N'Default', 1, 0, 0, 0, N'Active'),
(N'Standard', N'STANDARD VIP', 99000, 30, N'Điểm nhấn ĐỎ: Dành cho DJ tải kho Track Nhóm & MP3 320kbps hàng ngày.', N'PHỔ BIẾN NHẤT', N'RubyRed', 1, 1, 0, 30, N'Active'),
(N'Premium', N'PREMIUM VIP ĐỘC QUYỀN', 199000, 30, N'Điểm nhấn VÀNG: Dành cho DJ Bar Club & Pro tải Full Master WAV 24-Bit và Track Slot độc quyền.', N'DÀNH CHO PRO DJ', N'RoyalGold', 1, 1, 1, 0, N'Active');
GO

-- 5.3 TrackCategories (6 phân loại chuẩn SRS: Section 1.3, 3.2, 4)
INSERT INTO dbo.TrackCategories (CategoryCode, Name, Kind, AccessLevel, RequiredTierToDownload, Description)
VALUES
(N'TrackLot', N'Track Lọt', N'Track', N'Lot', N'Free', N'Các bản Track lẻ lọt phòng thu, Free Member được nghe và tải về'),
(N'NonstopLot', N'Nonstop Lọt', N'Nonstop', N'Lot', N'Free', N'Các bản Nonstop lọt từ phòng thu / Soundcloud, nghe và tải miễn phí'),
(N'TrackNhom', N'Track Nhóm', N'Track', N'Nhom', N'Standard', N'Track lẻ chuẩn bị cho DJ trong nhóm nội bộ, cần Standard VIP để tải'),
(N'NonstopNhom', N'Nonstop Nhóm', N'Nonstop', N'Nhom', N'Standard', N'Nonstop mix theo nhóm riêng cho DJ, cần gói Standard VIP'),
(N'TrackSlot', N'Track Slot', N'Track', N'Slot', N'Premium', N'Track làm riêng theo đơn Slot bar club, Standard nghe demo 30s, Premium tải Full WAV'),
(N'NonstopSlot', N'Nonstop Slot', N'Nonstop', N'Slot', N'Premium', N'Set Nonstop đặt độc quyền biểu diễn sự kiện, chỉ dành riêng cho Premium VIP');
GO

-- 5.4 Users (5 Tài khoản đại diện chuẩn: Mật khẩu mặc định đều là '123456')
-- PasswordHash minh họa cho mật khẩu: 123456 (SHA-256: 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92)
DECLARE @AdminId UNIQUEIDENTIFIER = '11111111-1111-1111-1111-111111111111';
DECLARE @ProducerId UNIQUEIDENTIFIER = '22222222-2222-2222-2222-222222222222';
DECLARE @StandardUserId UNIQUEIDENTIFIER = '33333333-3333-3333-3333-333333333333';
DECLARE @PremiumUserId UNIQUEIDENTIFIER = '44444444-4444-4444-4444-444444444444';
DECLARE @FreeUserId UNIQUEIDENTIFIER = '55555555-5555-5555-5555-555555555555';

INSERT INTO dbo.Users (UserId, Username, Email, PasswordHash, FullName, PhoneNumber, AvatarUrl, Status)
VALUES
(@AdminId, N'admin', N'admin@tlongmusic.vn', N'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', N'Quản Trị Viên (Admin)', N'0988888888', N'/images/logo.png', N'Active'),
(@ProducerId, N'producer_tlong', N'producer@tlongmusic.vn', N'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', N'DJ TLong (Producer)', N'0977777777', N'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150', N'Active'),
(@StandardUserId, N'user_standard', N'standard@tlongmusic.vn', N'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', N'Hội Viên Standard VIP', N'0966666666', N'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', N'Active'),
(@PremiumUserId, N'user_premium', N'premium@tlongmusic.vn', N'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', N'Hội Viên Premium Master', N'0955555555', N'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', N'Active'),
(@FreeUserId, N'user_free', N'free@tlongmusic.vn', N'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', N'Nguyễn Văn A (Free)', N'0944444444', N'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', N'Active');

-- 5.5 UserRoles (Phân quyền tài khoản)
INSERT INTO dbo.UserRoles (UserId, RoleId)
VALUES
(@AdminId, N'Admin'),
(@ProducerId, N'Producer'),
(@StandardUserId, N'Member'),
(@PremiumUserId, N'Member'),
(@FreeUserId, N'Member');

-- 5.6 Producers Profile
DECLARE @ProdProfileId UNIQUEIDENTIFIER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
INSERT INTO dbo.Producers (ProducerId, UserId, StageName, Bio, PhoneNumber, ZaloContact, FacebookUrl, SoundCloudUrl, BankName, BankAccountNumber, BankAccountHolder, IsVerified, CreatedByAdminId)
VALUES
(@ProdProfileId, @ProducerId, N'DJ TLong Official', N'Nhà sản xuất âm nhạc Vinahouse & Electro hàng đầu, chuyên gia mix master cho các Bar Club lớn tại Việt Nam.', N'0977777777', N'0977777777', N'https://facebook.com/tlongmusic', N'https://soundcloud.com/tlongmusic', N'MB Bank (Quân Đội)', N'0988888888', N'NGUYEN THANH LONG', 1, @AdminId);

-- 5.7 Subscriptions (Thời hạn gói 1 tháng theo SRS)
INSERT INTO dbo.Subscriptions (SubscriptionId, UserId, PackageId, StartDate, EndDate, Status)
VALUES
(NEWID(), @StandardUserId, N'Standard', SYSUTCDATETIME(), DATEADD(day, 30, SYSUTCDATETIME()), N'Active'),
(NEWID(), @PremiumUserId, N'Premium', SYSUTCDATETIME(), DATEADD(day, 30, SYSUTCDATETIME()), N'Active'),
(NEWID(), @FreeUserId, N'Free', SYSUTCDATETIME(), DATEADD(year, 10, SYSUTCDATETIME()), N'Active');

-- 5.8 Musics (Dữ liệu bài nhạc phủ đủ 6 danh mục theo SRS)
INSERT INTO dbo.Musics (MusicId, ProducerId, Title, Artist, Genre, CategoryCode, Type, Bpm, MusicalKey, DurationSeconds, CoverUrl, SourceType, SourceUrl, QualityAvailable, IsDemoOnlyForFree, DemoLimitSeconds, PlaysCount, DownloadsCount, Status)
VALUES
-- 1. Nonstop Lọt (Free)
('e1111111-1111-1111-1111-111111111111', @ProdProfileId, N'Nonstop Vinahouse 2026 - Lọt Kho Nhạc Bay Đỉnh Cao', N'DJ TLong x Producer VietNam', N'Vinahouse', N'NonstopLot', N'Nonstop', 138, N'8A', 3845, N'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', N'320kbps MP3', 0, 0, 48520, 12430, N'Published'),
('e1111111-1111-1111-1111-111111111112', @ProdProfileId, N'Nonstop Bass Căng Đét - Quẩy Tung Nóc Club 2026', N'DJ Hoàng x TLong Team', N'Vinahouse Club', N'NonstopLot', N'Nonstop', 140, N'11B', 4210, N'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', N'320kbps MP3', 0, 0, 36900, 8900, N'Published'),

-- 2. Nonstop Slot (Premium VIP - Vàng)
('e2222222-2222-2222-2222-222222222221', @ProdProfileId, N'[VIP ĐẶT] Nonstop Hàng Hiệu Độc Quyền Bar 1900 Hà Nội', N'TLong Music Exclusive Mix', N'Vinahouse Master', N'NonstopSlot', N'Nonstop', 140, N'1A', 4800, N'https://images.unsplash.com/photo-1541689592655-f5f52825a3b8?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', N'WAV Master 24-Bit / FLAC', 1, 45, 89000, 450, N'Published'),
('e2222222-2222-2222-2222-222222222222', @ProdProfileId, N'[VIP ĐẶT] Set Nhạc Đám Cưới Khủng - Siêu Bass Độc Quyền', N'DJ Alex Tran x Producer VIP', N'Vinahouse Độc Quyền', N'NonstopSlot', N'Nonstop', 142, N'9B', 4500, N'https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3', N'WAV Lossless + MP3 320k', 1, 45, 64200, 380, N'Published'),

-- 3. Track Nhóm (Standard VIP - Đỏ)
('e3333333-3333-3333-3333-333333333331', @ProdProfileId, N'Tình Nhạt Phai (TLong Remix Intro Club)', N'TLong Music x Đan Trường', N'Vinahouse Intro', N'TrackNhom', N'Track', 140, N'8A', 245, N'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3', N'320kbps MP3', 1, 45, 12400, 3450, N'Published'),
('e3333333-3333-3333-3333-333333333332', @ProdProfileId, N'Cắt Đôi Nỗi Sầu (TLong x Hưng Bass Extended Mix)', N'TLong Producer', N'Vinahouse Bassline', N'TrackNhom', N'Track', 138, N'5A', 280, N'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3', N'320kbps MP3', 1, 45, 18900, 4920, N'Published'),
('e3333333-3333-3333-3333-333333333333', @ProdProfileId, N'Waiting For You (TLong Bootleg 2026 Club Edit)', N'MONO x DJ TLong', N'Electro House', N'TrackNhom', N'Track', 132, N'3A', 225, N'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3', N'320kbps MP3', 1, 45, 9800, 2810, N'Published'),

-- 4. Track Slot (Premium VIP - Vàng)
('e4444444-4444-4444-4444-444444444441', @ProdProfileId, N'[DUBPLATE] Vũ Điệu Hoang Dã (Exclusive VIP Master)', N'DJ TLong Private Dubplate', N'Vinahouse Dubplate', N'TrackSlot', N'Track', 142, N'11B', 260, N'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3', N'WAV Lossless 24-Bit', 1, 30, 31200, 210, N'Published'),
('e4444444-4444-4444-4444-444444444442', @ProdProfileId, N'[TRACK ĐẶT] Bass Drop Đỉnh Cao - Show Sân Vận Động', N'DJ TLong x DJ Quốc Tế', N'Festival Bounce', N'TrackSlot', N'Track', 145, N'12A', 295, N'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', N'WAV Lossless 24-Bit', 1, 30, 42500, 180, N'Published'),

-- 5. Track Lọt (Free)
('e5555555-5555-5555-5555-555555555551', @ProdProfileId, N'Nơi Này Có Anh (TLong Mashup Vina Drop Lọt)', N'Sơn Tùng M-TP x TLong Mix', N'Vinahouse Mashup', N'TrackLot', N'Track', 140, N'7B', 250, N'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop&q=80', N'DirectFile', N'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3', N'320kbps MP3', 0, 0, 24300, 6700, N'Published');

-- 5.9 Sample Playlists & Favorites
DECLARE @SamplePlaylistId UNIQUEIDENTIFIER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
INSERT INTO dbo.Playlists (PlaylistId, UserId, Name, Description, IsPublic)
VALUES
(@SamplePlaylistId, @StandardUserId, N'Top Vinahouse Bay Phòng 2026', N'Tuyển tập các track hay nhất dùng đi show hàng đêm.', 1);

INSERT INTO dbo.PlaylistTracks (PlaylistId, MusicId, OrderIndex)
VALUES
(@SamplePlaylistId, 'e3333333-3333-3333-3333-333333333331', 1),
(@SamplePlaylistId, 'e3333333-3333-3333-3333-333333333332', 2);

INSERT INTO dbo.Favorites (UserId, MusicId)
VALUES
(@PremiumUserId, 'e4444444-4444-4444-4444-444444444441'),
(@PremiumUserId, 'e2222222-2222-2222-2222-222222222221');

-- 5.10 Notifications
INSERT INTO dbo.Notifications (UserId, Title, Content, Type)
VALUES
(@StandardUserId, N'Chào mừng thành viên Standard VIP', N'Tài khoản của bạn đã được kích hoạt gói Standard VIP. Nhấn điểm đỏ nổi bật và tải không giới hạn kho Track Nhóm.', N'Subscription'),
(@PremiumUserId, N'Chào mừng thành viên Premium Master', N'Đặc quyền cao nhất với điểm nhấn Vàng Hoàng Gia. Bạn có quyền tải trọn vẹn Track Slot và Nonstop Slot chất lượng WAV 24-Bit.', N'Subscription');
GO

PRINT N'=========================================================================================';
PRINT N'>>> HOÀN THÀNH KHỞI TẠO CƠ SỞ DỮ LIỆU TLONGMUSIC CHUẨN SRS VỚI 16 BẢNG VÀ SEED DATA!';
PRINT N'=========================================================================================';
GO
