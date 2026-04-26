// ==================== КРИПТОГРАФИЯ ====================

        const SECRET_KEY = "key12415";

        async function sha256(message) {
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return new Uint8Array(hashBuffer);
        }

        function base64UrlDecode(str) {
            const pad = str.length % 4;
            if (pad) str += '='.repeat(4 - pad);
            str = str.replace(/\-/g, '+').replace(/\_/g, '/');
            const binary = atob(str);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }

        function readFloat32(bytes, offset) {
            const buf = new ArrayBuffer(4);
            new Uint8Array(buf).set(bytes.slice(offset, offset + 4));
            return new DataView(buf).getFloat32(0, true);
        }

        function readUint64(bytes, offset) {
            const buf = new ArrayBuffer(8);
            new Uint8Array(buf).set(bytes.slice(offset, offset + 8));
            const view = new DataView(buf);
            const low = view.getUint32(0, true);
            const high = view.getUint32(4, true);
            return (BigInt(high) << BigInt(32)) | BigInt(low);
        }

        function readUint32(bytes, offset) {
            const buf = new ArrayBuffer(4);
            new Uint8Array(buf).set(bytes.slice(offset, offset + 4));
            return new DataView(buf).getUint32(0, true);
        }

        async function decryptCheck(token) {
            try {
                const key = await sha256(SECRET_KEY);
                const encrypted = base64UrlDecode(token);

                if (encrypted.length !== 16) {
                    console.error("Wrong length:", encrypted.length, "expected 16");
                    return null;
                }

                const decrypted = new Uint8Array(16);
                for (let i = 0; i < 16; i++) {
                    decrypted[i] = encrypted[i] ^ key[i % key.length];
                }

                const sum = readFloat32(decrypted, 0);
                const user_id = Number(readUint64(decrypted, 4));
                const check_id = readUint32(decrypted, 12);

                if (isNaN(sum) || sum < 0 || sum > 1000000) {
                    console.error("Invalid sum:", sum);
                    return null;
                }

                return {
                    sum: Math.round(sum * 100) / 100,
                    user_id: user_id,
                    check_id: check_id
                };
            } catch (e) {
                console.error('Decrypt error:', e);
                return null;
            }
        }

        // ==================== ХРАНИЛИЩЕ ПОЛЬЗОВАТЕЛЯ ====================

        function getUserStorageKey(userId) {
            return `app_user_${userId}`;
        }

        function loadUserData(userId) {
            const key = getUserStorageKey(userId);
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    return JSON.parse(raw);
                } catch (e) {
                    return null;
                }
            }
            return null;
        }

        function saveUserData(userId, data) {
            const key = getUserStorageKey(userId);
            localStorage.setItem(key, JSON.stringify(data));
        }

        // ==================== ПРИЛОЖЕНИЕ ====================

        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        const user = tg.initDataUnsafe?.user;
        let currentUserId = null;
        let userData = null;

        if (user && user.id) {
            currentUserId = user.id;
        } else {
            currentUserId = parseInt(localStorage.getItem('debug_user_id') || '0') || null;
        }

        if (currentUserId) {
            userData = loadUserData(currentUserId);
            if (!userData) {
                userData = { 
                    balance: 0, 
                    usedChecks: [],
                    transactions: [] 
                };
                saveUserData(currentUserId, userData);
            }
            if (!userData.transactions) {
                userData.transactions = [];
            }
        } else {
            userData = { 
                balance: 0, 
                usedChecks: [],
                transactions: [] 
            };
        }

        if (user) {
            const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
            document.getElementById('userName').textContent = fullName || 'Name';
            document.getElementById('userUsername').textContent = user.username ? '@' + user.username : '@username';

            const avatarEl = document.getElementById('userAvatar');
            if (user.photo_url) {
                avatarEl.innerHTML = `<img src="${user.photo_url}" alt="avatar">`;
            } else {
                avatarEl.textContent = (user.first_name?.[0] || 'N').toUpperCase();
            }
        }

        function formatDate(dateStr) {
            const d = new Date(dateStr);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();

            if (isToday) {
                return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }

        function updateBalanceDisplay() {
            document.getElementById('balance').textContent = userData.balance.toLocaleString('ru-RU', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) + ' ₽';
        }

        function renderMiniHistoryItem(tx) {
            const isIncome = tx.type === 'income';
            const iconClass = isIncome ? 'income' : 'outcome';
            const amountClass = isIncome ? 'income' : 'outcome';
            const sign = isIncome ? '+' : '-';
            const iconSvg = isIncome 
                ? '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5H7z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7z"/></svg>';

            return `
                <div class="history-item">
                    <div class="history-item-left">
                        <div class="history-icon ${iconClass}">${iconSvg}</div>
                        <div class="history-info">
                            <div class="history-desc">${tx.description}</div>
                            <div class="history-date">${formatDate(tx.date)}</div>
                        </div>
                    </div>
                    <div class="history-amount ${amountClass}">${sign}${tx.amount.toFixed(2)} ₽</div>
                </div>
            `;
        }

        function renderFullHistoryItem(tx) {
            const isIncome = tx.type === 'income';
            const iconClass = isIncome ? 'income' : 'outcome';
            const amountClass = isIncome ? 'income' : 'outcome';
            const sign = isIncome ? '+' : '-';
            const iconSvg = isIncome 
                ? '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5H7z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7z"/></svg>';

            return `
                <div class="all-history-item">
                    <div class="all-history-item-left">
                        <div class="all-history-icon ${iconClass}">${iconSvg}</div>
                        <div class="all-history-info">
                            <div class="all-history-desc">${tx.description}</div>
                            <div class="all-history-date">${formatDate(tx.date)}</div>
                        </div>
                    </div>
                    <div class="all-history-amount ${amountClass}">${sign}${tx.amount.toFixed(2)} ₽</div>
                </div>
            `;
        }

        function renderMiniHistory() {
            const container = document.getElementById('historyContent');

            if (!userData.transactions || userData.transactions.length === 0) {
                container.innerHTML = '<div class="history-empty">Нет операций</div>';
                return;
            }

            const sorted = [...userData.transactions].sort((a, b) => 
                new Date(b.date) - new Date(a.date)
            );

            const recent = sorted.slice(0, 3);

            let html = '<div class="history-list">';
            for (const tx of recent) {
                html += renderMiniHistoryItem(tx);
            }
            html += '</div>';
            container.innerHTML = html;
        }

        function renderFullHistory() {
            const container = document.getElementById('allHistoryContent');

            if (!userData.transactions || userData.transactions.length === 0) {
                container.innerHTML = '<div class="all-history-empty">Нет операций</div>';
                return;
            }

            const sorted = [...userData.transactions].sort((a, b) => 
                new Date(b.date) - new Date(a.date)
            );

            let html = '';
            for (const tx of sorted) {
                html += renderFullHistoryItem(tx);
            }
            container.innerHTML = html;
        }

        updateBalanceDisplay();
        renderMiniHistory();

        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast ' + type;
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        async function processCheck(token) {
            if (!token) return;

            if (!currentUserId) {
                showToast('Ошибка: не удалось определить пользователя', 'error');
                return;
            }

            const data = await decryptCheck(token);
            if (!data) {
                showToast('Неверный или повреждённый чек', 'error');
                return;
            }

            if (data.user_id !== currentUserId) {
                showToast('Этот чек предназначен для другого пользователя', 'error');
                return;
            }

            if (userData.usedChecks.includes(data.check_id)) {
                showToast('Этот чек уже был активирован', 'info');
                return;
            }

            userData.balance += data.sum;
            userData.usedChecks.push(data.check_id);

            userData.transactions.push({
                date: new Date().toISOString(),
                type: 'income',
                amount: data.sum,
                description: 'Активация чека'
            });

            saveUserData(currentUserId, userData);

            updateBalanceDisplay();
            renderMiniHistory();
            showToast(`+${data.sum.toFixed(2)} ₽ зачислено!`, 'success');

            if (window.history.replaceState) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        // Обработка startapp
        const initData = tg.initData;
        const startParam = tg.initDataUnsafe?.start_param;

        if (initData && startParam && startParam.trim() !== '') {
            const lastProcessed = sessionStorage.getItem('last_processed_check');
            if (lastProcessed !== startParam) {
                sessionStorage.setItem('last_processed_check', startParam);
                processCheck(startParam);
            }
        }

        // ==================== КАРУСЕЛЬ БАННЕРОВ ====================

        const bannersTrack = document.getElementById('bannersTrack');
        const bannersDots = document.getElementById('bannersDots');
        const dots = bannersDots.querySelectorAll('.banner-dot');

        // Обновление точек при скролле
        bannersTrack.addEventListener('scroll', () => {
            const slideWidth = bannersTrack.offsetWidth;
            const index = Math.round(bannersTrack.scrollLeft / slideWidth);
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === index);
            });
        });

        // Клик по точкам
        dots.forEach(dot => {
            dot.addEventListener('click', () => {
                const index = parseInt(dot.dataset.index);
                const slideWidth = bannersTrack.offsetWidth;
                bannersTrack.scrollTo({ left: index * slideWidth, behavior: 'smooth' });
            });
        });

        // ==================== TELEGRAM BACK BUTTON ====================
        // Управление стеком экранов для навигации назад
        const screenStack = [];
        let backButtonHandler = null;

        function pushScreen(screenElement, onBack) {
            screenStack.push({ element: screenElement, onBack: onBack });
            updateBackButton();
        }

        function popScreen() {
            if (screenStack.length === 0) return;
            const screen = screenStack.pop();
            screen.element.classList.remove('active');
            if (screen.onBack) screen.onBack();
            updateBackButton();
        }

        function updateBackButton() {
            if (screenStack.length > 0) {
                tg.BackButton.show();
                if (backButtonHandler) {
                    tg.BackButton.offClick(backButtonHandler);
                }
                backButtonHandler = () => {
                    popScreen();
                };
                tg.BackButton.onClick(backButtonHandler);
            } else {
                if (backButtonHandler) {
                    tg.BackButton.offClick(backButtonHandler);
                    backButtonHandler = null;
                }
                tg.BackButton.hide();
            }
        }

        // ==================== QR-СКАНЕР ====================

        const qrScreen = document.getElementById('qrScreen');
        const qrBtn = document.getElementById('qrBtn');
        const startScan = document.getElementById('startScan');

        qrBtn.addEventListener('click', () => {
            qrScreen.classList.add('active');
            pushScreen(qrScreen);
        });

        // Клик по баннеру QR тоже открывает экран
        document.getElementById('bannerQr').addEventListener('click', () => {
            qrScreen.classList.add('active');
            pushScreen(qrScreen);
        });

        startScan.addEventListener('click', () => {
            if (tg.showScanQrPopup) {
                tg.showScanQrPopup({
                    text: 'Наведите камеру на QR-код оплаты'
                }, async (text) => {
                    await processCheck(text);
                    qrScreen.classList.remove('active');
                    return true;
                });
            } else {
                tg.showAlert('Сканер QR недоступен на этом устройстве');
            }
        });

        // ==================== НАВИГАЦИЯ ====================

        const allHistoryScreen = document.getElementById('allHistoryScreen');
        const showAllHistoryBtn = document.getElementById('showAllHistory');

        showAllHistoryBtn.addEventListener('click', () => {
            renderFullHistory();
            allHistoryScreen.classList.add('active');
            pushScreen(allHistoryScreen);
        });

