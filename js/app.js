// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
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
    let notificationEl = document.getElementById('notification');
    if (!notificationEl) {
        notificationEl = document.createElement('div');
        notificationEl.id = 'notification';
        document.body.appendChild(notificationEl);
    }
    notificationEl.textContent = message;
    notificationEl.className = 'notification';
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

function renderSharePageView(shareData) {
    const { meetingInfo, teams: teamsObject, lineups } = shareData;
    const teams = Object.values(teamsObject || {});
    document.body.innerHTML = '';
    document.body.className = "bg-gray-100";

    let locationHtml = meetingInfo.locationUrl 
        ? `<a href="${meetingInfo.locationUrl}" target="_blank" class="text-blue-600 underline">${meetingInfo.location}</a>`
        : (meetingInfo.location || '미정');

    let contentHtml = `
    <div class="container mx-auto p-4 md:p-8">
        <header class="text-center mb-8 relative">
            <h1 class="text-4xl md:text-5xl font-bold text-gray-900">BareaPlay⚽</h1>
            <p class="mt-2 text-lg text-gray-600">모임 결과</p>
        </header>
        
        <div class="bg-white p-6 rounded-lg shadow-md mb-8 max-w-2xl mx-auto">
            <h2 class="text-2xl font-bold mb-4 border-b pb-2">📅 모임 정보</h2>
            <p class="text-gray-700 mb-2"><strong>시간:</strong> ${new Date(meetingInfo.time).toLocaleString('ko-KR')}</p>
            <p class="text-gray-700"><strong>장소:</strong> ${locationHtml}</p>
        </div>

        <div class="bg-white p-6 rounded-lg shadow-md mb-8 max-w-4xl mx-auto">
            <h2 class="text-2xl font-bold mb-4 border-b pb-2">⚖️ 팀 배정 결과</h2>
            <div class="grid grid-cols-1 md:grid-cols-${teams.length > 2 ? '3' : '2'} gap-4">`;

    const colors = ["#14B8A6","#0288D1","#7B1FA2","#43A047","#F4511E"];
    teams.forEach((team, i) => {
        contentHtml += `<div class="rounded-lg p-4 text-white" style="background-color:${colors[i%5]}">
            <h3 class="font-bold text-xl mb-2 border-b border-white/30 pb-2">팀 ${i + 1}</h3>
            <ul class="space-y-1">${team.map(p => `<li class="bg-white/20 p-2 rounded-md">${p.name.replace(' (신규)','')}</li>`).join('')}</ul>
        </div>`;
    });
    contentHtml += `</div></div>`;

    const createQuarterHTML = (teamLineup, qIndex) => {
        if (!teamLineup || !teamLineup.lineups || !teamLineup.lineups[qIndex]) return '<div class="p-2 border rounded-lg bg-gray-50 text-center text-gray-400">데이터 없음</div>';
        const lineup = teamLineup.lineups[qIndex];
        const formation = teamLineup.formations[qIndex];
        const resters = teamLineup.resters[`q${qIndex + 1}`] || [];
        
        let html = `<div class="p-2 border rounded-lg"><h4 class="font-bold text-center mb-2">${qIndex + 1}쿼터 (${formation})</h4><ul class="space-y-1 text-sm">`;
        Object.keys(lineup).sort().forEach(pos => {
            lineup[pos].forEach(player => {
                if(player) html += `<li class="p-1 bg-gray-100 rounded">${pos}: ${player}</li>`;
            });
        });
        html += `</ul><hr class="my-2"><p class="text-sm"><b>휴식:</b> ${resters.join(', ') || '없음'}</p></div>`;
        return html;
    };
    
    contentHtml += `<div class="bg-white p-6 rounded-lg shadow-md max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4 border-b pb-2">📋 라인업 결과</h2>
        <div class="grid grid-cols-1 ${teams.length > 1 ? 'md:grid-cols-2' : ''} ${teams.length > 2 ? 'lg:grid-cols-3' : ''} gap-6">`;

    teams.forEach((team, teamIdx) => {
        contentHtml += `<div><h3 class="text-xl font-bold text-center mb-3">팀 ${teamIdx + 1}</h3><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">`;
        const lineup = lineups[`team${teamIdx + 1}`];
        for (let i = 0; i < 6; i++) {
            contentHtml += createQuarterHTML(lineup, i);
        }
        contentHtml += `</div></div>`;
    });

    contentHtml += `</div></div>
        <div class="text-center my-8">
            <button id="print-share-btn" class="bg-gray-700 text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-800">전체 라인업 인쇄 / PDF 저장</button>
        </div>
        <footer class="text-center py-4">
            <p class="text-sm text-gray-500">© 2025 BareaPlay. All Rights Reserved. Created by 송감독.</p>
        </footer>
    </div>`;
    
    document.body.innerHTML = contentHtml;
    
    const notificationEl = document.createElement('div');
    notificationEl.id = 'notification';
    document.body.appendChild(notificationEl);
    
    document.getElementById('print-share-btn').addEventListener('click', () => {
        shareMgmt.generatePrintView(shareData);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    
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
    
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId) {
        loadingOverlay.style.display = 'flex';
        loadingOverlay.style.opacity = 1;
        
        try {
            const shareDoc = await getDoc(doc(db, "shares", shareId));
            if (shareDoc.exists()) {
                const shareData = shareDoc.data();
                renderSharePageView(shareData);
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
        
        onSnapshot(doc(db, "settings", "activeMeeting"), (doc) => {
            const container = document.getElementById('active-meeting-link-container');
            const link = document.getElementById('active-meeting-link');
            if (doc.exists() && doc.data().shareId) {
                const shareId = doc.data().shareId;
                const linkText = doc.data().linkText || "오늘 모임 결과 확인하기";
                link.href = `${window.location.origin}${window.location.pathname}?shareId=${shareId}`;
                link.textContent = linkText;
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
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
                if(pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); }
            });

            onSnapshot(collection(db, "attendance"), (snapshot) => {
                 state.attendanceLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                 if(pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); }
                 if (playerMgmt) playerMgmt.renderPlayerTable();
            });

            onSnapshot(doc(db, "memos", "accounting_memo"), (doc) => {
                const memoArea = document.getElementById('memo-area');
                if (doc.exists() && memoArea) { memoArea.value = doc.data().content; }
            });
            
            playerMgmt.renderPlayerTable();
            accounting.renderForDate();

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