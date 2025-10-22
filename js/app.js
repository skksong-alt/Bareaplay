// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { state, setAdmin } from './store.js';
import * as playerMgmt from './modules/playerManagement.js';
import * as balancer from './modules/teamBalancer.js';
import * as lineup from './modules/lineupGenerator.js';
import * as accounting from './modules/accounting.js';
import * as shareMgmt from './modules/shareManagement.js';

const firebaseConfig = {
    apiKey: "AIzaSyD_2tm5-hYbCeU8yi0QiWW9Oqm0O7oPBco",
    authDomain: "team-barea.firebaseapp.com",
    projectId: "team-barea",
    storageBucket: "team-barea.appspot.com",
    messagingSenderId: "1005771179097",
    appId: "1:1005771179097:web:c62fd10192da0eaad29d48",
    measurementId: "G-MX4MHMX069"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let adminModal, passwordInput, modalConfirmBtn, modalCancelBtn;
const pages = {};
const tabs = {};
let pendingTabSwitch = null;
let isSavingLocally = false;

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

const saveDailyMeetingData = window.debounce(async () => {
    if (!state.isAdmin) return;
isSavingLocally = true;
    const today = new Date().toISOString().split('T')[0];

    // [수정] Firestore 저장을 위해 Nested Array를 객체로 변환
    const teamsObject = {};
    (state.teams || []).forEach((team, index) => {
        teamsObject[`team_${index}`] = team;
    });

    const transformedCache = {};
    Object.keys(state.teamLineupCache || {}).forEach(teamIndex => {
        const originalLineup = state.teamLineupCache[teamIndex];
        if (originalLineup && Array.isArray(originalLineup.resters)) {
            const restersObject = {};
            originalLineup.resters.forEach((resterList, qIndex) => {
                restersObject[`q_${qIndex}`] = resterList;
            });
            transformedCache[teamIndex] = { ...originalLineup, resters: restersObject };
        } else {
            transformedCache[teamIndex] = originalLineup;
        }
    });

    const dataToSave = {
        date: today,
        teams: teamsObject, // 변환된 객체 사용
        teamLineupCache: transformedCache, // 변환된 객체 사용
        lastUpdatedAt: serverTimestamp()
    };

    try {
        await setDoc(doc(db, "dailyMeetings", today), dataToSave, { merge: true });
        console.log(`${today} 모임 데이터가 저장되었습니다.`);
    } catch (error) {
        console.error("일일 모임 데이터 저장 실패:", error);
        window.showNotification(`저장 실패: ${error.message}`, 'error');
isSavingLocally = false;
    }
}, 1000);

function loadAndSyncDailyMeetingData() {
    const today = new Date().toISOString().split('T')[0];
    const meetingDocRef = doc(db, "dailyMeetings", today);

    onSnapshot(meetingDocRef, (doc) => {
if (isSavingLocally) {
            isSavingLocally = false; // 2. 깃발을 'false'로 리셋
            return; // 3. 동기화 로직을 실행하지 않고 종료
        }
        const hasLocalChanges = doc.metadata.hasPendingWrites;
        if (hasLocalChanges) return;

        if (doc.exists()) {
            console.log("외부 변경 감지, 데이터 동기화.");
            const data = doc.data();

            // [수정] Firestore에서 불러온 객체를 다시 Nested Array로 변환
            state.teams = Object.values(data.teams || {});

            const originalCache = {};
            Object.keys(data.teamLineupCache || {}).forEach(teamIndex => {
                const transformedLineup = data.teamLineupCache[teamIndex];
                if (transformedLineup && typeof transformedLineup.resters === 'object') {
                    const restersArray = Object.values(transformedLineup.resters);
                    originalCache[teamIndex] = { ...transformedLineup, resters: restersArray };
                } else {
                    originalCache[teamIndex] = transformedLineup;
                }
            });
            state.teamLineupCache = originalCache;

            balancer.renderResults(state.teams);
            lineup.renderTeamSelectTabs(state.teams);
            window.showNotification("다른 기기 내용이 동기화되었습니다.");
        } else {
            console.log(`${today} 데이터 없음, 초기화.`);
            state.teams = [];
            state.teamLineupCache = {};
            balancer.renderResults(state.teams);
            lineup.renderTeamSelectTabs(state.teams);
        }
    });
}

function updateUIAccess() {
    const isViewOnly = !state.isAdmin;
    document.getElementById('page-balancer').classList.toggle('view-only', isViewOnly);
    document.getElementById('page-lineup').classList.toggle('view-only', isViewOnly);
}

function loadPlayerDB() {
    const savedDB = localStorage.getItem('playerDB');
    if (savedDB) {
        state.playerDB = JSON.parse(savedDB);
        console.log('브라우저 저장소에서 선수 정보를 불러왔습니다.');
    } else {
        console.log('브라우저에 저장된 선수 정보가 없습니다.');
    }
}

async function savePlayerDB(newDB, syncWithFirebase = true) {
    state.playerDB = newDB;
    localStorage.setItem('playerDB', JSON.stringify(newDB));
    window.showNotification(`${Object.keys(newDB).length}명의 선수 정보가 업데이트되었습니다!`);

    if (syncWithFirebase) {
        console.log("Firebase와 동기화를 시작합니다...");
        try {
            const currentSnapshot = await getDocs(collection(db, "players"));
            const deletePromises = [];
            currentSnapshot.forEach(docSnapshot => {
                deletePromises.push(deleteDoc(doc(db, "players", docSnapshot.id)));
            });
            await Promise.all(deletePromises);

            const setPromises = [];
            for (const playerName in newDB) {
                setPromises.push(setDoc(doc(db, "players", playerName), newDB[playerName]));
            }
            await Promise.all(setPromises);
            
            console.log("Firebase 동기화 완료.");
            window.showNotification(`Firebase DB 동기화 완료!`);
        } catch (error) {
            console.error("Firebase 동기화 중 오류 발생:", error);
            window.showNotification("DB 동기화에 실패했습니다.", "error");
        }
    }
}

function initExcelUploader() {
    const uploader = document.getElementById('excel-uploader');
    if (!uploader) return;
    if (uploader.dataset.listenerAttached) return;

    uploader.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);

            const newPlayerDB = {};
            json.forEach(player => {
                const name = player.이름;
                if (!name) return;
                newPlayerDB[name] = {
                    name: name,
                    pos1: (player.주포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s1:   player.주포지션숙련도 || 65,
                    pos2: (player.부포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s2:   player.부포지션숙련도 || 0
                };
            });
            savePlayerDB(newPlayerDB, true);
            playerMgmt.renderPlayerTable();
            uploader.value = ''; 
        };
        reader.readAsArrayBuffer(file);
    });
    uploader.dataset.listenerAttached = 'true';
}

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
    updateUIAccess();
}