// ==================== ЭКРАН ПЕРЕВОДОВ ====================

const transferScreen = document.getElementById('transferScreen');
const transferBtn = document.getElementById('transferBtn');

if (transferBtn) {
    transferBtn.addEventListener('click', () => {
        transferScreen.classList.add('active');
        pushScreen(transferScreen);
    });
}

// ==================== ЭКРАН НАСТРОЙКИ АККАУНТА ====================

const setupScreen = document.getElementById('setupScreen');
const setupPhoneStep = document.getElementById('setupPhoneStep');

// Open setup screen when any transfer item is clicked
document.querySelectorAll('.transfer-item').forEach(item => {
    item.addEventListener('click', () => {
        transferScreen.classList.remove('active');
        // Убираем transferScreen из стека, т.к. мы заменяем его на setupScreen
        if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
            screenStack.pop();
        }
        setupScreen.classList.add('active');
        pushScreen(setupScreen);
    });
});

// ==================== МОДАЛЬНОЕ ОКНО ТЕЛЕФОНА ====================

const phoneModal = document.getElementById('phoneModal');
const phoneModalOverlay = document.getElementById('phoneModalOverlay');
const phoneModalClose = document.getElementById('phoneModalClose');
const phoneModalContinue = document.getElementById('phoneModalContinue');

