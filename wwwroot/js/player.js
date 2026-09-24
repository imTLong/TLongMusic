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
    restorePlaybackState();
});

// Authentication System - Connected to Kho dữ liệu via /Auth API
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

// ==========================================
// SEAMLESS PLAYBACK PERSISTENCE ACROSS ACTIONS & PAGES
// (Chỉ duy trì phát trên các trang công khai, ngắt trước khi vào Admin / Producer)
// ==========================================
function savePlaybackState() {
    const path = window.location.pathname.toLowerCase();
    // Tuyệt đối không lưu và không duy trì nhạc nền khi đang ở trong Admin hoặc Producer
    if (path.startsWith('/admin') || path.startsWith('/producer')) {
        try { sessionStorage.removeItem('tlong_playback_state'); } catch (e) {}
        return;
    }

    const currentTrack = window.TLongPlayer?.currentTrack;
    const audio = window.TLongPlayer?.audio;
    if (!currentTrack || !audio) return;

    if (!audio.paused && window.TLongPlayer.isPlaying) {
        const state = {
            track: currentTrack,
            currentTime: audio.currentTime || 0,
            isPlaying: true,
            timestamp: Date.now()
        };
        try {
            sessionStorage.setItem('tlong_playback_state', JSON.stringify(state));
        } catch (e) {}
    } else {
        try {
            sessionStorage.removeItem('tlong_playback_state');
        } catch (e) {}
    }
}

function restorePlaybackState() {
    const path = window.location.pathname.toLowerCase();
    // Trước khi vào các chức năng quản lý của Producer và Admin: dừng nhạc và không khôi phục
    if (path.startsWith('/admin') || path.startsWith('/producer')) {
        try {
            sessionStorage.removeItem('tlong_playback_state');
            if (window.TLongPlayer?.audio) {
                window.TLongPlayer.audio.pause();
                window.TLongPlayer.isPlaying = false;
            }
        } catch (e) {}
        return;
    }

    try {
        const raw = sessionStorage.getItem('tlong_playback_state');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !state.track || !state.isPlaying) return;

        // Chỉ khôi phục nếu chuyển trang trong vòng 60 giây
        const elapsedSec = (Date.now() - (state.timestamp || Date.now())) / 1000;
        if (elapsedSec > 60) {
            sessionStorage.removeItem('tlong_playback_state');
            return;
        }

        const track = state.track;
        let resumeTime = (state.currentTime || 0) + elapsedSec;
        if (isDemoPlayback(track)) {
            const limit = track.demoLimit || 30;
            if (resumeTime >= limit) {
                resumeTime = 0;
            }
        }

        window.TLongPlayer.currentTrack = track;
        const audio = window.TLongPlayer.audio;

        const titleEl = document.getElementById('playerTrackTitle');
        const artistEl = document.getElementById('playerTrackArtist');
        const coverEl = document.getElementById('playerTrackCover');
        const bpmEl = document.getElementById('playerTrackBpm');
        const keyEl = document.getElementById('playerTrackKey');
        const qualityEl = document.getElementById('playerTrackQuality');
        const durationEl = document.getElementById('playerDuration');

        if (titleEl) titleEl.textContent = track.title;
        if (artistEl) artistEl.textContent = track.artist || 'DJ TLong Studio';
        if (coverEl) coverEl.src = track.coverUrl || '/images/logo.png';
        if (bpmEl && track.bpm) bpmEl.textContent = `${track.bpm} BPM`;
        if (keyEl && track.key) keyEl.textContent = track.key;
        if (qualityEl && track.quality) qualityEl.textContent = track.quality;
        if (durationEl && track.durationSeconds) durationEl.textContent = formatTime(track.durationSeconds);

        updateDemoBadge();

        if (track.audioUrl) {
            audio.src = track.audioUrl;
            audio.currentTime = Math.max(0, resumeTime);

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    window.TLongPlayer.isPlaying = true;
                    updatePlayPauseButton();
                }).catch(() => {
                    // Nếu chính sách trình duyệt yêu cầu click người dùng
                    window.TLongPlayer.isPlaying = false;
                    updatePlayPauseButton();
                    const resumeOnFirstClick = () => {
                        audio.play().then(() => {
                            window.TLongPlayer.isPlaying = true;
                            updatePlayPauseButton();
                        }).catch(() => {});
                    };
                    document.addEventListener('click', resumeOnFirstClick, { once: true });
                });
            }
        }
    } catch (e) {
        console.warn("restorePlaybackState error:", e);
    }
}

// ==========================================
// ZERO-LATENCY SEAMLESS SPA NAVIGATION ENGINE
// (Giữ nhạc phát liên tục 100% không ngắt quãng, không độ trễ khi chuyển trang)
// ==========================================
let isNavigatingSeamlessly = false;

function showTopLoadingBar() {
    const bar = document.getElementById('seamlessProgressBar');
    if (!bar) return;
    bar.style.transition = 'width 0.2s ease, opacity 0.15s ease';
    bar.style.width = '25%';
    bar.classList.add('loading');
    setTimeout(() => {
        if (bar.classList.contains('loading')) {
            bar.style.width = '75%';
        }
    }, 150);
}

function hideTopLoadingBar() {
    const bar = document.getElementById('seamlessProgressBar');
    if (!bar) return;
    bar.style.width = '100%';
    setTimeout(() => {
        bar.classList.remove('loading');
        setTimeout(() => {
            bar.style.width = '0%';
        }, 200);
    }, 100);
}

function closeMobileNav() {
    const navCollapse = document.getElementById('tlongNavCollapse');
    if (navCollapse && navCollapse.classList.contains('show')) {
        try {
            if (window.bootstrap?.Collapse) {
                const bsCollapse = window.bootstrap.Collapse.getInstance(navCollapse) || new window.bootstrap.Collapse(navCollapse, { toggle: false });
                bsCollapse.hide();
            } else {
                navCollapse.classList.remove('show');
            }
        } catch(e) {
            navCollapse.classList.remove('show');
        }
    }
}

function updateActiveNavLinks(targetPathname) {
    const path = targetPathname.toLowerCase();
    document.querySelectorAll('.tlong-navbar .nav-link').forEach(link => {
        const href = (link.getAttribute('href') || '').toLowerCase();
        if (href === '/' || href === '/home' || href === '/home/index') {
            if (path === '/' || path === '/home' || path === '/home/index') {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        } else if (href.startsWith('/track')) {
            if (path.startsWith('/track')) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        } else if (href.startsWith('/nonstop')) {
            if (path.startsWith('/nonstop')) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        }
    });
}

function runScriptsInElement(container) {
    if (!container) return;
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
        if (oldScript.src && (oldScript.src.includes('jquery') || oldScript.src.includes('bootstrap') || oldScript.src.includes('player.js'))) {
            return;
        }
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
        });
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

async function navigateSeamlessly(urlStr, pushState = true) {
    if (isNavigatingSeamlessly) return;
    isNavigatingSeamlessly = true;

    const targetUrl = new URL(urlStr, window.location.origin);
    showTopLoadingBar();

    try {
        const response = await fetch(targetUrl.href, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            window.location.href = targetUrl.href;
            return;
        }

        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const newMain = doc.querySelector('#mainContentApp') || doc.querySelector('main');
        const currentMain = document.querySelector('#mainContentApp') || document.querySelector('main');

        if (!newMain || !currentMain) {
            window.location.href = targetUrl.href;
            return;
        }

        // 1. Hoán đổi phần nội dung chính <main>
        currentMain.innerHTML = newMain.innerHTML;

        // 2. Cập nhật tiêu đề trang
        if (doc.title) {
            document.title = doc.title;
        }

        // 3. Cập nhật trạng thái active thanh menu điều hướng
        updateActiveNavLinks(targetUrl.pathname);

        // 4. Cập nhật thanh địa chỉ URL của trình duyệt
        if (pushState) {
            window.history.pushState({ path: targetUrl.href }, doc.title || '', targetUrl.href);
        }

        // 5. Chạy các script động của trang mới
        const newScriptsContainer = doc.querySelector('#pageDynamicScripts');
        const currentScriptsContainer = document.querySelector('#pageDynamicScripts');
        if (newScriptsContainer && currentScriptsContainer) {
            currentScriptsContainer.innerHTML = newScriptsContainer.innerHTML;
            runScriptsInElement(currentScriptsContainer);
        }
        runScriptsInElement(currentMain);

        // 6. Cuộn trang mượt mà (nếu có anchor # thì cuộn tới phần đó, không thì lên đầu trang)
        if (targetUrl.hash) {
            setTimeout(() => {
                const targetElem = document.querySelector(targetUrl.hash);
                if (targetElem) targetElem.scrollIntoView({ behavior: 'smooth' });
            }, 80);
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        // 7. Đồng bộ giao diện nếu trang vừa chuyển đến là trang Chi tiết của bài hát đang phát
        if (typeof window.syncDetailWaveWithAudio === 'function') {
            window.syncDetailWaveWithAudio();
        }
        if (typeof window.initTrackDetailPage === 'function') {
            window.initTrackDetailPage();
        }

        // 8. Đồng bộ phân quyền và trạng thái nút Play
        if (typeof updateTierUI === 'function') updateTierUI();
        if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
        if (typeof window.syncUserHomepagePrivileges === 'function') {
            window.syncUserHomepagePrivileges();
        }

    } catch (err) {
        console.warn("Seamless navigation error, fallback to normal load:", err);
        window.location.href = targetUrl.href;
    } finally {
        hideTopLoadingBar();
        isNavigatingSeamlessly = false;
    }
}
window.navigateSeamlessly = navigateSeamlessly;

// Lắng nghe sự kiện click trên toàn bộ liên kết nội bộ
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;

    // Bỏ qua nếu click chuột phải, giữ Ctrl/Cmd (mở tab mới), download, hoặc nút đóng
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.target === '_blank' || link.hasAttribute('download') || (link.getAttribute('role') === 'button' && link.href.endsWith('#'))) return;

    try {
        const url = new URL(link.href, window.location.origin);
        // Chỉ xử lý các liên kết cùng tên miền
        if (url.origin !== window.location.origin) return;

        const targetPath = url.pathname.toLowerCase();

        // 1. Nếu vào Admin hoặc Producer: Dừng nhạc ngay lập tức & để trình duyệt chuyển trang bình thường
        if (targetPath.startsWith('/admin') || targetPath.startsWith('/producer')) {
            sessionStorage.removeItem('tlong_playback_state');
            if (window.TLongPlayer?.audio) {
                try {
                    window.TLongPlayer.audio.pause();
                    window.TLongPlayer.isPlaying = false;
                    updatePlayPauseButton();
                } catch (err) {}
            }
            return;
        }

        // 2. Nếu là liên kết Anchor hash trên cùng trang hiện tại
        if (url.pathname.toLowerCase() === window.location.pathname.toLowerCase() && url.hash) {
            e.preventDefault();
            closeMobileNav();
            const targetEl = document.querySelector(url.hash);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth' });
                history.pushState(null, '', url.href);
            }
            return;
        }

        // 3. Bỏ qua các API, file ảnh, thanh toán checkout modal
        if (targetPath.startsWith('/api') || targetPath.startsWith('/auth/logout') || targetPath.startsWith('/images/')) {
            return;
        }

        // Nếu là nút Mua VIP / Nâng cấp VIP -> mở modal không cần tải lại
        if (targetPath.startsWith('/payment/checkout')) {
            return;
        }

        // 4. CHUYỂN TRANG MƯỢT KHÔNG TẢI LẠI (SEAMLESS SPA)
        e.preventDefault();
        closeMobileNav();
        navigateSeamlessly(url.href, true);
    } catch (err) {
        console.warn("Link navigation error:", err);
    }
});

// Lắng nghe sự kiện Back/Forward của trình duyệt
window.addEventListener('popstate', (e) => {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith('/admin') || path.startsWith('/producer')) {
        window.location.reload();
        return;
    }
    navigateSeamlessly(window.location.href, false);
});

window.addEventListener('beforeunload', () => {
    savePlaybackState();
});

// ==========================================
// TÍNH NĂNG LỌC TIER KHÔNG TẢI LẠI TRANG (GIỮ NHẠC KHÔNG BỊ NGẮT KHI BẤM)
// ==========================================
function applyNonstopTierFilter(tier, event) {
    if (event) event.preventDefault();
    const cleanTier = (tier || 'all').toLowerCase();

    // 1. Cập nhật URL trong thanh địa chỉ không tải lại trang
    const newUrl = cleanTier === 'all' ? '/Nonstop' : `/Nonstop?tier=${cleanTier}`;
    try { window.history.pushState({ tier: cleanTier }, '', newUrl); } catch(e) {}

    // 2. Cập nhật active pill buttons
    document.querySelectorAll('.pill-all, .pill-nhom, .pill-slot, .pill-lot').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('border-secondary');
    });
    const activePill = document.querySelector(`.pill-${cleanTier}`);
    if (activePill) {
        activePill.classList.add('active');
        activePill.classList.remove('border-secondary');
    }

    // 3. Lọc các dòng trong bảng
    document.querySelectorAll('.daily-track-section').forEach(section => {
        let hasVisible = false;
        const rows = section.querySelectorAll('tr.crystal-table-row');
        rows.forEach(row => {
            const trackType = (row.dataset.trackType || '').toLowerCase();
            const match = cleanTier === 'all' || trackType === cleanTier;
            row.style.display = match ? '' : 'none';
            if (match) hasVisible = true;
        });
        section.style.display = hasVisible ? '' : 'none';
    });

    // 4. Cập nhật thông báo badge
    const slotNotice = document.getElementById('badgeDemoNonstopSlotNotice');
    const nhomNotice = document.getElementById('badgeNonstopNhomNotice');
    if (slotNotice) slotNotice.className = cleanTier === 'slot' ? 'badge bg-warning text-dark fw-bold px-3 py-1.5 rounded-pill shadow' : 'd-none';
    if (nhomNotice) nhomNotice.className = cleanTier === 'nhom' ? 'badge bg-danger text-white fw-bold px-3 py-1.5 rounded-pill shadow' : 'd-none';

    return false;
}
window.applyNonstopTierFilter = applyNonstopTierFilter;

