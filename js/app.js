// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { state, setAdmin } from './store.js';
import * as playerMgmt from './modules/playerManagement.js';
import * as balancer from './modules/teamBalancer.js';
import * as lineup from './modules/lineupGenerator.js';
import * as accounting from './modules/accounting.js';
import * as shareMgmt from './modules/shareManagement.js';

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "team-barea.firebaseapp.com",
    projectId: "team-barea",
    storageBucket: "team-barea.appspot.com",
    messagingSenderId: "1005771179097",
    appId: "1:1005771179097:web:c62fd10192da0eaad29d48",
    measurementId: "G-MX4MHMX069"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let adminModal, passwordInput, modalConfirmBtn, modalCancelBtn;
const pages = {};
const tabs = {};

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

window.shuffleLocal = function(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
};

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
}

function promptForAdminPassword() {
    if (state.isAdmin) {
        window.showNotification('이미 관리자 권한으로 로그인되어 있습니다.');
        return;
    }
    passwordInput.value = '';
    adminModal.classList.remove('hidden');
    passwordInput.focus();
}

function switchTab(activeKey, force = false) {
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
}

window.refreshData = async function(collectionName) {
    const snapshot = await getDocs(collection(db, collectionName));
    if (collectionName === 'players') {
        const data = {};
        snapshot.forEach(doc => { data[doc.id] = doc.data(); });
        state.playerDB = data;
        playerMgmt.renderPlayerTable();
    }
};

document.addEventListener('DOMContentLoaded', async () => {
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

    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt };
    const dependencies = { db, state };

    for (const moduleName in modules) {
        if (modules[moduleName].init) {
            modules[moduleName].init(dependencies);
        }
    }
    
    window.playerMgmt = playerMgmt;
    window.accounting = accounting;
    window.lineup = lineup;
    window.shareMgmt = shareMgmt;

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
        const collectionsToFetch = ['players', 'attendance', 'expenses', 'locations'];
        const snapshots = await Promise.all(collectionsToFetch.map(c => getDocs(collection(db, c))));
        
        state.playerDB = {}; snapshots[0].forEach(doc => { state.playerDB[doc.id] = doc.data(); });
        state.attendanceLog = snapshots[1].docs.map(doc => ({ id: doc.id, ...doc.data() }));
        state.expenseLog = snapshots[2].docs.map(doc => ({ id: doc.id, ...doc.data() }));
        state.locations = snapshots[3].docs.map(doc => ({ id: doc.id, ...doc.data() }));

        onSnapshot(collection(db, "expenses"), (snapshot) => {
            state.expenseLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if(!pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); }
        });

        onSnapshot(collection(db, "attendance"), (snapshot) => {
             state.attendanceLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
             if(!pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); }
             playerMgmt.renderPlayerTable();
        });

        onSnapshot(doc(db, "memos", "accounting_memo"), (doc) => {
            const memoArea = document.getElementById('memo-area');
            if (doc.exists() && memoArea) { memoArea.value = doc.data().content; }
        });
        
        playerMgmt.renderPlayerTable();
        accounting.renderForDate();
        shareMgmt.populateLocations();

    } catch (error) {
        console.error("초기 데이터 로딩 실패:", error);
        showNotification('데이터 로딩에 실패했습니다.', 'error');
    } finally {
        loadingOverlay.style.opacity = 0;
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
        updateAdminUI();
        switchTab('balancer', true);
    }
});