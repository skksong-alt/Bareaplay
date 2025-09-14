// js/app.js

// Firebase 모듈 import
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// 중앙 스토어와 각 기능 모듈들 import (중복 제거)
import { state, setAdmin } from './store.js';
import * as playerMgmt from './modules/playerManagement.js';
import * as balancer from './modules/teamBalancer.js';
import * as lineup from './modules/lineupGenerator.js';
import * as accounting from './modules/accounting.js';
import * as shareMgmt from './modules/shareManagement.js';

// --- Firebase 초기화 ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY", // 실제 키로 교체해주세요.
    authDomain: "team-barea.firebaseapp.com",
    projectId: "team-barea",
    storageBucket: "team-barea.appspot.com",
    messagingSenderId: "1005771179097",
    appId: "1:1005771179097:web:c62fd10192da0eaad29d48",
    measurementId: "G-MX4MHMX069"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 모달 제어 관련 변수 선언
let adminModal, passwordInput, modalConfirmBtn, modalCancelBtn;

// --- 글로벌 헬퍼 함수들 ---
window.shuffleLocal = function(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
};

window.showNotification = function(message, type = 'success') {
    const notificationEl = document.getElementById('notification');
    notificationEl.textContent = message;
    notificationEl.className = '';
    notificationEl.classList.add(type === 'success' ? 'notification-success' : 'notification-error');
    notificationEl.classList.add('show');
    setTimeout(() => {
        notificationEl.classList.remove('show');
    }, 3000);
};

window.debounce = function(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

// --- UI 컨트롤 ---
const pages = {};
const tabs = {};

function updateAdminUI() {
    document.querySelectorAll('.admin-control').forEach(el => {
        el.disabled = !state.isAdmin;
    });
    const adminLoginBtn = document.getElementById('admin-login-btn');
    if (adminLoginBtn) {
        adminLoginBtn.textContent = state.isAdmin ? '관리자 모드 ON' : '관리자 로그인';
        adminLoginBtn.classList.toggle('bg-green-500', state.isAdmin);
        adminLoginBtn.classList.toggle('hover:bg-green-600', state.isAdmin);
        adminLoginBtn.classList.toggle('bg-red-500', !state.isAdmin);
        adminLoginBtn.classList.toggle('hover:bg-red-600', !state.isAdmin);
    }
    if (pages.accounting && !pages.accounting.classList.contains('hidden')) {
        accounting.renderForDate();
    }
}

window.promptForAdminPassword = function() {
    if (state.isAdmin) {
        window.showNotification('이미 관리자 권한으로 로그인되어 있습니다.');
        return;
    }
    passwordInput.value = '';
    adminModal.classList.remove('hidden');
    passwordInput.focus();
};

window.switchTab = function(activeKey, force = false) {
    if (activeKey === 'players' && !state.isAdmin && !force) {
        promptForAdminPassword();
        if (!state.isAdmin) return;
    }
    Object.keys(pages).forEach(key => {
        if (pages[key]) pages[key].classList.toggle('hidden', key !== activeKey);
        if (tabs[key]) tabs[key].classList.toggle('active', key === activeKey);
    });
    if (activeKey === 'accounting') {
        accounting.renderForDate();
    }
};

// --- 앱 메인 실행 로직 ---
document.addEventListener('DOMContentLoaded', async () => {
    // 전역에서 사용할 DOM 요소 할당 (정리된 버전)
    Object.assign(pages, { 
        players: document.getElementById('page-players'), 
        balancer: document.getElementById('page-balancer'), 
        lineup: document.getElementById('page-lineup'), 
        accounting: document.getElementById('page-accounting'),
        share: document.getElementById('page-share')
    });
    Object.assign(tabs, { 
        players: document.getElementById('tab-players'), 
        balancer: document.getElementById('tab-balancer'), 
        lineup: document.getElementById('tab-lineup'), 
        accounting: document.getElementById('tab-accounting'),
        share: document.getElementById('tab-share')
    });
    const loadingOverlay = document.getElementById('loading-overlay');
    
    adminModal = document.getElementById('admin-modal');
    passwordInput = document.getElementById('admin-password-input');
    modalConfirmBtn = document.getElementById('modal-confirm-btn');
    modalCancelBtn = document.getElementById('modal-cancel-btn');
    
    // 각 모듈 초기화
    playerMgmt.init(db, state);
    balancer.init(db, state);
    lineup.init(db, state);
    accounting.init(db, state);
    shareMgmt.init(db, state); 

    modalConfirmBtn.addEventListener('click', () => {
        if (passwordInput.value === state.ADMIN_PASSWORD) {
            setAdmin(true);
            window.showNotification('관리자 인증에 성공했습니다.', 'success');
            updateAdminUI();
            adminModal.classList.add('hidden');
        } else {
            window.showNotification('승인번호가 올바르지 않습니다.', 'error');
        }
    });
    modalCancelBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
    adminModal.addEventListener('click', (e) => { if (e.target === adminModal) adminModal.classList.add('hidden'); });
    passwordInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') modalConfirmBtn.click(); });

    Object.keys(tabs).forEach(key => {
        if (tabs[key]) tabs[key].addEventListener('click', () => switchTab(key));
    });

    try {
        const playersSnapshot = await getDocs(collection(db, "players"));
        playersSnapshot.forEach(doc => { state.playerDB[doc.id] = doc.data(); });

        const attendanceSnapshot = await getDocs(collection(db, "attendance"));
        state.attendanceLog = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        playerMgmt.renderPlayerTable();
        accounting.renderForDate();

    } catch (error) {
        console.error("초기 데이터 로딩 실패:", error);
        window.showNotification('데이터 로딩에 실패했습니다.', 'error');
    } finally {
        loadingOverlay.style.opacity = 0;
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
    }
    
    onSnapshot(collection(db, "expenses"), (snapshot) => {
        state.expenseLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(!pages.accounting.classList.contains('hidden')) {
            accounting.renderForDate();
        }
    });

    onSnapshot(doc(db, "memos", "accounting_memo"), (doc) => {
        const memoArea = document.getElementById('memo-area');
        if (doc.exists()) {
            state.memoContent = doc.data().content;
            if(memoArea) memoArea.value = state.memoContent;
        }
    });

    updateAdminUI();
    switchTab('balancer', true);
});

// 다른 모듈에서 호출할 수 있도록 window 객체에 할당
window.accounting = accounting;
window.teamBalancer = balancer;
window.lineup = lineup;

// --- 다크 모드 컨트롤 로직 ---
const themeToggleBtn = document.getElementById('dark-mode-toggle');
const moonIcon = document.getElementById('theme-icon-moon');
const sunIcon = document.getElementById('theme-icon-sun');

const updateIcons = (isDarkMode) => {
    state.isDarkMode = isDarkMode;
    if (isDarkMode) {
        moonIcon.classList.add('hidden');
        sunIcon.classList.remove('hidden');
    } else {
        moonIcon.classList.remove('hidden');
        sunIcon.classList.add('hidden');
    }
    if (pages.accounting && !pages.accounting.classList.contains('hidden')) {
        accounting.renderForDate();
    }
};

const applyTheme = (theme) => {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        updateIcons(true);
    } else {
        document.documentElement.classList.remove('dark');
        updateIcons(false);
    }
};

const savedTheme = localStorage.getItem('theme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme) {
    applyTheme(savedTheme);
} else {
    applyTheme(systemPrefersDark ? 'dark' : 'light');
}

themeToggleBtn.addEventListener('click', () => {
    const isDarkMode = document.documentElement.classList.toggle('dark');
    const newTheme = isDarkMode ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    updateIcons(isDarkMode);
});