// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { state, setAdmin } from './store.js';
import * as playerMgmt from './modules/playerManagement.js';
import * as balancer from './modules/teamBalancer.js';
import * as lineup from './modules/lineupGenerator.js';
import * as accounting from './modules/accounting.js';
import * as shareMgmt from './modules/shareManagement.js';

// Firebase 구성 정보는 실제 프로젝트의 값으로 채워주세요.
const firebaseConfig = {
    apiKey: "YOUR_API_KEY", // 실제 API 키로 교체
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
    notificationEl.className = 'notification'; // 기존 클래스 초기화
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

window.promptForAdminPassword = function() {
    if (state.isAdmin) {
        window.showNotification('이미 관리자 권한으로 로그인되어 있습니다.');
        return;
    }
    passwordInput.value = '';
    adminModal.classList.remove('hidden');
    passwordInput.focus();
}

function switchTab(activeKey, force = false) {
    if ((activeKey === 'players' || activeKey === 'accounting') && !state.isAdmin && !force) {
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
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // 모듈 및 전역 객체 초기화
    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt };
    const dependencies = { db, state };

    window.playerMgmt = playerMgmt;
    window.accounting = accounting;
    window.lineup = lineup;
    window.shareMgmt = shareMgmt;

    for (const moduleName in modules) {
        if (modules[moduleName].init) {
            modules[moduleName].init(dependencies);
        }
    }
    
    // URL에서 공유 ID 확인
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId) {
        // 공유 링크로 접속한 경우
        loadingOverlay.style.display = 'flex';
        loadingOverlay.style.opacity = 1;
        document.body.innerHTML = ''; // 기존 UI 모두 제거
        try {
            const shareDoc = await getDoc(doc(db, "shares", shareId));
            if (shareDoc.exists()) {
                const shareData = shareDoc.data();
                document.body.className = "bg-gray-100"; // 배경색 유지
                
                // 인쇄 버튼 추가
                const printButtonContainer = document.createElement('div');
                printButtonContainer.className = 'text-center my-8';
                printButtonContainer.innerHTML = `<button id="print-share-btn" class="bg-gray-700 text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-800">결과 인쇄 / PDF 저장</button>`;
                document.body.appendChild(printButtonContainer);

                // 인쇄 버튼에 이벤트 리스너 추가
                document.getElementById('print-share-btn').addEventListener('click', () => {
                    shareMgmt.generatePrintView(shareData);
                });

                // 알림창 요소 추가
                const notificationEl = document.createElement('div');
                notificationEl.id = 'notification';
                document.body.appendChild(notificationEl);
                
                window.showNotification("공유된 모임 정보입니다. 버튼을 눌러 확인하세요.");

            } else {
                document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">공유된 데이터를 찾을 수 없습니다.</p>`;
            }
        } catch (e) {
            console.error("Error loading share data:", e);
            document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">데이터를 불러오는 중 오류가 발생했습니다.</p>`;
        } finally {
            loadingOverlay.style.display = 'none';
        }
    } else {
        // 일반 접속의 경우
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
        
        adminModal = document.getElementById('admin-modal');
        passwordInput = document.getElementById('admin-password-input');
        modalConfirmBtn = document.getElementById('modal-confirm-btn');
        modalCancelBtn = document.getElementById('modal-cancel-btn');

        modalConfirmBtn.addEventListener('click', () => {
            if (passwordInput.value === state.ADMIN_PASSWORD) {
                setAdmin(true);
                window.showNotification('관리자 인증에 성공했습니다.', 'success');
                updateAdminUI();
                adminModal.classList.add('hidden');
                // 인증 후 현재 탭 다시 로드 시도
                const activeTabKey = Object.keys(tabs).find(key => tabs[key].classList.contains('active'));
                if(activeTabKey) switchTab(activeTabKey, true);
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
    }
});