function openPhoneModal() {
    phoneModal.classList.add('active');
}

function closePhoneModal() {
    phoneModal.classList.remove('active');
}

if (setupPhoneStep) {
    setupPhoneStep.addEventListener('click', openPhoneModal);
}

if (phoneModalOverlay) {
    phoneModalOverlay.addEventListener('click', closePhoneModal);
}

if (phoneModalClose) {
    phoneModalClose.addEventListener('click', closePhoneModal);
}

if (phoneModalContinue) {
    phoneModalContinue.addEventListener('click', () => {
        if (tg.requestContact) {
            tg.requestContact((sent, event) => {
                if (sent) {
                    const phone = event?.responseUnsafe?.contact?.phone_number;
                    if (phone) {
                        userData.phone = phone;
                        if (currentUserId) {
                            saveUserData(currentUserId, userData);
                        }
                        showToast('Номер телефона сохранён!', 'success');
                        closePhoneModal();
                        // Mark step as done
                        setupPhoneStep.classList.remove('active');
                        setupPhoneStep.classList.add('done');
                        const icon = setupPhoneStep.querySelector('.setup-step-icon');
                        icon.classList.remove('blue');
                        icon.classList.add('green');
                        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
                        setupPhoneStep.querySelector('.setup-step-arrow').outerHTML = '<div class="setup-step-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>';
                        // Update progress
                        document.querySelector('.progress-bar').style.strokeDashoffset = '0';
                        document.querySelector('.setup-percent').textContent = '100%';
                        document.querySelector('.setup-subtitle').textContent = 'Всё готово!';
                    }
                } else {
                    showToast('Доступ к контактам отклонён', 'error');
                }
            });
        } else {
            showToast('requestContact недоступен', 'error');
        }
    });
}

// Update setup avatar with user data
if (user) {
    const setupAvatar = document.getElementById('setupAvatar');
    if (setupAvatar) {
        if (user.photo_url) {
            setupAvatar.innerHTML = `<img src="${user.photo_url}" alt="avatar">`;
        } else {
            setupAvatar.textContent = (user.first_name?.[0] || 'N').toUpperCase();
        }
    }
}