function applyTrackTierFilter(tier, event) {
    if (event) event.preventDefault();
    const cleanTier = (tier || 'all').toLowerCase();

    const newUrl = cleanTier === 'all' ? '/Track' : `/Track?tier=${cleanTier}`;
    try { window.history.pushState({ tier: cleanTier }, '', newUrl); } catch(e) {}

    document.querySelectorAll('.pill-all, .pill-nhom, .pill-slot, .pill-lot').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('border-secondary');
    });
    const activePill = document.querySelector(`.pill-${cleanTier}`);
    if (activePill) {
        activePill.classList.add('active');
        activePill.classList.remove('border-secondary');
    }

    document.querySelectorAll('.daily-track-section').forEach(section => {
        let hasVisible = false;
        const rows = section.querySelectorAll('tr.crystal-table-row');
        rows.forEach(row => {
            const trackType = (row.dataset.trackType || '').toLowerCase();
            const match = cleanTier === 'all' || trackType === cleanTier;
            row.style.display = match ? '' : 'none';
            if (match) hasVisible = true;
        });
        section.style.display = hasVisible ? '' : 'none';
    });

    const slotNotice = document.getElementById('badgeDemoSlotNotice');
    const nhomNotice = document.getElementById('badgeTrackNhomNotice');
    if (slotNotice) slotNotice.className = cleanTier === 'slot' ? 'badge bg-warning text-dark fw-bold px-3 py-1.5 rounded-pill shadow' : 'd-none';
    if (nhomNotice) nhomNotice.className = cleanTier === 'nhom' ? 'badge bg-danger text-white fw-bold px-3 py-1.5 rounded-pill shadow' : 'd-none';

    return false;
}
window.applyTrackTierFilter = applyTrackTierFilter;

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
                <a href="/Producer/UploadTrack" class="btn btn-outline-info fw-bold rounded-pill px-3 py-1 shadow d-flex align-items-center gap-1 text-nowrap flex-shrink-0 text-decoration-none" 
                   style="border-width: 2px; color: #00b4d8; border-color: #00b4d8; box-shadow: 0 0 12px rgba(0, 180, 216, 0.4); background: rgba(0, 180, 216, 0.12); white-space: nowrap; font-size: 0.82rem;">
                    <i class="fas fa-compact-disc text-info"></i>
                    <span class="text-white text-nowrap">ĐĂNG TRACK LẺ</span>
                </a>
                <a href="/Producer/UploadNonstop" class="btn btn-outline-warning fw-bold rounded-pill px-3 py-1 shadow d-flex align-items-center gap-1 text-nowrap flex-shrink-0 text-decoration-none" 
                   style="border-width: 2px; color: #ffd166; border-color: #ffd166; box-shadow: 0 0 12px rgba(255, 209, 102, 0.4); background: rgba(255, 209, 102, 0.12); white-space: nowrap; font-size: 0.82rem;">
                    <i class="fas fa-fire-flame-curved text-warning"></i>
                    <span class="text-white text-nowrap">ĐĂNG NONSTOP</span>
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
                        <a href="/Producer/UploadTrack" class="dropdown-item py-2 text-info fw-bold">
                            <i class="fas fa-compact-disc me-2 text-info"></i> 🎵 Đăng Track Lẻ (BPM & Key)
                        </a>
                    </li>
                    <li>
                        <a href="/Producer/UploadNonstop" class="dropdown-item py-2 text-warning fw-bold">
                            <i class="fas fa-fire-flame-curved me-2 text-warning"></i> 🔥 Đăng Nonstop Dài (Set Mix)
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

    if (typeof window.syncUserHomepagePrivileges === 'function') {
        window.syncUserHomepagePrivileges();
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

    window.TLongPlayer.isSeeking = false;

    audio.addEventListener('seeking', () => {
        window.TLongPlayer.isSeeking = true;
        const currentTrack = window.TLongPlayer.currentTrack;
        if (currentTrack && isDemoPlayback(currentTrack)) {
            const limit = currentTrack.demoLimit || 30;
            if (audio.currentTime >= limit) {
                audio.currentTime = 0;
                pauseTrack();
                const currentTimeElem = document.getElementById('playerCurrentTime');
                if (currentTimeElem) currentTimeElem.textContent = '0:00';
                const seekSlider = document.getElementById('playerSeekSlider');
                if (seekSlider) {
                    seekSlider.value = 0;
                    updateSeekSliderProgress(seekSlider);
                }
                if (typeof renderWaveform === 'function') {
                    renderWaveform(0);
                }
                const detailCurrentTime = document.getElementById('detailCurrentTime');
                if (detailCurrentTime) detailCurrentTime.textContent = '0:00';
                showDemoLimitModal();
            }
        }
    });

    audio.addEventListener('seeked', () => {
        window.TLongPlayer.isSeeking = false;
        const seekSlider = document.getElementById('playerSeekSlider');
        if (seekSlider) seekSlider.dataset.dragging = '';
        const currentTrack = window.TLongPlayer.currentTrack;
        if (currentTrack && isDemoPlayback(currentTrack)) {
            const limit = currentTrack.demoLimit || 30;
            if (audio.currentTime >= limit) {
                audio.currentTime = 0;
                pauseTrack();
                const currentTimeElem = document.getElementById('playerCurrentTime');
                if (currentTimeElem) currentTimeElem.textContent = '0:00';
                if (seekSlider) {
                    seekSlider.value = 0;
                    updateSeekSliderProgress(seekSlider);
                }
                if (typeof renderWaveform === 'function') {
                    renderWaveform(0);
                }
                const detailCurrentTime = document.getElementById('detailCurrentTime');
                if (detailCurrentTime) detailCurrentTime.textContent = '0:00';
                showDemoLimitModal();
            }
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

        if (seekSlider && !window.TLongPlayer.isSeeking && !seekSlider.dataset.dragging && duration > 0) {
            seekSlider.value = (currentTime / duration) * 100 || 0;
            updateSeekSliderProgress(seekSlider);
        }

        if (currentTimeElem && !window.TLongPlayer.isSeeking && (!seekSlider || !seekSlider.dataset.dragging)) {
            currentTimeElem.textContent = formatTime(currentTime);
        }
        if (durationElem && duration > 0) {
            durationElem.textContent = formatTime(duration);
        }

        if (!window._lastStateSaveTime || Date.now() - window._lastStateSaveTime > 1500) {
            window._lastStateSaveTime = Date.now();
            savePlaybackState();
        }

        // Demo limit enforcement for Standard / Free / Guest on Slot VIP tracks and Nonstops
        const currentTrack = window.TLongPlayer.currentTrack;
        if (currentTrack && isDemoPlayback(currentTrack)) {
            const limit = currentTrack.demoLimit || 30;
            if (currentTime >= limit) {
                pauseTrack();
                audio.currentTime = 0;
                if (currentTimeElem) currentTimeElem.textContent = '0:00';
                if (seekSlider) {
                    seekSlider.value = 0;
                    updateSeekSliderProgress(seekSlider);
                }
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
        const startSeekInteraction = () => {
            window.TLongPlayer.isSeeking = true;
            seekSlider.dataset.dragging = 'true';
        };

        seekSlider.addEventListener('mousedown', startSeekInteraction);
        seekSlider.addEventListener('touchstart', startSeekInteraction, { passive: true });

        seekSlider.addEventListener('input', (e) => {
            window.TLongPlayer.isSeeking = true;
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
                    if (targetTime >= limit) {
                        // Tua quá số giây demo -> Chặn lại, đưa về 0 và bật popup VIP ngay lập tức
                        audio.currentTime = 0;
                        pauseTrack();
                        seekSlider.value = 0;
                        updateSeekSliderProgress(seekSlider);
                        const currentTimeElem = document.getElementById('playerCurrentTime');
                        if (currentTimeElem) currentTimeElem.textContent = '0:00';
                        if (typeof renderWaveform === 'function') {
                            renderWaveform(0);
                        }
                        const detailCurrentTime = document.getElementById('detailCurrentTime');
                        if (detailCurrentTime) detailCurrentTime.textContent = '0:00';
                        window.TLongPlayer.isSeeking = false;
                        seekSlider.dataset.dragging = '';
                        showDemoLimitModal();
                        return;
                    }
                }
                const currentTimeElem = document.getElementById('playerCurrentTime');
                if (currentTimeElem) currentTimeElem.textContent = formatTime(targetTime);
            }
        });

        const commitSeek = (e) => {
            const dur = audio.duration;
            const duration = (dur && !isNaN(dur) && isFinite(dur) && dur > 0)
                ? dur
                : (window.TLongPlayer.currentTrack ? window.TLongPlayer.currentTrack.durationSeconds : 0);

            if (duration > 0) {
                let targetTime = (parseFloat(seekSlider.value) / 100) * duration;
                const currentTrack = window.TLongPlayer.currentTrack;
                if (currentTrack && isDemoPlayback(currentTrack)) {
                    const limit = currentTrack.demoLimit || 30;
                    if (targetTime >= limit) {
                        // Tua quá số giây demo khi thả chuột/thả tay -> Chặn lại và bật popup VIP
                        targetTime = 0;
                        audio.currentTime = 0;
                        pauseTrack();
                        const currentTimeElem = document.getElementById('playerCurrentTime');
                        if (currentTimeElem) currentTimeElem.textContent = '0:00';
                        seekSlider.value = 0;
                        updateSeekSliderProgress(seekSlider);
                        if (typeof renderWaveform === 'function') {
                            renderWaveform(0);
                        }
                        const detailCurrentTime = document.getElementById('detailCurrentTime');
                        if (detailCurrentTime) detailCurrentTime.textContent = '0:00';
                        window.TLongPlayer.isSeeking = false;
                        seekSlider.dataset.dragging = '';
                        showDemoLimitModal();
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
                window.TLongPlayer.isSeeking = false;
                seekSlider.dataset.dragging = '';
            }, 250);
        };

        seekSlider.addEventListener('change', commitSeek);
        seekSlider.addEventListener('mouseup', commitSeek);
        seekSlider.addEventListener('touchend', commitSeek);
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

// Hàm nhận diện chuẩn Nonstop
function isNonstopTrack(track) {
    if (!track) return false;
    const catCode = (track.categoryCode || '').toLowerCase();
    const type = (track.type || track.trackType || track.kind || '').toLowerCase();
    const key = (track.key || track.musicalKey || '').toLowerCase();
    const title = (track.title || '').toLowerCase();
    const bpm = Number(track.bpm);

    return catCode.includes('nonstop') ||
           type.includes('nonstop') ||
           key === 'nonstop' ||
           title.includes('nonstop') ||
           (track.bpm !== undefined && track.bpm !== null && !isNaN(bpm) && bpm <= 0);
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

    // 3. Nhận diện bài hát thuộc nhóm Slot VIP (Track Slot & Nonstop Slot):
    const isSlot = (track.tierRequired && track.tierRequired.toLowerCase() === 'premium') ||
                   (track.categoryCode && track.categoryCode.toLowerCase().includes('slot')) ||
                   (track.trackType && track.trackType.toLowerCase().includes('slot')) ||
                   (track.type && track.type.toLowerCase().includes('slot')) ||
                   (track.kind && track.kind.toLowerCase().includes('slot')) ||
                   (track.title && (track.title.toLowerCase().includes('slot') || track.title.includes('DUBPLATE') || track.title.includes('BẢN ĐẶT')));

    // 4. Tài khoản Standard VIP:
    // - Nhạc Slot VIP: BẮT BUỘC CHỈ ĐƯỢC NGHE DEMO, KHÔNG ĐƯỢC NGHE FULL!
    // - Nhạc Nhóm & Lọt: Nghe Full trọn vẹn
    if (tier === 'standard') {
        return isSlot || (track.isDemo && track.tierRequired && track.tierRequired.toLowerCase() === 'premium');
    }

    // 5. Tài khoản Free / Khách vãng lai:
    // - Nhạc Slot VIP & Nhóm VIP: Bắt buộc chỉ được nghe Demo
    const isNhom = (track.tierRequired && track.tierRequired.toLowerCase() === 'standard') ||
                   (track.categoryCode && track.categoryCode.toLowerCase().includes('nhom')) ||
                   (track.trackType && track.trackType.toLowerCase().includes('nhom')) ||
                   (track.type && track.type.toLowerCase().includes('nhom')) ||
                   (track.kind && track.kind.toLowerCase().includes('nhom'));

    return isSlot || isNhom || track.isDemo === true || (track.demoLimit && track.demoLimit > 0 && tier !== 'premium');
}

function showDemoLimitModal() {
    const track = window.TLongPlayer.currentTrack;
    const tier = (window.TLongPlayer.userTier || 'free').toLowerCase();
    const isStandard = tier === 'standard';

    const isNonstop = isNonstopTrack(track);
    const demoSec = track?.demoLimit || 30;

    const modalElem = document.getElementById('vipUpgradeModal');
    if (!modalElem) return;

    // Reset cờ nếu modal không hiển thị
    if (!modalElem.classList.contains('show')) {
        window.TLongPlayer._isDemoModalShowing = false;
    }

    // Tránh mở trùng lặp nếu modal đang hiển thị
    if (window.TLongPlayer._isDemoModalShowing) {
        return;
    }
    window.TLongPlayer._isDemoModalShowing = true;

    const isSlot = (track && (
        (track.tierRequired && track.tierRequired.toLowerCase() === 'premium') ||
        (track.categoryCode && track.categoryCode.toLowerCase().includes('slot')) ||
        (track.trackType && track.trackType.toLowerCase().includes('slot')) ||
        (track.title && track.title.toLowerCase().includes('slot'))
    ));

    const modalContent = modalElem.querySelector('.modal-content');
    const modalTitle = modalElem.querySelector('.modal-title');

    if (!isSlot) {
        // ==========================================
        // POPUP DEMO DÀNH CHO TRACK NHÓM / NONSTOP NHÓM (MÀU ĐỎ RUBY)
        // ==========================================
        if (modalContent) {
            modalContent.style.border = '1px solid rgba(255, 19, 74, 0.6)';
            modalContent.style.boxShadow = '0 0 50px rgba(255, 19, 74, 0.4)';
        }
        if (modalTitle) {
            modalTitle.innerHTML = '<i class="fas fa-certificate text-danger me-2"></i> TLongMusic Standard VIP';
        }

        const nhomBadgeText = isNonstop ? '🔒 KHO NONSTOP NHÓM VIP' : '🔒 KHO TRACK NHÓM VIP';
        const nhomName = isNonstop ? 'Nonstop Nhóm VIP' : 'Track Nhóm VIP';

        showVipModal(`
            <div class="text-center py-3 px-2">
                <div class="mb-3 mx-auto d-flex align-items-center justify-content-center rounded-circle" style="width: 76px; height: 76px; background: rgba(255, 19, 74, 0.15); border: 1px solid rgba(255, 19, 74, 0.5); box-shadow: 0 0 30px rgba(255, 19, 74, 0.35);">
                    <i class="fas fa-certificate" style="font-size: 2.1rem; color: #ff134a;"></i>
                </div>
                <h3 class="text-white fw-bold mb-3" style="font-size: 1.55rem; letter-spacing: -0.3px;">Hết Thời Gian Demo ${demoSec} Giây</h3>
                <div class="mb-3">
                    <span class="badge px-3.5 py-1.5 rounded-pill fw-bold text-white font-monospace" style="background: linear-gradient(135deg, #ff134a, #d90429); box-shadow: 0 0 15px rgba(255, 19, 74, 0.4); font-size: 0.82rem; letter-spacing: 0.5px;">
                        <i class="fas fa-lock me-1"></i> ${nhomBadgeText}
                    </span>
                </div>
                <p class="text-white mb-2" style="font-size: 0.95rem; line-height: 1.6; max-width: 480px; margin: 0 auto;">
                    Tài khoản của bạn là <strong>Free / Khách</strong> chỉ được nghe thử demo <strong>${demoSec} giây</strong> đối với kho <strong>${nhomName}</strong>.
                </p>
                <p class="text-dim mb-4" style="font-size: 0.88rem; color: #9da3b4; line-height: 1.55; max-width: 460px; margin: 0 auto 1.5rem auto;">
                    Để mở khóa quyền <strong>nghe trọn vẹn 100%</strong> và <strong>tải file MP3 320kbps phòng thu chất lượng cao</strong>, vui lòng nâng cấp lên gói <strong>Standard VIP</strong> (hoặc Premium VIP)!
                </p>
                <div class="d-flex justify-content-center align-items-center gap-3 flex-wrap">
                    <button type="button" class="btn px-4 py-2.5 fw-bold text-white rounded-pill d-flex align-items-center gap-2" style="background: linear-gradient(135deg, #ff134a, #d90429); box-shadow: 0 4px 20px rgba(255, 19, 74, 0.45); font-size: 0.95rem; border: none; padding: 12px 28px;" onclick="openCheckoutModal('Standard VIP', 99000)" data-bs-dismiss="modal">
                        <i class="fas fa-gem"></i> Lên Standard VIP Ngay (99K)
                    </button>
                    <button type="button" class="btn px-4 py-2.5 rounded-pill text-white fw-bold d-flex align-items-center gap-2" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); font-size: 0.95rem; padding: 12px 24px;" data-bs-dismiss="modal" onclick="closeDemoLimitModal()">
                        <i class="fas fa-arrow-left"></i> Đóng & Quay Lại
                    </button>
                </div>
            </div>
        `);
        return;
    }

    // ==========================================
    // POPUP DEMO DÀNH CHO TRACK SLOT / NONSTOP SLOT (MÀU VÀNG KIM PREMIUM)
    // ==========================================
    if (modalContent) {
        modalContent.style.border = '1px solid rgba(255, 209, 102, 0.6)';
        modalContent.style.boxShadow = '0 0 50px rgba(255, 209, 102, 0.35)';
    }
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="fas fa-crown text-warning me-2"></i> TLongMusic VIP Master';
    }

    const badgeText = isNonstop ? '🔒 KHO NONSTOP VIP' : '🔒 KHO TRACK SLOT VIP';

    const tierExplain = isStandard
        ? `Tài khoản của bạn là <strong>Standard VIP</strong> chỉ được nghe thử demo <strong>${demoSec} giây</strong> đối với kho <strong>${isNonstop ? 'Nonstop VIP' : 'Track Slot VIP'}</strong>.`
        : `Bạn đang ở tài khoản <strong>Free / Khách</strong> chỉ được nghe thử demo <strong>${demoSec} giây</strong> đối với kho <strong>${isNonstop ? 'Nonstop VIP' : 'Track Slot VIP'}</strong>.`;

    showVipModal(`
        <div class="text-center py-3 px-2">
            <div class="mb-3 mx-auto d-flex align-items-center justify-content-center rounded-circle" style="width: 76px; height: 76px; background: rgba(255, 209, 102, 0.12); border: 1px solid rgba(255, 209, 102, 0.4); box-shadow: 0 0 30px rgba(255, 209, 102, 0.25);">
                <i class="fas fa-crown" style="font-size: 2.1rem; color: #ffd166;"></i>
            </div>
            <h3 class="text-white fw-bold mb-3" style="font-size: 1.55rem; letter-spacing: -0.3px;">Hết Thời Gian Demo ${demoSec} Giây</h3>
            <div class="mb-3">
                <span class="badge px-3.5 py-1.5 rounded-pill fw-bold text-dark font-monospace" style="background: #ffb703; font-size: 0.82rem; letter-spacing: 0.5px;">
                    <i class="fas fa-lock me-1"></i> ${badgeText}
                </span>
            </div>
            <p class="text-white mb-2" style="font-size: 0.95rem; line-height: 1.6; max-width: 480px; margin: 0 auto;">
                ${tierExplain}
            </p>
            <p class="text-dim mb-4" style="font-size: 0.88rem; color: #9da3b4; line-height: 1.55; max-width: 460px; margin: 0 auto 1.5rem auto;">
                Để mở khóa quyền <strong>nghe trọn vẹn 100% bản Master</strong> và <strong>tải file Lossless WAV 24–Bit phòng thu</strong>, vui lòng nâng cấp lên gói <strong>Premium VIP</strong>!
            </p>
            <div class="d-flex justify-content-center align-items-center gap-3 flex-wrap">
                <button type="button" class="btn px-4 py-2.5 fw-bold text-dark rounded-pill d-flex align-items-center gap-2" style="background: linear-gradient(135deg, #ffc048, #f39c12); box-shadow: 0 4px 20px rgba(243, 156, 18, 0.45); font-size: 0.95rem; border: none; padding: 12px 28px;" onclick="openCheckoutModal('Premium Master', 199000)" data-bs-dismiss="modal">
                    <i class="fas fa-crown"></i> Lên Premium VIP Ngay (199K)
                </button>
                <button type="button" class="btn px-4 py-2.5 rounded-pill text-white fw-bold d-flex align-items-center gap-2" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); font-size: 0.95rem; padding: 12px 24px;" data-bs-dismiss="modal" onclick="closeDemoLimitModal()">
                    <i class="fas fa-arrow-left"></i> Đóng & Quay Lại
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
        window.TLongPlayer._isDemoModalShowing = false;
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
        const limit = currentTrack.demoLimit || 30;
        demoBadge.classList.remove('d-none');
        demoBadge.textContent = `DEMO ${limit}S`;
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
                        if (apiData.isDemo) {
                            window.TLongPlayer.currentTrack.demoLimit = apiData.demoLimit || 30;
                        } else {
                            window.TLongPlayer.currentTrack.demoLimit = 0;
                        }
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

    // Handle BPM & Key display for Nonstop vs Track
    const bpmElem = document.getElementById('playerTrackBpm');
    const keyElem = document.getElementById('playerTrackKey');
    const isNonstop = (trackData.bpm !== undefined && trackData.bpm !== null && Number(trackData.bpm) <= 0)
        || (trackData.key && String(trackData.key).toLowerCase() === 'nonstop')
        || (trackData.categoryCode && String(trackData.categoryCode).toLowerCase().includes('nonstop'))
        || (trackData.trackType && String(trackData.trackType).toLowerCase().includes('nonstop'));

    if (bpmElem) {
        if (isNonstop) {
            bpmElem.textContent = 'NONSTOP';
            bpmElem.className = 'badge bg-danger text-white';
            bpmElem.style.fontSize = '0.6rem';
            bpmElem.style.padding = '1px 5px';
        } else {
            bpmElem.textContent = `${trackData.bpm || '--'} BPM`;
            bpmElem.className = 'badge-shimmer-ruby';
            bpmElem.style.fontSize = '0.6rem';
            bpmElem.style.padding = '1px 5px';
        }
        bpmElem.style.display = '';
    }

    if (keyElem) {
        if (isNonstop) {
            keyElem.style.display = 'none';
        } else {
            keyElem.textContent = trackData.key || '--';
            keyElem.style.display = '';
        }
    }

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
            savePlaybackState();
        }).catch((err) => {
            console.warn("Direct audio play note:", err);
            startBeatSynthesizer();
            window.TLongPlayer.isPlaying = true;
            updatePlayPauseButton();
            savePlaybackState();
        });
    } else {
        startBeatSynthesizer();
        window.TLongPlayer.isPlaying = true;
        updatePlayPauseButton();
        savePlaybackState();
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
    savePlaybackState();
}

function pauseTrack() {
    window.TLongPlayer.isPlaying = false;
    window.TLongPlayer.audio.pause();
    stopBeatSynthesizer();
    updatePlayPauseButton();
    savePlaybackState();
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

// Tua nhạc theo số giây (+10s hoặc -10s)
function skipTime(seconds) {
    const audio = window.TLongPlayer?.audio;
    const currentTrack = window.TLongPlayer?.currentTrack;
    if (!audio || !currentTrack) {
        showToastNotification("⚠️ Vui lòng chọn bài để phát trước khi tua!");
        return;
    }

    const dur = audio.duration;
    const duration = (dur && !isNaN(dur) && isFinite(dur) && dur > 0)
        ? dur
        : (currentTrack.durationSeconds || 0);

    if (duration <= 0) return;

    let targetTime = (audio.currentTime || 0) + seconds;
    if (targetTime < 0) targetTime = 0;

    // Kiểm tra giới hạn demo nếu đang trong chế độ demo
    if (isDemoPlayback(currentTrack)) {
        const limit = currentTrack.demoLimit || 30;
        if (targetTime >= limit) {
            audio.currentTime = 0;
            pauseTrack();
            const currentTimeElem = document.getElementById('playerCurrentTime');
            if (currentTimeElem) currentTimeElem.textContent = '0:00';
            const seekSlider = document.getElementById('playerSeekSlider');
            if (seekSlider) {
                seekSlider.value = 0;
                updateSeekSliderProgress(seekSlider);
            }
            if (typeof renderWaveform === 'function') {
                renderWaveform(0);
            }
            showDemoLimitModal();
            return;
        }
    }

    if (targetTime >= duration) {
        playNextTrack();
        return;
    }

    audio.currentTime = targetTime;

    // Cập nhật giao diện thanh phát
    const currentTimeElem = document.getElementById('playerCurrentTime');
    if (currentTimeElem) currentTimeElem.textContent = formatTime(targetTime);
    const seekSlider = document.getElementById('playerSeekSlider');
    if (seekSlider) {
        seekSlider.value = (targetTime / duration) * 100;
        updateSeekSliderProgress(seekSlider);
    }

    // Đồng bộ nếu đang ở trang Track Detail
    const detailCurrentTime = document.getElementById('detailCurrentTime');
    if (detailCurrentTime) detailCurrentTime.textContent = formatTime(targetTime);
    if (typeof renderWaveform === 'function') {
        renderWaveform(targetTime / duration);
    }

    const dirText = seconds > 0 ? `+${seconds}s` : `${seconds}s`;
    showToastNotification(`⏩ Đã tua ${dirText} (${formatTime(targetTime)})`);
}
window.skipTime = skipTime;

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
            loadAdminProducers(true);
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

window.currentUploadType = 'Track';

function setUploadType(type) {
    window.currentUploadType = type;
    const typeInput = document.getElementById('uploadProductTypeInput');
    if (typeInput) typeInput.value = type;

    const trackTabBtn = document.getElementById('uploadTabTrackBtn');
    const nonstopTabBtn = document.getElementById('uploadTabNonstopBtn');
    const bpmKeyRow = document.getElementById('uploadBpmKeyRow');
    const analysisStatus = document.getElementById('audioAnalysisStatus');
    const categorySelect = document.getElementById('uploadCategorySelect');
    const titleInput = document.getElementById('uploadTitleInput');
    const subtitleEl = document.getElementById('uploadModalSubtitle');
    const dropZoneTitle = document.getElementById('dropZoneTitle');
    const dropZoneHint = document.getElementById('dropZoneHint');
    const bpmInput = document.getElementById('uploadBpmInput');
    const keyInput = document.getElementById('uploadMusicalKeyInput');

    if (type === 'Nonstop') {
        if (trackTabBtn) {
            trackTabBtn.style.background = 'transparent';
            trackTabBtn.style.boxShadow = 'none';
        }
        if (nonstopTabBtn) {
            nonstopTabBtn.style.background = 'linear-gradient(135deg, #ffd166, #ff9f1c)';
            nonstopTabBtn.style.color = '#000';
            nonstopTabBtn.style.boxShadow = '0 0 15px rgba(255, 209, 102, 0.4)';
        }
        if (subtitleEl) subtitleEl.textContent = 'Tải bản Nonstop / Mixtape dài (MP3/WAV/FLAC) • Không cần đọc Key và BPM';
        if (dropZoneTitle) dropZoneTitle.textContent = 'Bấm để chọn file Nonstop dài hoặc kéo thả vào đây';
        if (dropZoneHint) dropZoneHint.innerHTML = 'Hỗ trợ các file set mix dài: <strong>MP3 (320kbps), WAV Lossless (24-bit), FLAC</strong>';
        if (bpmKeyRow) bpmKeyRow.classList.add('d-none');
        if (analysisStatus) analysisStatus.classList.add('d-none');

        if (categorySelect) {
            categorySelect.innerHTML = `
                <option value="NonstopLot">Nonstop Lọt (Khách nghe full, Free tải được)</option>
                <option value="NonstopNhom" selected>Nonstop Nhóm (Standard & Premium tải được)</option>
                <option value="NonstopSlot">Nonstop Slot VIP (Chỉ Premium tải, Demo 30s)</option>
            `;
        }
        if (titleInput && (!titleInput.value || titleInput.value.includes('Remix') || titleInput.value === 'Bay Phòng Cực Căng (TLong Remix)...')) {
            titleInput.placeholder = "Ví dụ: Nonstop Vinahouse 2026 - Đẳng Cấp Dân Bay (DJ TLong)...";
        }
        if (bpmInput) bpmInput.value = 0;
        if (keyInput) keyInput.value = "Nonstop";
    } else {
        if (trackTabBtn) {
            trackTabBtn.style.background = 'linear-gradient(135deg, #ff134a, #d90429)';
            trackTabBtn.style.color = '#fff';
            trackTabBtn.style.boxShadow = '0 0 15px rgba(255, 19, 74, 0.4)';
        }
        if (nonstopTabBtn) {
            nonstopTabBtn.style.background = 'transparent';
            nonstopTabBtn.style.color = '#fff';
            nonstopTabBtn.style.boxShadow = 'none';
        }
        if (subtitleEl) subtitleEl.textContent = 'Tải file Track nhạc lẻ (MP3/WAV/FLAC) • Tự động quét và đọc BPM & Tone Key chuẩn xác';
        if (dropZoneTitle) dropZoneTitle.textContent = 'Bấm để chọn file Track âm thanh hoặc kéo thả vào đây';
        if (dropZoneHint) dropZoneHint.innerHTML = 'Hỗ trợ các định dạng: <strong>MP3 (320kbps), WAV (24-bit Lossless), FLAC, M4A</strong>';
        if (bpmKeyRow) bpmKeyRow.classList.remove('d-none');

        if (categorySelect) {
            categorySelect.innerHTML = `
                <option value="TrackLot">Track Lọt (Khách nghe full, Free tải được)</option>
                <option value="TrackNhom" selected>Track Nhóm (Standard & Premium tải được)</option>
                <option value="TrackSlot">Track Slot VIP (Chỉ Premium tải, Demo 30s)</option>
            `;
        }
        if (titleInput) {
            titleInput.placeholder = "Ví dụ: Bay Phòng Cực Căng (TLong Remix)...";
        }
        if (window.producerSelectedAudioFile) {
            analyzeAudioFile(window.producerSelectedAudioFile);
        }
    }
}

function switchUploadMode(mode) {
    setUploadType(mode === 'Nonstop' ? 'Nonstop' : 'Track');
}

window.producerSelectedAudioFile = null;

function formatTime(sec) {
    if (!sec || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

// ==========================================
// DJ AUDIO INTELLIGENCE: THREE-LAYER BPM & KEY ENGINE
// Layer 1: Authoritative ID3v2 & RIFF Metadata Binary Parser
// Layer 2: Intelligent Filename Pattern Recognizer
// Layer 3: High-Precision Web Audio Multi-Harmonic DSP (Goertzel Chromagram)
// ==========================================

const NOTE_TO_CAMELOT_MAP = {
    "Abm": "1A", "G#m": "1A", "Ebm": "2A", "D#m": "2A", "Bbm": "3A", "A#m": "3A",
    "Fm": "4A",  "Cm": "5A",  "Gm": "6A",  "Dm": "7A",  "Am": "8A",  "Em": "9A",
    "Bm": "10A", "F#m": "11A", "Gbm": "11A", "C#m": "12A", "Dbm": "12A",
    "B": "1B", "Bmaj": "1B", "Bmajor": "1B", "F#": "2B", "Gb": "2B", "F#maj": "2B", "F#major": "2B",
    "C#": "3B", "Db": "3B", "C#maj": "3B", "Dbmaj": "3B", "G#": "4B", "Ab": "4B", "G#maj": "4B", "Abmaj": "4B",
    "D#": "5B", "Eb": "5B", "D#maj": "5B", "Ebmaj": "5B", "A#": "6B", "Bb": "6B", "A#maj": "6B", "Bbmaj": "6B",
    "F": "7B", "Fmaj": "7B", "Fmajor": "7B", "C": "8B", "Cmaj": "8B", "Cmajor": "8B", "G": "9B", "Gmaj": "9B", "Gmajor": "9B",
    "D": "10B", "Dmaj": "10B", "Dmajor": "10B", "A": "11B", "Amaj": "11B", "Amajor": "11B", "E": "12B", "Emaj": "12B", "Emajor": "12B"
};

const CAMELOT_TO_NOTE_MAP = {
    "1A": "G#m", "2A": "D#m", "3A": "A#m", "4A": "Fm", "5A": "Cm", "6A": "Gm",
    "7A": "Dm", "8A": "Am", "9A": "Em", "10A": "Bm", "11A": "F#m", "12A": "C#m",
    "1B": "B", "2B": "F#", "3B": "C#", "4B": "G#", "5B": "D#", "6B": "A#",
    "7B": "F", "8B": "C", "9B": "G", "10B": "D", "11B": "A", "12B": "E"
};

function getCamelotKeyInfo(inputKey) {
    if (!inputKey) return { camelot: "8A", name: "Am", label: "8A (Am)" };
    let raw = String(inputKey).replace(/[\uFEFF\0]/g, "").trim();
    if (!raw) return { camelot: "8A", name: "Am", label: "8A (Am)" };

    const upper = raw.toUpperCase();
    
    // 1. Tìm trực tiếp mã Camelot có trong chuỗi (ví dụ: "8A", "8A - 140", "Key 11B", "11B [Dm]")
    const camMatch = upper.match(/(?:^|[\s_–—.:\(\[\{])(1[0-2]|[1-9])([AB])(?:$|[\s_–—.:\)\]\}])/);
    if (camMatch) {
        const cam = camMatch[1] + camMatch[2];
        const note = CAMELOT_TO_NOTE_MAP[cam] || cam;
        return { camelot: cam, name: note, label: `${cam} (${note})` };
    }
    
    // 2. Tìm nốt nhạc tự nhiên (Am, Dm, Em, F#m, C#m, Bbm, G#m, B, C, D...)
    // Chỉ khớp nốt nhạc nếu:
    // a) Chuỗi ngắn (<= 6 ký tự) đại diện cho chính nốt đó (ví dụ: "Am", "G#m", "D#m", "F#")
    // b) Hoặc đứng sau tiền tố "key", "tone", "camelot"
    // c) Hoặc đi kèm BPM: "Am - 140", "140 - Dm"
    // CHỐNG NHẦM LẪN các từ tiếng Việt như "Em Thua Co Ta", "Anh Met Roi", "Co Gai", "Bao Gio"...
    let noteCandidate = null;
    if (raw.length <= 6) {
        const strictMatch = raw.match(/^([A-G][#b]?(?:m|min|minor|maj|major)?)$/i);
        if (strictMatch) noteCandidate = strictMatch[1];
    } else {
        const prefixMatch = raw.match(/(?:key|tone|camelot)[\s_.:-]*([A-G][#b]?(?:m|min|minor|maj|major)?)\b/i);
        if (prefixMatch) {
            noteCandidate = prefixMatch[1];
        } else {
            const bpmNoteMatch = raw.match(/(?:(?:1[2-5][0-9])[\s_–—.:-]+([A-G][#b]?(?:m|min|minor)?)|([A-G][#b]?(?:m|min|minor)?)[\s_–—.:-]+(?:1[2-5][0-9]))\b/i);
            if (bpmNoteMatch) noteCandidate = bpmNoteMatch[1] || bpmNoteMatch[2];
        }
    }

    if (noteCandidate) {
        let cleanNote = noteCandidate.replace(/\s*(?:minor|min)\b/i, "m")
                                     .replace(/\s*(?:major|maj)\b/i, "")
                                     .replace(/\s+/g, "").trim();
        if (cleanNote) {
            let formatted = cleanNote.charAt(0).toUpperCase();
            if (cleanNote.length > 1) {
                let rest = cleanNote.slice(1);
                if (rest.startsWith('#')) {
                    formatted += '#' + rest.slice(1).toLowerCase();
                } else if (rest.startsWith('b')) {
                    formatted += 'b' + rest.slice(1).toLowerCase();
                } else {
                    formatted += rest.toLowerCase();
                }
            }
            if (NOTE_TO_CAMELOT_MAP[formatted]) {
                const cam = NOTE_TO_CAMELOT_MAP[formatted];
                const note = CAMELOT_TO_NOTE_MAP[cam] || formatted;
                return { camelot: cam, name: note, label: `${cam} (${note})` };
            }
        }
    }
    
    return { camelot: upper, name: upper, label: upper };
}

// ----------------------------------------------------
// LAYER 1: AUTHORITATIVE ID3V2 & METADATA BINARY PARSER
// ----------------------------------------------------
async function parseAudioMetadata(file) {
    const meta = { bpm: null, key: null, title: null, artist: null, genre: null };
    const name = file.name || "";
    const nameWithoutExt = name.replace(/\.[a-zA-Z0-9]+$/, "").trim();

    // 1. Phân tích tên file tìm BPM (nhịp đập)
    const bpmPatterns = [
        /(?:bpm|nhịp)[\s_.:-]*(\d{2,3}(?:\.\d+)?)/i,
        /(\d{2,3}(?:\.\d+)?)\s*(?:bpm|nhịp)\b/i,
        /(?:1[0-2][AB]|[1-9][AB])[\s_–—.:-]+(1[2-5][0-9])\b/i,
        /\b(1[2-5][0-9])[\s_–—.:-]+(?:1[0-2][AB]|[1-9][AB])\b/i,
        /[\(\[\{][^\)\]\}]*?\b(1[2-5][0-9])\b[^\)\]\}]*?[\)\]\}]/i,
        /(?:^|[\s_(\[-])(1[2-5][0-9])(?:[\s_)\]-]|(?=\.[a-zA-Z0-9]+$)|$)/i
    ];
    for (const pat of bpmPatterns) {
        const m = nameWithoutExt.match(pat);
        if (m) {
            const val = parseFloat(m[1]);
            if (val >= 60 && val <= 200) {
                meta.bpm = Math.round(val);
                break;
            }
        }
    }

    // 2. Phân tích tên file tìm Tone Key
    // Ưu tiên A: Tiền tố rõ ràng (Key 8A, Tone 11B, Camelot 4A, Key Am)
    const labeledMatch = nameWithoutExt.match(/(?:key|tone|camelot)[\s_.:-]*([1-9][AB]|1[0-2][AB]|[A-G][#b]?(?:m|min|minor)?)\b/i);
    if (labeledMatch && labeledMatch[1]) {
        const info = getCamelotKeyInfo(labeledMatch[1]);
        if (info && info.camelot) meta.key = info.camelot;
    }

    // Ưu tiên B: Trong ngoặc đơn/vuông chứa Camelot hoặc nốt rõ ràng: [6A], (8A), [140 - 11B], (Am - 140), [F#m]
    if (!meta.key) {
        const bracketBlocks = nameWithoutExt.match(/[\(\[\{][^\(\)\[\]\{\}]+[\)\]\}]/g);
        if (bracketBlocks) {
            for (const b of bracketBlocks) {
                const inner = b.slice(1, -1).trim();
                const camInB = inner.match(/(?:^|[\s_–—.:-])(1[0-2]|[1-9])([AB])(?:$|[\s_–—.:-])/i);
                if (camInB) {
                    meta.key = (camInB[1] + camInB[2]).toUpperCase();
                    break;
                }
                // Chỉ bắt nốt nếu toàn bộ khối ngoặc là nốt nhạc (ví dụ: [Am], [F#m]) hoặc đi kèm số BPM [Am - 140]
                if (/^[A-G][#b]?(?:m|min|minor)?$/i.test(inner)) {
                    const info = getCamelotKeyInfo(inner);
                    if (info && info.camelot) { meta.key = info.camelot; break; }
                } else {
                    const noteWithBpm = inner.match(/(?:(?:1[2-5][0-9])[\s_–—.:-]+([A-G][#b]?(?:m|min|minor)?)|([A-G][#b]?(?:m|min|minor)?)[\s_–—.:-]+(?:1[2-5][0-9]))/i);
                    if (noteWithBpm) {
                        const info = getCamelotKeyInfo(noteWithBpm[1] || noteWithBpm[2]);
                        if (info && info.camelot) { meta.key = info.camelot; break; }
                    }
                }
            }
        }
    }

    // Ưu tiên C: Camelot đứng ở đầu hoặc đi kèm BPM ở tên file: "6A - 140 - Tên Bài", "140 - 6A - Tên Bài"
    if (!meta.key) {
        const leadingCam = nameWithoutExt.match(/^([1-9]|1[0-2])([AB])[\s_–—-]+/i);
        if (leadingCam) meta.key = (leadingCam[1] + leadingCam[2]).toUpperCase();
    }
    if (!meta.key) {
        const camBpm = nameWithoutExt.match(/(?:^|[\s_–—-])(1[0-2]|[1-9])([AB])[\s_–—.:-]+(?:1[2-5][0-9])\b/i);
        if (camBpm) meta.key = (camBpm[1] + camBpm[2]).toUpperCase();
    }
    if (!meta.key) {
        const bpmCam = nameWithoutExt.match(/\b(?:1[2-5][0-9])[\s_–—.:-]+(1[0-2]|[1-9])([AB])(?:[\s_–—-]|$)/i);
        if (bpmCam) meta.key = (bpmCam[1] + bpmCam[2]).toUpperCase();
    }

    // 3. Binary ID3v2 & RIFF Chunk Parser với DYNAMIC TAG SLICING (Khắc phục 100% lỗi album art APIC 1.5MB)
    try {
        // Bước 3.1: Đọc 10 bytes đầu tiên để xác định chính xác độ dài tag ID3v2
        const headBuf = await file.slice(0, 10).arrayBuffer();
        const headBytes = new Uint8Array(headBuf);

        let sliceSize = 262144; // Mặc định 256KB nếu không có ID3
        if (headBytes[0] === 0x49 && headBytes[1] === 0x44 && headBytes[2] === 0x33) { // 'ID3'
            const tagSize = ((headBytes[6] & 0x7F) << 21) |
                            ((headBytes[7] & 0x7F) << 14) |
                            ((headBytes[8] & 0x7F) << 7)  |
                            (headBytes[9] & 0x7F);
            // Slice toàn bộ phần Header ID3v2 (tối đa 6MB để vượt qua ảnh bìa album art APIC)
            sliceSize = Math.min(file.size, Math.min(tagSize + 1024, 6291456));
        }

        const slice = file.slice(0, sliceSize);
        const buffer = await slice.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        const decAscii = new TextDecoder("ascii");
        const decUtf8 = new TextDecoder("utf-8");
        const decUtf16 = new TextDecoder("utf-16le");

        let id3Offset = -1;
        for (let i = 0; i < Math.min(bytes.length - 10, 65536); i++) {
            if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && bytes[i + 2] === 0x33) {
                id3Offset = i;
                break;
            }
        }

        if (id3Offset >= 0) {
            const version = bytes[id3Offset + 3];
            const tagSize = ((bytes[id3Offset + 6] & 0x7F) << 21) |
                            ((bytes[id3Offset + 7] & 0x7F) << 14) |
                            ((bytes[id3Offset + 8] & 0x7F) << 7)  |
                            (bytes[id3Offset + 9] & 0x7F);
            let pos = id3Offset + 10;
            const maxPos = Math.min(id3Offset + 10 + tagSize, bytes.length - 10);

            while (pos < maxPos) {
                if (bytes[pos] === 0) { pos++; continue; }
                const frameId = decAscii.decode(bytes.subarray(pos, pos + 4));
                if (!/^[A-Z0-9]{4}$/.test(frameId)) { pos++; continue; }

                let frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
                if (version === 4) {
                    frameSize = ((bytes[pos + 4] & 0x7F) << 21) | ((bytes[pos + 5] & 0x7F) << 14) | ((bytes[pos + 6] & 0x7F) << 7) | (bytes[pos + 7] & 0x7F);
                }
                if (frameSize <= 0 || pos + 10 + frameSize > bytes.length) break;

                // QUAN TRỌNG: Nếu là ảnh bìa APIC/PIC, lập tức nhảy qua để đọc các khung văn bản phía sau (TIT2, TKEY...)
                if (frameId === "APIC" || frameId === "PIC") {
                    pos += 10 + frameSize;
                    continue;
                }

                const dataSlice = bytes.subarray(pos + 10, pos + 10 + frameSize);
                let text = "";
                if (dataSlice.length > 1) {
                    const enc = dataSlice[0];
                    const contentSlice = dataSlice.subarray(1);
                    if (enc === 0) text = decAscii.decode(contentSlice);
                    else if (enc === 1 || enc === 2) text = decUtf16.decode(contentSlice);
                    else text = decUtf8.decode(contentSlice);
                    text = text.replace(/[\uFEFF\0]/g, "").trim();
                }

                if (frameId === "TBPM" && text && !meta.bpm) {
                    const parsedBpm = parseFloat(text);
                    if (parsedBpm >= 50 && parsedBpm <= 220) meta.bpm = Math.round(parsedBpm);
                } else if (frameId === "TKEY" && text) {
                    const info = getCamelotKeyInfo(text);
                    if (info && info.camelot) meta.key = info.camelot;
                } else if (frameId === "TXXX" && text) {
                    const parts = text.split(/[\u0000\0]+/);
                    const desc = (parts[0] || "").toLowerCase().replace(/[\uFEFF\0]/g, "").trim();
                    const val = (parts[1] || "").replace(/[\uFEFF\0]/g, "").trim();
                    if (desc.includes("bpm") && !meta.bpm) {
                        const parsedBpm = parseFloat(val);
                        if (parsedBpm >= 50 && parsedBpm <= 220) meta.bpm = Math.round(parsedBpm);
                    } else if ((desc.includes("key") || desc.includes("camelot") || desc.includes("initial")) && !meta.key) {
                        const info = getCamelotKeyInfo(val);
                        if (info && info.camelot) meta.key = info.camelot;
                    }
                } else if (frameId === "COMM" && text && !meta.key) {
                    // Mixed In Key thường ghi: "11A - In Key: 11A" hoặc "11A"
                    const m = text.match(/\b(1[0-2]|[1-9])([AB])\b/i);
                    if (m) meta.key = (m[1] + m[2]).toUpperCase();
                } else if (frameId === "TIT2" && text) {
                    meta.title = text;
                    // Phân tích nếu Tiêu đề có chứa Key và BPM (Ví dụ: "6A - 140 - HAY - 10 MAT 1 CON KHONG - KAYZ")
                    if (!meta.key) {
                        const titKey = text.match(/^(1[0-2]|[1-9])([AB])[\s_–—-]+/i) || text.match(/\b(1[0-2]|[1-9])([AB])\b/i);
                        if (titKey) meta.key = (titKey[1] + titKey[2]).toUpperCase();
                    }
                    if (!meta.bpm) {
                        const titBpm = text.match(/(?:^|[\s_–—-])(1[2-5][0-9])\b/);
                        if (titBpm) meta.bpm = parseInt(titBpm[1]);
                    }
                } else if (frameId === "TPE1" && text && !meta.artist) {
                    meta.artist = text;
                } else if (frameId === "TCON" && text && !meta.genre) {
                    meta.genre = text;
                }

                pos += 10 + frameSize;
            }
        }

        // Bước 3.2: Đọc ID3v1 ở đuôi file (128 bytes cuối)
        if (file.size > 128) {
            const tailBuf = await file.slice(file.size - 128, file.size).arrayBuffer();
            const tailBytes = new Uint8Array(tailBuf);
            if (tailBytes[0] === 0x54 && tailBytes[1] === 0x41 && tailBytes[2] === 0x47) { // "TAG"
                const v1Comment = decAscii.decode(tailBytes.subarray(97, 127)).replace(/[\uFEFF\0]/g, "").trim();
                const v1Title = decAscii.decode(tailBytes.subarray(3, 33)).replace(/[\uFEFF\0]/g, "").trim();
                if (!meta.key) {
                    const m = v1Comment.match(/\b(1[0-2]|[1-9])([AB])\b/i) || v1Title.match(/\b(1[0-2]|[1-9])([AB])\b/i);
                    if (m) meta.key = (m[1] + m[2]).toUpperCase();
                }
            }
        }
    } catch (e) {
        console.warn("[Metadata Parser]", e);
    }

    return meta;
}

// ----------------------------------------------------
// LAYER 2: HIGH-PRECISION MULTI-HARMONIC BPM ENGINE
// ----------------------------------------------------
async function detectBpmFromAudio(audioBuffer) {
    try {
        const sampleRate = audioBuffer.sampleRate;
        const duration = audioBuffer.duration;
        const rawChannel = audioBuffer.getChannelData(0);

        // Intelligent Drop Finder: scan candidate 25s windows to find the section with strongest kick energy
        let bestStartSec = 15;
        let maxEnergy = -1;
        const candidateStarts = duration > 130 ? [15, 45, 75, 105] : (duration > 70 ? [15, 45] : [10]);
        for (const cand of candidateStarts) {
            if (cand + 25 > duration) continue;
            const startIdx = Math.floor(cand * sampleRate);
            const checkLen = Math.floor(25 * sampleRate);
            let energy = 0;
            const step = 200;
            for (let i = 0; i < checkLen; i += step) {
                const val = rawChannel[startIdx + i] || 0;
                energy += val * val;
            }
            if (energy > maxEnergy) {
                maxEnergy = energy;
                bestStartSec = cand;
            }
        }

        const startSec = Math.min(bestStartSec, Math.max(0, duration - 30));
        const lengthSec = Math.min(30, Math.max(5, duration - startSec));
        const numSamples = Math.floor(lengthSec * sampleRate);

        // Lowpass filter at 140Hz with OfflineAudioContext to isolate kick drum transients
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, numSamples, sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;

        const filter = offlineCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 140;
        filter.Q.value = 1.0;

        source.connect(filter);
        filter.connect(offlineCtx.destination);
        source.start(0, startSec, lengthSec);

        const rendered = await offlineCtx.startRendering();
        const filteredData = rendered.getChannelData(0);

        // Downsample to 2000Hz envelope
        const targetRate = 2000;
        const factor = Math.max(1, Math.floor(sampleRate / targetRate));
        const envLen = Math.floor(filteredData.length / factor);
        const env = new Float32Array(envLen);

        for (let i = 0; i < envLen; i++) {
            let sum = 0;
            const off = i * factor;
            for (let j = 0; j < factor; j++) {
                const v = filteredData[off + j];
                sum += v * v;
            }
            env[i] = Math.sqrt(sum / factor);
        }

        // Onset novelty function (forward difference)
        const onset = new Float32Array(envLen);
        for (let i = 2; i < envLen; i++) {
            const diff = env[i] - env[i - 2];
            if (diff > 0) onset[i] = diff;
        }

        // Multi-harmonic comb autocorrelation across candidate tempos 70.0 to 170.0 (0.5 BPM step)
        let bestScore = -1;
        let bestBpm = 140;

        for (let bpm = 70.0; bpm <= 170.0; bpm += 0.5) {
            const lag1 = Math.round((60.0 * targetRate) / bpm);
            const lag2 = Math.round(lag1 * 2);
            const lag4 = Math.round(lag1 * 4);
            if (lag4 >= envLen) continue;

            let c1 = 0, c2 = 0, c4 = 0;
            let count = 0;
            const step = 4;
            for (let i = 0; i < envLen - lag4; i += step) {
                c1 += onset[i] * onset[i + lag1];
                c2 += onset[i] * onset[i + lag2];
                c4 += onset[i] * onset[i + lag4];
                count++;
            }
            if (count > 0) {
                c1 /= count;
                c2 /= count;
                c4 /= count;
                let score = c1 + 0.65 * c2 + 0.35 * c4;

                // Prioritize Vinahouse / Dance standard club tempo (128 - 146 BPM)
                if (bpm >= 128 && bpm <= 146) {
                    score *= 1.15;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestBpm = bpm;
                }
            }
        }

        if (bestBpm < 95) bestBpm *= 2;
        return Math.round(bestBpm);
    } catch (e) {
        console.warn("[BPM Engine DSP Fallback]", e);
        return 140;
    }
}

// ----------------------------------------------------
// LAYER 3: STATE-OF-THE-ART DSP + MIR KEY ESTIMATION ENGINE
// Integrating:
// 1. Digital Signal Processing (DSP): Multi-frame STFT with Hann window & Goertzel log filterbank
// 2. Music Information Retrieval (MIR): Gómez HPCP + Sha'ath EDMA dual profiles
// 3. Psychoacoustic logarithmic magnitude compression: log(1 + 10 * mag)
// 4. Harmonic Overtone Suppression (HPS) to remove false 5th and 3rd harmonics
// 5. L2-Normalized Bivariate Pearson Correlation Coefficient (r)
// ----------------------------------------------------
async function detectKeyFromAudio(audioBuffer) {
    try {
        const sampleRate = audioBuffer.sampleRate;
        const duration = audioBuffer.duration;
        const targetSampleRate = 11025; // Chuẩn MIR resample để tối ưu hóa phân giải tần số

        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const camelotMinor = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];
        const camelotMajor = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];

        // 1. Chuẩn MIR: Gómez HPCP Polyphonic Audio Profiles (Emilia Gómez, ISMIR)
        const gomezMinor = [1.0, 0.15, 0.45, 0.85, 0.15, 0.55, 0.10, 0.80, 0.40, 0.15, 0.60, 0.20];
        const gomezMajor = [1.0, 0.10, 0.40, 0.10, 0.80, 0.45, 0.10, 0.85, 0.15, 0.50, 0.10, 0.45];

        // 2. Chuẩn MIR: Sha'ath EDMA Profiles (Electronic Dance Music Adapted)
        const shaathMinor = [1.0, -0.6, 0.35, 0.85, -0.7, 0.45, -0.6, 0.75, 0.45, -0.5, 0.65, -0.4];
        const shaathMajor = [1.0, -0.6, 0.35, -0.7, 0.85, 0.40, -0.6, 0.75, -0.6, 0.50, -0.5, 0.55];

        // MIR Sampling: 4 phân đoạn đại diện cấu trúc bài nhạc (20%, 40%, 60%, 75%)
        const samplePoints = [
            Math.max(4, duration * 0.20),
            Math.max(8, duration * 0.40),
            Math.max(12, duration * 0.60),
            Math.max(16, duration * 0.75)
        ];

        const hpcp = new Float32Array(12);
        const winLenSec = 8;

        for (const startSec of samplePoints) {
            if (startSec + winLenSec > duration) continue;
            const actualLenSec = Math.min(winLenSec, duration - startSec);
            const numSamplesTarget = Math.floor(actualLenSec * targetSampleRate);

            const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, numSamplesTarget, targetSampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;

            // DSP Bandpass Filtering (130Hz - 1600Hz)
            const hp = offlineCtx.createBiquadFilter();
            hp.type = "highpass";
            hp.frequency.value = 130;
            hp.Q.value = 0.707;

            const lp = offlineCtx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 1600;
            lp.Q.value = 0.707;

            source.connect(hp);
            hp.connect(lp);
            lp.connect(offlineCtx.destination);
            source.start(0, startSec, actualLenSec);

            const rendered = await offlineCtx.startRendering();
            const data = rendered.getChannelData(0);

            // DSP Multi-frame Hop STFT (50% Overlap)
            const N = 4096;
            const hop = 2048;
            const numFrames = Math.floor((data.length - N) / hop);

            for (let f = 0; f < numFrames; f++) {
                const offset = f * hop;
                for (let p = 0; p < 12; p++) {
                    for (let oct = 3; oct <= 5; oct++) {
                        const midi = (oct + 1) * 12 + p;
                        const freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
                        if (freq < 130.0 || freq > 1600.0) continue;

                        const omega = (2.0 * Math.PI * freq) / targetSampleRate;
                        const coeff = 2.0 * Math.cos(omega);

                        let s0 = 0, s1 = 0, s2 = 0;
                        for (let n = 0; n < N; n++) {
                            const hann = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / N));
                            const sample = data[offset + n] * hann;
                            s0 = sample + coeff * s1 - s2;
                            s2 = s1;
                            s1 = s0;
                        }
                        const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));

                        // MIR Psychoacoustic Logarithmic Compression: log(1 + 10 * mag)
                        const logMag = Math.log(1.0 + 10.0 * mag);
                        const octWeight = (oct === 3 ? 1.5 : (oct === 4 ? 1.2 : 0.8));
                        hpcp[p] += logMag * octWeight;
                    }
                }
            }
        }

        // MIR Harmonic Overtone Suppression (HPS)
        const cleanedHpcp = new Float32Array(12);
        for (let p = 0; p < 12; p++) {
            const rawP = hpcp[p];
            const sub5th = hpcp[(p - 7 + 12) % 12] * 0.22;
            const sub3rd = hpcp[(p - 4 + 12) % 12] * 0.12;
            cleanedHpcp[p] = Math.max(0, rawP - sub5th - sub3rd);
        }

        // MIR L2 Normalization
        let sumSq = 0;
        for (let i = 0; i < 12; i++) sumSq += cleanedHpcp[i] * cleanedHpcp[i];
        const norm = Math.sqrt(sumSq);
        if (norm > 0) {
            for (let i = 0; i < 12; i++) cleanedHpcp[i] /= norm;
        }

        // Bivariate Pearson Correlation Function
        function calcPearson(x, p, root) {
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
            for (let i = 0; i < 12; i++) {
                const xi = x[i];
                const yi = p[(i - root + 12) % 12];
                sumX += xi;
                sumY += yi;
                sumXY += xi * yi;
                sumX2 += xi * xi;
                sumY2 += yi * yi;
            }
            const num = 12 * sumXY - sumX * sumY;
            const den = Math.sqrt((12 * sumX2 - sumX * sumX) * (12 * sumY2 - sumY * sumY));
            return den > 1e-9 ? num / den : 0;
        }

        const candidateScores = [];
        for (let r = 0; r < 12; r++) {
            const rGomez_min = calcPearson(cleanedHpcp, gomezMinor, r);
            const rGomez_maj = calcPearson(cleanedHpcp, gomezMajor, r);
            const rShaath_min = calcPearson(cleanedHpcp, shaathMinor, r);
            const rShaath_maj = calcPearson(cleanedHpcp, shaathMajor, r);

            // MIR Ensemble Score (50% Gómez Polyphonic + 50% Shaath EDMA)
            const scoreMin = (0.50 * rGomez_min + 0.50 * rShaath_min) * 1.10; // Prior Minor (1.10x)
            const scoreMaj = (0.50 * rGomez_maj + 0.50 * rShaath_maj);

            candidateScores.push({
                camelot: camelotMinor[r],
                name: noteNames[r] + "m",
                label: `${camelotMinor[r]} (${noteNames[r]}m)`,
                score: scoreMin,
                type: "Minor"
            });

            candidateScores.push({
                camelot: camelotMajor[r],
                name: noteNames[r],
                label: `${camelotMajor[r]} (${noteNames[r]})`,
                score: scoreMaj,
                type: "Major"
            });
        }

        candidateScores.sort((a, b) => b.score - a.score);

        const best = candidateScores[0];
        const second = candidateScores[1];
        const third = candidateScores[2];

        const bestConf = Math.min(99, Math.max(68, Math.round(best.score * 100)));
        const secConf = Math.min(bestConf - 4, Math.max(50, Math.round(second.score * 100)));
        const thirdConf = Math.min(secConf - 4, Math.max(40, Math.round(third.score * 100)));

        return {
            camelot: best.camelot,
            name: best.name,
            label: best.label,
            confidence: bestConf,
            topCandidates: [
                { camelot: best.camelot, name: best.name, label: best.label, confidence: bestConf },
                { camelot: second.camelot, name: second.name, label: second.label, confidence: secConf },
                { camelot: third.camelot, name: third.name, label: third.label, confidence: thirdConf }
            ]
        };
    } catch (e) {
        console.warn("[DSP + MIR Key Engine Fallback]", e);
        return {
            camelot: "8A",
            name: "Am",
            label: "8A (Am)",
            confidence: 75,
            topCandidates: [
                { camelot: "8A", name: "Am", label: "8A (Am)", confidence: 75 },
                { camelot: "8B", name: "C", label: "8B (C)", confidence: 60 },
                { camelot: "7A", name: "Dm", label: "7A (Dm)", confidence: 55 }
            ]
        };
    }
}

// ----------------------------------------------------
// INTEGRATED CONTROLLER: ANALYZE AUDIO FILE
// ----------------------------------------------------
async function analyzeAudioFile(file) {
    const statusBox = document.getElementById('audioAnalysisStatus');
    const badge = document.getElementById('analysisBadge');
    const bpmBadge = document.getElementById('detectedBpmBadge');
    const keyBadge = document.getElementById('detectedKeyBadge');
    const durationBadge = document.getElementById('detectedDurationBadge');
    const bpmInput = document.getElementById('uploadBpmInput');
    const keyInput = document.getElementById('uploadMusicalKeyInput');
    const durationInput = document.getElementById('uploadDurationInput');
    const titleInput = document.getElementById('uploadTitleInput');
    const artistInput = document.getElementById('uploadArtistInput');

    if (statusBox) statusBox.classList.remove('d-none');
    if (badge) {
        badge.className = 'badge bg-warning text-dark px-3 py-1 rounded-pill fw-bold';
        badge.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Đang quét ID3 & Phân tích BPM/Khóa âm...';
    }

    try {
        // Step 1: Authoritative ID3v2 & Filename Metadata Check
        const meta = await parseAudioMetadata(file);

        if (meta.title && titleInput && (!titleInput.value || titleInput.value.trim() === '')) {
            titleInput.value = meta.title;
        }
        if (meta.artist && artistInput && (!artistInput.value || artistInput.value.trim() === '')) {
            artistInput.value = meta.artist;
        }

        // Step 2: Decode Audio Buffer for DSP Analysis
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const duration = Math.round(audioBuffer.duration);
        if (durationInput) durationInput.value = duration;
        if (durationBadge) durationBadge.textContent = `Thời lượng: ${formatTime(duration)}`;

        // Step 3: Determine BPM (Prioritize Metadata/Filename, otherwise Multi-Harmonic DSP)
        let detectedBpm = meta.bpm;
        if (!detectedBpm) {
            detectedBpm = await detectBpmFromAudio(audioBuffer);
        }
        if (bpmInput) bpmInput.value = detectedBpm;
        if (bpmBadge) bpmBadge.textContent = `${detectedBpm} BPM`;

        // Step 4: Determine Musical Key (Prioritize Metadata/Filename, otherwise HPCP DSP)
        let keyInfo = null;
        if (meta.key) {
            keyInfo = getCamelotKeyInfo(meta.key);
        } else {
            keyInfo = await detectKeyFromAudio(audioBuffer);
        }
        if (keyInput) keyInput.value = keyInfo.camelot;
        if (keyBadge) keyBadge.textContent = `Key ${keyInfo.camelot} (${keyInfo.name})`;

        if (badge) {
            badge.className = 'badge text-white px-3 py-1 rounded-pill fw-bold';
            badge.style.background = '#10b981';
            badge.innerHTML = '<i class="fas fa-check-circle me-1"></i> Đã Nhận Diện Thành Công!';
        }

        try { audioCtx.close(); } catch (e) {}
    } catch (err) {
        console.warn("[Audio Engine] Fallback during analysis:", err);
        if (bpmInput && !bpmInput.value) bpmInput.value = 140;
        if (keyInput && !keyInput.value) keyInput.value = "8A";
        if (bpmBadge) bpmBadge.textContent = `${bpmInput.value} BPM`;
        if (keyBadge) keyBadge.textContent = `Key ${keyInput.value}`;
        if (durationBadge) durationBadge.textContent = 'Thời lượng: --:--';
        if (badge) {
            badge.className = 'badge bg-secondary text-white px-3 py-1 rounded-pill';
            badge.innerHTML = '<i class="fas fa-music me-1"></i> Mặc định: 140 BPM • Key 8A (Có thể chỉnh tay)';
        }
    }
}

// Global Exports
window.setUploadType = setUploadType;
window.parseAudioMetadata = parseAudioMetadata;
window.detectBpmFromAudio = detectBpmFromAudio;
window.detectKeyFromAudio = detectKeyFromAudio;
window.getCamelotKeyInfo = getCamelotKeyInfo;
window.NOTE_TO_CAMELOT_MAP = NOTE_TO_CAMELOT_MAP;
window.CAMELOT_TO_NOTE_MAP = CAMELOT_TO_NOTE_MAP;

function handleAudioFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    window.producerSelectedAudioFile = file;

    const fileNameEl = document.getElementById('selectedFileName');
    const fileSizeEl = document.getElementById('selectedFileSize');
    const infoEl = document.getElementById('fileSelectedInfo');
    const promptEl = document.getElementById('audioDropZone') || document.getElementById('dropZonePrompt');
    const previewEl = document.getElementById('audioPreviewElement');
    const titleInput = document.getElementById('uploadTitleInput');
    const qualitySelect = document.getElementById('uploadQualitySelect');

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB • ' + (file.type || 'audio/mpeg');

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
    if (titleInput && (!titleInput.value || titleInput.value.trim() === '')) {
        let cleanName = file.name.replace(/\.[^/.]+$/, "");
        cleanName = cleanName.replace(/_/g, " ").replace(/-/g, " ");
        titleInput.value = cleanName;
    }

    // Auto-detect format quality
    const ext = file.name.split('.').pop().toLowerCase();
    if (qualitySelect) {
        if (ext === 'wav') qualitySelect.value = 'WAV Lossless 24-Bit';
        else if (ext === 'flac') qualitySelect.value = 'FLAC 24-Bit Lossless';
        else qualitySelect.value = 'MP3 320kbps';
    }

    // CHIA 2 LOẠI: NẾU LÀ TRACK THÌ MỚI ĐỌC BPM VÀ KEY. NẾU LÀ NONSTOP THÌ BỎ QUA HOÀN TOÀN!
    if (window.currentUploadType === 'Track') {
        analyzeAudioFile(file);
    } else {
        // NONSTOP: Bỏ qua đọc key và bpm!
        const statusBox = document.getElementById('audioAnalysisStatus');
        if (statusBox) statusBox.classList.add('d-none');

        const bpmInput = document.getElementById('uploadBpmInput');
        const keyInput = document.getElementById('uploadMusicalKeyInput');
        const durationInput = document.getElementById('uploadDurationInput');
        if (bpmInput) bpmInput.value = 0;
        if (keyInput) keyInput.value = "Nonstop";

        // Try getting duration via HTML5 audio element
        const tempAudio = new Audio();
        tempAudio.src = URL.createObjectURL(file);
        tempAudio.onloadedmetadata = function() {
            if (tempAudio.duration && isFinite(tempAudio.duration) && tempAudio.duration > 0) {
                if (durationInput) durationInput.value = Math.round(tempAudio.duration);
            }
        };
    }
}

function clearSelectedAudioFile() {
    window.producerSelectedAudioFile = null;
    const input = document.getElementById('audioFileInput');
    if (input) input.value = '';

    const promptEl = document.getElementById('audioDropZone') || document.getElementById('dropZonePrompt');
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
    if (promptEl) promptEl.classList.remove('d-none');

    const bpmBadge = document.getElementById('detectedBpmBadge');
    const keyBadge = document.getElementById('detectedKeyBadge');
    const durationBadge = document.getElementById('detectedDurationBadge');
    if (bpmBadge) bpmBadge.textContent = '-- BPM';
    if (keyBadge) keyBadge.textContent = 'Key --';
    if (durationBadge) durationBadge.textContent = 'Thời lượng: --:--';

    const bpmInput = document.getElementById('uploadBpmInput');
    const keyInput = document.getElementById('uploadMusicalKeyInput');
    if (bpmInput) bpmInput.value = 140;
    if (keyInput) keyInput.value = '8A';
}

// Live Bidirectional Sync: user editing BPM or Key updates badges instantly
document.addEventListener('DOMContentLoaded', function() {
    const bpmInput = document.getElementById('uploadBpmInput');
    const keyInput = document.getElementById('uploadMusicalKeyInput');
    const bpmBadge = document.getElementById('detectedBpmBadge');
    const keyBadge = document.getElementById('detectedKeyBadge');

    if (bpmInput) {
        bpmInput.addEventListener('input', function() {
            const val = parseInt(this.value);
            if (bpmBadge && val > 0) {
                bpmBadge.textContent = `${val} BPM`;
            }
        });
    }

    if (keyInput) {
        keyInput.addEventListener('input', function() {
            const info = getCamelotKeyInfo(this.value);
            if (keyBadge && info) {
                keyBadge.textContent = `Key ${info.label}`;
            }
        });
    }
});

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
                <option value="NonstopSlot">Nonstop Slot VIP (Chỉ Premium tải Master, Demo 30s)</option>
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
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Đang tải lên và lưu vào Kho dữ liệu...';

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
    } else if (mode === 'nonstop') {
        if (trackContainer) trackContainer.style.display = 'none';
        if (nonstopContainer) nonstopContainer.style.display = 'block';
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

async function loadAdminProducers(forceRefresh = false) {
    const container = document.getElementById('adminProducersTableContainer');
    if (!container) return;

    // Fast-path: nếu đã có dữ liệu trong bộ nhớ và không yêu cầu làm mới bắt buộc, render tức thì 0ms
    if (!forceRefresh && window._allAdminProducers && window._allAdminProducers.length > 0) {
        filterAdminProducersTable();
        return;
    }

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
            loadAdminProducers(true);
            return;
        }

        showToastNotification(`❌ ${data.message || 'Không thể thay đổi trạng thái Producer!'}`);
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi thay đổi trạng thái Producer!");
    }
}

async function adminDeleteProducer(producerId, stageName) {
    if (!confirm(`⚠️ CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA VĨNH VIỄN Producer '${stageName}'?\n\nToàn bộ bài hát do Producer này phát hành và dữ liệu liên quan sẽ bị xóa sạch khỏi Kho dữ liệu!`)) {
        return;
    }

    try {
        const res = await fetch(`/Admin/DeleteProducer/${producerId}`, {
            method: 'POST'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToastNotification(data.message);
            loadAdminProducers(true);
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
// ==========================================
// ADMIN MUSICS MANAGEMENT (TRACK & NONSTOP SEPARATE TABS)
// ==========================================
window._allAdminMusics = [];
window._adminTrackFilter = 'all'; // 'all', 'Slot', 'Nhom', 'Lot'
window._adminNonstopFilter = 'all'; // 'all', 'Slot', 'Nhom', 'Lot'
window._selectedTrackIds = new Set();
window._selectedNonstopIds = new Set();
let _currentDeleteTarget = null;
let _currentBulkDeleteType = null;

function getMusicAccessLevel(m) {
    if (m.accessLevel) return m.accessLevel;
    const code = (m.categoryCode || '').toLowerCase();
    const name = (m.categoryName || '').toLowerCase();
    if (code.includes('slot') || name.includes('slot')) return 'Slot';
    if (code.includes('nhom') || name.includes('nhóm') || name.includes('nhom')) return 'Nhom';
    return 'Lot';
}

function isMusicSlot(m) { return getMusicAccessLevel(m) === 'Slot'; }
function isMusicNhom(m) { return getMusicAccessLevel(m) === 'Nhom'; }
function isMusicLot(m) { return getMusicAccessLevel(m) === 'Lot'; }

async function loadAdminMusics(forceRefresh = false) {
    const trackContainer = document.getElementById('adminTracksTableContainer');
    const nonstopContainer = document.getElementById('adminNonstopsTableContainer');
    const legacyContainer = document.getElementById('adminMusicsTableContainer');

    if (!trackContainer && !nonstopContainer && !legacyContainer) return;

    // Fast-path: nếu đã có dữ liệu trong bộ nhớ và không yêu cầu làm mới bắt buộc, render tức thì 0ms
    if (!forceRefresh && window._allAdminMusics && window._allAdminMusics.length > 0) {
        filterAdminTracksTable();
        filterAdminNonstopsTable();
        filterAdminMusicsTable();
        return;
    }

    try {
        const res = await fetch('/Admin/Musics');
        const json = await res.json();
        if (json.success && json.data) {
            window._allAdminMusics = json.data;

            // Separate tracks and nonstops
            const tracks = window._allAdminMusics.filter(m => {
                const t = (m.type || '').toLowerCase();
                return t === 'track' || !t.includes('nonstop');
            });
            const nonstops = window._allAdminMusics.filter(m => {
                const t = (m.type || '').toLowerCase();
                return t === 'nonstop' || (m.categoryCode || '').toLowerCase().includes('nonstop');
            });

            // Update tab badge counters
            const bTrack = document.getElementById('badgeAdmTrackCount');
            if (bTrack) bTrack.textContent = tracks.length.toLocaleString();

            const bNonstop = document.getElementById('badgeAdmNonstopCount');
            if (bNonstop) bNonstop.textContent = nonstops.length.toLocaleString();

            const bLegacy = document.getElementById('badgeAdmMusicCount');
            if (bLegacy) bLegacy.textContent = window._allAdminMusics.length.toLocaleString();

            // Update Track Sub-filter counters
            const trackAllCount = tracks.length;
            const trackSlotCount = tracks.filter(m => isMusicSlot(m)).length;
            const trackNhomCount = tracks.filter(m => isMusicNhom(m)).length;
            const trackLotCount = tracks.filter(m => isMusicLot(m)).length;

            const bTAll = document.getElementById('badgeTrackCountAll');
            const bTSlot = document.getElementById('badgeTrackCountSlot');
            const bTNhom = document.getElementById('badgeTrackCountNhom');
            const bTLot = document.getElementById('badgeTrackCountLot');
            if (bTAll) bTAll.textContent = trackAllCount;
            if (bTSlot) bTSlot.textContent = trackSlotCount;
            if (bTNhom) bTNhom.textContent = trackNhomCount;
            if (bTLot) bTLot.textContent = trackLotCount;

            // Update Nonstop Sub-filter counters
            const nonstopAllCount = nonstops.length;
            const nonstopSlotCount = nonstops.filter(m => isMusicSlot(m)).length;
            const nonstopNhomCount = nonstops.filter(m => isMusicNhom(m)).length;
            const nonstopLotCount = nonstops.filter(m => isMusicLot(m)).length;

            const bNAll = document.getElementById('badgeNonstopCountAll');
            const bNSlot = document.getElementById('badgeNonstopCountSlot');
            const bNNhom = document.getElementById('badgeNonstopCountNhom');
            const bNLot = document.getElementById('badgeNonstopCountLot');
            if (bNAll) bNAll.textContent = nonstopAllCount;
            if (bNSlot) bNSlot.textContent = nonstopSlotCount;
            if (bNNhom) bNNhom.textContent = nonstopNhomCount;
            if (bNLot) bNLot.textContent = nonstopLotCount;

            // Render tables
            filterAdminTracksTable();
            filterAdminNonstopsTable();
            filterAdminMusicsTable();
        } else {
            const errMsg = `<div class="p-4 text-center text-danger">❌ ${json.message || 'Không thể tải kho âm nhạc!'}</div>`;
            if (trackContainer) trackContainer.innerHTML = errMsg;
            if (nonstopContainer) nonstopContainer.innerHTML = errMsg;
            if (legacyContainer) legacyContainer.innerHTML = errMsg;
        }
    } catch (e) {
        console.error("loadAdminMusics error:", e);
        const errConn = '<div class="p-4 text-center text-danger">❌ Lỗi kết nối khi tải kho âm nhạc!</div>';
        if (trackContainer) trackContainer.innerHTML = errConn;
        if (nonstopContainer) nonstopContainer.innerHTML = errConn;
        if (legacyContainer) legacyContainer.innerHTML = errConn;
    }
}

// ------------------------------------------
// TRACK FILTER & RENDER
// ------------------------------------------
function setTrackSubFilter(level) {
    window._adminTrackFilter = level;
    ['All', 'Slot', 'Nhom', 'Lot'].forEach(l => {
        const btn = document.getElementById('btnFilterTrack' + l);
        if (btn) {
            if (l.toLowerCase() === level.toLowerCase()) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
    filterAdminTracksTable();
}

function filterAdminTracksTable() {
    const container = document.getElementById('adminTracksTableContainer');
    if (!container || !window._allAdminMusics) return;

    const searchInput = document.getElementById('adminTrackSearchInput');
    const statusFilter = document.getElementById('adminTrackStatusFilter');

    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const statusVal = statusFilter ? statusFilter.value : 'all';
    const subFilter = window._adminTrackFilter || 'all';

    const tracks = window._allAdminMusics.filter(m => {
        const t = (m.type || '').toLowerCase();
        return t === 'track' || !t.includes('nonstop');
    });

    let list = tracks.filter(m => {
        if (kw) {
            const title = (m.title || '').toLowerCase();
            const artist = (m.artist || '').toLowerCase();
            const prod = (m.producerName || '').toLowerCase();
            if (!title.includes(kw) && !artist.includes(kw) && !prod.includes(kw)) {
                return false;
            }
        }

        if (subFilter !== 'all') {
            const level = getMusicAccessLevel(m);
            if (level !== subFilter) return false;
        }

        if (statusVal !== 'all') {
            if (statusVal === 'Published' && m.status !== 'Published') return false;
            if (statusVal === 'Hidden' && m.status === 'Published') return false;
        }

        return true;
    });

    updateTrackBulkButton();

    if (list.length === 0) {
        container.innerHTML = '<div class="p-5 text-center text-dim"><i class="fas fa-compact-disc fa-2x mb-2 text-danger opacity-50"></i><br />Không tìm thấy bản Track nào phù hợp với bộ lọc hiện tại.</div>';
        return;
    }

    const allChecked = list.length > 0 && list.every(m => window._selectedTrackIds.has(m.musicId));

    let rows = list.map(m => {
        const isPublished = m.status === 'Published';
        const isSlot = isMusicSlot(m);
        const isNhom = isMusicNhom(m);
        const isChecked = window._selectedTrackIds.has(m.musicId);

        let catBadge = '<span class="badge bg-secondary">🎵 Track Lọt</span>';
        if (isSlot) catBadge = '<span class="badge badge-premium-gold"><i class="fas fa-crown me-1"></i>Track Slot (VIP)</span>';
        else if (isNhom) catBadge = '<span class="badge badge-standard-red"><i class="fas fa-certificate me-1"></i>Track Nhóm</span>';

        const coverSrc = m.coverUrl || '/images/logo.png';
        const bpmKey = (m.bpm ? `${m.bpm} BPM` : '') + (m.musicalKey ? ` • ${m.musicalKey}` : '');
        const durationText = m.formattedDuration || (m.durationSeconds ? Math.floor(m.durationSeconds / 60) + ':' + String(m.durationSeconds % 60).padStart(2, '0') : '--:--');

        return `
            <tr class="align-middle ${isChecked ? 'table-active' : ''}">
                <td style="width: 40px;" class="text-center">
                    <input type="checkbox" class="form-check-input track-select-chk" value="${m.musicId}" ${isChecked ? 'checked' : ''} onchange="onTrackCheckboxChange(this, '${m.musicId}')" />
                </td>
                <td>
                    <div class="d-flex align-items-center gap-2.5">
                        <div class="position-relative flex-shrink-0" style="width: 44px; height: 44px;">
                            <img src="${coverSrc}" class="rounded-3 border border-secondary border-opacity-50" style="width: 44px; height: 44px; object-fit: cover;" onerror="this.src='/images/logo.png';" />
                            <button class="btn btn-sm btn-dark position-absolute top-50 start-50 translate-middle rounded-circle p-0 d-flex align-items-center justify-content-center shadow" 
                                    style="width: 24px; height: 24px; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.4);" 
                                    onclick="playMusicPreview('${m.musicId}')" title="Nghe thử bài hát">
                                <i class="fas fa-play text-white" style="font-size: 0.6rem; margin-left: 1px;"></i>
                            </button>
                        </div>
                        <div class="overflow-hidden">
                            <div class="fw-bold text-white text-truncate" style="max-width: 280px;" title="${m.title}">${m.title}</div>
                            <small class="text-dim text-truncate d-block" style="max-width: 280px;">${m.artist || 'Chưa rõ nghệ sĩ'} • <span class="text-info">${m.genre || 'Vinahouse'}</span> • ${durationText}</small>
                        </div>
                    </div>
                </td>
                <td><span class="badge bg-dark border border-info text-info font-monospace"><i class="fas fa-headphones me-1"></i>${m.producerName || 'DJ TLong'}</span></td>
                <td>${catBadge}</td>
                <td><span class="badge bg-dark border border-secondary text-dim font-monospace">${bpmKey || '140 BPM'}</span></td>
                <td><span class="badge bg-dark font-monospace text-warning border border-secondary">${m.qualityAvailable || 'MP3 320k'}</span></td>
                <td class="text-dim font-monospace small">
                    <span title="Lượt nghe"><i class="fas fa-play me-1 text-secondary"></i>${(m.playsCount || 0).toLocaleString()}</span>
                    <span class="ms-2" title="Lượt tải"><i class="fas fa-download me-1 text-secondary"></i>${(m.downloadsCount || 0).toLocaleString()}</span>
                </td>
                <td>
                    <span class="badge ${isPublished ? 'bg-success bg-opacity-25 text-success border border-success border-opacity-50' : 'bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50'}">
                        <i class="fas ${isPublished ? 'fa-circle-check' : 'fa-circle-pause'} me-1"></i>${isPublished ? 'Hiển thị' : 'Đang ẩn'}
                    </span>
                </td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm ${isPublished ? 'btn-outline-warning' : 'btn-outline-success'} py-1 px-2.5 rounded-pill fw-bold" 
                            onclick="toggleAdminMusicStatus('${m.musicId}')"
                            title="${isPublished ? 'Ẩn bài hát khỏi website' : 'Hiện bài hát trên website'}">
                        <i class="fas ${isPublished ? 'fa-eye-slash' : 'fa-eye'} me-1"></i> ${isPublished ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button class="btn btn-sm btn-outline-danger py-1 px-2.5 ms-1 rounded-pill fw-bold" 
                            onclick="deleteAdminMusic('${m.musicId}', '${m.title.replace(/'/g, "\\'")}', 'Track')" 
                            title="Xóa vĩnh viễn Track khỏi hệ thống">
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
                    <th style="width: 40px;" class="text-center">
                        <input type="checkbox" id="chkSelectAllTracks" class="form-check-input" ${allChecked ? 'checked' : ''} onchange="toggleSelectAllTracks(this.checked)" title="Chọn tất cả bài Track" />
                    </th>
                    <th>Bài Hát Track</th>
                    <th>Producer Studio</th>
                    <th>Phân Cấp Gói</th>
                    <th>BPM & Key</th>
                    <th>Định Dạng</th>
                    <th>Lượt Nghe / Tải</th>
                    <th>Trạng Thái</th>
                    <th class="text-end">Thao Tác</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function onTrackCheckboxChange(chk, musicId) {
    if (chk.checked) window._selectedTrackIds.add(musicId);
    else window._selectedTrackIds.delete(musicId);
    updateTrackBulkButton();
}

function toggleSelectAllTracks(checked) {
    const checkboxes = document.querySelectorAll('#adminTracksTableContainer .track-select-chk');
    checkboxes.forEach(chk => {
        chk.checked = checked;
        if (checked) window._selectedTrackIds.add(chk.value);
        else window._selectedTrackIds.delete(chk.value);
    });
    updateTrackBulkButton();
}

function updateTrackBulkButton() {
    const btn = document.getElementById('btnBulkDeleteTracks');
    const countEl = document.getElementById('countSelectedTracks');
    const count = window._selectedTrackIds ? window._selectedTrackIds.size : 0;
    if (countEl) countEl.textContent = count;
    if (btn) {
        if (count > 0) {
            btn.classList.remove('d-none');
            btn.removeAttribute('disabled');
        } else {
            btn.classList.add('d-none');
            btn.setAttribute('disabled', 'disabled');
        }
    }
}

// ------------------------------------------
// NONSTOP FILTER & RENDER
// ------------------------------------------
function setNonstopSubFilter(level) {
    window._adminNonstopFilter = level;
    ['All', 'Slot', 'Nhom', 'Lot'].forEach(l => {
        const btn = document.getElementById('btnFilterNonstop' + l);
        if (btn) {
            if (l.toLowerCase() === level.toLowerCase()) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
    filterAdminNonstopsTable();
}

function filterAdminNonstopsTable() {
    const container = document.getElementById('adminNonstopsTableContainer');
    if (!container || !window._allAdminMusics) return;

    const searchInput = document.getElementById('adminNonstopSearchInput');
    const statusFilter = document.getElementById('adminNonstopStatusFilter');

    const kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const statusVal = statusFilter ? statusFilter.value : 'all';
    const subFilter = window._adminNonstopFilter || 'all';

    const nonstops = window._allAdminMusics.filter(m => {
        const t = (m.type || '').toLowerCase();
        return t === 'nonstop' || (m.categoryCode || '').toLowerCase().includes('nonstop');
    });

    let list = nonstops.filter(m => {
        if (kw) {
            const title = (m.title || '').toLowerCase();
            const artist = (m.artist || '').toLowerCase();
            const prod = (m.producerName || '').toLowerCase();
            if (!title.includes(kw) && !artist.includes(kw) && !prod.includes(kw)) {
                return false;
            }
        }

        if (subFilter !== 'all') {
            const level = getMusicAccessLevel(m);
            if (level !== subFilter) return false;
        }

        if (statusVal !== 'all') {
            if (statusVal === 'Published' && m.status !== 'Published') return false;
            if (statusVal === 'Hidden' && m.status === 'Published') return false;
        }

        return true;
    });

    updateNonstopBulkButton();

    if (list.length === 0) {
        container.innerHTML = '<div class="p-5 text-center text-dim"><i class="fas fa-fire-flame-curved fa-2x mb-2 text-warning opacity-50"></i><br />Không tìm thấy bản Nonstop nào phù hợp với bộ lọc hiện tại.</div>';
        return;
    }

    const allChecked = list.length > 0 && list.every(m => window._selectedNonstopIds.has(m.musicId));

    let rows = list.map(m => {
        const isPublished = m.status === 'Published';
        const isSlot = isMusicSlot(m);
        const isNhom = isMusicNhom(m);
        const isChecked = window._selectedNonstopIds.has(m.musicId);

        let catBadge = '<span class="badge bg-secondary">🔥 Nonstop Lọt</span>';
        if (isSlot) catBadge = '<span class="badge badge-premium-gold"><i class="fas fa-crown me-1"></i>Nonstop Slot (VIP)</span>';
        else if (isNhom) catBadge = '<span class="badge badge-standard-red"><i class="fas fa-certificate me-1"></i>Nonstop Nhóm</span>';

        const coverSrc = m.coverUrl || '/images/logo.png';
        const durationText = m.formattedDuration || (m.durationSeconds ? Math.floor(m.durationSeconds / 60) + ':' + String(m.durationSeconds % 60).padStart(2, '0') : '--:--');

        return `
            <tr class="align-middle ${isChecked ? 'table-active' : ''}">
                <td style="width: 40px;" class="text-center">
                    <input type="checkbox" class="form-check-input nonstop-select-chk" value="${m.musicId}" ${isChecked ? 'checked' : ''} onchange="onNonstopCheckboxChange(this, '${m.musicId}')" />
                </td>
                <td>
                    <div class="d-flex align-items-center gap-2.5">
                        <div class="position-relative flex-shrink-0" style="width: 44px; height: 44px;">
                            <img src="${coverSrc}" class="rounded-3 border border-secondary border-opacity-50" style="width: 44px; height: 44px; object-fit: cover;" onerror="this.src='/images/logo.png';" />
                            <button class="btn btn-sm btn-dark position-absolute top-50 start-50 translate-middle rounded-circle p-0 d-flex align-items-center justify-content-center shadow" 
                                    style="width: 24px; height: 24px; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.4);" 
                                    onclick="playMusicPreview('${m.musicId}')" title="Nghe thử Nonstop">
                                <i class="fas fa-play text-warning" style="font-size: 0.6rem; margin-left: 1px;"></i>
                            </button>
                        </div>
                        <div class="overflow-hidden">
                            <div class="fw-bold text-white text-truncate" style="max-width: 280px;" title="${m.title}">${m.title}</div>
                            <small class="text-dim text-truncate d-block" style="max-width: 280px;">${m.artist || 'DJ TLong Studio'} • <span class="text-warning">${m.genre || 'Vinahouse Mix'}</span></small>
                        </div>
                    </div>
                </td>
                <td><span class="badge bg-dark border border-warning text-warning font-monospace"><i class="fas fa-headphones me-1"></i>${m.producerName || 'DJ TLong'}</span></td>
                <td>${catBadge}</td>
                <td><span class="badge bg-dark border border-info text-info font-monospace"><i class="fas fa-clock me-1"></i>${durationText}</span></td>
                <td><span class="badge bg-dark font-monospace text-warning border border-secondary">${m.qualityAvailable || 'MP3 320k'}</span></td>
                <td class="text-dim font-monospace small">
                    <span title="Lượt nghe"><i class="fas fa-play me-1 text-secondary"></i>${(m.playsCount || 0).toLocaleString()}</span>
                    <span class="ms-2" title="Lượt tải"><i class="fas fa-download me-1 text-secondary"></i>${(m.downloadsCount || 0).toLocaleString()}</span>
                </td>
                <td>
                    <span class="badge ${isPublished ? 'bg-success bg-opacity-25 text-success border border-success border-opacity-50' : 'bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50'}">
                        <i class="fas ${isPublished ? 'fa-circle-check' : 'fa-circle-pause'} me-1"></i>${isPublished ? 'Hiển thị' : 'Đang ẩn'}
                    </span>
                </td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm ${isPublished ? 'btn-outline-warning' : 'btn-outline-success'} py-1 px-2.5 rounded-pill fw-bold" 
                            onclick="toggleAdminMusicStatus('${m.musicId}')"
                            title="${isPublished ? 'Ẩn bản mix khỏi website' : 'Hiện bản mix trên website'}">
                        <i class="fas ${isPublished ? 'fa-eye-slash' : 'fa-eye'} me-1"></i> ${isPublished ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button class="btn btn-sm btn-outline-danger py-1 px-2.5 ms-1 rounded-pill fw-bold" 
                            onclick="deleteAdminMusic('${m.musicId}', '${m.title.replace(/'/g, "\\'")}', 'Nonstop')" 
                            title="Xóa vĩnh viễn Nonstop khỏi hệ thống">
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
                    <th style="width: 40px;" class="text-center">
                        <input type="checkbox" id="chkSelectAllNonstops" class="form-check-input" ${allChecked ? 'checked' : ''} onchange="toggleSelectAllNonstops(this.checked)" title="Chọn tất cả bản Nonstop" />
                    </th>
                    <th>Bản Mix Nonstop</th>
                    <th>Producer Studio</th>
                    <th>Phân Cấp Gói</th>
                    <th>Thời Lượng</th>
                    <th>Định Dạng</th>
                    <th>Lượt Nghe / Tải</th>
                    <th>Trạng Thái</th>
                    <th class="text-end">Thao Tác</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function onNonstopCheckboxChange(chk, musicId) {
    if (chk.checked) window._selectedNonstopIds.add(musicId);
    else window._selectedNonstopIds.delete(musicId);
    updateNonstopBulkButton();
}

function toggleSelectAllNonstops(checked) {
    const checkboxes = document.querySelectorAll('#adminNonstopsTableContainer .nonstop-select-chk');
    checkboxes.forEach(chk => {
        chk.checked = checked;
        if (checked) window._selectedNonstopIds.add(chk.value);
        else window._selectedNonstopIds.delete(chk.value);
    });
    updateNonstopBulkButton();
}

function updateNonstopBulkButton() {
    const btn = document.getElementById('btnBulkDeleteNonstops');
    const countEl = document.getElementById('countSelectedNonstops');
    const count = window._selectedNonstopIds ? window._selectedNonstopIds.size : 0;
    if (countEl) countEl.textContent = count;
    if (btn) {
        if (count > 0) {
            btn.classList.remove('d-none');
            btn.removeAttribute('disabled');
        } else {
            btn.classList.add('d-none');
            btn.setAttribute('disabled', 'disabled');
        }
    }
}

// ------------------------------------------
// LEGACY MUSICS FILTER FALLBACK (FOR OLD MODAL)
// ------------------------------------------
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
        const isSlot = isMusicSlot(m);
        const isNhom = isMusicNhom(m);
        const isNonstop = (m.type || '').toLowerCase().includes('nonstop') || (m.categoryCode || '').toLowerCase().includes('nonstop');

        let catBadge = '<span class="badge bg-secondary">Track Lọt</span>';
        if (isSlot) catBadge = '<span class="badge badge-premium-gold"><i class="fas fa-crown me-1"></i>Slot (VIP)</span>';
        else if (isNhom) catBadge = '<span class="badge badge-standard-red"><i class="fas fa-certificate me-1"></i>Nhóm</span>';
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
                            onclick="toggleAdminMusicStatus('${m.musicId}')">
                        <i class="fas ${isPublished ? 'fa-eye-slash' : 'fa-eye'} me-1"></i> ${isPublished ? 'Ẩn' : 'Hiện'}
                    </button>
                    <button class="btn btn-sm btn-outline-danger py-1 px-2.5 ms-1 rounded-pill" 
                            onclick="deleteAdminMusic('${m.musicId}', '${m.title.replace(/'/g, "\\'")}', '${m.type || 'Track'}')">
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

// ------------------------------------------
// PLAY AUDIO PREVIEW FROM ADMIN PANEL
// ------------------------------------------
function playMusicPreview(musicId) {
    const current = window.TLongPlayer?.currentTrack;
    if (current && current.id === musicId) {
        togglePlayPause();
        return;
    }
    const music = (window._allAdminMusics || []).find(m => m.musicId === musicId);
    if (!music) return;
    const isNonstop = (music.type || '').toLowerCase().includes('nonstop') || (music.categoryCode || '').toLowerCase().includes('nonstop');
    playTrack({
        id: music.musicId,
        title: music.title,
        artist: music.artist || music.producerName || 'DJ TLong Studio',
        coverUrl: music.coverUrl || '/images/logo.png',
        audioUrl: music.audioUrl || music.sourceUrl,
        sourceUrl: music.sourceUrl,
        bpm: music.bpm || 140,
        key: music.musicalKey || '8A',
        durationSeconds: music.durationSeconds || 0,
        trackType: isNonstop ? 'nonstop' : 'track',
        kind: isNonstop ? 'Nonstop' : 'Track',
        categoryCode: music.categoryCode,
        isDemo: false
    });
}

// ------------------------------------------
// TOGGLE STATUS & DELETE ACTIONS
// ------------------------------------------
async function toggleAdminMusicStatus(musicId) {
    try {
        const res = await fetch('/Admin/ToggleMusicStatus/' + musicId, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            showToastNotification(json.message);
            loadAdminMusics(true);
        } else {
            showToastNotification(`❌ ${json.message || 'Thao tác thất bại!'}`);
        }
    } catch (e) {
        console.error(e);
        showToastNotification("❌ Lỗi kết nối khi thay đổi trạng thái!");
    }
}

function deleteAdminMusic(musicId, title, type) {
    const item = (window._allAdminMusics || []).find(m => m.musicId === musicId);
    _currentDeleteTarget = {
        id: musicId,
        title: title || (item ? item.title : 'Bản thu'),
        type: type || (item ? item.type : 'Track')
    };

    const modalEl = document.getElementById('adminMusicDeleteModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const coverEl = document.getElementById('delModalCover');
        const titleEl = document.getElementById('delModalTitle');
        const artistEl = document.getElementById('delModalArtist');
        const typeBadge = document.getElementById('delModalTypeBadge');
        const tierBadge = document.getElementById('delModalTierBadge');
        const targetName = document.getElementById('delModalTargetName');

        if (coverEl) coverEl.src = (item && item.coverUrl) ? item.coverUrl : '/images/logo.png';
        if (titleEl) titleEl.textContent = _currentDeleteTarget.title;
        if (artistEl) artistEl.textContent = (item && item.artist ? item.artist : 'Chưa rõ') + ' • ' + (item && item.producerName ? item.producerName : 'DJ TLong');
        if (targetName) targetName.textContent = `"${_currentDeleteTarget.title}" (${_currentDeleteTarget.type})`;

        const level = item ? getMusicAccessLevel(item) : 'Lot';
        if (typeBadge) {
            typeBadge.textContent = _currentDeleteTarget.type;
            typeBadge.className = _currentDeleteTarget.type === 'Nonstop' ? 'badge bg-warning text-dark mb-1 font-monospace' : 'badge bg-danger mb-1 font-monospace';
        }
        if (tierBadge) {
            tierBadge.textContent = _currentDeleteTarget.type + ' ' + (level === 'Slot' ? 'Slot (VIP)' : (level === 'Nhom' ? 'Nhóm' : 'Lọt'));
            tierBadge.className = level === 'Slot' ? 'badge badge-premium-gold mb-1 font-monospace' : (level === 'Nhom' ? 'badge badge-standard-red mb-1 font-monospace' : 'badge bg-secondary mb-1 font-monospace');
        }

        const confirmBtn = document.getElementById('btnConfirmExecuteDelete');
        if (confirmBtn) {
            confirmBtn.onclick = executeDeleteMusic;
        }

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } else {
        if (confirm(`ADMIN XÁC NHẬN:\nBạn có chắc chắn muốn xóa vĩnh viễn ${_currentDeleteTarget.type} "${_currentDeleteTarget.title}" khỏi hệ thống?\nThao tác này sẽ xóa sạch dữ liệu và file trên ổ cứng server!`)) {
            executeDeleteMusic();
        }
    }
}

async function executeDeleteMusic() {
    if (!_currentDeleteTarget) return;
    const target = _currentDeleteTarget;
    try {
        const modalEl = document.getElementById('adminMusicDeleteModal');
        if (modalEl) {
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        }

        showToastNotification(`⏳ Đang tiến hành xóa ${target.type} "${target.title}"...`);
        const res = await fetch('/Admin/DeleteMusic/' + target.id, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            showToastNotification(`🗑️ ${json.message}`);
            if (window._selectedTrackIds) window._selectedTrackIds.delete(target.id);
            if (window._selectedNonstopIds) window._selectedNonstopIds.delete(target.id);
            loadAdminMusics(true);
        } else {
            showToastNotification(`❌ ${json.message || 'Xóa thất bại!'}`);
        }
    } catch (e) {
        console.error("executeDeleteMusic error:", e);
        showToastNotification("❌ Lỗi kết nối khi xóa bài hát!");
    } finally {
        _currentDeleteTarget = null;
    }
}

function confirmBulkDelete(type) {
    _currentBulkDeleteType = type;
    const set = (type === 'Nonstop') ? window._selectedNonstopIds : window._selectedTrackIds;
    const count = set ? set.size : 0;
    if (count === 0) {
        alert(`Vui lòng tick chọn ít nhất một ${type} trong danh sách để xóa!`);
        return;
    }

    const modalEl = document.getElementById('adminBulkDeleteModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        const countEl = document.getElementById('bulkDelCount');
        const typeNameEl = document.getElementById('bulkDelTypeName');
        if (countEl) countEl.textContent = count;
        if (typeNameEl) typeNameEl.textContent = (type === 'Nonstop' ? 'bản Nonstop' : 'bài Track');

        const confirmBtn = document.getElementById('btnConfirmExecuteBulkDelete');
        if (confirmBtn) confirmBtn.onclick = executeBulkDeleteMusics;

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } else {
        if (confirm(`ADMIN XÁC NHẬN:\nBạn có chắc chắn muốn xóa ${count} ${type} đã chọn khỏi hệ thống?`)) {
            executeBulkDeleteMusics();
        }
    }
}

async function executeBulkDeleteMusics() {
    const type = _currentBulkDeleteType || 'Track';
    const set = (type === 'Nonstop') ? window._selectedNonstopIds : window._selectedTrackIds;
    const ids = Array.from(set || []);
    if (ids.length === 0) return;

    try {
        const modalEl = document.getElementById('adminBulkDeleteModal');
        if (modalEl) {
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        }

        showToastNotification(`⏳ Đang xóa hàng loạt ${ids.length} ${type}...`);
        const res = await fetch('/Admin/DeleteMusicsBatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ musicIds: ids })
        });
        const json = await res.json();
        if (json.success) {
            showToastNotification(`🗑️ ${json.message}`);
            if (type === 'Nonstop') {
                window._selectedNonstopIds.clear();
            } else {
                window._selectedTrackIds.clear();
            }
            loadAdminMusics(true);
        } else {
            showToastNotification(`❌ ${json.message || 'Xóa hàng loạt thất bại!'}`);
        }
    } catch (e) {
        console.error("executeBulkDeleteMusics error:", e);
        showToastNotification("❌ Lỗi kết nối khi xóa hàng loạt!");
    } finally {
        _currentBulkDeleteType = null;
    }
}

// ==========================================
// ADMIN USER MANAGEMENT & VIP SUBSCRIPTION EXTENSION
// ==========================================
window._allAdminUsers = [];

async function loadAdminUsers(forceRefresh = false) {
    const container = document.getElementById('adminUsersTableContainer');
    if (!container) return;

    // Fast-path: nếu đã có dữ liệu trong bộ nhớ và không yêu cầu làm mới bắt buộc, render tức thì 0ms
    if (!forceRefresh && window._allAdminUsers && window._allAdminUsers.length > 0) {
        filterAdminUsersTable();
        return;
    }

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
            loadAdminUsers(true);
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
            loadAdminUsers(true);
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
            loadAdminUsers(true);
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

