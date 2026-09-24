/**
 * TLongMusic - Ruby Crystal Glass Audio Controller & Authentication System
 */

window.TLongPlayer = {
    audio: new Audio(),
    currentTrack: null,
    isPlaying: false,
    currentUser: null, // { username, fullName, role: 'Admin'|'Producer'|'Member', tier: 'Free'|'Standard'|'Premium', avatarUrl }
    userTier: 'free',
    audioContext: null,
    isSynthesizing: false
};

document.addEventListener('DOMContentLoaded', () => {
    initAuthFromStorage();
    initPlayerEvents();
    initCrystalWaveform();
    initStardustShimmer();
    initKeyboardShortcuts();
    updateTierUI();
    updateAuthUI();
});

// Authentication System - Connected to SQL Server via /Auth API
async function initAuthFromStorage() {
    try {
        const res = await fetch('/Auth/CurrentUser');
        const data = await res.json();
        if (data.isAuthenticated && data.user) {
            window.TLongPlayer.currentUser = data.user;
            window.TLongPlayer.userTier = data.user.tier.toLowerCase();
            localStorage.setItem('tlong_current_user', JSON.stringify(data.user));
            updateAuthUI();
            updateTierUI();
            return;
        }
    } catch (e) {
        console.warn("Could not fetch current user from backend, fallback to storage:", e);
    }

    const savedUser = localStorage.getItem('tlong_current_user');
    if (savedUser) {
        try {
            window.TLongPlayer.currentUser = JSON.parse(savedUser);
            window.TLongPlayer.userTier = window.TLongPlayer.currentUser.tier.toLowerCase();
        } catch (e) {
            window.TLongPlayer.currentUser = null;
        }
    }
}

async function handleLogin(username, password) {
    const errorAlertEl = document.getElementById('loginErrorMessage');
    if (errorAlertEl) errorAlertEl.classList.add('d-none');

    const errMsg = "Sai tài khoản hoặc mật khẩu";

    if (!username || !username.trim() || !password || !password.trim()) {
        if (errorAlertEl) {
            const errSpan = errorAlertEl.querySelector('span') || errorAlertEl;
            errSpan.textContent = errMsg;
            errorAlertEl.classList.remove('d-none');
        }
        return;
    }

    try {
        const res = await fetch('/Auth/Login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernameOrEmail: username.trim(), password: password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            window.TLongPlayer.currentUser = data.user;
            window.TLongPlayer.userTier = data.user.tier.toLowerCase();
            localStorage.setItem('tlong_current_user', JSON.stringify(data.user));

            updateAuthUI();
            updateTierUI();

            // Close modal
            const loginModal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
            if (loginModal) loginModal.hide();

            showToastNotification(`🎉 ${data.message}`);
            return;
        }

        // ĐĂNG NHẬP THẤT BẠI: Chỉ hiện dòng "Sai tài khoản hoặc mật khẩu" trong form (không hiện popup)
        if (errorAlertEl) {
            const errSpan = errorAlertEl.querySelector('span') || errorAlertEl;
            errSpan.textContent = errMsg;
            errorAlertEl.classList.remove('d-none');
        }
    } catch (err) {
        console.error("Login fetch error:", err);
        if (errorAlertEl) {
            const errSpan = errorAlertEl.querySelector('span') || errorAlertEl;
            errSpan.textContent = errMsg;
            errorAlertEl.classList.remove('d-none');
        }
    }
}

async function submitRegister(form) {
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    if (password !== confirmPassword) {
        showToastNotification("⚠️ Mật khẩu xác nhận không khớp!");
        return;
    }

    const regData = {
        fullName: form.fullName.value.trim(),
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        phoneNumber: form.phoneNumber ? form.phoneNumber.value.trim() : null,
        password: password
    };

    try {
        const res = await fetch('/Auth/Register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(regData)
        });
        const data = await res.json();

        if (res.ok && data.success) {
            window.TLongPlayer.currentUser = data.user;
            window.TLongPlayer.userTier = (data.user.tier || 'free').toLowerCase();
            localStorage.setItem('tlong_current_user', JSON.stringify(data.user));

            updateAuthUI();
            updateTierUI();

            const loginModal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
            if (loginModal) loginModal.hide();

            showToastNotification(`🎉 ${data.message}`);
            return;
        }

        showToastNotification(`❌ ${data.message || 'Đăng ký không thành công!'}`);
    } catch (err) {
        console.error("Register error:", err);
        showToastNotification("❌ Lỗi kết nối khi gửi đăng ký!");
    }
}

async function handleLogout() {
    try {
        await fetch('/Auth/Logout', { method: 'POST' });
    } catch (e) {
        console.error("Logout error:", e);
    }

    // Thoát hoàn toàn khỏi phiên làm việc (clear state & storage)
    window.TLongPlayer.currentUser = null;
    window.TLongPlayer.userTier = 'free';
    localStorage.removeItem('tlong_current_user');
    sessionStorage.clear();

    // Dừng âm thanh đang phát để kết thúc phiên làm việc
    if (window.TLongPlayer.audio) {
        try {
            window.TLongPlayer.audio.pause();
            window.TLongPlayer.audio.currentTime = 0;
        } catch (e) {}
    }

    // Chuyển hướng quay về Homepage
    window.location.href = '/';
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) {
        icon.className = isPass ? 'fas fa-eye-slash text-warning' : 'fas fa-eye';
    }
}

function quickFillAndLogin(username, password) {
    const uInput = document.getElementById('loginUsername');
    const pInput = document.getElementById('loginPassword');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
    handleLogin(username, password);
}

function updateAuthUI() {
    const authContainer = document.getElementById('navbarAuthSection');
    const roleActionBtnContainer = document.getElementById('roleActionButtons');
    if (!authContainer) return;

    const user = window.TLongPlayer.currentUser;

    // 1. Role-specific Prominent Management Buttons in Navbar
    if (roleActionBtnContainer) {
        if (!user) {
            roleActionBtnContainer.innerHTML = '';
        } else if (user.role === 'Admin' || user.primaryRole === 'Admin') {
            roleActionBtnContainer.innerHTML = `
                <a href="/Admin" class="btn btn-outline-danger fw-bold rounded-pill px-3 py-1 shadow d-flex align-items-center gap-2 text-nowrap flex-shrink-0 text-decoration-none" 
                   style="border-width: 2px; box-shadow: 0 0 15px rgba(255, 19, 74, 0.6); background: rgba(255, 19, 74, 0.15); white-space: nowrap;">
                    <i class="fas fa-shield-halved text-danger"></i>
                    <span class="text-white small text-nowrap">TRUNG TÂM ADMIN</span>
                </a>
            `;
        } else if (user.role === 'Producer' || user.primaryRole === 'Producer') {
            roleActionBtnContainer.innerHTML = `
                <a href="/Producer/Upload" class="btn btn-outline-warning fw-bold rounded-pill px-3 py-1 shadow d-flex align-items-center gap-2 text-nowrap flex-shrink-0 text-decoration-none" 
                   style="border-width: 2px; color: #ffd166; border-color: #ffd166; box-shadow: 0 0 15px rgba(255, 209, 102, 0.6); background: rgba(255, 209, 102, 0.15); white-space: nowrap;">
                    <i class="fas fa-headphones-simple text-warning"></i>
                    <span class="text-white small text-nowrap">STUDIO UPLOAD NHẠC</span>
                </a>
            `;
        } else {
            // Member thông thường tuyệt đối không có 2 nút này
            roleActionBtnContainer.innerHTML = '';
        }
    }

    // Loại bỏ chữ/nút Nâng Cấp VIP ở tài khoản Admin và Producer trên toàn website
    const isStaff = user && (user.role === 'Admin' || user.primaryRole === 'Admin' || user.role === 'Producer' || user.primaryRole === 'Producer' || (user.roles && (user.roles.includes('Admin') || user.roles.includes('Producer'))));
    const navUpgradeVipBtn = document.getElementById('navUpgradeVipBtn');
    const heroUpgradeVipBtn = document.getElementById('heroUpgradeVipBtn');
    if (navUpgradeVipBtn) {
        if (isStaff) {
            navUpgradeVipBtn.style.setProperty('display', 'none', 'important');
        } else {
            navUpgradeVipBtn.style.removeProperty('display');
        }
    }
    if (heroUpgradeVipBtn) {
        if (isStaff) {
            heroUpgradeVipBtn.style.setProperty('display', 'none', 'important');
        } else {
            heroUpgradeVipBtn.style.removeProperty('display');
        }
    }

    // 2. User Profile Dropdown
    if (!user) {
        // GUEST (Chưa đăng nhập)
        authContainer.innerHTML = `
            <button class="btn btn-glass-crystal d-flex align-items-center gap-2 py-2 px-3 rounded-pill text-nowrap flex-shrink-0" data-bs-toggle="modal" data-bs-target="#loginModal">
                <i class="fas fa-arrow-right-to-bracket text-danger"></i>
                <span class="text-nowrap">Đăng Nhập</span>
            </button>
        `;
    } else {
        // LOGGED IN
        let roleBadgeClass = 'badge-standard-red';
        let roleBadgeText = '<i class="fas fa-certificate me-1"></i> STANDARD VIP';
        let avatarBorder = '2px solid #ff134a';
        let avatarShadow = '0 0 10px rgba(255, 19, 74, 0.6)';

        const primaryRole = user.primaryRole || user.role || (user.roles && user.roles.includes('Admin') ? 'Admin' : user.roles && user.roles.includes('Producer') ? 'Producer' : 'Member');

        if (primaryRole === 'Admin') {
            roleBadgeClass = 'badge bg-danger';
            roleBadgeText = '<i class="fas fa-shield-halved me-1"></i> ADMIN';
            avatarBorder = '2px solid #ff134a';
            avatarShadow = '0 0 12px rgba(255, 19, 74, 0.7)';
        } else if (primaryRole === 'Producer') {
            roleBadgeClass = 'badge badge-premium-gold';
            roleBadgeText = '<i class="fas fa-headphones me-1"></i> PRODUCER';
            avatarBorder = '2px solid #ffd166';
            avatarShadow = '0 0 12px rgba(255, 209, 102, 0.7)';
        } else if (user.tier && user.tier.toLowerCase() === 'premium') {
            roleBadgeClass = 'badge badge-premium-gold';
            roleBadgeText = '<i class="fas fa-crown me-1"></i> PREMIUM VIP';
            avatarBorder = '2px solid #ffd166';
            avatarShadow = '0 0 14px rgba(255, 209, 102, 0.8)';
        } else if (user.tier && user.tier.toLowerCase() === 'standard') {
            roleBadgeClass = 'badge badge-standard-red';
            roleBadgeText = '<i class="fas fa-certificate me-1"></i> STANDARD VIP';
            avatarBorder = '2px solid #ff134a';
            avatarShadow = '0 0 12px rgba(255, 19, 74, 0.7)';
        } else {
            roleBadgeClass = 'badge bg-secondary';
            roleBadgeText = 'FREE MEMBER';
            avatarBorder = '1px solid rgba(255, 255, 255, 0.3)';
            avatarShadow = 'none';
        }

        // Hiển thị thông tin Hạn Dùng VIP và Nâng Cấp (Chỉ dành cho Member, Admin & Producer tuyệt đối không hiển thị)
        let tierExpiryText = '';
        if (!isStaff) {
            const userTier = (user.tier || 'free').toLowerCase();
            const isPremium = userTier === 'premium';
            const isStandard = userTier === 'standard';
            const isVip = isPremium || isStandard;

            if (isVip && user.tierExpiresAt) {
                const expDate = new Date(user.tierExpiresAt);
                const now = new Date();
                const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
                const statusBadge = diffDays > 0
                    ? `<span class="text-success fw-bold"><i class="fas fa-clock me-1"></i>Còn ${diffDays} ngày</span> <span class="text-dim" style="font-size: 0.72rem;">(đến ${expDate.toLocaleDateString('vi-VN')})</span>`
                    : `<span class="text-danger fw-bold"><i class="fas fa-circle-exclamation me-1"></i>Đã hết hạn ngày ${expDate.toLocaleDateString('vi-VN')}</span>`;

                let upgradeCta = '';
                if (isStandard) {
                    upgradeCta = `
                        <a href="/Payment/Checkout?package=Premium" class="btn btn-sm btn-shimmer-gold w-100 mt-2 py-1 fw-bold text-dark text-nowrap d-block text-center" style="font-size: 0.72rem;">
                            <i class="fas fa-crown me-1"></i> Nâng Cấp Lên Premium VIP
                        </a>
                    `;
                } else {
                    upgradeCta = `
                        <a href="/Payment/Checkout?package=Premium" class="btn btn-sm btn-outline-warning w-100 mt-2 py-1 fw-bold text-nowrap d-block text-center" style="font-size: 0.72rem;">
                            <i class="fas fa-rotate-right me-1"></i> Gia Hạn Thêm Premium VIP
                        </a>
                    `;
                }

                tierExpiryText = `
                    <div class="mt-2 pt-2 border-top border-secondary border-opacity-25 small font-monospace">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="text-dim">Gói cước:</span>
                            <strong class="${isPremium ? 'text-warning' : 'text-danger'}">${isPremium ? '👑 PREMIUM VIP' : '💎 STANDARD VIP'}</strong>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="text-dim">Hạn dùng:</span>
                            <span>${statusBadge}</span>
                        </div>
                        ${upgradeCta}
                    </div>
                `;
            } else {
                tierExpiryText = `
                    <div class="mt-2 pt-2 border-top border-secondary border-opacity-25 small">
                        <div class="d-flex justify-content-between align-items-center mb-1 font-monospace">
                            <span class="text-dim">Gói cước:</span>
                            <span class="badge bg-secondary">Free Member</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-1 font-monospace text-dim" style="font-size: 0.72rem;">
                            <span>Hạn dùng:</span>
                            <span>Chưa kích hoạt VIP</span>
                        </div>
                        <a href="/Payment/Checkout?package=Standard" class="btn btn-sm btn-shimmer-ruby w-100 mt-1 py-1 fw-bold text-white text-nowrap d-block text-center" style="font-size: 0.72rem;">
                            <i class="fas fa-sparkles me-1"></i> Nâng Cấp VIP Ngay
                        </a>
                    </div>
                `;
            }
        }

        authContainer.innerHTML = `
            <div class="dropdown flex-shrink-0 text-nowrap">
                <button class="btn btn-dark dropdown-toggle d-flex align-items-center gap-2 py-1 px-3 rounded-pill text-nowrap" type="button" data-bs-toggle="dropdown" 
                        style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); backdrop-filter: blur(15px); white-space: nowrap;">
                    <img src="${user.avatarUrl}" alt="Avatar" class="rounded-circle flex-shrink-0" style="width: 28px; height: 28px; object-fit: cover; border: ${avatarBorder}; box-shadow: ${avatarShadow};" />
                    <span class="text-white small font-weight-bold text-nowrap" style="max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block;">${user.fullName}</span>
                    <span class="${roleBadgeClass} text-nowrap" style="font-size: 0.65rem; white-space: nowrap;">${roleBadgeText}</span>
                </button>
                <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end shadow" 
                    style="background: rgba(18, 19, 32, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); backdrop-filter: blur(20px); border-radius: 14px; min-width: 260px;">
                    <li class="px-3 py-2 border-bottom border-secondary border-opacity-25">
                        <small class="text-muted d-block">Tài khoản: <strong class="text-white">${user.username}</strong></small>
                        ${tierExpiryText}
                    </li>
                    ${primaryRole === 'Admin' ? `
                    <li>
                        <a href="/Admin" class="dropdown-item py-2 text-danger fw-bold">
                            <i class="fas fa-shield-halved me-2"></i> Trung Tâm Quản Trị Admin
                        </a>
                    </li>` : ''}
                    ${primaryRole === 'Producer' ? `
                    <li>
                        <a href="/Producer/Upload" class="dropdown-item py-2 text-warning fw-bold">
                            <i class="fas fa-headphones-simple me-2"></i> Studio Producer (Upload)
                        </a>
                    </li>` : ''}
                    <li>
                        <a href="/Profile" class="dropdown-item py-2 text-info fw-bold">
                            <i class="fas fa-id-card me-2"></i> Hồ Sơ & Tài Khoản Ngân Hàng
                        </a>
                    </li>
                    <li>
                        <button class="dropdown-item py-2 text-white" onclick="showFavoritesModal()">
                            <i class="fas fa-heart text-danger me-2"></i> Bài Hát Yêu Thích
                        </button>
                    </li>
                    ${!isStaff ? `
                    <li>
                        <a href="/Payment/Checkout?package=Standard" class="dropdown-item py-2 text-white">
                            <i class="fas fa-gem text-danger me-2"></i> Nâng Cấp Gói VIP
                        </a>
                    </li>` : ''}
                    <li><hr class="dropdown-divider border-secondary border-opacity-25"></li>
                    <li>
                        <button class="dropdown-item py-2 text-danger" onclick="handleLogout()">
                            <i class="fas fa-arrow-right-from-bracket me-2"></i> Đăng Xuất
                        </button>
                    </li>
                </ul>
            </div>
        `;
    }

    // Cập nhật text nút Track Slot & Nonstop Slot và ẩn thông báo Demo cho tài khoản Premium
    const isPremiumUser = user && (
        user.role === 'Admin' || user.primaryRole === 'Admin' ||
        user.role === 'Producer' || user.primaryRole === 'Producer' ||
        (user.roles && (user.roles.includes('Admin') || user.roles.includes('Producer'))) ||
        (user.tier && user.tier.toLowerCase() === 'premium')
    );

    const isVipUser = isPremiumUser || (user && user.tier && user.tier.toLowerCase() === 'standard');

    // Nút Track Nhóm & Nonstop Nhóm: Tài khoản Free hiển thị "Demo track Nhóm"
    const pillTextTrackNhom = document.getElementById('pillTextTrackNhom');
    if (pillTextTrackNhom) {
        pillTextTrackNhom.textContent = isVipUser ? 'Track Nhóm' : 'Demo track Nhóm';
    }
    const homeTabTrackNhomText = document.getElementById('homeTabTrackNhomText');
    if (homeTabTrackNhomText) {
        homeTabTrackNhomText.textContent = isVipUser ? 'Track Nhóm' : 'Demo track Nhóm';
    }
    const pillTextNonstopNhom = document.getElementById('pillTextNonstopNhom');
    if (pillTextNonstopNhom) {
        pillTextNonstopNhom.textContent = isVipUser ? 'Nonstop Nhóm' : 'Demo Nonstop Nhóm';
    }

    const badgeNhomNotice = document.getElementById('badgeNhomNotice');
    if (badgeNhomNotice) {
        badgeNhomNotice.innerHTML = `<i class="fas fa-certificate me-1"></i> ${isVipUser ? 'Đang hiển thị kho Track Nhóm Standard VIP' : 'Đang hiển thị Demo kho Track Nhóm (Cần VIP để tải)'}`;
    }
    const badgeNonstopNhomNotice = document.getElementById('badgeNonstopNhomNotice');
    if (badgeNonstopNhomNotice) {
        badgeNonstopNhomNotice.innerHTML = `<i class="fas fa-certificate me-1"></i> ${isVipUser ? 'Đang hiển thị kho Nonstop Nhóm Standard VIP' : 'Đang hiển thị Demo kho Nonstop Nhóm (Cần VIP để tải)'}`;
    }

    // Nút Track Slot & Nonstop Slot: Tài khoản Premium hiển thị "Track Slot", còn lại hiển thị "Demo track Slot"
    const pillTextTrackSlot = document.getElementById('pillTextTrackSlot');
    if (pillTextTrackSlot) {
        pillTextTrackSlot.textContent = isPremiumUser ? 'Track Slot' : 'Demo track Slot';
    }
    const homeTabTrackSlotText = document.getElementById('homeTabTrackSlotText');
    if (homeTabTrackSlotText) {
        homeTabTrackSlotText.textContent = isPremiumUser ? 'Track Slot' : 'Demo track Slot';
    }
    const pillTextNonstopSlot = document.getElementById('pillTextNonstopSlot');
    if (pillTextNonstopSlot) {
        pillTextNonstopSlot.textContent = isPremiumUser ? 'Nonstop Slot' : 'Demo Nonstop Slot';
    }

    const badgeDemoSlotNotice = document.getElementById('badgeDemoSlotNotice');
    if (badgeDemoSlotNotice) {
        if (isPremiumUser) {
            badgeDemoSlotNotice.classList.add('d-none');
            badgeDemoSlotNotice.style.display = 'none';
        } else {
            badgeDemoSlotNotice.classList.remove('d-none');
            badgeDemoSlotNotice.style.display = '';
        }
    }

    const badgeDemoNonstopSlotNotice = document.getElementById('badgeDemoNonstopSlotNotice');
    if (badgeDemoNonstopSlotNotice) {
        if (isPremiumUser) {
            badgeDemoNonstopSlotNotice.classList.add('d-none');
            badgeDemoNonstopSlotNotice.style.display = 'none';
        } else {
            badgeDemoNonstopSlotNotice.classList.remove('d-none');
            badgeDemoNonstopSlotNotice.style.display = '';
        }
    }

    // 3. Update Pricing Section with User's Active Package & Expiration
    document.querySelectorAll('.plan-active-indicator').forEach(el => {
        el.className = 'plan-active-indicator d-none';
        el.innerHTML = '';
    });
    document.querySelectorAll('[data-plan-tier]').forEach(el => {
        el.style.boxShadow = '';
    });

    if (isStaff) {
        document.querySelectorAll('#pricingSection button').forEach(btn => {
            btn.classList.add('disabled');
            btn.style.opacity = '0.55';
            btn.style.pointerEvents = 'none';
            btn.innerHTML = `<i class="fas fa-shield-check me-2"></i> Tài Khoản Đặc Quyền (${user.primaryRole || user.role})`;
        });
        return;
    }

    if (user && user.tier) {
        const userTierKey = user.tier.toLowerCase();
        const activeBadge = document.getElementById('planActiveBadge-' + userTierKey);
        const activeCard = document.getElementById('pricingCard-' + userTierKey);

        if (activeBadge) {
            activeBadge.classList.remove('d-none');
            if (userTierKey === 'premium') {
                activeBadge.style.background = 'rgba(255, 209, 102, 0.2)';
                activeBadge.style.border = '1px solid #ffd166';
                activeBadge.style.color = '#ffd166';
                activeBadge.innerHTML = `<i class="fas fa-crown me-1"></i> GÓI BẠN ĐANG DÙNG (CAO CẤP NHẤT)` + 
                    (user.tierExpiresAt ? `<div class="font-monospace small text-white">Hạn VIP đến: ${new Date(user.tierExpiresAt).toLocaleDateString('vi-VN')}</div>` : '');
                if (activeCard) activeCard.style.boxShadow = '0 0 35px rgba(255, 209, 102, 0.7)';
            } else if (userTierKey === 'standard') {
                activeBadge.style.background = 'rgba(255, 19, 74, 0.2)';
                activeBadge.style.border = '1px solid #ff134a';
                activeBadge.style.color = '#ff6b8b';
                activeBadge.innerHTML = `<i class="fas fa-certificate text-danger me-1"></i> GÓI BẠN ĐANG DÙNG (ĐỎ RUBY)` + 
                    (user.tierExpiresAt ? `<div class="font-monospace small text-white">Hạn VIP đến: ${new Date(user.tierExpiresAt).toLocaleDateString('vi-VN')}</div>` : '');
                if (activeCard) activeCard.style.boxShadow = '0 0 35px rgba(255, 19, 74, 0.7)';
            } else {
                activeBadge.style.background = 'rgba(255, 255, 255, 0.1)';
                activeBadge.style.border = '1px solid rgba(255, 255, 255, 0.3)';
                activeBadge.style.color = '#ffffff';
                activeBadge.innerHTML = `<i class="fas fa-user text-muted me-1"></i> GÓI MIỄN PHÍ HIỆN TẠI`;
            }
        }
    }
}