window.promptForAdminPassword = function() {
    if (state.isAdmin) {
        window.showNotification('이미 관리자 권한으로 로그인되어 있습니다.');
        return;
    }
    adminModal.classList.remove('hidden');
}

function switchTab(activeKey, force = false) {
    if ((activeKey === 'players' || activeKey === 'share') && !state.isAdmin && !force) {
        pendingTabSwitch = activeKey; 
        promptForAdminPassword();
        return; 
    }
    Object.keys(pages).forEach(key => {
        if (pages[key]) pages[key].classList.toggle('hidden', key !== activeKey);
        if (tabs[key]) tabs[key].classList.toggle('active', key === activeKey);
    });
    if (activeKey === 'accounting') {
        accounting.renderForDate();
    }
    if (activeKey === 'players') { 
        initExcelUploader();
    }
    pendingTabSwitch = null; 
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
    let locationHtml = meetingInfo.locationUrl ? `<a href="${meetingInfo.locationUrl}" target="_blank" class="text-blue-600 underline">${meetingInfo.location}</a>` : (meetingInfo.location || '미정');
    let contentHtml = `<div class="container mx-auto p-4 md:p-8"><header class="text-center mb-8 relative"><h1 class="text-4xl md:text-5xl font-bold text-gray-900">BareaPlay⚽</h1><p class="mt-2 text-lg text-gray-600">모임 결과</p></header><div class="bg-white p-6 rounded-lg shadow-md mb-8 max-w-2xl mx-auto"><h2 class="text-2xl font-bold mb-4 border-b pb-2">📅 모임 정보</h2><p class="text-gray-700 mb-2"><strong>시간:</strong> ${new Date(meetingInfo.time).toLocaleString('ko-KR')}</p><p class="text-gray-700"><strong>장소:</strong> ${locationHtml}</p></div><div class="bg-white p-6 rounded-lg shadow-md mb-8 max-w-4xl mx-auto"><h2 class="text-2xl font-bold mb-4 border-b pb-2">⚖️ 팀 배정 결과</h2><div class="grid grid-cols-1 md:grid-cols-${teams.length > 2 ? '3' : '2'} gap-4">`;
    const colors = ["#14B8A6","#0288D1","#7B1FA2","#43A047","#F4511E"];
    teams.forEach((team, i) => { contentHtml += `<div class="rounded-lg p-4 text-white" style="background-color:${colors[i%5]}"><h3 class="font-bold text-xl mb-2 border-b border-white/30 pb-2">팀 ${i + 1}</h3><ul class="space-y-1">${team.map(p => `<li class="bg-white/20 p-2 rounded-md">${p.name.replace(' (신규)','')}</li>`).join('')}</ul></div>`; });
    contentHtml += `</div></div>`;
    const createQuarterHTML = (teamLineup, qIndex) => {
        if (!teamLineup || !teamLineup.lineups || !teamLineup.lineups[qIndex]) return '<div class="p-2 border rounded-lg bg-gray-50 text-center text-gray-400">데이터 없음</div>';
        const lineup = teamLineup.lineups[qIndex];
        const formation = teamLineup.formations[qIndex];
        const resters = teamLineup.resters[`q_${qIndex}`] || [];
        let html = `<div class="p-2 border rounded-lg"><h4 class="font-bold text-center mb-2">${qIndex + 1}쿼터 (${formation})</h4><ul class="space-y-1 text-sm">`;
        Object.keys(lineup).sort().forEach(pos => { lineup[pos].forEach(player => { if(player) html += `<li class="p-1 bg-gray-100 rounded">${pos}: ${player}</li>`; }); });
        html += `</ul><hr class="my-2"><p class="text-sm"><b>휴식:</b> ${resters.join(', ') || '없음'}</p></div>`;
        return html;
    };
    contentHtml += `<div class="bg-white p-6 rounded-lg shadow-md max-w-6xl mx-auto"><h2 class="text-2xl font-bold mb-4 border-b pb-2">📋 라인업 결과</h2><div class="grid grid-cols-1 ${teams.length > 1 ? 'md:grid-cols-2' : ''} ${teams.length > 2 ? 'lg:grid-cols-3' : ''} gap-6">`;
    teams.forEach((team, teamIdx) => {
        contentHtml += `<div><h3 class="text-xl font-bold text-center mb-3">팀 ${teamIdx + 1}</h3><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">`;
        const lineupData = lineups ? lineups[teamIdx] || lineups[`team${teamIdx + 1}`] : {};
        for (let i = 0; i < 6; i++) { contentHtml += createQuarterHTML(lineupData, i); }
        contentHtml += `</div></div>`;
    });
    contentHtml += `</div></div><div class="text-center my-8"><button id="print-share-btn" class="bg-gray-700 text-white font-bold py-3 px-6 rounded-lg hover:bg-gray-800">전체 라인업 인쇄 / PDF 저장</button></div><footer class="text-center py-4"><p class="text-sm text-gray-500">© 2025 BareaPlay. All Rights Reserved. Created by 송감독.</p></footer></div>`;
    document.body.innerHTML = contentHtml;
    const notificationEl = document.createElement('div');
    notificationEl.id = 'notification';
    document.body.appendChild(notificationEl);
    document.getElementById('print-share-btn').addEventListener('click', () => { shareMgmt.generatePrintView(shareData); });
}

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    
    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt };
    const dependencies = { db, state };
    window.playerMgmt = playerMgmt;
    window.accounting = accounting;
    window.lineup = lineup;
    window.shareMgmt = shareMgmt;
    window.saveDailyMeetingData = saveDailyMeetingData;

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
            if (shareDoc.exists()) { renderSharePageView(shareDoc.data()); } 
            else { document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">공유된 데이터를 찾을 수 없습니다.</p>`; }
        } catch (e) {
            console.error("Error loading share data:", e);
            document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">데이터를 불러오는 중 오류가 발생했습니다.</p>`;
        } finally {
            loadingOverlay.style.display = 'none';
        }
    } else {
        Object.assign(pages, { players: document.getElementById('page-players'), balancer: document.getElementById('page-balancer'), lineup: document.getElementById('page-lineup'), accounting: document.getElementById('page-accounting'), share: document.getElementById('page-share') });
        Object.assign(tabs, { players: document.getElementById('tab-players'), balancer: document.getElementById('tab-balancer'), lineup: document.getElementById('tab-lineup'), accounting: document.getElementById('tab-accounting'), share: document.getElementById('tab-share') });
        adminModal = document.getElementById('admin-modal');
        // passwordInput, modalConfirmBtn 변수는 비밀번호 방식이라 삭제했습니다.
        modalCancelBtn = document.getElementById('modal-cancel-btn'); 

        // 'Google 계정으로 로그인' 버튼을 찾습니다.
        const googleLoginBtn = document.getElementById('google-login-btn');
        
        if (googleLoginBtn) {
            googleLoginBtn.addEventListener('click', async () => {
                const provider = new GoogleAuthProvider();
                try {
                    // 1. Google 로그인 팝업창을 띄웁니다.
                    const result = await signInWithPopup(auth, provider);
                    const user = result.user;
                    
                    // 2. Firestore 'admins' 컬렉션에서 로그인한 사용자의 UID 문서를 찾아봅니다.
                    const adminDocRef = doc(db, "admins", user.uid);
                    const adminDoc = await getDoc(adminDocRef);

                    // 3. 'admins' 목록에 해당 UID 문서가 존재하는지 확인합니다.
                    if (adminDoc.exists()) {
                        // 4. 관리자가 맞습니다! (UI 활성화)
                        console.log("관리자 인증 성공! UID:", user.uid);
                        setAdmin(true);
                        window.showNotification('관리자 인증에 성공했습니다.', 'success');
                        updateAdminUI();
                        adminModal.classList.add('hidden');
                        if (pendingTabSwitch) { switchTab(pendingTabSwitch, true); }
                    } else {
                        // 5. 관리자가 아닙니다. (UI 비활성화)
                        console.log("관리자가 아닌 사용자 로그인 시도:", user.uid);
                        window.showNotification('관리자 계정이 아닙니다.', 'error');
                        // (setAdmin(true)를 호출하지 않으므로 관리자 모드가 켜지지 않습니다)
                    }

                } catch (error) {
                    // 6. 'try'의 짝이 되는 'catch'입니다.
                    console.error("Google 로그인 실패:", error);
                    window.showNotification('Google 로그인에 실패했습니다.', 'error');
                }
            });
        }
        
        // '취소' 버튼과 팝업창 바깥쪽을 클릭했을 때의 동작입니다.
        modalCancelBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
        adminModal.addEventListener('click', (e) => { if (e.target === adminModal) adminModal.classList.add('hidden'); });

        // 탭 버튼들에 클릭 이벤트를 추가합니다.
        Object.keys(tabs).forEach(key => { if (tabs[key]) tabs[key].addEventListener('click', () => switchTab(key)); });

        onSnapshot(doc(db, "settings", "activeMeeting"), (doc) => {
            const placeholder = document.getElementById('realtime-link-placeholder');
            placeholder.innerHTML = '';
            if (doc.exists() && doc.data().shareId) {
                const shareId = doc.data().shareId;
                const linkText = doc.data().linkText || "오늘 모임 결과 확인하기";
                const link = document.createElement('a');
                link.href = `${window.location.origin}${window.location.pathname}?shareId=${shareId}`;
                link.target = "_blank";
                link.className = 'realtime-link-button';
                link.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" /></svg>${linkText}`;
                placeholder.appendChild(link);
            }
        });
        try {
            loadPlayerDB(); 
            const collectionsToFetch = ['attendance', 'expenses', 'locations'];
            const snapshots = await Promise.all(collectionsToFetch.map(c => getDocs(collection(db, c))));
            state.attendanceLog = snapshots[0].docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.expenseLog = snapshots[1].docs.map(doc => ({ id: doc.id, ...doc.data() }));
            state.locations = snapshots[2].docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (Object.keys(state.playerDB).length === 0) {
                console.log("로컬 선수 데이터가 없어 Firebase에서 가져옵니다.");
                const playerSnapshot = await getDocs(collection(db, "players"));
                const firebaseDB = {};
                playerSnapshot.forEach(doc => { firebaseDB[doc.id] = doc.data(); });
                savePlayerDB(firebaseDB, false);
            }
            onSnapshot(collection(db, "expenses"), (snapshot) => { state.expenseLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } });
            onSnapshot(collection(db, "attendance"), (snapshot) => { state.attendanceLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } if (playerMgmt) playerMgmt.renderPlayerTable(); });
            onSnapshot(doc(db, "memos", "accounting_memo"), (doc) => { const memoArea = document.getElementById('memo-area'); if (doc.exists() && memoArea) { memoArea.value = doc.data().content; } });
            playerMgmt.renderPlayerTable();
            accounting.renderForDate();
            loadAndSyncDailyMeetingData();
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