async function showFavoritesModal() {
    try {
        const res = await fetch('/Music/Favorites');
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToastNotification("⚠️ " + (data.message || "Không thể tải danh sách yêu thích!"));
            return;
        }

        if (!data.data || data.data.length === 0) {
            showVipModal(`
                <div class="text-center py-4">
                    <i class="far fa-heart text-dim fa-3x mb-3"></i>
                    <h5 class="text-white font-weight-bold">Chưa có bài hát yêu thích</h5>
                    <p class="text-muted small">Hãy bấm nút trái tim ❤️ ở bất kỳ bài hát nào để lưu vào đây nhé!</p>
                </div>
            `);
            return;
        }

        let rowsHtml = data.data.map((m, idx) => `
            <div class="d-flex align-items-center justify-content-between p-2 mb-2 rounded border border-secondary border-opacity-25" style="background: rgba(255,255,255,0.03);">
                <div class="d-flex align-items-center gap-3" style="min-width: 0;">
                    <span class="text-dim small font-monospace">${idx + 1}</span>
                    <img src="${m.coverUrl || '/images/logo.png'}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover;" />
                    <div class="text-truncate">
                        <strong class="text-white d-block text-truncate" style="font-size: 0.9rem;">${m.title}</strong>
                        <small class="text-dim">${m.artist} • ${m.bpm} BPM • ${m.musicalKey}</small>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <button class="btn btn-sm btn-shimmer-ruby px-2 py-1" onclick="handleDownload('${m.musicId}', '${m.title.replace(/'/g, "\\'")}', '${m.category}')" title="Tải về">
                        <i class="fas fa-arrow-down-to-bracket"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger px-2 py-1" onclick="toggleFavorite('${m.musicId}', null); showFavoritesModal();" title="Bỏ yêu thích">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        showVipModal(`
            <div class="p-2">
                <h5 class="text-white font-weight-bold mb-3 d-flex align-items-center gap-2">
                    <i class="fas fa-heart text-danger"></i> BÀI HÁT YÊU THÍCH CỦA BẠN (${data.data.length})
                </h5>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${rowsHtml}
                </div>
            </div>
        `);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Không thể kết nối lấy bài hát yêu thích!");
    }
}

function initPlayerEvents() {
    const audio = window.TLongPlayer.audio;

    // Accurately capture audio duration as soon as metadata is loaded
    audio.addEventListener('loadedmetadata', () => {
        const durationElem = document.getElementById('playerDuration');
        const dur = audio.duration;
        if (durationElem && dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
            durationElem.textContent = formatTime(dur);
        }
    });

    audio.addEventListener('timeupdate', () => {
        const currentTime = audio.currentTime || 0;
        const dur = audio.duration;
        const duration = (dur && !isNaN(dur) && isFinite(dur) && dur > 0)
            ? dur
            : (window.TLongPlayer.currentTrack ? window.TLongPlayer.currentTrack.durationSeconds : 0);

        const seekSlider = document.getElementById('playerSeekSlider');
        const currentTimeElem = document.getElementById('playerCurrentTime');
        const durationElem = document.getElementById('playerDuration');

        if (seekSlider && !seekSlider.dataset.dragging && duration > 0) {
            seekSlider.value = (currentTime / duration) * 100 || 0;
            updateSeekSliderProgress(seekSlider);
        }

        if (currentTimeElem && (!seekSlider || !seekSlider.dataset.dragging)) {
            currentTimeElem.textContent = formatTime(currentTime);
        }
        if (durationElem && duration > 0) {
            durationElem.textContent = formatTime(duration);
        }

        // Demo limit enforcement for Standard / Free / Guest on Slot VIP tracks
        const currentTrack = window.TLongPlayer.currentTrack;
        if (currentTrack && isDemoPlayback(currentTrack)) {
            const limit = currentTrack.demoLimit || 30;
            if (currentTime >= limit) {
                pauseTrack();
                audio.currentTime = 0;
                const currentTimeElem = document.getElementById('playerCurrentTime');
                if (currentTimeElem) currentTimeElem.textContent = '0:00';
                const seekSlider = document.getElementById('playerSeekSlider');
                if (seekSlider) seekSlider.value = 0;
                showDemoLimitModal();
            }
        }
    });

    audio.addEventListener('ended', () => {
        playNextTrack();
    });

    audio.addEventListener('error', () => {
        startBeatSynthesizer();
    });

    // Seeking Controller (Supports smooth dragging, instant clicking & demo boundary clamping)
    const seekSlider = document.getElementById('playerSeekSlider');
    if (seekSlider) {
        seekSlider.addEventListener('input', (e) => {
            seekSlider.dataset.dragging = 'true';
            updateSeekSliderProgress(seekSlider);
            const dur = audio.duration;
            const duration = (dur && !isNaN(dur) && isFinite(dur) && dur > 0)
                ? dur
                : (window.TLongPlayer.currentTrack ? window.TLongPlayer.currentTrack.durationSeconds : 0);

            if (duration > 0) {
                let targetTime = (parseFloat(e.target.value) / 100) * duration;
                const currentTrack = window.TLongPlayer.currentTrack;
                if (currentTrack && isDemoPlayback(currentTrack)) {
                    const limit = currentTrack.demoLimit || 30;
                    if (targetTime > limit) {
                        targetTime = limit;
                        e.target.value = (limit / duration) * 100;
                        updateSeekSliderProgress(seekSlider);
                    }
                }
                const currentTimeElem = document.getElementById('playerCurrentTime');
                if (currentTimeElem) currentTimeElem.textContent = formatTime(targetTime);
            }
        });

        seekSlider.addEventListener('change', (e) => {
            const dur = audio.duration;
            const duration = (dur && !isNaN(dur) && isFinite(dur) && dur > 0)
                ? dur
                : (window.TLongPlayer.currentTrack ? window.TLongPlayer.currentTrack.durationSeconds : 0);

            if (duration > 0) {
                let targetTime = (parseFloat(e.target.value) / 100) * duration;
                const currentTrack = window.TLongPlayer.currentTrack;
                if (currentTrack && isDemoPlayback(currentTrack)) {
                    const limit = currentTrack.demoLimit || 30;
                    if (targetTime >= limit) {
                        targetTime = 0;
                        audio.currentTime = 0;
                        pauseTrack();
                        const currentTimeElem = document.getElementById('playerCurrentTime');
                        if (currentTimeElem) currentTimeElem.textContent = '0:00';
                        e.target.value = 0;
                        showDemoLimitModal();
                        setTimeout(() => { seekSlider.dataset.dragging = ''; }, 80);
                        return;
                    }
                }
                if (!isNaN(targetTime) && isFinite(targetTime) && targetTime >= 0) {
                    try {
                        audio.currentTime = Math.min(targetTime, duration);
                    } catch (err) {
                        console.warn("Seek error:", err);
                    }
                }
            }
            setTimeout(() => {
                seekSlider.dataset.dragging = '';
            }, 80);
        });
    }

    const volumeSlider = document.getElementById('playerVolumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            audio.volume = e.target.value / 100;
            const volumeIcon = document.getElementById('volumeIcon');
            if (volumeIcon) {
                if (e.target.value == 0) volumeIcon.className = 'fas fa-volume-mute';
                else if (e.target.value < 50) volumeIcon.className = 'fas fa-volume-down';
                else volumeIcon.className = 'fas fa-volume-up';
            }
        });
    }
}

// Kiểm tra xem bài hát có phải chạy chế độ DEMO với người dùng hiện tại hay không
function isDemoPlayback(track) {
    if (!track) return false;

    const user = window.TLongPlayer.currentUser;
    const tier = (window.TLongPlayer.userTier || 'free').toLowerCase();

    // 1. Admin & Producer luôn có toàn quyền nghe Full mọi bài
    if (user) {
        const roles = user.roles || (user.primaryRole ? [user.primaryRole] : []);
        if (roles.includes('Admin') || roles.includes('Producer') || user.primaryRole === 'Admin' || user.primaryRole === 'Producer') {
            return false;
        }
    }

    // 2. Hội viên Premium VIP có toàn quyền nghe Full mọi bài (kể cả Slot VIP)
    if (tier === 'premium') {
        return false;
    }

    // 3. Nhận diện bài hát thuộc nhóm Slot VIP:
    // - Yêu cầu gói Premium (tierRequired === 'Premium')
    // - categoryCode là TrackSlot hoặc NonstopSlot
    // - Hoặc bài có chứa tag Slot / Dubplate
    const isSlot = (track.tierRequired && track.tierRequired.toLowerCase() === 'premium') ||
                   (track.categoryCode && track.categoryCode.toLowerCase().includes('slot')) ||
                   (track.title && (track.title.toLowerCase().includes('slot') || track.title.includes('DUBPLATE') || track.title.includes('BẢN ĐẶT')));

    // 4. Tài khoản Standard VIP:
    // - Nhạc Slot VIP: BẮT BUỘC CHỈ ĐƯỢC NGHE DEMO (30 GIÂY), KHÔNG ĐƯỢC NGHE FULL!
    // - Nhạc Nhóm & Lọt: Nghe Full trọn vẹn
    if (tier === 'standard') {
        return isSlot || (track.isDemo && track.tierRequired && track.tierRequired.toLowerCase() === 'premium');
    }

    // 5. Tài khoản Free / Khách vãng lai:
    // - Nhạc Slot VIP: Chỉ được nghe Demo (30s)
    // - Bất kỳ bài nào đánh dấu isDemo: Chỉ được nghe Demo
    return isSlot || track.isDemo === true;
}

function showDemoLimitModal() {
    const track = window.TLongPlayer.currentTrack;
    const tier = (window.TLongPlayer.userTier || 'free').toLowerCase();
    const isStandard = tier === 'standard';

    const modalElem = document.getElementById('vipUpgradeModal');
    if (!modalElem) return;

    // Tránh mở trùng lặp nếu modal đang hiển thị
    if (window.TLongPlayer._isDemoModalShowing || modalElem.classList.contains('show')) {
        return;
    }
    window.TLongPlayer._isDemoModalShowing = true;

    showVipModal(`
        <div class="text-center py-4 px-2">
            <div class="mb-3 d-inline-flex p-3 rounded-circle" style="background: rgba(255, 209, 102, 0.15); border: 1px solid rgba(255, 209, 102, 0.4); box-shadow: 0 0 25px rgba(255, 209, 102, 0.3);">
                <i class="fas fa-crown text-warning fa-2x"></i>
            </div>
            <h4 class="text-white font-weight-bold mb-2">Hết Thời Gian Demo 30 Giây</h4>
            <div class="badge bg-warning text-dark px-3 py-1 rounded-pill fw-bold mb-3"><i class="fas fa-lock me-1"></i> KHO NHẠC SLOT ĐẶT ĐỘC QUYỀN</div>
            <p class="text-light small mb-2" style="line-height: 1.6;">
                ${isStandard 
                    ? `Bạn đang dùng tài khoản <strong>Standard VIP</strong>. Theo quy định, gói Standard chỉ được nghe thử demo <strong>30 giây</strong> đối với kho <strong>Track Slot & Nonstop Đặt</strong>.`
                    : `Bạn đang ở tài khoản <strong>Free / Khách</strong> chỉ được nghe thử demo <strong>30 giây</strong> đối với kho <strong>Track Slot VIP</strong>.`
                }
            </p>
            <p class="text-muted small">
                Để mở khóa quyền <strong>nghe trọn vẹn 100% bản Master</strong> và <strong>tải file Lossless WAV 24-Bit phòng thu</strong>, vui lòng nâng cấp lên gói <strong>Premium VIP</strong>!
            </p>
            <div class="mt-4 d-flex justify-content-center gap-2">
                <button class="btn btn-shimmer-gold px-4 py-2 fw-bold" onclick="openCheckoutModal('Premium Master', 199000)" data-bs-dismiss="modal">
                    <i class="fas fa-crown me-2"></i> Lên Premium VIP Ngay (199K)
                </button>
                <button type="button" class="btn btn-outline-secondary px-4 py-2 rounded-pill fw-bold" data-bs-dismiss="modal" onclick="closeDemoLimitModal()">
                    <i class="fas fa-arrow-left me-1"></i> Đóng & Quay Lại
                </button>
            </div>
        </div>
    `);
}

function closeDemoLimitModal() {
    const modalElem = document.getElementById('vipUpgradeModal');
    if (modalElem) {
        const modal = bootstrap.Modal.getInstance(modalElem);
        if (modal) {
            modal.hide();
        }
    }
    window.TLongPlayer._isDemoModalShowing = false;
    // Dọn sạch mọi backdrop thừa và phục hồi thanh cuộn màn hình ngay lập tức
    setTimeout(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
    }, 150);
}

function updateDemoBadge() {
    const demoBadge = document.getElementById('playerDemoBadge');
    if (!demoBadge) return;
    const currentTrack = window.TLongPlayer.currentTrack;
    if (currentTrack && isDemoPlayback(currentTrack)) {
        demoBadge.classList.remove('d-none');
        demoBadge.textContent = `DEMO ${currentTrack.demoLimit || 30}S`;
        demoBadge.style.background = 'linear-gradient(135deg, #ffd166, #ff9f1c)';
        demoBadge.style.color = '#000';
    } else {
        demoBadge.classList.add('d-none');
    }
}

function playTrack(trackData) {
    if (!trackData) return;
    window.TLongPlayer.currentTrack = trackData;
    const audio = window.TLongPlayer.audio;

    if (trackData.id) {
        fetch('/Music/Play/' + trackData.id)
            .then(res => res.json())
            .then(apiData => {
                if (apiData && apiData.success) {
                    if (window.TLongPlayer.currentTrack && window.TLongPlayer.currentTrack.id === trackData.id) {
                        window.TLongPlayer.currentTrack.isDemo = apiData.isDemo;
                        window.TLongPlayer.currentTrack.demoLimit = apiData.demoLimit || 30;
                        if (apiData.categoryCode) window.TLongPlayer.currentTrack.categoryCode = apiData.categoryCode;
                        if (apiData.tierRequired) window.TLongPlayer.currentTrack.tierRequired = apiData.tierRequired;
                        updateDemoBadge();
                    }
                }
            })
            .catch(e => console.warn(e));
    }

    stopBeatSynthesizer();

    document.getElementById('playerTrackTitle').textContent = trackData.title;
    document.getElementById('playerTrackArtist').textContent = trackData.artist;
    document.getElementById('playerTrackCover').src = trackData.coverUrl || '/images/logo.png';
    document.getElementById('playerTrackBpm').textContent = `${trackData.bpm || 140} BPM`;
    const rawQ = (trackData.quality || '').toUpperCase();
    const isWavQ = rawQ.includes('WAV') || rawQ.includes('MASTER') || rawQ.includes('LOSSLESS') || rawQ.includes('FLAC');
    const cleanPlayerQuality = isWavQ ? 'WAV' : 'MP3';
    const qualityElem = document.getElementById('playerTrackQuality');
    if (qualityElem) {
        qualityElem.textContent = cleanPlayerQuality;
        qualityElem.className = isWavQ
            ? 'badge-premium-gold d-none d-lg-inline-block font-monospace fw-bold'
            : 'badge-standard-red d-none d-lg-inline-block font-monospace fw-bold';
    }

    const durationElem = document.getElementById('playerDuration');
    const currentTimeElem = document.getElementById('playerCurrentTime');
    const seekSlider = document.getElementById('playerSeekSlider');

    if (durationElem && trackData.durationSeconds) {
        durationElem.textContent = formatTime(trackData.durationSeconds);
    }
    if (currentTimeElem) currentTimeElem.textContent = '0:00';
    if (seekSlider) seekSlider.value = 0;

    updateDemoBadge();

    // ĐỔI MÀU CON TRỎ VÀ HIỆU ỨNG KHI PHÁT BÀI: SLOT = VÀNG, NHÓM = ĐỎ, LỌT = KHÔNG NỀN
    let trackKind = (trackData.trackType || '').toLowerCase();
    if (!trackKind) {
        const catCode = (trackData.categoryCode || '').toLowerCase();
        const tierReq = (trackData.tierRequired || '').toLowerCase();
        const titleLower = (trackData.title || '').toLowerCase();
        if (catCode.includes('slot') || tierReq.includes('premium') || titleLower.includes('slot') || titleLower.includes('dubplate')) {
            trackKind = 'slot';
        } else if (catCode.includes('nhom') || tierReq.includes('standard')) {
            trackKind = 'nhom';
        } else {
            trackKind = 'lot';
        }
    }

    document.body.classList.remove('playing-slot', 'playing-nhom', 'playing-lot');
    if (trackKind === 'slot') {
        document.body.classList.add('playing-slot');
    } else if (trackKind === 'nhom') {
        document.body.classList.add('playing-nhom');
    } else {
        document.body.classList.add('playing-lot');
    }

    if (seekSlider) {
        updateSeekSliderProgress(seekSlider);
    }
    document.querySelectorAll('.crystal-table-row').forEach(row => {
        row.classList.remove('active-track');
        const playBtn = row.querySelector('.track-play-inline-btn i');
        if (playBtn) playBtn.className = 'fas fa-play';
    });

    const activeRow = document.querySelector(`[data-track-id="${trackData.id}"]`);
    if (activeRow) {
        activeRow.classList.add('active-track');
        const playBtn = activeRow.querySelector('.track-play-inline-btn i');
        if (playBtn) playBtn.className = 'fas fa-pause';
    }

    // Play direct studio audio file via HTML5 Audio element
    if (trackData.audioUrl) {
        audio.src = trackData.audioUrl;
        audio.play().then(() => {
            window.TLongPlayer.isPlaying = true;
            updatePlayPauseButton();
        }).catch((err) => {
            console.warn("Direct audio play note:", err);
            startBeatSynthesizer();
            window.TLongPlayer.isPlaying = true;
            updatePlayPauseButton();
        });
    } else {
        startBeatSynthesizer();
        window.TLongPlayer.isPlaying = true;
        updatePlayPauseButton();
    }
}

function togglePlayPause() {
    if (!window.TLongPlayer.currentTrack) {
        const firstPlayBtn = document.querySelector('.btn-play-trigger');
        if (firstPlayBtn) firstPlayBtn.click();
        return;
    }

    if (window.TLongPlayer.isPlaying) {
        pauseTrack();
    } else {
        resumeTrack();
    }
}

function resumeTrack() {
    window.TLongPlayer.isPlaying = true;
    if (window.TLongPlayer.isSynthesizing) {
        startBeatSynthesizer();
    } else {
        window.TLongPlayer.audio.play();
    }
    updatePlayPauseButton();
}

function pauseTrack() {
    window.TLongPlayer.isPlaying = false;
    window.TLongPlayer.audio.pause();
    stopBeatSynthesizer();
    updatePlayPauseButton();
}

function updatePlayPauseButton() {
    const mainBtn = document.getElementById('playerPlayPauseBtn');
    if (mainBtn) {
        mainBtn.innerHTML = window.TLongPlayer.isPlaying 
            ? '<i class="fas fa-pause"></i>' 
            : '<i class="fas fa-play" style="margin-left: 3px;"></i>';
    }

    if (window.TLongPlayer.currentTrack) {
        const activeRow = document.querySelector(`[data-track-id="${window.TLongPlayer.currentTrack.id}"]`);
        if (activeRow) {
            const playBtn = activeRow.querySelector('.track-play-inline-btn i');
            if (playBtn) {
                playBtn.className = window.TLongPlayer.isPlaying ? 'fas fa-pause' : 'fas fa-play';
            }
        }
    }
}

function playNextTrack() {
    showToastNotification("✨ Đang chuyển bài tiếp theo...");
}

function playPrevTrack() {
    showToastNotification("✨ Quay lại bài trước...");
}

// Download action with Server-Side Enforcement (SRS BR-08, BR-01, FR-DL-01..06)
async function handleDownload(trackId, title, requiredTier) {
    try {
        const res = await fetch('/Music/Download/' + trackId);
        const data = await res.json();

        // 401: Guest strictly forbidden from downloading
        if (res.status === 401) {
            showVipModal(`
                <div class="text-center py-4 px-2">
                    <i class="fas fa-user-lock text-danger fa-3x mb-3"></i>
                    <h4 class="text-white font-weight-bold mb-2">NGHIÊM CẤM TẢI VỀ KHI CHƯA ĐĂNG NHẬP</h4>
                    <p class="text-muted small">${data.message || 'Theo quy định của TLongMusic, khách vãng lai chỉ được nghe trực tuyến.'}</p>
                    <div class="mt-4 d-flex justify-content-center gap-3">
                        <button class="btn btn-shimmer-ruby px-4 py-2" data-bs-dismiss="modal" data-bs-toggle="modal" data-bs-target="#loginModal">
                            <i class="fas fa-arrow-right-to-bracket me-2"></i> Đăng Nhập Ngay
                        </button>
                    </div>
                </div>
            `);
            return;
        }

        // 403: Tier Upgrade required
        if (res.status === 403) {
            const isPremiumNeeded = data.requiredTier === 'Premium';
            showVipModal(`
                <div class="text-center py-4 px-2">
                    <div class="mb-3 d-inline-flex p-3 rounded-circle" style="background: ${isPremiumNeeded ? 'rgba(255, 209, 102, 0.15)' : 'rgba(255, 19, 74, 0.15)'}; border: 1px solid ${isPremiumNeeded ? 'rgba(255, 209, 102, 0.4)' : 'rgba(255, 19, 74, 0.4)'};">
                        <i class="${isPremiumNeeded ? 'fas fa-crown text-warning' : 'fas fa-gem text-danger'} fa-2x"></i>
                    </div>
                    <h4 class="text-white font-weight-bold mb-2">BÀI NHẠC YÊU CẦU GÓI ${data.requiredTier.toUpperCase()} VIP</h4>
                    <p class="text-muted small">${data.message}</p>
                    <div class="mt-4">
                        <button class="${isPremiumNeeded ? 'btn-shimmer-gold' : 'btn-shimmer-ruby'} px-4 py-2" onclick="openCheckoutModal('${data.requiredTier} VIP', ${isPremiumNeeded ? 199000 : 99000})" data-bs-dismiss="modal">
                            <i class="fas fa-crown me-2"></i> Nâng Cấp ${data.requiredTier} VIP
                        </button>
                    </div>
                </div>
            `);
            return;
        }

        if (res.ok && data.success) {
            const qualityBadge = data.quality ? `<span class="badge bg-danger ms-1">${data.quality}</span>` : '';
            showToastNotification(`✨ Xác thực (${data.tier || 'VIP'} ${qualityBadge}) thành công! Đang tải file chuẩn chất lượng cao <strong>${title}</strong>...`);
            
            setTimeout(() => {
                // Trigger direct physical file download
                const downloadUrl = data.downloadUrl || `/Music/DownloadFile/${trackId}`;
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.setAttribute('download', data.fileName || `${title.replace(/\s+/g, '_')}_TLongMusic.mp3`);
                document.body.appendChild(link);
                link.click();
                setTimeout(() => {
                    if (link.parentNode) link.parentNode.removeChild(link);
                }, 1000);
            }, 300);
            return;
        }

        showToastNotification("⚠️ " + (data.message || "Không thể tải bài hát lúc này!"));
    } catch (err) {
        console.error("Download fetch error:", err);
        showToastNotification("❌ Lỗi kết nối khi gửi yêu cầu tải!");
    }
}

// VietQR Checkout - Chuyển sang Trang Thanh Toán Chuyên Biệt
function openCheckoutModal(planName, price) {
    const pkgId = (planName && planName.toLowerCase().includes('premium')) ? 'Premium' : 'Standard';
    
    // Check if user is logged in
    if (!window.TLongPlayer || !window.TLongPlayer.currentUser) {
        showToastNotification("Vui lòng đăng nhập trước khi gia hạn / mua gói!");
        const loginModalEl = document.getElementById('loginModal');
        if (loginModalEl) {
            const loginModal = new bootstrap.Modal(loginModalEl);
            loginModal.show();
        }
        return;
    }

    // Điều hướng trực tiếp sang Trang Thanh Toán Riêng Biệt (VietQR động + Tự động kích hoạt)
    window.location.href = `/Payment/Checkout?package=${encodeURIComponent(pkgId)}`;
}

async function confirmOrderPayment(orderCode, planName) {
    try {
        const res = await fetch('/Payment/ConfirmPayment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderCode: orderCode })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            if (window.TLongPlayer.currentUser) {
                window.TLongPlayer.currentUser.tier = data.tier;
                window.TLongPlayer.userTier = data.tier.toLowerCase();
                localStorage.setItem('tlong_current_user', JSON.stringify(window.TLongPlayer.currentUser));
                updateAuthUI();
                updateTierUI();
            }
            showToastNotification(`🎉 ${data.message}`);
            return;
        }

        showToastNotification("❌ " + (data.message || "Xác nhận thanh toán không thành công!"));
    } catch (err) {
        console.error("ConfirmPayment error:", err);
    }
}

function openUserProfileModal() {
    const user = window.TLongPlayer.currentUser;
    if (!user) {
        showToastNotification("⚠️ Vui lòng đăng nhập trước!");
        return;
    }

    const usernameEl = document.getElementById('profileUsername');
    const fullNameEl = document.getElementById('profileFullName');
    const emailEl = document.getElementById('profileEmail');
    const phoneEl = document.getElementById('profilePhone');
    const avatarUrlEl = document.getElementById('profileAvatarUrl');
    const avatarPreviewEl = document.getElementById('profileAvatarPreview');
    const bankNameEl = document.getElementById('profileBankName');
    const bankAccNoEl = document.getElementById('profileBankAccountNumber');
    const bankAccHolderEl = document.getElementById('profileBankAccountHolder');
    const oldPassEl = document.getElementById('profileOldPassword');
    const newPassEl = document.getElementById('profileNewPassword');

    if (usernameEl) usernameEl.value = user.username || '';
    if (fullNameEl) fullNameEl.value = user.fullName || '';
    if (emailEl) emailEl.value = user.email || '';
    if (phoneEl) phoneEl.value = user.phoneNumber || '';
    if (avatarUrlEl) avatarUrlEl.value = user.avatarUrl || '';
    if (avatarPreviewEl) avatarPreviewEl.src = user.avatarUrl || '/images/logo.png';
    const avatarFileInput = document.getElementById('profileAvatarFile');
    if (avatarFileInput) avatarFileInput.value = '';
    if (bankNameEl) bankNameEl.value = user.bankName || '';
    if (bankAccNoEl) bankAccNoEl.value = user.bankAccountNumber || '';
    if (bankAccHolderEl) bankAccHolderEl.value = user.bankAccountHolder || '';
    if (oldPassEl) oldPassEl.value = '';
    if (newPassEl) newPassEl.value = '';

    const modal = new bootstrap.Modal(document.getElementById('userProfileModal'));
    modal.show();
}

function previewModalAvatarFile(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('profileAvatarPreview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function submitUpdateProfile(form) {
    const user = window.TLongPlayer.currentUser;
    if (!user) return;

    const newPass = form.newPassword && form.newPassword.value ? form.newPassword.value : null;
    if (newPass && newPass.length < 6) {
        showToastNotification("⚠️ Mật khẩu mới phải có ít nhất 6 ký tự!");
        return;
    }

    const formData = new FormData();
    formData.append('fullName', form.fullName.value.trim());
    formData.append('email', form.email.value.trim());
    if (form.phoneNumber && form.phoneNumber.value) formData.append('phoneNumber', form.phoneNumber.value.trim());
    if (form.bankName && form.bankName.value) formData.append('bankName', form.bankName.value.trim());
    if (form.bankAccountNumber && form.bankAccountNumber.value) formData.append('bankAccountNumber', form.bankAccountNumber.value.trim());
    if (form.bankAccountHolder && form.bankAccountHolder.value) formData.append('bankAccountHolder', form.bankAccountHolder.value.trim().toUpperCase());
    if (form.oldPassword && form.oldPassword.value) formData.append('oldPassword', form.oldPassword.value);
    if (newPass) formData.append('newPassword', newPass);

    if (form.avatarFile && form.avatarFile.files && form.avatarFile.files[0]) {
        formData.append('avatarFile', form.avatarFile.files[0]);
    }

    try {
        const res = await fetch('/Auth/UpdateProfile', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (res.ok && data.success) {
            window.TLongPlayer.currentUser = data.user;
            localStorage.setItem('tlong_current_user', JSON.stringify(data.user));
            updateAuthUI();
            updateTierUI();

            const modalInstance = bootstrap.Modal.getInstance(document.getElementById('userProfileModal'));
            if (modalInstance) modalInstance.hide();

            showToastNotification(`🎉 ${data.message}`);
            return;
        }

        showToastNotification(`❌ ${data.message || 'Cập nhật thất bại!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi cập nhật hồ sơ!");
    }
}

function openAdminCreateProducerModal() {
    const modalEl = document.getElementById('adminCreateProducerModal');
    if (modalEl) {
        if (modalEl.parentElement !== document.body) {
            document.body.appendChild(modalEl);
        }
        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    }
    const form = document.getElementById('adminCreateProducerForm');
    if (form) form.reset();
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

function showAdminModal() {
    openAdminCreateProducerModal();
}

async function submitAdminCreateProducerForm(form) {
    const payload = {
        stageName: form.stageName.value.trim(),
        fullName: form.fullName.value.trim(),
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value ? form.password.value.trim() : "123456",
        phoneNumber: form.phoneNumber ? form.phoneNumber.value.trim() : null,
        zaloContact: form.phoneNumber ? form.phoneNumber.value.trim() : null,
        bankName: form.bankName ? form.bankName.value.trim() : null,
        bankAccountNumber: form.bankAccountNumber ? form.bankAccountNumber.value.trim() : null,
        bankAccountHolder: form.bankAccountHolder && form.bankAccountHolder.value ? form.bankAccountHolder.value.trim().toUpperCase() : form.fullName.value.trim().toUpperCase(),
        bio: form.bio ? form.bio.value.trim() : null
    };

    try {
        const res = await fetch('/Admin/CreateProducer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.success) {
            const modalInstance = bootstrap.Modal.getInstance(document.getElementById('adminCreateProducerModal'));
            if (modalInstance) modalInstance.hide();

            showToastNotification(data.message);
            loadAdminProducers();
            loadAdminStats();
            return;
        }

        showToastNotification(`❌ ${data.message || 'Cấp tài khoản thất bại!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối máy chủ!");
    }
}

function showProducerUploadModal() {
    const modalEl = document.getElementById('producerUploadModal');
    if (!modalEl) return;

    // Prefill Artist
    const artistInput = document.getElementById('uploadArtistInput');
    if (artistInput && window.TLongPlayer.currentUser) {
        artistInput.value = window.TLongPlayer.currentUser.fullName || window.TLongPlayer.currentUser.username || 'DJ TLong';
    }

    // Reset drag drop listeners
    initAudioDropZone();

    const uploadModal = new bootstrap.Modal(modalEl);
    uploadModal.show();
}

function switchUploadMode(mode) {
    const typeInput = document.getElementById('uploadSourceType');
    const qualitySelect = document.getElementById('uploadQualitySelect');
    if (typeInput) typeInput.value = 'DirectFile';
    if (qualitySelect) qualitySelect.value = 'MP3 320kbps';
}

window.producerSelectedAudioFile = null;

// ==========================================
// DJ AUDIO INTELLIGENCE: AUTO BPM & KEY DETECTOR
// ==========================================
async function analyzeAudioFile(file) {
    const statusBox = document.getElementById('audioAnalysisStatus');
    const badge = document.getElementById('analysisBadge');
    const bpmBadge = document.getElementById('detectedBpmBadge');
    const keyBadge = document.getElementById('detectedKeyBadge');
    const durationBadge = document.getElementById('detectedDurationBadge');
    const bpmInput = document.getElementById('uploadBpmInput');
    const keyInput = document.getElementById('uploadMusicalKeyInput');
    const durationInput = document.getElementById('uploadDurationInput');

    if (statusBox) statusBox.classList.remove('d-none');
    if (badge) {
        badge.className = 'badge badge-shimmer-gold';
        badge.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Đang phân tích BPM & Tone Key...';
    }

    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const duration = Math.round(audioBuffer.duration);
        if (durationInput) durationInput.value = duration;
        if (durationBadge) durationBadge.textContent = `Thời lượng: ${formatTime(duration)}`;

        // Detect BPM
        const detectedBpm = detectBpmFromBuffer(audioBuffer);
        if (bpmInput) bpmInput.value = detectedBpm;
        if (bpmBadge) bpmBadge.textContent = `${detectedBpm} BPM`;

        // Detect Musical Key (Camelot Wheel)
        const keyInfo = detectKeyFromBuffer(audioBuffer);
        if (keyInput) keyInput.value = keyInfo.camelot;
        if (keyBadge) keyBadge.textContent = `Key ${keyInfo.camelot} (${keyInfo.name})`;

        if (badge) {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="fas fa-check-circle me-1"></i> Đã Nhận Diện Thành Công!';
        }

        try { audioCtx.close(); } catch(e){}
    } catch (err) {
        console.warn("Audio analysis fallback:", err);
        if (bpmInput && !bpmInput.value) bpmInput.value = 140;
        if (keyInput && !keyInput.value) keyInput.value = "8A";
        if (badge) {
            badge.className = 'badge bg-secondary';
            badge.innerHTML = '<i class="fas fa-music me-1"></i> Mặc định: 140 BPM • Key 8A';
        }
    }
}

function detectBpmFromBuffer(audioBuffer) {
    try {
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        
        // Analyze representative section (10s to 40s)
        const startSec = audioBuffer.duration > 20 ? 10 : 0;
        const lengthSec = Math.min(30, audioBuffer.duration - startSec);
        const startSample = Math.floor(startSec * sampleRate);
        const numSamples = Math.floor(lengthSec * sampleRate);
        
        // 10ms energy windows
        const blockSize = Math.floor(sampleRate / 100);
        const numBlocks = Math.floor(numSamples / blockSize);
        const energies = new Float32Array(numBlocks);
        
        let avgEnergy = 0;
        for (let i = 0; i < numBlocks; i++) {
            let sum = 0;
            const offset = startSample + i * blockSize;
            for (let j = 0; j < blockSize; j += 4) {
                const val = channelData[offset + j] || 0;
                sum += val * val;
            }
            energies[i] = sum / (blockSize / 4);
            avgEnergy += energies[i];
        }
        avgEnergy /= numBlocks;
        
        const threshold = avgEnergy * 1.3;
        const peaks = [];
        for (let i = 2; i < numBlocks - 2; i++) {
            if (energies[i] > threshold && 
                energies[i] > energies[i - 1] && 
                energies[i] > energies[i - 2] && 
                energies[i] > energies[i + 1] && 
                energies[i] > energies[i + 2]) {
                peaks.push(i);
            }
        }
        
        const intervals = {};
        for (let i = 0; i < peaks.length; i++) {
            for (let j = 1; j <= 5 && (i + j) < peaks.length; j++) {
                const diff = peaks[i + j] - peaks[i];
                const interval = Math.round(diff / j);
                if (interval >= 20 && interval <= 80) {
                    intervals[interval] = (intervals[interval] || 0) + (6 - j);
                }
            }
        }
        
        let maxWeight = 0;
        let bestInterval = 43; // default ~140 BPM
        for (const itv in intervals) {
            if (intervals[itv] > maxWeight) {
                maxWeight = intervals[itv];
                bestInterval = parseInt(itv);
            }
        }
        
        let bpm = Math.round((60 * 100) / bestInterval);
        
        // Normalize into DJ Vinahouse / Club standard (128 - 150 BPM)
        while (bpm < 125) bpm *= 2;
        while (bpm > 160) bpm = Math.round(bpm / 2);
        if (bpm < 125 || bpm > 160) bpm = 140;
        return bpm;
    } catch(e) {
        return 140;
    }
}

function detectKeyFromBuffer(audioBuffer) {
    try {
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const totalSamples = channelData.length;
        
        // Note names and Camelot mapping (1A-12A Minor, 1B-12B Major)
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const camelotMinor = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];
        const camelotMajor = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
        
        // Krumhansl-Schmuckler empirical key profiles
        const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
        const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
        
        function normalizeVector(vec) {
            let mean = 0;
            for (let i = 0; i < vec.length; i++) mean += vec[i];
            mean /= vec.length;
            let variance = 0;
            for (let i = 0; i < vec.length; i++) variance += (vec[i] - mean) * (vec[i] - mean);
            const std = Math.sqrt(variance / vec.length) || 1;
            const res = new Float64Array(vec.length);
            for (let i = 0; i < vec.length; i++) res[i] = (vec[i] - mean) / std;
            return res;
        }
        
        const normMajor = normalizeVector(majorProfile);
        const normMinor = normalizeVector(minorProfile);
        
        const chroma = new Float64Array(12);
        const windowSize = 4096;
        const numWindows = 8;
        const startOffset = Math.floor(totalSamples * 0.15);
        const endOffset = Math.floor(totalSamples * 0.85);
        const step = Math.max(windowSize, Math.floor((endOffset - startOffset) / numWindows));
        
        for (let w = 0; w < numWindows; w++) {
            const offset = startOffset + w * step;
            if (offset + windowSize > totalSamples) break;
            
            for (let p = 0; p < 12; p++) {
                for (let oct = 2; oct <= 4; oct++) {
                    const midi = (oct + 1) * 12 + p;
                    const freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
                    
                    const k = Math.round((windowSize * freq) / sampleRate);
                    const omega = (2.0 * Math.PI * k) / windowSize;
                    const coeff = 2.0 * Math.cos(omega);
                    let s0 = 0, s1 = 0, s2 = 0;
                    
                    for (let i = 0; i < windowSize; i++) {
                        s0 = channelData[offset + i] + coeff * s1 - s2;
                        s2 = s1;
                        s1 = s0;
                    }
                    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
                    const octWeight = oct === 3 ? 1.2 : oct === 4 ? 1.0 : 0.8;
                    chroma[p] += power * octWeight;
                }
            }
        }
        
        const normChroma = normalizeVector(chroma);
        
        let bestCorrelation = -999;
        let bestKey = "8A";
        let bestKeyName = "Am";
        
        for (let root = 0; root < 12; root++) {
            let r = 0;
            for (let i = 0; i < 12; i++) {
                r += normChroma[i] * normMinor[(i - root + 12) % 12];
            }
            if (r > bestCorrelation) {
                bestCorrelation = r;
                bestKey = camelotMinor[root];
                bestKeyName = noteNames[root] + "m";
            }
        }
        
        for (let root = 0; root < 12; root++) {
            let r = 0;
            for (let i = 0; i < 12; i++) {
                r += normChroma[i] * normMajor[(i - root + 12) % 12];
            }
            if (r > bestCorrelation) {
                bestCorrelation = r;
                bestKey = camelotMajor[root];
                bestKeyName = noteNames[root];
            }
        }
        
        return { camelot: bestKey, name: bestKeyName, label: `${bestKey} (${bestKeyName})` };
    } catch(e) {
        console.warn("Key detection fallback:", e);
        return { camelot: "8A", name: "Am", label: "8A (Am)" };
    }
}

function handleAudioFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    window.producerSelectedAudioFile = file;

    const fileNameEl = document.getElementById('selectedFileName');
    const fileSizeEl = document.getElementById('selectedFileSize');
    const infoEl = document.getElementById('fileSelectedInfo');
    const promptEl = document.getElementById('dropZonePrompt');
    const previewEl = document.getElementById('audioPreviewElement');
    const titleInput = document.getElementById('uploadTitleInput');
    const qualitySelect = document.getElementById('uploadQualitySelect');

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB • ' + (file.type || 'Audio File');

    if (promptEl) promptEl.classList.add('d-none');
    if (infoEl) infoEl.classList.remove('d-none');

    // Audio preview
    if (previewEl) {
        try {
            previewEl.src = URL.createObjectURL(file);
            previewEl.classList.remove('d-none');
        } catch(e) {}
    }

    // Auto-fill title if empty
    if (titleInput && !titleInput.value) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        titleInput.value = cleanName;
    }

    // Auto-detect format quality
    const ext = file.name.split('.').pop().toLowerCase();
    if (qualitySelect) {
        if (ext === 'wav') qualitySelect.value = 'WAV Lossless 24-Bit';
        else if (ext === 'flac') qualitySelect.value = 'FLAC 24-Bit Lossless';
        else qualitySelect.value = 'MP3 320kbps';
    }

    // Analyze Audio file for BPM and Camelot Key
    analyzeAudioFile(file);
}

function clearSelectedAudioFile() {
    window.producerSelectedAudioFile = null;
    const input = document.getElementById('audioFileInput');
    if (input) input.value = '';

    const promptEl = document.getElementById('dropZonePrompt');
    const infoEl = document.getElementById('fileSelectedInfo');
    const previewEl = document.getElementById('audioPreviewElement');
    const statusBox = document.getElementById('audioAnalysisStatus');

    if (previewEl) {
        previewEl.pause();
        previewEl.src = '';
        previewEl.classList.add('d-none');
    }

    if (statusBox) statusBox.classList.add('d-none');
    if (infoEl) infoEl.classList.add('d-none');
    window.producerSelectedAudioFile = null;
    const fileInput = document.getElementById('audioFileInput');
    if (fileInput) fileInput.value = '';
}

function handleCategoryChange(catCode) {
    const qualitySelect = document.getElementById('uploadQualitySelect');
    if (catCode.includes('Slot') && qualitySelect) {
        qualitySelect.value = 'WAV Lossless 24-Bit';
    }
}

function onUploadProductTypeChanged(type) {
    const typeInput = document.getElementById('uploadProductTypeInput');
    const durationInput = document.getElementById('uploadDurationInput');
    const badge = document.getElementById('productTypeBadge');
    const label = document.getElementById('uploadCategoryLabel');
    const catSelect = document.getElementById('uploadCategorySelect');

    if (typeInput) typeInput.value = type;

    if (type === 'Nonstop') {
        if (badge) {
            badge.className = 'badge bg-warning text-dark fw-bold';
            badge.textContent = 'Đang chọn: Bản Nonstop Mix';
        }
        if (durationInput && (durationInput.value === '240' || !durationInput.value)) {
            durationInput.value = '3600'; // 60 mins default
        }
        if (label) label.innerHTML = 'Phân Cấp Nonstop (Theo Chuẩn SRS): <span class="text-danger">*</span>';
        if (catSelect) {
            catSelect.innerHTML = `
                <option value="NonstopLot" selected>Nonstop Lọt (Khách nghe full 100%, Free tải được)</option>
                <option value="NonstopNhom">Nonstop Nhóm (Standard & Premium VIP tải được)</option>
                <option value="NonstopSlot">Nonstop Slot VIP (Chỉ Premium tải Master, Demo 45s)</option>
            `;
        }
    } else {
        if (badge) {
            badge.className = 'badge bg-info text-dark fw-bold';
            badge.textContent = 'Đang chọn: Track Đơn DJ';
        }
        if (durationInput && (durationInput.value === '3600' || !durationInput.value)) {
            durationInput.value = '240'; // 4 mins default
        }
        if (label) label.innerHTML = 'Phân Cấp Track (Theo Chuẩn SRS): <span class="text-danger">*</span>';
        if (catSelect) {
            catSelect.innerHTML = `
                <option value="TrackLot">Track Lọt (Khách nghe full, Free tải được)</option>
                <option value="TrackNhom" selected>Track Nhóm (Standard & Premium VIP tải được)</option>
                <option value="TrackSlot">Track Slot VIP (Chỉ Premium tải WAV Master, Demo 30s)</option>
            `;
        }
    }
}

function initAudioDropZone() {
    const dropZone = document.getElementById('audioDropZone');
    const fileInput = document.getElementById('audioFileInput');
    if (!dropZone || !fileInput || dropZone.dataset.initialized) return;

    dropZone.dataset.initialized = 'true';

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = '#ffd166';
            dropZone.style.background = 'rgba(255, 209, 102, 0.12)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = '';
            dropZone.style.background = 'rgba(255, 209, 102, 0.03)';
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            window.producerSelectedAudioFile = files[0];
            try {
                const transfer = new DataTransfer();
                transfer.items.add(files[0]);
                fileInput.files = transfer.files;
            } catch(err){}
            handleAudioFileSelect({ files: [files[0]] });
        }
    }, false);
}

async function submitProducerUploadForm(form) {
    const submitBtn = document.getElementById('producerUploadSubmitBtn');
    const audioFile = window.producerSelectedAudioFile || document.getElementById('audioFileInput')?.files?.[0];

    // Validation: Require direct audio file
    if (!audioFile) {
        showToastNotification("⚠️ Vui lòng chọn 1 file âm thanh từ máy tính (MP3/WAV/FLAC)!");
        return;
    }

    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Đang tải lên và lưu vào SQL Server...';

    try {
        const formData = new FormData(form);
        formData.set('sourceType', 'DirectFile');
        if (audioFile) {
            formData.set('audioFile', audioFile);
        }

        const res = await fetch('/Producer/Upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (res.ok && data.success) {
            // Close modal
            const modalEl = document.getElementById('producerUploadModal');
            const bsModal = bootstrap.Modal.getInstance(modalEl);
            if (bsModal) bsModal.hide();

            showToastNotification(data.message || "🎧 Đăng tải bài hát thành công!");

            // Reset form
            form.reset();
            clearSelectedAudioFile();

            // Refresh personal track list in Producer Studio
            loadProducerTracks();
            return;
        }

        showToastNotification("❌ " + (data.message || "Đăng tải thất bại!"));
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi tải bài hát lên máy chủ!");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
    }
}

async function toggleFavorite(musicId, btnElem) {
    try {
        const res = await fetch('/Music/ToggleFavorite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(musicId)
        });
        const data = await res.json();

        if (res.status === 401) {
            showToastNotification("Vui lòng đăng nhập để lưu bài hát yêu thích!");
            new bootstrap.Modal(document.getElementById('loginModal')).show();
            return;
        }

        if (res.ok && data.success) {
            if (btnElem) {
                const icon = btnElem.querySelector('i');
                if (icon) {
                    icon.className = data.isFavorited ? 'fas fa-heart text-danger' : 'far fa-heart text-dim';
                }
            }
            showToastNotification(data.message);
        }
    } catch (e) {
        console.error(e);
    }
}

function switchUserTier(tier) {
    if (window.TLongPlayer.currentUser) {
        window.TLongPlayer.currentUser.tier = tier.charAt(0).toUpperCase() + tier.slice(1);
        localStorage.setItem('tlong_current_user', JSON.stringify(window.TLongPlayer.currentUser));
    }
    window.TLongPlayer.userTier = tier;
    updateTierUI();
    updateAuthUI();
    showToastNotification(`Đã chuyển cấp độ test: <strong class="text-uppercase text-danger">${tier}</strong>`);
}

function updateTierUI() {
    const tier = window.TLongPlayer.userTier ? window.TLongPlayer.userTier.toLowerCase() : 'free';
    document.body.classList.remove('tier-active-standard', 'tier-active-premium', 'tier-active-free');
    document.body.classList.add('tier-active-' + tier);

    const badge = document.getElementById('navUserTierBadge');
    if (!badge) return;

    if (tier === 'free') {
        badge.className = 'badge bg-secondary';
        badge.textContent = 'Free Member';
    } else if (tier === 'standard') {
        badge.className = 'badge badge-standard-red';
        badge.innerHTML = '<i class="fas fa-certificate me-1"></i> Standard VIP';
        // Tài khoản Standard mặc định chỉ hiển thị Track của Nhóm
        if (!window.TLongPlayer._customTierSelected || window.TLongPlayer.selectedTierFilter === 'all') {
            window.TLongPlayer.selectedTierFilter = 'Standard';
            const nhomBtn = document.getElementById('btnTabTrackNhom');
            if (nhomBtn) {
                document.querySelectorAll('#packageFilterPills button').forEach(b => b.classList.remove('active'));
                nhomBtn.classList.add('active');
            }
            if (typeof filterTracks === 'function') filterTracks();
        }
    } else if (tier === 'premium') {
        badge.className = 'badge badge-premium-gold';
        badge.innerHTML = '<i class="fas fa-crown me-1"></i> Premium Master';
    }
    updateDemoBadge();
}

// Waveform Canvas (Tự động chuyển phổ màu: VÀNG cho Premium, ĐỎ cho Standard)
function initCrystalWaveform() {
    const canvas = document.getElementById('audioWaveCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const bars = 48;
        const barWidth = canvas.width / bars;

        const isPremium = (window.TLongPlayer.userTier === 'premium') || 
                          (window.TLongPlayer.currentTrack && window.TLongPlayer.currentTrack.tierRequired === 'Premium');
        const isStandard = (window.TLongPlayer.userTier === 'standard') || 
                           (window.TLongPlayer.currentTrack && window.TLongPlayer.currentTrack.tierRequired === 'Standard');

        if (isPremium) {
            canvas.style.filter = 'drop-shadow(0 0 10px rgba(255, 209, 102, 0.75))';
        } else if (isStandard) {
            canvas.style.filter = 'drop-shadow(0 0 10px rgba(255, 19, 74, 0.75))';
        } else {
            canvas.style.filter = 'drop-shadow(0 0 8px rgba(255, 19, 74, 0.5))';
        }

        for (let i = 0; i < bars; i++) {
            let height = 3;
            if (window.TLongPlayer.isPlaying) {
                const time = Date.now() / 140;
                height = Math.sin(time + i * 0.32) * 10 + Math.cos(time * 0.8 + i * 0.25) * 6 + 11;
                height = Math.max(3, Math.min(canvas.height, height));
            }

            const x = i * barWidth;
            const y = (canvas.height - height) / 2;

            const grad = ctx.createLinearGradient(0, y, 0, y + height);
            if (isPremium) {
                // Hoàng Kim Vàng - Royal Gold Spectrum
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.3, '#ffe082');
                grad.addColorStop(0.7, '#ffd166');
                grad.addColorStop(1, '#ff9f1c');
            } else if (isStandard) {
                // Đỏ Ruby Rực Lửa - Ruby Red Spectrum
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.3, '#ff708f');
                grad.addColorStop(0.7, '#ff134a');
                grad.addColorStop(1, '#990022');
            } else {
                // Đa sắc cực quang
                grad.addColorStop(0, '#ffd166');
                grad.addColorStop(0.4, '#ff134a');
                grad.addColorStop(1, '#a855f7');
            }

            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barWidth - 2, height);
        }
    }

    draw();
}

// Stardust Engine
function initStardustShimmer() {
    const canvas = document.getElementById('stardustCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });

    const stars = [];
    const numStars = 65;

    for (let i = 0; i < numStars; i++) {
        stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 1.6 + 0.6,
            alpha: Math.random(),
            speed: Math.random() * 0.02 + 0.008,
            color: ['#ffffff', '#ffd166', '#ff94ab', '#06b6d4'][Math.floor(Math.random() * 4)]
        });
    }

    function animateStars() {
        requestAnimationFrame(animateStars);
        ctx.clearRect(0, 0, width, height);

        stars.forEach(s => {
            s.alpha += s.speed;
            if (s.alpha > 1 || s.alpha < 0) s.speed = -s.speed;

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.globalAlpha = Math.max(0.1, Math.min(1, s.alpha));
            ctx.shadowBlur = 8;
            ctx.shadowColor = s.color;
            ctx.fill();
        });

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    animateStars();
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault();
            togglePlayPause();
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            const audio = window.TLongPlayer.audio;
            audio.currentTime = Math.min(audio.duration || 300, audio.currentTime + 5);
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            const audio = window.TLongPlayer.audio;
            audio.currentTime = Math.max(0, audio.currentTime - 5);
        }
    });
}

function startBeatSynthesizer() {
    try {
        if (!window.AudioContext && !window.webkitAudioContext) return;
        if (!window.TLongPlayer.audioContext) {
            window.TLongPlayer.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const ctx = window.TLongPlayer.audioContext;
        if (ctx.state === 'suspended') ctx.resume();

        window.TLongPlayer.isSynthesizing = true;
        const intervalMs = (60 / 140) * 1000;
        window.TLongPlayer.synthTimer = setInterval(() => {
            if (!window.TLongPlayer.isPlaying) return;
            playSynthKick(ctx);
        }, intervalMs);
    } catch (e) {
        console.log(e);
    }
}

function playSynthKick(ctx) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.32);

    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.32);
}

function stopBeatSynthesizer() {
    window.TLongPlayer.isSynthesizing = false;
    if (window.TLongPlayer.synthTimer) {
        clearInterval(window.TLongPlayer.synthTimer);
        window.TLongPlayer.synthTimer = null;
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function showVipModal(htmlContent) {
    const modalElem = document.getElementById('vipUpgradeModal');
    const modalBody = document.getElementById('vipModalBody');
    if (modalElem && modalBody) {
        modalBody.innerHTML = htmlContent;
        const modal = bootstrap.Modal.getOrCreateInstance(modalElem);
        modal.show();

        if (!modalElem._hasHiddenListener) {
            modalElem._hasHiddenListener = true;
            modalElem.addEventListener('hidden.bs.modal', () => {
                closeDemoLimitModal();
            });
        }
    }
}

function showToastNotification(message) {
    const toastElem = document.getElementById('liveToast');
    const toastBody = document.getElementById('liveToastBody');
    if (toastElem && toastBody) {
        toastBody.innerHTML = message;
        const toast = new bootstrap.Toast(toastElem, { delay: 3500 });
        toast.show();
    }
}

function switchMusicSectionView(mode, btn) {
    const trackContainer = document.getElementById('masterTrackContainer');
    const nonstopContainer = document.getElementById('masterNonstopContainer');
    
    // Update active button styling
    if (btn) {
        document.querySelectorAll('#mainTypeTabs .nav-link').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    } else {
        const targetBtn = document.getElementById(`tab-${mode === 'all' ? 'all-sections' : mode + '-section'}`);
        if (targetBtn) {
            document.querySelectorAll('#mainTypeTabs .nav-link').forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
        }
    }

    if (mode === 'track') {
        if (trackContainer) trackContainer.style.display = 'block';
        if (nonstopContainer) nonstopContainer.style.display = 'none';
        trackContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (mode === 'nonstop') {
        if (trackContainer) trackContainer.style.display = 'none';
        if (nonstopContainer) nonstopContainer.style.display = 'block';
        nonstopContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        if (trackContainer) trackContainer.style.display = 'block';
        if (nonstopContainer) nonstopContainer.style.display = 'block';
    }
}

window.TLongPlayer.selectedTierFilter = 'all';

function filterByTier(tier, btnElem) {
    window.TLongPlayer.selectedTierFilter = tier;
    window.TLongPlayer._customTierSelected = true;
    if (btnElem) {
        document.querySelectorAll('#packageFilterPills button').forEach(b => {
            b.classList.remove('active');
        });
        btnElem.classList.add('active');
    }
    filterTracks();
}

function filterTracks() {
    const query = document.getElementById('trackSearchInput')?.value.toLowerCase() || '';
    const genreFilter = document.getElementById('genreFilterSelect')?.value.toLowerCase() || '';
    const bpmFilter = document.getElementById('bpmFilterSelect')?.value || '';
    const tierFilter = window.TLongPlayer.selectedTierFilter || 'all';
    const currentUser = window.TLongPlayer.currentUser;
    const userTier = (window.TLongPlayer.userTier || 'free').toLowerCase();

    let visibleCount = 0;

    document.querySelectorAll('.crystal-table-row').forEach(row => {
        const title = (row.dataset.title || '').toLowerCase();
        const artist = (row.dataset.artist || '').toLowerCase();
        const genre = (row.dataset.genre || '').toLowerCase();
        const bpm = parseInt(row.dataset.bpm) || 0;
        const requiredTier = row.dataset.tier || 'Free';
        const isSlotRow = row.classList.contains('track-row-slot') || requiredTier === 'Premium';
        const isNhomRow = row.classList.contains('track-row-nhom') || requiredTier === 'Standard';

        let matchesQuery = !query || title.includes(query) || artist.includes(query);
        let matchesGenre = !genreFilter || genre.includes(genreFilter);
        let matchesBpm = true;

        if (bpmFilter === '130-138') matchesBpm = bpm >= 130 && bpm <= 138;
        else if (bpmFilter === '139-142') matchesBpm = bpm >= 139 && bpm <= 142;
        else if (bpmFilter === '143+') matchesBpm = bpm >= 143;

        let matchesTier = true;
        if (tierFilter === 'demo_slot') {
            // NÚT RIÊNG: Chỉ hiển thị track Slot để nghe Demo 30s
            matchesTier = isSlotRow;
        } else if (tierFilter === 'Standard') {
            // Chỉ hiển thị track của Nhóm
            matchesTier = isNhomRow;
        } else if (tierFilter === 'all') {
            if (userTier === 'standard') {
                // Tài khoản Standard mặc định chỉ hiển thị track của Nhóm
                matchesTier = isNhomRow;
            } else {
                matchesTier = true;
            }
        } else if (tierFilter === 'my_tier') {
            if (currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Producer')) {
                matchesTier = true;
            } else if (userTier === 'premium') {
                matchesTier = true;
            } else if (userTier === 'standard') {
                matchesTier = isNhomRow;
            } else {
                matchesTier = (requiredTier === 'Free');
            }
        } else if (tierFilter === 'Free') {
            matchesTier = !isSlotRow && !isNhomRow;
        } else if (tierFilter === 'Premium') {
            matchesTier = isSlotRow;
        }

        const isVisible = matchesQuery && matchesGenre && matchesBpm && matchesTier;
        row.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
    });

    const summaryElem = document.getElementById('packageFilterSummary');
    if (summaryElem) {
        if (tierFilter === 'demo_slot') {
            const isPremium = (currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Producer' || (currentUser.tier && currentUser.tier.toLowerCase() === 'premium'))) || userTier === 'premium';
            summaryElem.innerHTML = isPremium
                ? `<span class="text-warning fw-bold"><i class="fas fa-crown me-1"></i> Kho Track Slot VIP (${visibleCount} bài)</span>`
                : `<span class="text-warning fw-bold"><i class="fas fa-crown me-1"></i> Đang hiển thị Demo track Slot (${visibleCount} bài)</span>`;
        } else if (tierFilter === 'Standard' || userTier === 'standard') {
            const isVip = (currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Producer' || (currentUser.tier && (currentUser.tier.toLowerCase() === 'standard' || currentUser.tier.toLowerCase() === 'premium')))) || userTier === 'standard' || userTier === 'premium';
            summaryElem.innerHTML = isVip
                ? `<span class="text-danger fw-bold"><i class="fas fa-certificate me-1"></i> Kho Track Nhóm Standard VIP (${visibleCount} bài)</span>`
                : `<span class="text-danger fw-bold"><i class="fas fa-certificate me-1"></i> Đang hiển thị Demo track Nhóm (${visibleCount} bài)</span>`;
        } else if (tierFilter === 'all') {
            summaryElem.textContent = `Hiển thị toàn bộ kho nhạc (${visibleCount} bài)`;
        } else if (tierFilter === 'my_tier') {
            summaryElem.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i> Có ${visibleCount} bài bạn được phép tải về</span>`;
        } else {
            summaryElem.textContent = `Đang lọc gói ${tierFilter} (${visibleCount} bài)`;
        }
    }
}

// ==========================================
// TRUNG TÂM QUẢN TRỊ ADMIN (PORTAL)
// ==========================================
async function openAdminPortal() {
    window.location.href = '/Admin';
}

async function loadAdminStats() {
    const container = document.getElementById('adminStatsGrid');
    if (!container) return;
    try {
        const res = await fetch('/Admin/Stats');
        const json = await res.json();
        if (json.success && json.data) {
            const s = json.data;

            // Cập nhật số liệu trên các tab
            const bP = document.getElementById('badgeAdmProducerCount');
            if (bP) bP.textContent = (s.totalProducers || 0).toLocaleString();
            const bM = document.getElementById('badgeAdmMusicCount');
            if (bM) bM.textContent = (s.totalMusics || 0).toLocaleString();
            const bU = document.getElementById('badgeAdmUserCount');
            if (bU) bU.textContent = (s.totalUsers || 0).toLocaleString();

            container.innerHTML = `
                <!-- 2 MEGA KPI CARDS -->
                <div class="col-12 col-lg-6">
                    <div class="admin-mega-kpi admin-mega-revenue h-100 d-flex flex-column justify-content-between">
                        <div>
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="badge bg-success text-dark fw-bold px-2.5 py-1 rounded-pill" style="font-size: 0.72rem;">
                                    <i class="fas fa-money-bill-wave me-1"></i> VIETQR REVENUE
                                </span>
                                <span class="text-dim small font-monospace"><i class="fas fa-bolt text-warning me-1"></i>Tự Động Quyết Toán</span>
                            </div>
                            <small class="text-dim text-uppercase fw-bold" style="letter-spacing: 0.5px;">Tổng Doanh Thu Nạp Gói VIP</small>
                            <h2 class="display-5 fw-bold text-success font-monospace my-1.5">${Number(s.totalRevenue || 0).toLocaleString()} <span class="fs-5">VNĐ</span></h2>
                            <p class="text-dim small mb-0">Tiền nâng cấp gói Standard VIP (99k) và Premium VIP (199k) từ toàn bộ khách hàng trên sàn.</p>
                        </div>
                        <div class="pt-3 mt-3 border-top border-secondary border-opacity-25 d-flex justify-content-between align-items-center">
                            <span class="text-dim small font-monospace"><i class="fas fa-building-columns text-info me-1"></i>Chuyển thẳng vào STK Admin</span>
                            <button type="button" class="btn btn-sm btn-outline-success rounded-pill px-3 py-1 font-monospace" onclick="document.getElementById('adm-settings-tab').click()">Xem STK Nhận Tiền</button>
                        </div>
                    </div>
                </div>

                <div class="col-12 col-lg-6">
                    <div class="admin-mega-kpi admin-mega-vip h-100 d-flex flex-column justify-content-between">
                        <div>
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="badge bg-warning text-dark fw-bold px-2.5 py-1 rounded-pill" style="font-size: 0.72rem;">
                                    <i class="fas fa-crown me-1"></i> ACTIVE VIP MEMBERS
                                </span>
                                <span class="text-dim small font-monospace"><i class="fas fa-circle-check text-success me-1"></i>Đang Hoạt Động</span>
                            </div>
                            <small class="text-dim text-uppercase fw-bold" style="letter-spacing: 0.5px;">Số Tài Khoản VIP Đang Hoạt Động</small>
                            <h2 class="display-5 fw-bold text-warning font-monospace my-1.5">${(s.activeVipSubscriptions || 0).toLocaleString()} <span class="fs-5">HỘI VIÊN</span></h2>
                            <p class="text-dim small mb-0">Hội viên sở hữu đặc quyền tải trọn bộ nhạc Nhóm MP3 320k hoặc Slot Full Master WAV 24-Bit.</p>
                        </div>
                        <div class="pt-3 mt-3 border-top border-secondary border-opacity-25 d-flex justify-content-between align-items-center">
                            <span class="text-dim small font-monospace"><i class="fas fa-user-shield text-warning me-1"></i>Quản lý thời hạn & quyền</span>
                            <button type="button" class="btn btn-sm btn-outline-warning rounded-pill px-3 py-1 font-monospace" onclick="document.getElementById('adm-users-tab').click()">Quản Lý & Gia Hạn</button>
                        </div>
                    </div>
                </div>

                <!-- 4 SATELLITE METRIC CARDS -->
                <div class="col-6 col-md-3">
                    <div class="admin-metric-card text-center h-100">
                        <div class="d-inline-flex align-items-center justify-content-center rounded-circle p-2.5 mb-2" style="background: rgba(0, 180, 216, 0.15); width: 48px; height: 48px;">
                            <i class="fas fa-users text-info fs-5"></i>
                        </div>
                        <h3 class="text-white fw-bold font-monospace mb-0">${(s.totalUsers || 0).toLocaleString()}</h3>
                        <small class="text-dim">Tổng Thành Viên</small>
                    </div>
                </div>

                <div class="col-6 col-md-3">
                    <div class="admin-metric-card text-center h-100">
                        <div class="d-inline-flex align-items-center justify-content-center rounded-circle p-2.5 mb-2" style="background: rgba(255, 209, 102, 0.15); width: 48px; height: 48px;">
                            <i class="fas fa-headphones text-warning fs-5"></i>
                        </div>
                        <h3 class="text-white fw-bold font-monospace mb-0">${(s.totalProducers || 0).toLocaleString()}</h3>
                        <small class="text-dim">Producer Studio</small>
                    </div>
                </div>

                <div class="col-6 col-md-3">
                    <div class="admin-metric-card text-center h-100">
                        <div class="d-inline-flex align-items-center justify-content-center rounded-circle p-2.5 mb-2" style="background: rgba(255, 19, 74, 0.15); width: 48px; height: 48px;">
                            <i class="fas fa-compact-disc text-danger fs-5"></i>
                        </div>
                        <h3 class="text-white fw-bold font-monospace mb-0">${(s.totalMusics || 0).toLocaleString()}</h3>
                        <small class="text-dim">Bản Thu & Nonstop</small>
                    </div>
                </div>

                <div class="col-6 col-md-3">
                    <div class="admin-metric-card text-center h-100">
                        <div class="d-inline-flex align-items-center justify-content-center rounded-circle p-2.5 mb-2" style="background: rgba(162, 89, 255, 0.15); width: 48px; height: 48px;">
                            <i class="fas fa-cloud-arrow-down fs-5" style="color: #a259ff;"></i>
                        </div>
                        <h3 class="text-white fw-bold font-monospace mb-0">${(s.totalDownloads || 0).toLocaleString()}</h3>
                        <small class="text-dim">Lượt Tải Bản Gốc</small>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.error("loadAdminStats error:", e);
    }
}

// ==========================================
// ADMIN PRODUCERS MANAGEMENT (WITH SEARCH & FILTER)
// ==========================================
window._allAdminProducers = [];

async function loadAdminProducers() {
    const container = document.getElementById('adminProducersTableContainer');
    if (!container) return;
    try {
        const res = await fetch('/Admin/Producers');
        const json = await res.json();
        if (json.success && json.data) {
            window._allAdminProducers = json.data;
            const bP = document.getElementById('badgeAdmProducerCount');
            if (bP) bP.textContent = window._allAdminProducers.length.toLocaleString();
            filterAdminProducersTable();
        } else {
            container.innerHTML = `<div class="p-4 text-center text-danger">❌ ${json.message || 'Không thể tải danh sách Producer!'}</div>`;
        }
    } catch (e) {
        console.error("loadAdminProducers error:", e);
        container.innerHTML = '<div class="p-4 text-center text-danger">❌ Lỗi kết nối khi tải danh sách Producer!</div>';
    }
}

function filterAdminProducersTable() {
    const container = document.getElementById('adminProducersTableContainer');
    if (!container || !window._allAdminProducers) return;

    const searchInput = document.getElementById('adminProducerSearchInput');
    const statusFilter = document.getElementById('adminProducerStatusFilter');

    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const statusVal = statusFilter ? statusFilter.value : 'all';

    let list = window._allAdminProducers.filter(p => {
        if (kw) {
            const sName = (p.stageName || '').toLowerCase();
            const uName = (p.username || '').toLowerCase();
            const fName = (p.fullName || '').toLowerCase();
            const phone = (p.phoneNumber || p.zaloContact || '').toLowerCase();
            if (!sName.includes(kw) && !uName.includes(kw) && !fName.includes(kw) && !phone.includes(kw)) {
                return false;
            }
        }

        const isLocked = p.isLocked || p.userStatus === 'Locked';
        if (statusVal === 'active' && isLocked) return false;
        if (statusVal === 'locked' && !isLocked) return false;

        return true;
    });

    if (list.length === 0) {
        container.innerHTML = '<div class="p-5 text-center text-dim"><i class="fas fa-filter fa-2x mb-2 text-secondary"></i><br />Không tìm thấy Producer nào phù hợp với bộ lọc.</div>';
        return;
    }

    let rows = list.map(p => {
        const isLocked = p.isLocked || p.userStatus === 'Locked';
        const statusBadge = isLocked 
            ? `<span class="badge bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50"><i class="fas fa-lock me-1"></i>Đã Khóa</span>`
            : `<span class="badge bg-success bg-opacity-25 text-success border border-success border-opacity-50"><i class="fas fa-circle-check me-1"></i>Hoạt Động</span>`;
        
        const safeStageName = (p.stageName || '').replace(/'/g, "\\'");

        return `
        <tr class="align-middle">
            <td>
                <div class="d-flex align-items-center gap-2.5">
                    <div class="rounded-circle d-flex align-items-center justify-content-center bg-dark border border-warning text-warning fw-bold font-monospace" style="width: 38px; height: 38px; font-size: 0.85rem;">
                        ${(p.stageName || 'DJ').substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <strong class="text-white d-block">${p.stageName}</strong>
                        <span class="text-dim small font-monospace">@@${p.username}</span>
                    </div>
                </div>
            </td>
            <td>${p.fullName || '<span class="text-dim">--</span>'}</td>
            <td class="font-monospace small">${p.phoneNumber || p.zaloContact || '<span class="text-dim">--</span>'}</td>
            <td><span class="badge bg-dark border border-secondary text-info font-monospace">${p.bankName || '--'}</span></td>
            <td class="font-monospace text-warning small fw-bold">${p.bankAccountNumber || '--'}</td>
            <td class="text-uppercase small font-monospace">${p.bankAccountHolder || '--'}</td>
            <td><span class="badge bg-danger bg-opacity-20 text-danger border border-danger border-opacity-50 font-monospace">${p.tracksCount} bài</span></td>
            <td>${statusBadge}</td>
            <td class="text-end text-nowrap">
                <button class="btn btn-sm ${isLocked ? 'btn-outline-success' : 'btn-outline-warning'} py-1 px-2.5 rounded-pill fw-bold" 
                        onclick="adminToggleLockProducer('${p.producerId}', '${safeStageName}')" 
                        title="${isLocked ? 'Mở khóa tài khoản' : 'Khóa tài khoản Producer'}">
                    <i class="fas ${isLocked ? 'fa-lock-open' : 'fa-lock'} me-1"></i> ${isLocked ? 'Mở Khóa' : 'Khóa'}
                </button>
                <button class="btn btn-sm btn-outline-danger py-1 px-2.5 ms-1 rounded-pill" 
                        onclick="adminDeleteProducer('${p.producerId}', '${safeStageName}')" 
                        title="Xóa vĩnh viễn Producer">
                    <i class="fas fa-trash me-1"></i> Xóa
                </button>
            </td>
        </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="table table-dark table-hover mb-0 small">
            <thead class="table-dark text-dim" style="border-bottom: 1.5px solid rgba(255,255,255,0.1);">
                <tr>
                    <th>Producer / Nghệ Danh</th>
                    <th>Họ Tên Thật</th>
                    <th>SĐT / Zalo</th>
                    <th>Ngân Hàng</th>
                    <th>Số Tài Khoản</th>
                    <th>Chủ Tài Khoản</th>
                    <th>Kho Bản Thu</th>
                    <th>Trạng Thái</th>
                    <th class="text-end">Thao Tác</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function adminToggleLockProducer(producerId, stageName) {
    if (!confirm(`Bạn có chắc muốn thay đổi trạng thái khóa của Producer '${stageName}'?`)) {
        return;
    }

    try {
        const res = await fetch(`/Admin/ToggleLockProducer/${producerId}`, {
            method: 'POST'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToastNotification(data.message);
            loadAdminProducers();
            return;
        }

        showToastNotification(`❌ ${data.message || 'Không thể thay đổi trạng thái Producer!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi thay đổi trạng thái Producer!");
    }
}

async function adminDeleteProducer(producerId, stageName) {
    if (!confirm(`⚠️ CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA VĨNH VIỄN Producer '${stageName}'?\n\nToàn bộ bài hát do Producer này phát hành và dữ liệu liên quan sẽ bị xóa sạch khỏi SQL Server!`)) {
        return;
    }

    try {
        const res = await fetch(`/Admin/DeleteProducer/${producerId}`, {
            method: 'POST'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToastNotification(data.message);
            loadAdminProducers();
            loadAdminStats();
            if (typeof loadMusicsFromApi === 'function') {
                loadMusicsFromApi();
            }
            return;
        }

        showToastNotification(`❌ ${data.message || 'Không thể xóa Producer!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi xóa Producer!");
    }
}

// ==========================================
// ADMIN MUSICS MANAGEMENT (WITH SEARCH & FILTER)
// ==========================================
window._allAdminMusics = [];

async function loadAdminMusics() {
    const container = document.getElementById('adminMusicsTableContainer');
    if (!container) return;
    try {
        const res = await fetch('/Admin/Musics');
        const json = await res.json();
        if (json.success && json.data) {
            window._allAdminMusics = json.data;
            const bM = document.getElementById('badgeAdmMusicCount');
            if (bM) bM.textContent = window._allAdminMusics.length.toLocaleString();
            filterAdminMusicsTable();
        } else {
            container.innerHTML = `<div class="p-4 text-center text-danger">❌ ${json.message || 'Không thể tải kho âm nhạc!'}</div>`;
        }
    } catch (e) {
        console.error("loadAdminMusics error:", e);
        container.innerHTML = '<div class="p-4 text-center text-danger">❌ Lỗi kết nối khi tải kho âm nhạc!</div>';
    }
}

function filterAdminMusicsTable() {
    const container = document.getElementById('adminMusicsTableContainer');
    if (!container || !window._allAdminMusics) return;

    const searchInput = document.getElementById('adminMusicSearchInput');
    const catFilter = document.getElementById('adminMusicCategoryFilter');
    const statusFilter = document.getElementById('adminMusicStatusFilter');

    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const catVal = catFilter ? catFilter.value : 'all';
    const statusVal = statusFilter ? statusFilter.value : 'all';

    let list = window._allAdminMusics.filter(m => {
        if (kw) {
            const title = (m.title || '').toLowerCase();
            const artist = (m.artist || '').toLowerCase();
            const prod = (m.producerName || '').toLowerCase();
            if (!title.includes(kw) && !artist.includes(kw) && !prod.includes(kw)) {
                return false;
            }
        }

        if (catVal !== 'all') {
            const code = (m.categoryCode || '').toLowerCase();
            const name = (m.categoryName || '').toLowerCase();
            if (catVal === 'Slot' && !code.includes('slot') && !name.includes('slot')) return false;
            if (catVal === 'Nhom' && !code.includes('nhom') && !name.includes('nhóm') && !name.includes('nhom')) return false;
            if (catVal === 'Lot' && !code.includes('lot') && !name.includes('lọt') && !name.includes('lot')) return false;
            if (catVal === 'Nonstop' && !code.includes('nonstop') && !name.includes('nonstop')) return false;
        }

        if (statusVal !== 'all') {
            if (statusVal === 'Published' && m.status !== 'Published') return false;
            if (statusVal === 'Hidden' && m.status === 'Published') return false;
        }

        return true;
    });

    if (list.length === 0) {
        container.innerHTML = '<div class="p-5 text-center text-dim"><i class="fas fa-music fa-2x mb-2 text-secondary"></i><br />Không tìm thấy bài hát nào phù hợp với bộ lọc.</div>';
        return;
    }

    let rows = list.map(m => {
        const isPublished = m.status === 'Published';
        const isSlot = (m.categoryCode || '').includes('Slot') || (m.categoryName || '').includes('Slot');
        const isNhom = (m.categoryCode || '').includes('Nhom') || (m.categoryName || '').includes('Nhóm');
        const isNonstop = (m.categoryCode || '').includes('Nonstop') || (m.categoryName || '').includes('Nonstop');

        let catBadge = '<span class="badge bg-secondary">Track Lọt</span>';
        if (isSlot) catBadge = '<span class="badge badge-premium-gold"><i class="fas fa-crown me-1"></i>Track Slot</span>';
        else if (isNhom) catBadge = '<span class="badge badge-standard-red"><i class="fas fa-certificate me-1"></i>Track Nhóm</span>';
        else if (isNonstop) catBadge = '<span class="badge bg-info bg-opacity-25 text-info border border-info border-opacity-50"><i class="fas fa-bolt me-1"></i>Nonstop</span>';

        return `
            <tr class="align-middle">
                <td>
                    <div class="fw-bold text-white d-block">${m.title}</div>
                    <small class="text-dim">${m.artist || 'Chưa rõ nghệ sĩ'}</small>
                </td>
                <td><span class="badge bg-dark border border-info text-info font-monospace"><i class="fas fa-headphones me-1"></i>${m.producerName || 'DJ TLong'}</span></td>
                <td>${catBadge}</td>
                <td><span class="badge bg-dark font-monospace text-warning border border-secondary">${m.qualityAvailable || 'MP3 320k'}</span></td>
                <td class="text-dim font-monospace"><i class="fas fa-play me-1 text-secondary"></i>${(m.playsCount || 0).toLocaleString()}</td>
                <td class="text-dim font-monospace"><i class="fas fa-download me-1 text-secondary"></i>${(m.downloadsCount || 0).toLocaleString()}</td>
                <td>
                    <span class="badge ${isPublished ? 'bg-success bg-opacity-25 text-success border border-success border-opacity-50' : 'bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50'}">
                        <i class="fas ${isPublished ? 'fa-circle-check' : 'fa-circle-pause'} me-1"></i>${isPublished ? 'Hiển thị' : 'Đang ẩn'}
                    </span>
                </td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm ${isPublished ? 'btn-outline-warning' : 'btn-outline-success'} py-1 px-2.5 rounded-pill fw-bold" 
                            onclick="toggleAdminMusicStatus('${m.musicId}')"
                            title="${isPublished ? 'Ẩn bài hát khỏi website' : 'Hiện bài hát trên website'}">
                        <i class="fas ${isPublished ? 'fa-eye-slash' : 'fa-eye'} me-1"></i> ${isPublished ? 'Ẩn Bài' : 'Hiện Bài'}
                    </button>
                    <button class="btn btn-sm btn-outline-danger py-1 px-2.5 ms-1 rounded-pill" 
                            onclick="deleteAdminMusic('${m.musicId}', '${m.title.replace(/'/g, "\\'")}')" 
                            title="Xóa vĩnh viễn bài hát khỏi database">
                        <i class="fas fa-trash me-1"></i> Xóa
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="table table-dark table-hover mb-0 small">
            <thead class="table-dark text-dim" style="border-bottom: 1.5px solid rgba(255,255,255,0.1);">
                <tr>
                    <th>Tiêu Đề & Nghệ Sĩ</th>
                    <th>Producer Studio</th>
                    <th>Phân Cấp Gói</th>
                    <th>Định Dạng</th>
                    <th>Lượt Nghe</th>
                    <th>Lượt Tải</th>
                    <th>Trạng Thái</th>
                    <th class="text-end">Thao Tác</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function toggleAdminMusicStatus(musicId) {
    try {
        const res = await fetch('/Admin/ToggleMusicStatus/' + musicId, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            showToastNotification(json.message);
            loadAdminMusics();
        }
    } catch (e) {
        console.error(e);
    }
}

async function deleteAdminMusic(musicId, title) {
    if (!confirm(`ADMIN XÁC NHẬN: Bạn có chắc chắn muốn xóa vĩnh viễn bài hát "${title}" khỏi hệ thống?`)) return;

    try {
        const res = await fetch('/Admin/DeleteMusic/' + musicId, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            showToastNotification(`🗑️ ${json.message}`);
            loadAdminMusics();
            setTimeout(() => location.reload(), 1200);
        } else {
            showToastNotification(`❌ ${json.message || 'Xóa thất bại!'}`);
        }
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi xóa bài hát!");
    }
}

// ==========================================
// ADMIN USER MANAGEMENT & VIP SUBSCRIPTION EXTENSION
// ==========================================
window._allAdminUsers = [];

async function loadAdminUsers() {
    const container = document.getElementById('adminUsersTableContainer');
    if (!container) return;

    try {
        const res = await fetch('/Admin/Users');
        const json = await res.json();
        if (json.success && json.data) {
            window._allAdminUsers = json.data;
            filterAdminUsersTable();
        } else {
            container.innerHTML = `<div class="p-4 text-center text-danger">❌ ${json.message || 'Không thể tải danh sách người dùng!'}</div>`;
        }
    } catch (e) {
        console.error("loadAdminUsers error:", e);
        container.innerHTML = '<div class="p-4 text-center text-danger">❌ Lỗi kết nối khi tải danh sách người dùng!</div>';
    }
}

function filterAdminUsersTable() {
    const container = document.getElementById('adminUsersTableContainer');
    if (!container || !window._allAdminUsers) return;

    const searchInput = document.getElementById('adminUserSearchInput');
    const roleFilterEl = document.getElementById('adminUserRoleFilter');
    const tierFilter = document.getElementById('adminUserTierFilter');

    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const roleFilter = roleFilterEl ? roleFilterEl.value : 'all';
    const filter = tierFilter ? tierFilter.value : 'all';

    let list = window._allAdminUsers.filter(u => {
        // Keyword match
        if (kw) {
            const uName = (u.username || '').toLowerCase();
            const fName = (u.fullName || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const phone = (u.phoneNumber || '').toLowerCase();
            if (!uName.includes(kw) && !fName.includes(kw) && !email.includes(kw) && !phone.includes(kw)) {
                return false;
            }
        }

        // Role filter: Producer vs User vs Admin
        const isAdmin = (u.roles && u.roles.includes('Admin')) || u.primaryRole === 'Admin';
        const isProducer = (u.roles && u.roles.includes('Producer')) || u.primaryRole === 'Producer';
        const isRegularUser = !isAdmin && !isProducer;

        if (roleFilter === 'producer' && !isProducer) return false;
        if (roleFilter === 'user' && !isRegularUser) return false;
        if (roleFilter === 'admin' && !isAdmin) return false;

        // Tier / status filter
        if (filter === 'Premium') {
            return (u.tierCode === 'premium' || (u.currentTier && u.currentTier.toLowerCase().includes('premium')));
        } else if (filter === 'Standard') {
            return (u.tierCode === 'standard' || (u.currentTier && u.currentTier.toLowerCase().includes('standard')));
        } else if (filter === 'Free') {
            return (u.tierCode === 'free' || !u.tierExpiresAt);
        } else if (filter === 'expired') {
            return (u.tierExpiresAt && !u.isVipActive);
        } else if (filter === 'locked') {
            return (u.status === 'Locked');
        }

        return true;
    });

    // Sắp xếp danh sách: Người tạo mới nhất xuống dưới cùng (Cũ nhất ở trên cùng -> Mới nhất ở dưới cùng)
    list.sort((a, b) => {
        const timeA = a.createdAtRaw ? new Date(a.createdAtRaw).getTime() : 0;
        const timeB = b.createdAtRaw ? new Date(b.createdAtRaw).getTime() : 0;
        return timeA - timeB;
    });

    renderAdminUsersTable(list);
}

function renderAdminUsersTable(users) {
    const container = document.getElementById('adminUsersTableContainer');
    if (!container) return;

    if (!users || users.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-dim"><i class="fas fa-user-slash fa-2x mb-2 d-block"></i>Không tìm thấy người dùng nào phù hợp.</div>';
        return;
    }

    let rows = users.map(u => {
        const isLocked = u.status === 'Locked';
        const isAdmin = (u.roles && u.roles.includes('Admin')) || u.primaryRole === 'Admin';
        const isProducer = (u.roles && u.roles.includes('Producer')) || u.primaryRole === 'Producer';
        const isStaff = isAdmin || isProducer;

        // Role badges
        let roleBadge = '<span class="badge bg-secondary text-white">Thành Viên</span>';
        if (isAdmin) roleBadge = '<span class="badge bg-danger text-white"><i class="fas fa-shield-halved me-1"></i>Admin Tối Cao</span>';
        else if (isProducer) roleBadge = '<span class="badge bg-warning text-dark"><i class="fas fa-headphones me-1"></i>Producer Studio</span>';

        // Format expiration date and calculate days left reliably
        let daysLeft = (typeof u.daysRemaining === 'number' && !isNaN(u.daysRemaining)) ? u.daysRemaining : 0;
        let formattedExpiry = u.tierExpiresAt || '';

        if (u.tierExpiresAt) {
            // Check if tierExpiresAt is an ISO string (e.g. 2026-10-23T11:16:21) or needs formatting
            if (u.tierExpiresAt.includes('T') || u.tierExpiresAt.includes('-')) {
                const parsedDate = new Date(u.tierExpiresAt);
                if (!isNaN(parsedDate.getTime())) {
                    const now = new Date();
                    const diffDays = Math.ceil((parsedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    daysLeft = Math.max(0, diffDays);
                    const dd = String(parsedDate.getDate()).padStart(2, '0');
                    const MM = String(parsedDate.getMonth() + 1).padStart(2, '0');
                    const yyyy = parsedDate.getFullYear();
                    const hh = String(parsedDate.getHours()).padStart(2, '0');
                    const mm = String(parsedDate.getMinutes()).padStart(2, '0');
                    formattedExpiry = `${dd}/${MM}/${yyyy} ${hh}:${mm}`;
                }
            } else if (daysLeft === 0 && u.tierExpiresAt.includes('/')) {
                // Parse dd/MM/yyyy HH:mm
                const parts = u.tierExpiresAt.split(' ');
                if (parts.length >= 1) {
                    const dParts = parts[0].split('/');
                    if (dParts.length === 3) {
                        const parsedDate = new Date(parseInt(dParts[2]), parseInt(dParts[1]) - 1, parseInt(dParts[0]));
                        const now = new Date();
                        const diffDays = Math.ceil((parsedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        if (diffDays > 0) daysLeft = diffDays;
                    }
                }
            }
        }

        const safeFullName = (u.fullName || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeUsername = (u.username || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeAvatar = (u.avatarUrl || '/images/logo.png').replace(/'/g, "\\'");
        const safeTier = (u.currentTier || 'Free').replace(/'/g, "\\'");
        const safeExpires = formattedExpiry.replace(/'/g, "\\'");

        // Lock button
        let lockBtn = '';
        if (!isAdmin) {
            lockBtn = `
                <button class="btn btn-sm ${isLocked ? 'btn-outline-success' : 'btn-outline-danger'} py-1 px-2 ms-1" 
                        onclick="adminToggleLockUser('${u.userId}', '${safeUsername}')" 
                        title="${isLocked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}">
                    <i class="fas ${isLocked ? 'fa-lock-open' : 'fa-lock'} me-1"></i> ${isLocked ? 'Mở' : 'Khóa'}
                </button>
            `;
        }

        // CỘT: HẠN DÙNG VIP & NÂNG CẤP
        let vipColumnHtml = '';
        let actionColumnHtml = '';

        if (isAdmin) {
            vipColumnHtml = `
                <span class="badge bg-danger"><i class="fas fa-infinity me-1"></i>Toàn Quyền Hệ Thống</span>
                <small class="text-dim d-block mt-1 font-monospace">Tài khoản Admin không cần nâng cấp VIP</small>
            `;
            actionColumnHtml = `<span class="badge bg-dark border border-secondary text-dim">Toàn Quyền</span>`;
        } else if (isProducer) {
            vipColumnHtml = `
                <span class="badge bg-warning text-dark"><i class="fas fa-infinity me-1"></i>Studio Producer</span>
                <small class="text-dim d-block mt-1 font-monospace">Tài khoản Producer không cần nâng cấp VIP</small>
            `;
            actionColumnHtml = lockBtn || `<span class="text-dim small">--</span>`;
        } else {
            // REGULAR MEMBER: Hiển thị rõ Gói nào, Còn bao nhiêu ngày, và Muốn nâng cấp lên gói nào được
            const tierLower = (u.currentTier || '').toLowerCase();
            const isPremium = tierLower.includes('premium');
            const isStandard = tierLower.includes('standard');

            // 1. Gói nào
            const isFree = !isPremium && !isStandard;
            let tierBadge = '<span class="badge bg-dark border border-secondary text-dim"><i class="fas fa-user me-1"></i>Free Member</span>';
            if (isPremium) tierBadge = '<span class="badge badge-premium-gold"><i class="fas fa-crown me-1"></i>👑 PREMIUM VIP</span>';
            else if (isStandard) tierBadge = '<span class="badge badge-standard-red"><i class="fas fa-certificate me-1"></i>💎 STANDARD VIP</span>';

            // 2. Còn bao nhiêu ngày: Free member thì TUYỆT ĐỐI KHÔNG hiển thị hạn
            let remainingHtml = '';
            if (!isFree) {
                if (formattedExpiry) {
                    if (daysLeft > 0 || u.isVipActive) {
                        remainingHtml = `<div class="text-success small fw-bold mt-1"><i class="fas fa-clock me-1"></i>Còn <strong>${daysLeft} ngày</strong> <span class="text-dim font-monospace fw-normal" style="font-size: 0.72rem;">(đến ${formattedExpiry})</span></div>`;
                    } else {
                        remainingHtml = `<div class="text-danger small fw-bold mt-1"><i class="fas fa-circle-exclamation me-1"></i>Đã hết hạn <span class="text-dim font-monospace fw-normal" style="font-size: 0.72rem;">(từ ${formattedExpiry})</span></div>`;
                    }
                }
            }

            // 3. Muốn nâng cấp lên gói nào được (Gia hạn tự động 30 ngày hoặc Tùy chỉnh ngày/tuần/tháng)
            let upgradeOptionsHtml = '';
            if (isPremium) {
                upgradeOptionsHtml = `
                    <div class="mt-2 pt-1 border-top border-secondary border-opacity-25 d-flex flex-wrap align-items-center gap-1">
                        <span class="text-dim" style="font-size: 0.7rem;">Gói cao nhất:</span>
                        <button class="btn btn-sm btn-outline-warning py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="adminQuickExtend('${u.userId}', 'Premium', 30, '${safeFullName}')" title="Gia hạn tự động 30 ngày Premium VIP">
                            <i class="fas fa-crown me-1"></i>+ 👑 Gia Hạn Premium (30d)
                        </button>
                        <button class="btn btn-sm btn-outline-light py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="openAdminExtendModal('${u.userId}', '${safeFullName}', '${safeUsername}', '${safeAvatar}', '${safeTier}', '${safeExpires}')" title="Tùy chỉnh số ngày, tuần, tháng">
                            <i class="fas fa-sliders me-1 text-warning"></i> Tùy Chỉnh...
                        </button>
                    </div>
                `;
            } else if (isStandard) {
                upgradeOptionsHtml = `
                    <div class="mt-2 pt-1 border-top border-secondary border-opacity-25 d-flex flex-wrap align-items-center gap-1">
                        <span class="text-dim" style="font-size: 0.7rem;">Nâng cấp / Gia hạn:</span>
                        <button class="btn btn-sm btn-outline-warning py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="adminQuickExtend('${u.userId}', 'Premium', 30, '${safeFullName}')" title="Nâng cấp lên Premium VIP (+30 ngày)">
                            <i class="fas fa-arrow-up text-warning me-1"></i>👑 Nâng Lên Premium (30d)
                        </button>
                        <button class="btn btn-sm btn-outline-danger py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="adminQuickExtend('${u.userId}', 'Standard', 30, '${safeFullName}')" title="Gia hạn thêm 30 ngày Standard VIP">
                            <i class="fas fa-rotate-right me-1"></i>+ 💎 Standard (30d)
                        </button>
                        <button class="btn btn-sm btn-outline-light py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="openAdminExtendModal('${u.userId}', '${safeFullName}', '${safeUsername}', '${safeAvatar}', '${safeTier}', '${safeExpires}')" title="Tùy chỉnh số ngày, tuần, tháng">
                            <i class="fas fa-sliders me-1 text-warning"></i> Tùy Chỉnh...
                        </button>
                    </div>
                `;
            } else {
                // Free Member
                upgradeOptionsHtml = `
                    <div class="mt-2 pt-1 border-top border-secondary border-opacity-25 d-flex flex-wrap align-items-center gap-1">
                        <span class="text-dim" style="font-size: 0.7rem;">Nâng cấp lên:</span>
                        <button class="btn btn-sm btn-outline-danger py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="adminQuickExtend('${u.userId}', 'Standard', 30, '${safeFullName}')" title="Gia hạn tự động 30 ngày Standard VIP">
                            <i class="fas fa-certificate me-1"></i>+ 💎 Standard (30d)
                        </button>
                        <button class="btn btn-sm btn-outline-warning py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="adminQuickExtend('${u.userId}', 'Premium', 30, '${safeFullName}')" title="Gia hạn tự động 30 ngày Premium VIP">
                            <i class="fas fa-crown me-1"></i>+ 👑 Premium (30d)
                        </button>
                        <button class="btn btn-sm btn-outline-light py-0 px-2 rounded-pill fw-bold" style="font-size: 0.68rem;"
                                onclick="openAdminExtendModal('${u.userId}', '${safeFullName}', '${safeUsername}', '${safeAvatar}', '${safeTier}', '${safeExpires}')" title="Tùy chỉnh số ngày, tuần, tháng">
                            <i class="fas fa-sliders me-1 text-warning"></i> Tùy Chỉnh...
                        </button>
                    </div>
                `;
            }

            vipColumnHtml = `
                <div>
                    ${tierBadge}
                    ${remainingHtml}
                    ${upgradeOptionsHtml}
                </div>
            `;

            actionColumnHtml = `
                <button class="btn btn-sm btn-outline-warning py-1 px-2 fw-bold text-nowrap" 
                        onclick="openAdminExtendModal('${u.userId}', '${safeFullName}', '${safeUsername}', '${safeAvatar}', '${safeTier}', '${safeExpires}')"
                        title="Tùy chỉnh gia hạn theo ngày, tuần, tối đa tháng">
                    <i class="fas fa-sliders me-1"></i> Tùy Chỉnh VIP
                </button>
                ${lockBtn}
            `;
        }

        return `
            <tr class="align-middle">
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <img src="${u.avatarUrl || '/images/logo.png'}" class="rounded-circle border border-secondary" style="width: 38px; height: 38px; object-fit: cover;" onerror="this.src='/images/logo.png';" />
                        <div>
                            <strong class="text-white d-block">${u.fullName || u.username}</strong>
                            <span class="text-dim font-monospace small">${u.username}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="small text-dim"><i class="fas fa-envelope me-1"></i>${u.email || '--'}</div>
                    <div class="small text-dim"><i class="fas fa-phone me-1"></i>${u.phoneNumber || '--'}</div>
                </td>
                <td>${roleBadge}</td>
                <td>${vipColumnHtml}</td>
                <td class="font-monospace text-warning small fw-bold">${Number(u.totalSpent || 0).toLocaleString()} đ</td>
                <td>
                    <span class="badge ${isLocked ? 'bg-danger' : 'bg-success'}">
                        <i class="fas ${isLocked ? 'fa-lock' : 'fa-circle-check'} me-1"></i>${isLocked ? 'Đã Khóa' : 'Hoạt Động'}
                    </span>
                </td>
                <td class="text-dim small font-monospace">${u.createdAt || '--'}</td>
                <td class="text-end text-nowrap">${actionColumnHtml}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="table table-dark table-hover mb-0 small">
            <thead class="table-dark text-dim">
                <tr>
                    <th>Người Dùng</th>
                    <th>Liên Hệ</th>
                    <th>Vai Trò</th>
                    <th style="min-width: 280px;">Hạn Dùng VIP & Nâng Cấp</th>
                    <th>Đã Nạp</th>
                    <th>Trạng Thái</th>
                    <th>Ngày Tạo</th>
                    <th class="text-end">Hành Động</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

// GIA HẠN NHANH TỰ ĐỘNG CHO ADMIN (1-CLICK)
async function adminQuickExtend(userId, packageId, days, userName) {
    const pkgName = packageId === 'Premium' ? 'PREMIUM VIP' : 'STANDARD VIP';
    if (!confirm(`XÁC NHẬN GIA HẠN TỰ ĐỘNG:\nBạn có chắc chắn muốn gia hạn tự động gói '${pkgName}' (+${days} ngày) cho người dùng '${userName}'?`)) {
        return;
    }

    try {
        const res = await fetch('/Admin/ExtendSubscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                packageId: packageId,
                durationDays: days,
                reason: `Admin gia hạn tự động gói ${pkgName}`
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToastNotification(`🎉 ${data.message}`);
            loadAdminUsers();
            if (typeof loadAdminStats === 'function') loadAdminStats();
        } else {
            showToastNotification(`❌ ${data.message || 'Gia hạn thất bại!'}`);
        }
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi gia hạn tự động!");
    }
}

// MODAL TÙY CHỈNH GIA HẠN GÓI VIP (THEO NGÀY, TUẦN, TỐI ĐA THÁNG)
window._currentExtendingUser = null;

function openAdminExtendModal(userId, fullName, username, avatarUrl, currentTier, expiresAt, preselectedPkg) {
    window._currentExtendingUser = { userId, fullName, username, currentTier, expiresAt };

    const modalEl = document.getElementById('adminExtendModal');
    if (modalEl) {
        if (modalEl.parentElement !== document.body) {
            document.body.appendChild(modalEl);
        }
        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    }

    const idInput = document.getElementById('extendTargetUserId');
    if (idInput) idInput.value = userId;

    const avatarEl = document.getElementById('extendUserAvatar');
    if (avatarEl) avatarEl.src = avatarUrl || '/images/logo.png';

    const nameEl = document.getElementById('extendUserFullName');
    if (nameEl) nameEl.textContent = fullName || username;

    const subInfoEl = document.getElementById('extendUserSubInfo');
    const tierBadgeEl = document.getElementById('extendUserTierBadge');
    const tierPinEl = document.getElementById('extendUserTierPin');
    const currentExpiryValEl = document.getElementById('extendCurrentExpiryVal');

    const tierLower = (currentTier || 'free').toLowerCase();
    const isPrem = tierLower.includes('premium');
    const isStd = tierLower.includes('standard');
    const isFree = !isPrem && !isStd;

    if (subInfoEl) {
        subInfoEl.textContent = `@${username} • ${isFree ? 'Thành viên Free' : 'Hội viên VIP'}`;
    }

    if (tierBadgeEl) {
        if (isPrem) {
            tierBadgeEl.className = 'badge bg-warning text-dark font-monospace fw-bold';
            tierBadgeEl.textContent = '👑 Premium VIP';
        } else if (isStd) {
            tierBadgeEl.className = 'badge bg-danger text-white font-monospace fw-bold';
            tierBadgeEl.textContent = '💎 Standard VIP';
        } else {
            tierBadgeEl.className = 'badge bg-secondary text-light font-monospace';
            tierBadgeEl.textContent = '👤 Free Member';
        }
    }

    if (tierPinEl) {
        tierPinEl.textContent = isPrem ? '👑 VIP' : (isStd ? '💎 VIP' : 'FREE');
        tierPinEl.className = `position-absolute bottom-0 end-0 badge rounded-pill ${isPrem ? 'bg-warning text-dark' : (isStd ? 'bg-danger text-white' : 'bg-secondary text-white')}`;
    }

    if (currentExpiryValEl) {
        currentExpiryValEl.textContent = (!isFree && expiresAt) ? `${expiresAt}` : 'Chưa kích hoạt VIP';
    }

    // Badge "Đang dùng gói này" trên 2 card
    const bStd = document.getElementById('badgeCurrentPkgStd');
    const bPrem = document.getElementById('badgeCurrentPkgPrem');
    if (bStd) bStd.classList.toggle('d-none', !isStd);
    if (bPrem) bPrem.classList.toggle('d-none', !isPrem);

    // Chọn gói mặc định: ưu tiên preselectedPkg -> gói đang dùng -> Premium
    let defaultPkg = preselectedPkg || (isPrem ? 'Premium' : (isStd ? 'Standard' : 'Premium'));
    selectExtendPkg(defaultPkg);

    // Reset về 7 ngày
    setExtendDays(7);

    // Reset lý do
    setExtendReason('');

    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

function selectExtendPkg(pkgName) {
    const input = document.getElementById('extendSelectedPkgInput');
    if (input) input.value = pkgName;

    const cardStd = document.getElementById('cardPkgStandard');
    const cardPrem = document.getElementById('cardPkgPremium');

    if (pkgName === 'Premium') {
        if (cardPrem) cardPrem.classList.add('active');
        if (cardStd) cardStd.classList.remove('active');
    } else {
        if (cardStd) cardStd.classList.add('active');
        if (cardPrem) cardPrem.classList.remove('active');
    }

    updateExtendPreview();
}

function setExtendDays(days) {
    let val = parseInt(days, 10) || 1;
    if (val < 1) val = 1;
    if (val > 30) val = 30;

    const hiddenInput = document.getElementById('extendDurationDays');
    if (hiddenInput) hiddenInput.value = val;

    const slider = document.getElementById('extendDurationSlider');
    if (slider) slider.value = val;

    const displayText = document.getElementById('extendDisplayDaysText');
    if (displayText) displayText.textContent = val;

    const btnDaysText = document.getElementById('btnSubmitDaysText');
    if (btnDaysText) btnDaysText.textContent = `+${val} ngày`;

    // Highlight preset chip tương ứng
    [1, 3, 7, 14, 21, 30].forEach(d => {
        const chip = document.getElementById(`chipDay${d}`);
        if (chip) {
            chip.classList.toggle('active', d === val);
        }
    });

    updateExtendPreview();
}

function onExtendSliderChange(val) {
    setExtendDays(val);
}

function adjustExtendDays(delta) {
    const hiddenInput = document.getElementById('extendDurationDays');
    let currentVal = parseInt(hiddenInput ? hiddenInput.value : 7, 10) || 7;
    setExtendDays(currentVal + delta);
}

function setExtendReason(reasonText) {
    const input = document.getElementById('extendReason');
    if (input) {
        input.value = reasonText;
        if (reasonText) input.focus();
    }

    // Toggle active state on reason chips
    document.querySelectorAll('.reason-chip').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim().includes(reasonText) && reasonText !== '');
    });
}

function updateExtendPreview() {
    const selectedPkg = document.getElementById('extendSelectedPkgInput')?.value || 'Premium';
    const isPremium = selectedPkg === 'Premium';
    const selectedPkgName = isPremium ? 'PREMIUM VIP' : 'STANDARD VIP';
    const selectedPkgClass = isPremium ? 'text-warning' : 'text-danger';
    const selectedPkgIcon = isPremium ? '👑' : '💎';

    const selDisplay = document.getElementById('extendSelectedPkgDisplay');
    if (selDisplay) {
        selDisplay.className = `${selectedPkgClass} fw-bold font-monospace small`;
        selDisplay.textContent = `${selectedPkgIcon} ${selectedPkgName}`;
    }

    const hiddenDaysInput = document.getElementById('extendDurationDays');
    let days = parseInt(hiddenDaysInput ? hiddenDaysInput.value : 7, 10) || 7;
    if (days < 1) days = 1;
    if (days > 30) days = 30;

    const user = window._currentExtendingUser;
    if (!user) return;

    const isFree = !user.currentTier || user.currentTier.toLowerCase() === 'free';
    const userTierLower = (user.currentTier || '').toLowerCase();
    const isSameTier = !isFree && userTierLower.includes(isPremium ? 'premium' : 'standard');

    // Phân tích ngày hết hạn hiện tại
    let baseDate = new Date();
    let isContinuing = false;

    if (isSameTier && user.expiresAt) {
        let parsedExpiry = null;
        if (user.expiresAt.includes('/')) {
            const parts = user.expiresAt.split(' ');
            const dateParts = parts[0].split('/');
            let hh = 0, mm = 0;
            if (parts.length >= 2) {
                const timeParts = parts[1].split(':');
                if (timeParts.length >= 2) {
                    hh = parseInt(timeParts[0], 10) || 0;
                    mm = parseInt(timeParts[1], 10) || 0;
                }
            }
            if (dateParts.length === 3) {
                parsedExpiry = new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]), hh, mm);
            }
        } else {
            const p = new Date(user.expiresAt);
            if (!isNaN(p.getTime())) parsedExpiry = p;
        }

        if (parsedExpiry && parsedExpiry > baseDate) {
            baseDate = parsedExpiry;
            isContinuing = true;
        }
    }

    // Tính ngày hết hạn mới
    const newDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    const dd = String(newDate.getDate()).padStart(2, '0');
    const MM = String(newDate.getMonth() + 1).padStart(2, '0');
    const yyyy = newDate.getFullYear();
    const hh = String(newDate.getHours()).padStart(2, '0');
    const mm = String(newDate.getMinutes()).padStart(2, '0');
    const formattedNewExpiry = `${dd}/${MM}/${yyyy} ${hh}:${mm}`;

    // Tổng số ngày còn lại tính từ hiện tại
    const totalRemainingDays = Math.max(1, Math.ceil((newDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    // Cập nhật Timeline Preview
    const methodBadge = document.getElementById('extendCalculationMethodBadge');
    if (methodBadge) {
        if (isContinuing) {
            methodBadge.className = 'badge bg-success bg-opacity-25 text-success border border-success border-opacity-50 font-monospace';
            methodBadge.innerHTML = `<i class="fas fa-link me-1"></i>Cộng nối tiếp hạn cũ (+${days} ngày)`;
        } else {
            methodBadge.className = 'badge bg-info bg-opacity-25 text-info border border-info border-opacity-50 font-monospace';
            methodBadge.innerHTML = `<i class="fas fa-play me-1"></i>Kích hoạt từ hôm nay (+${days} ngày)`;
        }
    }

    const curTierEl = document.getElementById('timelineCurrentTier');
    if (curTierEl) {
        curTierEl.textContent = isFree ? 'Free Member' : user.currentTier;
    }

    const curExpEl = document.getElementById('timelineCurrentExpiry');
    if (curExpEl) {
        curExpEl.textContent = (!isFree && user.expiresAt) ? user.expiresAt : 'Chưa kích hoạt';
    }

    const addedBadge = document.getElementById('timelineAddedDaysBadge');
    if (addedBadge) {
        addedBadge.textContent = `+${days} ngày`;
    }

    const newTierEl = document.getElementById('timelineNewTier');
    if (newTierEl) {
        newTierEl.className = `small fw-bold text-truncate ${selectedPkgClass}`;
        newTierEl.textContent = `${selectedPkgIcon} ${selectedPkgName}`;
    }

    const newExpEl = document.getElementById('timelineNewExpiry');
    if (newExpEl) {
        newExpEl.textContent = formattedNewExpiry;
    }

    const totalRemainingEl = document.getElementById('timelineTotalRemaining');
    if (totalRemainingEl) {
        totalRemainingEl.textContent = `Tổng còn: ${totalRemainingDays} ngày`;
    }

    const btnSubmit = document.getElementById('btnSubmitExtend');
    if (btnSubmit) {
        btnSubmit.className = isPremium
            ? 'btn btn-shimmer-gold px-4 py-2.5 rounded-pill fw-bold d-flex align-items-center gap-2 shadow-lg'
            : 'btn btn-shimmer-ruby px-4 py-2.5 rounded-pill fw-bold d-flex align-items-center gap-2 shadow-lg';
    }
}

async function submitAdminExtendSubscription(form) {
    const userId = form.userId.value;
    const packageId = form.packageId.value;
    let durationDays = parseInt(form.durationDays.value, 10);
    const reason = form.reason ? form.reason.value.trim() : '';

    if (!userId) {
        showToastNotification("❌ Không tìm thấy mã người dùng!");
        return;
    }
    if (!durationDays || durationDays < 1) {
        showToastNotification("❌ Vui lòng nhập số ngày gia hạn hợp lệ (tối thiểu 1 ngày)!");
        return;
    }
    if (durationDays > 30) {
        durationDays = 30;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Đang gia hạn...';
    }

    try {
        const res = await fetch('/Admin/ExtendSubscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                packageId: packageId,
                durationDays: durationDays,
                reason: reason
            })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            const modalEl = document.getElementById('adminExtendModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
            showToastNotification(`🎉 ${data.message}`);
            loadAdminUsers();
            if (typeof loadAdminStats === 'function') loadAdminStats();
            return;
        }

        showToastNotification(`❌ ${data.message || 'Gia hạn gói thất bại!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi gia hạn gói!");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origBtnHtml;
        }
    }
}

async function adminToggleLockUser(userId, username) {
    if (!confirm(`Bạn có chắc chắn muốn thay đổi trạng thái Khóa / Mở khóa cho tài khoản "${username}"?`)) {
        return;
    }

    try {
        const res = await fetch(`/Admin/ToggleLockUser/${userId}`, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            showToastNotification(data.message);
            loadAdminUsers();
            return;
        }

        showToastNotification(`❌ ${data.message || 'Thao tác khóa thất bại!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi thao tác tài khoản!");
    }
}

// ==========================================
// STUDIO PRODUCER (PORTAL QUẢN LÝ NHẠC CÁ NHÂN)
// ==========================================
async function openProducerPortal() {
    window.location.href = '/Producer/Upload';
}

window._currentProducerFilter = 'all';

async function loadProducerTracks() {
    const container = document.getElementById('producerTracksTableContainer');
    const countBadge = document.getElementById('producerTracksCountBadge');
    if (!container) return;

    try {
        const res = await fetch('/Producer/MyTracks');
        const json = await res.json();
        if (json.success && json.data) {
            window._allProducerTracks = json.data;
            if (countBadge) countBadge.textContent = `${json.data.length} bài hát`;
            renderProducerTracksTable(window._currentProducerFilter || 'all');
        }
    } catch (e) {
        console.error(e);
    }
}

function filterProducerTracks(filterType) {
    window._currentProducerFilter = filterType;
    renderProducerTracksTable(filterType);
}

function renderProducerTracksTable(filterType) {
    const container = document.getElementById('producerTracksTableContainer');
    if (!container || !window._allProducerTracks) return;

    const allData = window._allProducerTracks;
    const tracksOnly = allData.filter(m => m.type !== 'Nonstop' && !m.categoryCode?.startsWith('Nonstop'));
    const nonstopsOnly = allData.filter(m => m.type === 'Nonstop' || m.categoryCode?.startsWith('Nonstop'));

    let displayData = allData;
    if (filterType === 'track') displayData = tracksOnly;
    else if (filterType === 'nonstop') displayData = nonstopsOnly;

    if (allData.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-dim"><i class="fas fa-music fa-2x mb-2 d-block text-warning"></i>Bạn chưa phát hành bài hát nào. Hãy bấm <strong>"Upload Bài Nhạc Mới"</strong> để tải lên file âm thanh bản gốc!</div>';
        return;
    }

    let filterToolbar = `
        <div class="d-flex flex-wrap align-items-center justify-content-between mb-3 p-2 rounded-3 bg-dark border border-secondary border-opacity-25 gap-2">
            <div class="d-flex gap-2">
                <button class="btn btn-sm ${filterType === 'all' ? 'btn-secondary text-white' : 'btn-dark text-dim'} rounded-pill px-3 py-1 fw-bold" onclick="filterProducerTracks('all')">
                    Tất Cả (${allData.length})
                </button>
                <button class="btn btn-sm ${filterType === 'track' ? 'btn-info text-dark' : 'btn-dark text-info'} rounded-pill px-3 py-1 fw-bold" onclick="filterProducerTracks('track')">
                    <i class="fas fa-compact-disc me-1"></i> Track Đơn (${tracksOnly.length})
                </button>
                <button class="btn btn-sm ${filterType === 'nonstop' ? 'btn-warning text-dark' : 'btn-dark text-warning'} rounded-pill px-3 py-1 fw-bold" onclick="filterProducerTracks('nonstop')">
                    <i class="fas fa-fire-flame-curved me-1"></i> Nonstop (${nonstopsOnly.length})
                </button>
            </div>
            <span class="text-dim small me-2"><i class="fas fa-sliders text-warning me-1"></i>Đang hiển thị: <strong>${displayData.length}</strong> bài</span>
        </div>
    `;

    if (displayData.length === 0) {
        container.innerHTML = filterToolbar + `<div class="p-4 text-center text-dim">Không có bài nào thuộc danh mục ${filterType === 'track' ? 'Track Đơn' : 'Nonstop'}.</div>`;
        return;
    }

    let rows = displayData.map(m => {
        const isNonstop = m.type === 'Nonstop' || m.categoryCode?.startsWith('Nonstop');
        const safeTitle = (m.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeArtist = (m.artist || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeAudioUrl = (m.sourceUrl || '').replace(/'/g, "\\'");
        const isSlot = m.categoryCode?.includes('Slot');
        const isNhom = !isSlot && m.categoryCode?.includes('Nhom');
        const trackKind = isSlot ? 'slot' : (isNhom ? 'nhom' : 'lot');
        const isWav = m.qualityAvailable && m.qualityAvailable.toUpperCase().includes('WAV');

        return `
            <tr class="align-middle border-bottom border-secondary border-opacity-10">
                <td style="width: 44px;" class="ps-2">
                    <button class="btn btn-sm btn-outline-warning rounded-circle p-1 d-flex align-items-center justify-content-center" 
                            style="width: 32px; height: 32px;"
                            onclick='playTrack({
                                id: "${m.musicId}",
                                title: "${safeTitle}",
                                artist: "${safeArtist}",
                                audioUrl: "${safeAudioUrl}",
                                bpm: ${m.bpm || 140},
                                key: "${m.musicalKey || '8A'}",
                                durationSeconds: ${m.durationSeconds || 240},
                                quality: "${isWav ? 'WAV' : 'MP3'}",
                                trackType: "${trackKind}",
                                isDemo: false
                            })' 
                            title="Phát bài này">
                        <i class="fas fa-play" style="font-size: 0.75rem;"></i>
                    </button>
                </td>
                <td style="min-width: 260px; max-width: 420px;">
                    <div class="d-flex align-items-start gap-2">
                        <span class="badge ${isNonstop ? 'bg-warning text-dark' : 'bg-info text-dark'} flex-shrink-0 mt-0.5" style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.5px; padding: 3px 6px;">
                            ${isNonstop ? 'NONSTOP' : 'TRACK'}
                        </span>
                        <div class="flex-grow-1" style="min-width: 0;">
                            <div style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; font-size: 0.92rem; font-weight: 700; color: #ffffff; word-break: break-word;" title="${safeTitle}">
                                ${m.title}
                            </div>
                            <div class="text-dim small mt-0.5 text-truncate" style="max-width: 100%;">
                                <span class="text-warning">${m.artist}</span> • <span class="text-silver">${m.genre}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="text-nowrap">
                    <span class="badge ${isSlot ? 'badge-premium-gold' : (isNhom ? 'badge-standard-red' : 'bg-secondary')} fw-bold" style="font-size: 0.72rem;">
                        ${isSlot ? '👑 Slot VIP' : (isNhom ? '💎 Nhóm VIP' : '🎵 Track Lọt')}
                    </span>
                </td>
                <td class="font-monospace small text-nowrap">
                    <span class="badge-shimmer-ruby px-2 py-0.5">${m.bpm ? m.bpm + ' BPM' : '--'}</span>
                    <span class="badge-shimmer-cyan px-2 py-0.5 ms-1">${m.musicalKey || '--'}</span>
                </td>
                <td class="text-nowrap">
                    <span class="badge ${isWav ? 'badge-premium-gold' : 'badge-standard-red'} font-monospace fw-bold" style="font-size: 0.72rem; padding: 2px 7px;">
                        ${isWav ? 'WAV' : 'MP3'}
                    </span>
                </td>
                <td class="text-nowrap small font-monospace text-center">
                    <span class="text-info" title="Lượt nghe"><i class="fas fa-headphones me-1"></i>${m.playsCount || 0}</span>
                    <span class="text-muted mx-1">/</span>
                    <span class="text-success" title="Lượt tải"><i class="fas fa-download me-1"></i>${m.downloadsCount || 0}</span>
                </td>
                <td class="text-nowrap">
                    <span class="badge bg-success-subtle text-success border border-success border-opacity-25 px-2 py-1" style="font-size: 0.72rem;">
                        <i class="fas fa-check-circle me-1"></i>${m.status === 'Published' ? 'Đã duyệt' : m.status}
                    </span>
                </td>
                <td class="text-end pe-2 text-nowrap">
                    <button class="btn btn-sm btn-outline-danger py-1 px-2.5 rounded-pill" onclick="deleteProducerTrack('${m.musicId}', '${safeTitle}')" title="Xóa bài hát khỏi kho">
                        <i class="fas fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = filterToolbar + `
        <div class="table-responsive">
            <table class="table table-dark table-hover mb-0 small" style="background: transparent;">
                <thead style="background: rgba(14, 15, 26, 0.9);">
                    <tr class="text-dim border-bottom border-secondary border-opacity-25">
                        <th style="width: 44px;" class="ps-2"></th>
                        <th style="min-width: 260px;">Tên Bản Thu & Nghệ Sĩ</th>
                        <th>Phân Cấp</th>
                        <th>BPM / Key</th>
                        <th>Chất Lượng</th>
                        <th class="text-center">Nghe / Tải</th>
                        <th>Trạng Thái</th>
                        <th class="text-end pe-2" style="width: 70px;">Xóa</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function deleteProducerTrack(musicId, title) {
    if (!confirm(`Bạn có chắc chắn muốn xóa bài hát "${title}" khỏi hệ thống không?`)) return;

    try {
        const res = await fetch('/Producer/DeleteTrack/' + musicId, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            showToastNotification(`🗑️ ${json.message}`);
            loadProducerTracks();
            setTimeout(() => location.reload(), 1500);
        } else {
            showToastNotification(`❌ ${json.message || 'Xóa thất bại!'}`);
        }
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi xóa bài hát!");
    }
}

// CẬP NHẬT MÀU DẢI TIẾN TRÌNH CON TRỎ TUA NHẠC
function updateSeekSliderProgress(seekSlider) {
    if (!seekSlider) return;
    const val = parseFloat(seekSlider.value) || 0;
    const isSlot = document.body.classList.contains('playing-slot');
    const isNhom = document.body.classList.contains('playing-nhom');
    const color = isSlot ? '#ffd166' : (isNhom ? '#ff134a' : '#00b4d8');
    seekSlider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${val}%, rgba(255, 255, 255, 0.18) ${val}%, rgba(255, 255, 255, 0.18) 100%)`;
}

