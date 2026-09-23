// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { state, setAdmin } from './store.js?v=2';
import * as playerMgmt from './modules/playerManagement.js?v=5';
import * as balancer from './modules/teamBalancer.js?v=9';
import * as lineup from './modules/lineupGenerator.js?v=10';
import * as accounting from './modules/accounting.js?v=7';
import * as shareMgmt from './modules/shareManagement.js?v=11';
import * as voteMgmt from './modules/voteManagement.js?v=22';
import * as lineupStats from './modules/lineupStats.js?v=2';
import * as coachWorkspace from './modules/coachWorkspace.js?v=4';
import * as adminWorkflow from './modules/adminWorkflow.js?v=1';
import { renderPositionSurvey, mountPreferenceAdmin } from './modules/positionPreferences.js?v=5';
import { roleTip } from './modules/coachCore.js?v=1';
import * as matchRecord from './modules/matchRecord.js?v=2'; // 경기기록 탭 (v58: 팀 이름 표시)
import { sharedRefereesFromLineups } from './modules/dutyRotation.js?v=2';

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
// [수정] 이 브라우저(기기)만의 서명. 내가 저장한 데이터의 메아리를 구분하는 데 사용
const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
// [A방식] 현재 선택된 모임 날짜(기본: 오늘). 명단·팀배정·라인업을 이 날짜 문서에 저장/로드한다.
let selectedMeetingDate = null;
let meetingUnsub = null; // 현재 날짜 문서의 실시간 구독 해제 함수

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
// [추가] 기기의 현지 시간 기준 오늘 날짜 (UTC 날짜 밀림 방지)
window.getLocalDate = function() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// [보안] 특수문자를 무해한 글자로 바꿔주는 안전장치
window.esc = function(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// [보안] http로 시작하는 정상 주소만 허용
window.safeUrl = function(url) {
    const u = String(url ?? '');
    return (u.startsWith('http://') || u.startsWith('https://')) ? u : '';
};

const saveDailyMeetingData = window.debounce(async () => {
    if (!state.isAdmin) return;
    const today = selectedMeetingDate || window.getLocalDate();

    const teamsObject = {};
    (state.teams || []).forEach((team, index) => {
        teamsObject[`team_${index}`] = team;
    });

    const transformedCache = {};
    // Do not silently rewrite historical referee records during an unrelated edit.
    const sharedReferees = today >= window.getLocalDate()
        ? sharedRefereesFromLineups(state.teamLineupCache || {}, state.initialAttendeeOrder || []) : [];
    Object.keys(state.teamLineupCache || {}).forEach(teamIndex => {
        const originalLineup = state.teamLineupCache[teamIndex];
        if (originalLineup && Array.isArray(originalLineup.resters)) {
            const restersObject = {};
            originalLineup.resters.forEach((resterList, qIndex) => {
                restersObject[`q_${qIndex}`] = resterList;
            });
            // [중요] 심판 데이터도 객체로 변환하여 저장
            const refereesObject = {};
            if (Array.isArray(originalLineup.referees)) {
                originalLineup.referees.forEach((ref, qIndex) => {
                    refereesObject[`q_${qIndex}`] = sharedReferees[qIndex]?.name ?? ref;
                });
            }
            // [추가] 수동 지정 심판도 객체로 변환하여 저장
            const manualRefereesObject = {};
            if (Array.isArray(originalLineup.manualReferees)) {
                originalLineup.manualReferees.forEach((mr, qIndex) => {
                    manualRefereesObject[`q_${qIndex}`] = mr;
                });
            }
            transformedCache[teamIndex] = { ...originalLineup, resters: restersObject, referees: refereesObject, manualReferees: manualRefereesObject };
        } else {
            transformedCache[teamIndex] = originalLineup;
        }
    });

    const dataToSave = {
        date: today,
        teams: teamsObject,
        teamLineupCache: transformedCache,
        initialAttendeeOrder: state.initialAttendeeOrder || [],
        teamNames: state.teamNames || [], // [v58] 🏷️ 팀 이름(Team A/B 또는 커스텀)도 날짜별 저장
        aceNames: state.aceNames || [], // [A방식] 에이스 명단도 날짜별로 함께 저장
        pinTogether: state.pinTogether || [], // [추가] 🧲 같은 팀 묶기 지정 (날짜별 저장)
        pinApart: state.pinApart || [],       // [추가] 🚧 다른 팀 나누기 지정
        lastWriter: CLIENT_ID, // [수정] 누가 저장했는지 서명
        lastUpdatedAt: serverTimestamp()

    };

    try {
        await setDoc(doc(db, "dailyMeetings", today), dataToSave); // [수정] merge 제거 → 빠진 team_* 키가 잔존하지 않도록 전체 덮어쓰기 (회계/출석은 attendance·expenses 등 별도 컬렉션이라 영향 없음)
        console.log(`${today} 모임 데이터가 저장되었습니다.`);
    } catch (error) {
        console.error("일일 모임 데이터 저장 실패:", error);
        window.showNotification(`저장 실패: ${error.message}`, 'error');
    }
}, 1000);

// [학습] 운영진의 수동 드래그 조정을 조용히 기록 (성향 제안의 재료) — 실패해도 앱 동작에 영향 없음
window.logAdjustment = function(entry) {
    if (!state.isAdmin) return;
    try {
        addDoc(collection(db, "adjustLogs"), {
            ...entry,
            reason: window.coachReason || 'temporary',
            date: selectedMeetingDate || window.getLocalDate(),
            at: serverTimestamp()
        }).catch(() => {});
    } catch (e) { /* no-op */ }
};

// [학습] 최근 N일간의 조정 기록 조회 (라인업 생성기의 성향 제안 카드가 사용)
window.fetchAdjustLogs = async function(days = 42) {
    const snap = await getDocs(collection(db, "adjustLogs"));
    const cutoff = Date.now() - days * 86400000;
    return snap.docs.map(d => d.data()).filter(l => {
        if (!l.date) return false;
        const t = Date.parse(l.date + 'T00:00:00');
        return !isNaN(t) && t >= cutoff;
    });
};

// [학습] 성향 제안 [반영] 버튼이 선수 문서를 부분 수정할 때 사용 (merge → 다른 필드 보존)
window.updatePlayerPref = async function(name, patch) {
    await setDoc(doc(db, "players", name), patch, { merge: true });
    window.showNotification(`${name} 선수 정보에 반영되었습니다.`);
};

// [A방식] 서버 문서 데이터를 화면/상태에 반영 (명단·에이스·팀배정·라인업 복원)
function applyMeetingData(data) {
    if (data) {
        state.teams = Object.values(data.teams || {});
        state.teamNames = data.teamNames || []; // [v58] 팀 이름 복원
        state.initialAttendeeOrder = data.initialAttendeeOrder || [];
        state.aceNames = data.aceNames || [];
        state.pinTogether = data.pinTogether || []; // [추가] 함께/분리 지정 복원
        state.pinApart = data.pinApart || [];

        const originalCache = {};
        Object.keys(data.teamLineupCache || {}).forEach(teamIndex => {
            const transformedLineup = data.teamLineupCache[teamIndex];
            let restoredResters = [];
            let restoredReferees = [];

            if (transformedLineup && typeof transformedLineup.resters === 'object' && !Array.isArray(transformedLineup.resters)) {
                restoredResters = Object.keys(transformedLineup.resters).sort().map(key => transformedLineup.resters[key]);
            } else if (transformedLineup && Array.isArray(transformedLineup.resters)) {
                restoredResters = transformedLineup.resters;
            }

            if (transformedLineup && typeof transformedLineup.referees === 'object' && !Array.isArray(transformedLineup.referees)) {
                restoredReferees = Object.keys(transformedLineup.referees).sort().map(key => transformedLineup.referees[key]);
            } else if (transformedLineup && Array.isArray(transformedLineup.referees)) {
                restoredReferees = transformedLineup.referees;
            }

            let restoredManualReferees = null;
            if (transformedLineup && typeof transformedLineup.manualReferees === 'object' && !Array.isArray(transformedLineup.manualReferees) && transformedLineup.manualReferees !== null) {
                restoredManualReferees = Object.keys(transformedLineup.manualReferees).sort().map(key => transformedLineup.manualReferees[key]);
            } else if (transformedLineup && Array.isArray(transformedLineup.manualReferees)) {
                restoredManualReferees = transformedLineup.manualReferees;
            }

            if (transformedLineup) {
                originalCache[teamIndex] = { ...transformedLineup, resters: restoredResters, referees: restoredReferees, manualReferees: restoredManualReferees };
            }
        });
        state.teamLineupCache = originalCache;
    } else {
        // 해당 날짜에 저장된 내용이 없으면 빈 상태로 시작 (예: 다음주 날짜)
        state.teams = [];
        state.teamNames = []; // [v58]
        state.teamLineupCache = {};
        state.initialAttendeeOrder = [];
        state.aceNames = [];
        state.pinTogether = [];
        state.pinApart = [];
    }

    // 명단·에이스 textarea 복원 (사용자가 그 칸을 편집 중이면 setAttendees/setAces 내부에서 건드리지 않음)
    if (balancer.setAttendees) balancer.setAttendees(state.initialAttendeeOrder);
    if (balancer.setAces) balancer.setAces(state.aceNames);
    if (balancer.setPins) balancer.setPins(state.pinTogether, state.pinApart); // [추가]
    balancer.renderResults(state.teams);
    lineup.renderTeamSelectTabs(state.teams);

    // [Q1] 출석탭을 이미 열어둔 다른 기기(현장 휴대폰)도, PC의 팀배정이 동기화되면 참석자 명단이 즉시 반영되도록 갱신.
    //      단, 사용자가 입력칸(금액/비고 등)을 편집 중이면 방해하지 않도록 건너뜀.
    try {
        const accPage = document.getElementById('page-accounting');
        const ae = document.activeElement;
        const editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
        if (accPage && !accPage.classList.contains('hidden') && !editing && accounting && accounting.renderForDate) {
            accounting.renderForDate();
        }
    } catch (e) { /* no-op */ }
}

// [A방식] 선택한 날짜의 문서를 즉시 강제 로드하고, 그 날짜에 대한 실시간 동기화를 건다.
async function changeMeetingDate(date) {
    selectedMeetingDate = date;
    state.meetingDate = date;   // [Q1] 출석탭이 '이 명단이 어느 모임 날짜 것인지' 대조할 수 있도록 공유 상태에 노출
    // 이전 날짜 구독 해제
    if (meetingUnsub) { meetingUnsub(); meetingUnsub = null; }

    const meetingDocRef = doc(db, "dailyMeetings", date);

    // 1) 날짜 전환 시에는 내 서명 여부와 상관없이 무조건 한 번 강제로 로드한다.
    try {
        const snap = await getDoc(meetingDocRef);
        applyMeetingData(snap.exists() ? snap.data() : null);
        console.log(snap.exists() ? `${date} 데이터를 불러왔습니다.` : `${date} 데이터 없음 → 빈 상태로 시작.`);
    } catch (error) {
        console.error("날짜 데이터 로드 실패:", error);
    }

    // 2) 이후에는 다른 기기의 변경을 실시간으로 반영한다.
    let firstSnap = true; // getDoc으로 이미 처리한 첫 스냅샷은 건너뛴다(중복/불필요 알림 방지)
    meetingUnsub = onSnapshot(meetingDocRef, (docSnap) => {
        if (firstSnap) { firstSnap = false; return; }
        if (docSnap.metadata.hasPendingWrites) return;                       // 아직 서버 전송 중인 내 데이터는 무시
        if (docSnap.exists() && docSnap.data().lastWriter === CLIENT_ID) return; // 내가 저장한 메아리는 무시
        if (selectedMeetingDate !== date) return;                            // 날짜가 이미 바뀌었으면 무시(오래된 구독)
        console.log("외부 변경 감지, 데이터 동기화.");
        applyMeetingData(docSnap.exists() ? docSnap.data() : null);
        window.showNotification("다른 기기 내용이 동기화되었습니다.");
    });
}
window.changeMeetingDate = changeMeetingDate;

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

            // 회비유형 셀(있을 때만) → 코드로 변환. 없으면 기존 값 유지.
            const parseFeeType = (v, prevName) => {
                const s = (v || '').toString().trim().toLowerCase();
                if (['admin', '운영진', '운영진(0)'].includes(s)) return 'admin';
                if (['student', '학생', '학생(25/35)'].includes(s)) return 'student';
                if (['normal', '일반', '일반(50/70)'].includes(s)) return 'normal';
                // 셀이 비어 있으면 기존 선수의 회비유형을 보존(왕복 시 손실 방지)
                return (state.playerDB[prevName] && state.playerDB[prevName].feeType) || 'normal';
            };
            // [성향] 성향 셀 파서 — 셀이 아예 없으면(구버전 양식) 기존 값을 보존해 왕복 시 손실 방지
            const VALID_POS = ['GK', 'LB', 'RB', 'CB', 'LW', 'RW', 'MF', 'CM', 'FW', 'DF'];
            const parsePosCell = (v) => (v || '').toString().split(/[\/,]/).map(p => p.toUpperCase().trim()).filter(p => VALID_POS.includes(p));
            const parseSide = (v) => {
                const s = (v || '').toString().trim();
                if (['L', '왼쪽', 'LEFT'].includes(s.toUpperCase()) || s === '왼쪽') return 'L';
                if (['R', '오른쪽', 'RIGHT'].includes(s.toUpperCase()) || s === '오른쪽') return 'R';
                return '';
            };
            const newPlayerDB = {};
            json.forEach(player => {
                const name = player.이름;
                if (!name) return;
                const prev = state.playerDB[name] || {};
                newPlayerDB[name] = {
                    name: name,
                    pos1: (player.주포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s1:   player.주포지션숙련도 || 65,
                    pos2: (player.부포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s2:   player.부포지션숙련도 || 0,
                    feeType: parseFeeType(player.회비유형, name),
                    // [성향] 셀이 있으면 그 값, 없으면 기존 값 유지
                    wishPos:   (player.희망포지션 !== undefined) ? parsePosCell(player.희망포지션) : (prev.wishPos || []),
                    wishQuota: (player.희망보장 !== undefined) ? Math.max(0, Math.min(6, parseInt(player.희망보장) || 0)) : (prev.wishQuota || 0),
                    side:      (player.선호측면 !== undefined) ? parseSide(player.선호측면) : (prev.side || ''),
                    memo:      (player.메모 !== undefined) ? String(player.메모).trim() : (prev.memo || '')
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

function renderManual() {
    const el = document.getElementById('page-manual');
    if (!el) return;
    const sec = (icon, title, body) => `<section class="mb-8"><h3 class="text-xl font-bold mb-3 border-b-2 border-indigo-100 pb-2">${icon} ${title}</h3>${body}</section>`;
    const tip = (t) => `<div class="bg-blue-50 border-l-4 border-blue-400 text-blue-900 text-sm rounded-r-lg p-3 my-2">\uD83D\uDCA1 <b>알아두면 좋아요</b><br>${t}</div>`;
    const warn = (t) => `<div class="bg-amber-50 border-l-4 border-amber-400 text-amber-900 text-sm rounded-r-lg p-3 my-2">\u26A0\uFE0F <b>주의</b><br>${t}</div>`;

    const sLogin = sec('\uD83D\uDD11', '관리자 로그인 (먼저 알아두기)', `
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>이 앱은 <b>누구나 화면을 볼 수 있지만</b>, 팀 배정\u00B7라인업\u00B7출석\u00B7회비\u00B7선수 정보\u00B7경기 기록을 <b>수정하는 것은 운영진(관리자)만</b> 할 수 있습니다.</li>
            <li>수정 기능을 누르면 <b>Google 로그인</b> 창이 뜹니다. 운영진 계정으로 로그인하면 모든 편집 기능이 열립니다.</li>
            <li>로그인하지 않은 사람은 버튼이 잠겨 있거나, 누르면 로그인 안내가 뜹니다. (구경은 자유, 수정은 운영진만)</li>
        </ul>
        ${tip('새 운영진을 추가하려면 맨 아래 <b>인수인계</b> 항목의 Firebase 설정이 필요합니다. 앱 안에서는 추가할 수 없습니다.')}`);

    const sVote = sec('\uD83D\uDDF3\uFE0F', '참석 투표 \u2014 자동 마감', `
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>모임배포 탭에서 <b>새 모임 투표 시작</b>을 누르면, 고정 링크(<code class="bg-gray-100 px-1 rounded">?vote=current</code>)가 이번 주 투표로 연결됩니다.</li>
            <li><b>\u23F0 자동 마감 (v55 변경)</b>: 투표는 입력한 <b>운동 시작 시각 2시간 전</b>에 자동 마감됩니다. 마감 후에도 참석을 누를 수는 있지만 <b>대기자</b>로 따로 등록되며(선착순), 참석 명단 아래에 구분 표시됩니다. 관리자 화면에서 <b>[참석 확정]</b>으로 정규 참석으로 올릴 수 있습니다.</li>
            <li>마감 후 변경이 필요하면 <b>관리자 화면에서는 계속 수정</b>할 수 있습니다. (참석\u2194미정\u2194불참 전환, 직접 추가\u00B7삭제)</li>
            <li>예전에 만든 투표(마감 시각 정보가 없는 투표)는 예전처럼 계속 열려 있습니다.</li>
        </ul>`);

    const sBalancer = sec('\u2696\uFE0F', '팀 배정기 \u2014 팀 나누기', `
        <p class="text-sm mb-2">참가자 이름을 넣고 버튼 한 번이면 실력\u00B7포지션\u00B7인원이 균형 잡힌 팀으로 자동으로 나눠집니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>참가자 명단</b>: 한 줄에 한 명씩 이름을 적습니다. <b>모든 선수 불러오기</b> 버튼을 누르면 등록된 선수 전체가 한 번에 채워집니다.</li>
            <li><b>명단은 저장됩니다</b>: 새로고침하거나 앱을 껐다 켜도 입력한 명단이 그대로 남아 있습니다. <b>명단 초기화</b> 버튼을 눌러야만 비워집니다.</li>
            <li><b>\u2B50 에이스 지정 (선택)</b>: 잘하는 핵심 선수를 여기에 적으면, 그 선수들이 <b>각 팀에 고르게 나뉩니다</b>. 예를 들어 에이스 6명을 적고 2팀으로 나누면 3:3으로 갈립니다. 배정 결과에 \u2B50 표시가 붙습니다.</li>
            <li><b>\uD83E\uDDF2 같은 팀으로 묶기 / \uD83D\uDEA7 다른 팀으로 나누기 (선택)</b>: 형제\u00B7차량 동승처럼 꼭 같은 팀이어야 하는 사람들, 또는 반드시 나눠야 하는 사람들을 <b>한 줄에 쉼표로</b> 적으면 배정 시 최우선으로 지켜집니다. 이 지정도 날짜별로 저장됩니다.</li>
            <li><b>\uD83D\uDD04 최근 4주 같은 팀 조합 반복 최소화</b>: 체크(기본 켜짐)하면 지난 4주 동안 자주 같은 팀이었던 사람들이 이번 주에는 되도록 다른 팀이 되도록 자동으로 섞습니다. 매주 비슷한 조합이 나오는 것을 방지합니다.</li>
            <li><b>밸런스 가중치</b>: 능력치\u00B7포지션\u00B7인원수 슬라이더로 "무엇을 더 중요하게 맞출지"를 조절합니다.</li>
            <li><b>수동 이동</b>: 자동 배정 후 마음에 안 들면 선수를 <b>드래그</b>해서 다른 팀으로 옮길 수 있습니다.</li>
            <li><b>\uD83C\uDFF7\uFE0F 팀 이름 (v58 신규)</b>: 팀은 기본 <b>Team A\u00B7Team B</b>로 표시됩니다. 결과 카드 제목 옆 \u270F\uFE0F를 누르면 원하는 이름으로 바꿀 수 있고, 바꾼 이름은 <b>라인업 탭\u00B7공유 보드\u00B7경기기록\u00B7출력물</b>에 모두 그대로 표시됩니다. (날짜별로 저장됨)</li>
            <li><b>\uD83D\uDCDD 직접 팀 입력 (v58 신규)</b>: 이미 정해둔 팀이 있으면 왼쪽의 <b>직접 팀 입력</b>을 열고 팀별 명단을 붙여넣은 뒤 <b>이대로 팀 만들기</b>를 누르세요. 자동 배정 없이 입력 그대로 팀이 만들어지고, 능력치 총합\u00B7포지션 통계로 밸런스도 바로 확인됩니다. 이후 라인업\u00B7공유\u00B7회비 연동은 자동 배정과 동일합니다.</li>
            <li><b>\u2795 현장에서 늦게 온 선수 (v58 신규)</b>: <b>팀 생성을 다시 누르지 마세요!</b> 각 팀 카드 아래의 <b>선수 추가</b> 칸에 이름을 넣으면 그 팀에 바로 추가되고, <b>회비 명단\u00B7활약 투표 후보에도 자동 반영</b>됩니다. 선수 오른쪽 \u2715로 제외할 수도 있습니다. (기존 팀\u00B7라인업은 그대로 유지)</li>
            <li><b>\uD83D\uDEE1\uFE0F 재배정 경고 (v58 신규)</b>: 이미 팀이 저장된 날짜에서 팀 생성 버튼을 다시 누르면 \"기존 팀\u00B7라인업\u00B7투표 명단이 덮어써진다\"는 확인창이 먼저 뜹니다.</li>
        </ul>
        ${warn('에이스는 <b>선수관리에 등록된 선수만</b> 인정됩니다. 또한 <b>에이스 자동 균등 배치</b>와 함께/분리 지정이 충돌하면 함께/분리가 완벽히 지켜지지 않을 수 있으니, 그 경우 드래그로 조정하세요.')}`);

    const sLineup = sec('\uD83D\uDCCB', '라인업 생성기 \u2014 쿼터별 포지션', `
        <p class="text-sm mb-2">팀을 나눈 뒤, 팀별로 <b>6쿼터 라인업</b>(누가 어느 쿼터에 어느 포지션을 보는지)을 자동으로 만들어 줍니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>각 선수의 <b>주 포지션을 우선</b> 배치하고, 모두가 비슷하게 뛰도록 <b>휴식을 공평하게 돌려가며</b> 배정합니다.</li>
            <li><b>\uD83C\uDFAF 성향 자동 반영 (신규)</b>: 선수관리에 등록한 성향이 라인업에 자동으로 반영됩니다.
                <ul class="list-disc pl-5 mt-1 space-y-1">
                    <li><b>희망 포지션 보장</b> \u2014 예: 실제 주포지션은 CB인데 본인은 MF를 원하는 선수에게 "희망 MF\u00B72회"를 등록하면, 6쿼터 중 2쿼터는 MF, 나머지는 CB로 자동 배치됩니다. (친목 모임의 "다들 즐기고 가기"가 규칙이 됨)</li>
                    <li><b>좌/우 선호</b> \u2014 "왼쪽 선호"로 등록된 윙\u00B7풀백은 비슷한 능력치의 다른 윙이 있어도 항상 왼쪽(LW\u00B7LB)에 배치됩니다.</li>
                </ul></li>
            <li><b>\uD83E\uDDE0 성향 제안 카드 (신규)</b>: 운영진이 라인업에서 선수를 드래그로 옮길 때마다 앱이 조용히 기억합니다. 같은 방향의 이동이 <b>서로 다른 날짜에 3회 이상</b> 반복되면, 라인업 생성 버튼 아래에 "\u25CB\u25CB님을 계속 수비로 옮기시네요. 주포지션에 CB를 추가할까요?" 같은 <b>제안 카드</b>가 뜹니다. <b>[반영]을 눌러야만 저장</b>되고, [무시]하면 다시 묻지 않습니다.</li>
            <li><b>휴식 형평성</b>: 누적 휴식이 <b>적은 사람부터</b> 쉬게 하고, 같은 조건이면 <b>투표를 늦게 한 사람(명단 아래쪽)</b>이 먼저 쉽니다. 한 사람이 두 쿼터 연속으로 쉬는 일이 없습니다.</li>
            <li><b>골키퍼(키퍼)</b>: 주\u00B7부 포지션이 모두 GK인 <b>전담 키퍼</b>가 있으면 그 선수가 골문을 봅니다. 없으면 <b>키퍼를 적게 본 사람부터</b> 돌아가며 맡습니다.</li>
            <li><b>키퍼\u00B7휴식 충돌 방지</b>: 직전 쿼터에 쉰(또는 심판 본) 사람은 다음 쿼터 키퍼로 세우지 않고, 키퍼를 본 사람을 바로 쉬게 하지도 않습니다. 키퍼는 두 쿼터 연속으로 맡기지 않습니다.</li>
            <li><b>심판</b>도 휴식과 함께 공평하게 자동으로 나눠집니다. <b>최소 9명</b>이 있어야 라인업을 만들 수 있습니다.</li>
            <li><b>교체 방법</b>: PC는 선수를 <b>드래그</b>, 휴대폰은 <b>두 선수를 차례로 톡톡</b> 누르면 같은 쿼터 안에서 자리가 바뀝니다. (이 드래그가 곧 성향 학습 재료가 됩니다 \u2014 추가로 할 일 없음)</li>
        </ul>
        ${tip('자동 배정 결과의 <b>포지션 집계표</b>에서 각 선수가 공격\u00B7미들\u00B7수비\u00B7GK\u00B7휴식\u00B7출전을 몇 번 했는지 한눈에 확인할 수 있습니다. 특정인이 너무 많이 받은 포지션은 분홍색으로 표시되니 드래그로 조정하세요.')}`);

    const sAccounting = sec('\uD83D\uDCC8', '출석 & 회계 \u2014 참석/회비 관리', `
        <p class="text-sm mb-2">경기 날짜별로 참석자를 체크하고 회비를 기록\u00B7정산하는 곳입니다. <b>휴대폰과 PC가 실시간으로 같은 데이터를 봅니다</b>(한쪽에서 고치면 즉시 반영).</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>날짜 선택</b>: 위쪽 날짜를 바꾸면 그 날짜의 출석\u00B7회비 기록이 나타납니다.</li>
            <li><b>현장 휴대폰에서도 명단 자동 표시</b>: PC에서 팀배정을 해두면, 현장에서 휴대폰으로 이 탭을 열었을 때 그날 팀배정 명단이 참석자 후보로 자동으로 떠 있습니다(전원 체크 상태). 그대로 <b>선택한 날짜 출석 저장</b>만 누르면 됩니다.</li>
            <li><b>불러올 때 기본은 전원 \u2715 미납</b>: 현장에서 돈을 받은 사람만 완납으로 바꾸면 됩니다.</li>
            <li><b>납부 상태</b>: \u25CF 완납 / \u25B3 일부 / \u2715 미납 / N 노쇼. <b>완납(\u25CF)으로 바꾸면 회비유형에 맞는 금액(일반 50\u00B7잔디 70\u00B7학생 25/35 등)이 자동 입력</b>되고(v58), 미납\u00B7노쇼로 바꾸면 자동 0원이 됩니다. 자동 입력된 금액은 직접 고칠 수 있습니다.</li>
            <li><b>\uD83D\uDCB3 납부방식 (v58 신규)</b>: 각 기록의 <b>현금 / 카림 / 이체 / 기타</b> 버튼을 탭해 남깁니다(다시 탭하면 해제). <b>기타</b>(면제\u00B7분할납부 등)의 상세 내용은 비고에 적어두세요 \u2014 비고는 다음 모임에 자동으로 이어 표시되므로 차주에 참고할 수 있습니다. 납부방식은 엑셀에도 함께 내려받아집니다.</li>
            <li><b>\u2795 기타 수입 (v58 신규)</b>: 후원금\u00B7이월금처럼 회비가 아닌 수입은 회비 표 아래의 <b>기타 수입</b> 칸에 날짜\u00B7항목\u00B7금액으로 입력합니다. 총 잔액\u00B7월별 차트\u00B7엑셀(전용 시트)에 자동 반영되며, 회비 기록과 분리 저장되어 인별 집계를 오염시키지 않습니다.</li>
            <li><b>\uD83C\uDFC3 늦게 온 선수 회비 처리 (v58)</b>: 팀배정을 다시 누르지 말고, <b>팀 배정기의 팀 카드 [선수 추가]</b>(팀에도 넣을 때) 또는 이 탭의 <b>수동 추가</b> 칸(회비만 처리할 때)을 쓰세요. 수동 추가 칸은 이름을 입력하면 등록 선수를 자동 제안합니다.</li>
            <li><b>노쇼 기록</b>: 이름 옆에 누적 노쇼 횟수가 표시되고 엑셀에도 집계됩니다.</li>
            <li><b>운영진(회비 0)은 수금 집계 제외</b>: 미수금 진행바는 실제로 돈을 내야 하는 사람만 셉니다.</li>
        </ul>
        ${tip('<b>현장 수금은 "수금 체크" 모드로!</b> 이름 줄을 톡 누르면 완납(자동 금액)으로 바뀌고, 다시 누르면 취소됩니다. 비고(메모)는 다음 모임에 자동으로 이어 보여지지만 과거 기록은 그대로 보존됩니다.')}
        ${tip('<b>엑셀 내보내기</b>: 회비 표 위의 엑셀 버튼은 회비\u00B7정산 내역만 받습니다. 선수 능력치\u00B7포지션\u00B7성향은 선수관리 탭의 엑셀 버튼에서 따로 받습니다.')}`);

    const sRecord = sec('\uD83C\uDFC6', '경기기록 (신규) \u2014 하루 30초 입력으로 시즌 데이터 만들기', `
        <p class="text-sm mb-2">운영진의 필수 입력은 <b>쿼터가 끝날 때 스코어 숫자 2개</b>가 전부입니다. 팀 명단은 그날의 팀배정에서 자동으로 가져오므로, 이것만으로 개인별 승패\u00B7시즌 요약\u00B7능력치 보정이 전부 자동 계산됩니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>\uD83D\uDCBE 쿼터 스코어</b>: 날짜를 고르고 쿼터별로 "팀1 2 : 1 팀2"처럼 숫자만 넣고 저장합니다. 일부 쿼터만 입력해도 되고, 3팀 로테이션이면 쿼터마다 맞대결 팀을 바꿔 고르면 됩니다. 저장된 스코어는 <b>공유 보드에도 자동 표시</b>됩니다.</li>
            <li><b>\u26A1 능력치 자동 보정 (개인 Elo)</b>: 스코어를 바탕으로 이긴 팀원의 능력치(s1)를 소폭 올리고 진 팀원을 소폭 내립니다(쿼터당 최대 \u00B10.8). <b>매주 팀 조합이 바뀌기 때문에</b> 몇 주가 쌓이면 "누가 낀 팀이 유독 자주 이기는지"가 점수에 수렴합니다. 반드시 <b>미리보기 확인 \u2192 [반영]</b> 순서이며, 이미 반영한 날짜는 표시가 남아 중복 적용을 막아줍니다.</li>
            <li><b>\uD83C\uDFC5 활약 투표 결과</b>: 회원들이 공유 보드에서 뽑은 "오늘 잘한 3명" 집계를 확인합니다. (아래 모임배포 항목 참고)</li>
            <li><b>\uD83D\uDCC8 시즌 요약</b>: 저장된 모든 스코어\u00B7투표에서 개인별 <b>기록일수\u00B7쿼터 승-무-패\u00B7승률\u00B7활약점수</b>를 자동 집계합니다. 추가 입력은 없습니다.</li>
        </ul>
        ${warn('능력치 보정은 <b>선수관리에 등록된 선수만</b> 적용됩니다. 게스트(미등록)는 미리보기에 "반영 안 됨"으로 표시됩니다. 같은 날짜를 두 번 반영하면 중복 적용되니, "이미 반영되었습니다" 표시가 있으면 누르지 마세요.')}`);

    const sShare = sec('\uD83D\uDCE2', '모임배포 \u2014 투표 & 공유 링크 & 활약 투표', `
        <p class="text-sm mb-2">이 탭에는 성격이 다른 <b>두 가지 링크</b>가 있습니다. 용도에 맞게 골라 단톡방에 올리세요.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>\u2460 참석 투표 링크</b>: 멤버들이 참석/미정/불참을 직접 누르는 <b>고정 링크</b>입니다. 미리보기에 "Barea 참석 투표"로 뜹니다. <b>운동 시작 2시간 전에 자동 마감</b>되며, 마감 후 참석 투표는 <b>대기자</b>로 등록됩니다. "이 투표로 팀 짜기"를 누르면 대기자 포함 여부를 물어봅니다.</li>
            <li><b>\u2461 공유 보드 링크</b>: <b>공유 링크 생성</b> 버튼으로 만든 링크(<code class="bg-gray-100 px-1 rounded">/share.html?shareId=...</code>)입니다. 팀 배정\u00B7라인업 결과가 표시되고, 미리보기에 "Barea 팀배정 및 라인업"으로 뜹니다.</li>
            <li><b>\uD83C\uDFC5 오늘의 활약 투표 (신규)</b>: 공유 보드의 <b>팀 배정 아래(라인업 위)</b>에 접힌 상태로 있으며, 제목 옆에 "인기투표가 아니라 팀 배정 균형에 쓰인다"는 안내가 함께 표시됩니다. 경기가 끝나면 회원이 <b>본인 이름을 명단에서 선택</b>(한 번 고르면 기기에 기억됨)한 뒤 <b>오늘 잘한 3명을 순서대로</b> 탭합니다. 1순위 3점\u00B72순위 2점\u00B73순위 1점으로 집계되며, 자기 자신은 못 뽑고, 다시 제출하면 이전 표를 덮어써서 중복 투표가 안 됩니다. <b>결과는 익명 집계만 공개</b>됩니다. (로그인\u00B7개인정보 없음 \u2014 출석 투표와 같은 방식)</li>
            <li><b>\uD83D\uDCCA 쿼터 스코어</b>: 운영진이 경기기록 탭에 스코어를 저장하면 공유 보드에도 자동으로 표시됩니다.</li>
            <li><b>\uD83C\uDF10 영어 보기 (v55 신규)</b>: 공유 보드 오른쪽 위 <b>English</b> 버튼을 누르면 선수 이름을 제외한 모든 문구가 영어로 바뀝니다(팀 1 \u2192 TEAM 1, 1쿼터 \u2192 Q1). 외국인 선수에게 같은 링크를 그대로 공유하면 되고, 선택한 언어는 그 기기에 기억됩니다.</li>
            <li><b>\uD83D\uDCD0 공유 보드 순서 (v55 변경)</b>: 모임 정보 \u2192 팀 배정 \u2192 쿼터 스코어 \u2192 활약 투표 \u2192 라인업 순서이며, 라인업만 기본으로 펼쳐져 있습니다. 나머지는 제목을 누르면 열립니다.</li>
            <li><b>\uD83D\uDDD1 지난 투표 삭제 (v58 신규)</b>: <b>지난 투표 기록</b> 목록에서 각 투표 오른쪽의 휴지통 버튼으로 오래된 투표와 응답을 영구 삭제할 수 있습니다. (관리자 전용 \u00B7 진행 중인 투표는 삭제 불가 \u00B7 되돌릴 수 없음)</li>
        </ul>
        ${warn('결과를 공유할 땐 반드시 <b>"공유 링크 생성" 버튼으로 만든 링크</b>를 올리세요. 일반 주소나 투표 링크를 올리면 미리보기 제목이 "참석 투표"로 뜹니다.')}
        ${tip('카카오톡은 링크 미리보기를 며칠간 저장(캐시)합니다. 미리보기가 예전 것으로 보이면 <b>카카오 OG 캐시 리셋 도구</b>(developers.kakao.com/tool/clear/og)에 링크를 넣어 갱신하세요.')}`);

    const sPlayers = sec('\uD83D\uDC64', '선수관리 \u2014 실력 & 포지션 & 성향 등록', `
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>각 선수의 <b>실력(능력치)</b>과 <b>주 포지션\u00B7부 포지션</b>을 등록\u00B7수정합니다. 이 정보가 정확할수록 팀 배정과 라인업의 품질이 좋아집니다.</li>
            <li><b>\uD83C\uDFAF 성향 필드 (신규)</b>:
                <ul class="list-disc pl-5 mt-1 space-y-1">
                    <li><b>본인 희망 포지션 + 보장 횟수</b> \u2014 "실제로는 CB가 맞는데 본인은 MF라고 생각하는" 선수에게: 주포지션은 CB로 두고, 희망 MF\u00B7보장 2회로 등록 \u2192 매주 드래그하던 것이 자동화됩니다.</li>
                    <li><b>좌/우 선호</b> \u2014 무조건 왼쪽 윙에 서고 싶어하는 선수는 "왼쪽 선호"로 등록.</li>
                    <li><b>운영진 메모</b> \u2014 "후반 체력 급락, 1~3쿼터 위주" 같은 기억 보조용. 라인업 로직에는 영향 없고 선수 목록에서 \uD83D\uDCDD 아이콘에 마우스를 올리면 보입니다.</li>
                </ul></li>
            <li><b>능력치는 이제 스스로 갱신됩니다</b>: 경기기록 탭에서 스코어를 반영하면 s1이 자동으로 미세 조정됩니다. 수동 수정도 언제든 가능합니다.</li>
            <li><b>엑셀 양식</b>: 다운로드 파일에 성향 열(희망포지션\u00B7희망보장\u00B7선호측면\u00B7메모)이 추가되었습니다. <b>구버전 엑셀(성향 열 없음)을 올려도 기존 성향은 지워지지 않고 보존</b>됩니다.</li>
        </ul>`);

    el.innerHTML = `
    <div class="bg-white p-6 md:p-8 rounded-2xl shadow-lg max-w-4xl mx-auto leading-relaxed text-gray-800">
        <h2 class="text-3xl font-bold mb-1">\uD83D\uDCD6 BareaPlay 사용설명서</h2>
        <p class="text-gray-500 mb-6">처음 쓰시는 분도 이 문서만 천천히 따라 하면 팀배정부터 공유\u00B7경기기록까지 모두 할 수 있습니다. (로그인 없이 누구나 열람 가능)</p>

        <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-8">
            <h3 class="font-bold text-indigo-800 mb-2">\u26A1 한눈에 보는 전체 흐름</h3>
            <ol class="list-decimal pl-5 space-y-1 text-sm text-indigo-900">
                <li><b>모임배포</b> 탭에서 투표 링크를 만들어 단톡방에 공유 \u2192 참석 응답을 받습니다. (경기 2시간 전 자동 마감 \u00B7 마감 후 참석은 대기자로 등록)</li>
                <li><b>팀 배정기</b>에서 명단을 넣고 팀을 나눕니다. (함께/분리 지정\u00B7최근 조합 반복 방지 \u00B7 미리 짠 팀은 <b>직접 팀 입력</b>, 팀 이름은 \u270F\uFE0F로 수정)</li>
                <li><b>라인업 생성기</b>에서 쿼터별 라인업을 만듭니다. (선수 성향 자동 반영)</li>
                <li><b>모임배포</b>에서 최종 공유 링크를 단톡방에 뿌립니다.</li>
                <li>경기 중\u00B7후: <b>출석 & 회계</b>에서 회비 정리(납부방식 체크\u00B7기타 수입 입력), <b>경기기록</b>에서 쿼터 스코어 입력(30초), 회원들은 공유 보드에서 <b>활약 투표</b>. 늦게 온 선수는 <b>팀 카드의 [선수 추가]</b>로!</li>
                <li>기록이 쌓이면: 능력치 자동 보정 \u2192 다음 주 팀배정이 더 정확해지는 선순환.</li>
            </ol>
        </div>
        <section class="mb-8 p-4 bg-emerald-50 rounded-xl"><h3 class="text-xl font-bold mb-3">⚽ 코칭 도구 업데이트</h3><p class="text-sm mb-2">참석 페이지에서 한국어/English 전환, 지난 경기 활약 투표, 이번 주 목표와 영상 자료를 이용할 수 있습니다. 활약 투표는 선택 참여이며 기존 점수 집계를 유지합니다.</p><p class="text-sm mb-2">모임배포 탭 아래에서 날짜별 주간 콘텐츠를 편집하고, 선수관리 탭 아래에서 역할·안내 선수·게스트 정보를 지정하세요. 라인업 탭의 감독 보드에서 최근 4회 배정 이력, 팀·포지션 고정, 부분 재배정 미리보기, 상대 비교를 사용합니다.</p><p class="text-sm">최근 이력은 실제 출전 시간이 아닌 배정 기록입니다. 희망 횟수는 최적화 목표입니다. 수동 변경 중 ‘지속적으로 적합한 역할’로 표시한 기록만 성향 제안에 사용합니다. 아래 내용은 기존 기능 설명이며 코칭 도구와 겹치는 항목은 이 안내를 우선합니다.</p></section>
        ${sLogin}${sVote}${sBalancer}${sLineup}${sAccounting}${sRecord}${sShare}${sPlayers}
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mt-10">
            <h3 class="text-xl font-bold mb-3 text-amber-900">\uD83D\uDEE0\uFE0F 인수인계 (기술 담당용)</h3>
            <p class="text-sm text-amber-900 mb-3">이 앱은 <b>GitHub</b>에 코드를 올리면 <b>Vercel</b>이 자동 배포하고, 데이터는 <b>Firebase</b>에 저장됩니다.</p>
            <ol class="list-decimal pl-5 space-y-2 text-sm text-amber-900">
                <li><b>코드 수정\u00B7배포</b>: 파일을 고친 뒤 터미널에서
                    <div class="bg-gray-800 text-gray-100 rounded-md p-3 mt-1 font-mono text-xs">git add .<br>git commit -m "수정 내용"<br>git push</div>
                    push하면 Vercel이 자동 배포합니다.</li>
                <li><b>\u2757 저장 사고 주의</b>: 코드 에디터에서 여러 파일을 열어둔 채 "모두 저장"을 누르면, 새로 교체한 파일이 에디터에 열려 있던 옛날 내용으로 다시 덮어쓰일 수 있습니다. <b>파일 교체 후에는 에디터 탭을 모두 닫고 저장\u00B7push하세요.</b></li>
                <li><b>캐시\u00B7버전 규칙</b>: 내용을 바꾼 파일은 불러오는 주소 끝 <code class="bg-amber-100 px-1 rounded">?v=숫자</code>를 한 단계 올리고, <code class="bg-amber-100 px-1 rounded">sw.js</code>의 <code class="bg-amber-100 px-1 rounded">CACHE_NAME</code> 숫자도 함께 올립니다. (이번 업그레이드 v58: app v14, teamBalancer v7, lineupGenerator v7, accounting v7, shareManagement v6, voteManagement v8, matchRecord v2, 캐시 v58 \u2014 playerManagement\u00B7lineupStats\u00B7store는 변동 없음)</li>
                <li><b>\uD83D\uDD14 새 버전 알림 배너 (v55 신규)</b>: 새 버전이 배포되면 화면 아래에 "새 버전이 준비되었습니다" 배너가 떠서 버튼 한 번으로 갱신됩니다. 탭을 오래 켜둔 기기도 1시간마다 자동으로 새 버전을 확인하므로, 예전처럼 구버전에 갇히는 일이 크게 줄어듭니다.</li>
                <li><b>\uD83D\uDCC1 파일 구성</b>: <code class="bg-amber-100 px-1 rounded">js/modules/matchRecord.js</code>가 새로 추가되었습니다(경기기록 탭). 새 파일을 레포의 <code class="bg-amber-100 px-1 rounded">js/modules/</code> 폴더에 넣어야 합니다.</li>
                <li><b>\uD83D\uDDC4\uFE0F 새 Firestore 컬렉션</b>: <code class="bg-amber-100 px-1 rounded">matchRecords</code>(쿼터 스코어, 날짜별 1문서), <code class="bg-amber-100 px-1 rounded">ratings</code>(활약 투표, 날짜별 1문서\u00B7투표자 이름 키로 덮어쓰기), <code class="bg-amber-100 px-1 rounded">adjustLogs</code>(운영진 드래그 기록). <b>기존 출석(attendance)\u00B7회비(expenses)\u00B7일일모임(dailyMeetings) 데이터 구조는 그대로이며 삭제\u00B7변경되지 않습니다.</b> (dailyMeetings\u00B7players 문서에 새 필드만 추가됨)</li>
                <li><b>\u2757 Firestore 보안 규칙 확인</b>: <code class="bg-amber-100 px-1 rounded">ratings</code>는 회원이 <b>로그인 없이</b> 쓰는 컬렉션입니다(투표 responses와 동일). 규칙이 컬렉션별 화이트리스트 방식이라면 Firebase Console \u2192 Firestore \u2192 규칙에서 <code class="bg-amber-100 px-1 rounded">ratings</code> 쓰기 허용을 추가해야 합니다. <code class="bg-amber-100 px-1 rounded">matchRecords</code>\u00B7<code class="bg-amber-100 px-1 rounded">adjustLogs</code>는 관리자(로그인)만 쓰고, 읽기는 공개가 필요합니다(공유 보드에서 스코어\u00B7집계 표시).</li>
                <li><b>\u2757 v58 Firestore 보안 규칙 (배포 후 꼭 확인)</b>: \u2460 새 컬렉션 <code class="bg-amber-100 px-1 rounded">incomes</code>(기타 수입)가 추가되었습니다 \u2014 <b>읽기 전원 허용\u00B7쓰기(create/update/delete)는 관리자만</b>. \u2461 지난 투표 삭제 기능을 위해 <code class="bg-amber-100 px-1 rounded">votes</code> 문서와 하위 <code class="bg-amber-100 px-1 rounded">responses</code>의 <b>delete가 관리자에게 허용</b>되어야 합니다. 규칙이 없으면 해당 기능만 오류가 뜨고 나머지 앱은 정상 동작합니다.</li>
                <li><b>\uD83D\uDCE5 과거기록 이관 버튼 제거 (v58)</b>: 2026년 상반기 엑셀 장부 일회성 이관 버튼과 내장 데이터가 accounting.js에서 제거되었습니다. <b>이미 이관된 Firestore 데이터는 그대로 유지</b>됩니다.</li>
                <li><b>배포 후 확인법</b>: GitHub 레포 웹에서 그 파일을 열고 <code class="bg-amber-100 px-1 rounded">Ctrl+F</code>로 바꾼 내용을 검색해 실제 반영됐는지 확인하세요.</li>
                <li><b>운영진(관리자) 추가</b>: Firebase Console \u2192 Firestore의 <code class="bg-amber-100 px-1 rounded">admins</code> 컬렉션에 새 운영진 계정 UID를 등록해야 관리자 권한이 생깁니다.</li>
                <li><b>공유 보드 링크 미리보기</b>: <code class="bg-amber-100 px-1 rounded">share.html</code>은 루트로 이동(redirect)하지 않고 그 페이지에서 직접 결과를 그립니다. 덕분에 카톡 미리보기가 "Barea 팀배정 및 라인업"으로 뜹니다.</li>
                <li><b>날짜 기준</b>: 모든 날짜는 두바이 현지 시각으로 저장됩니다.</li>
            </ol>
        </div>
        <p class="text-xs text-gray-400 mt-8 text-center">\u00A9 BareaPlay \u00B7 두바이 한인축구팀 Barea</p>
    </div>`;
}

function switchTab(activeKey, force = false) {
    if ((activeKey === 'players' || activeKey === 'share' || activeKey === 'balancer' || activeKey === 'lineup' || activeKey === 'record') && !state.isAdmin && !force) {
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
    if (activeKey === 'record' && matchRecord.onShow) {
        matchRecord.onShow(); // [신규] 경기기록 탭: 처음 열 때 오늘 날짜 데이터 로드
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

/* =========================================================
   [v55] 공유 보드 다국어(한/영) 지원
   외국인 선수도 최종 팀배정·라인업을 읽을 수 있도록, 보드 오른쪽 위 버튼으로
   '선수 이름을 제외한' 모든 문구를 영어로 전환한다. (팀 1 → TEAM 1, 1쿼터 → Q1)
   선택한 언어는 기기(localStorage)에 기억되어 다음에도 유지된다.
   ========================================================= */
let __bpLang = (localStorage.getItem('bp_lang') === 'en') ? 'en' : 'ko';
let __bpRateUnsub = null; // 활약 투표 실시간 구독 해제 핸들 (언어 전환 재렌더 시 중복 구독 방지)

const BP_I18N = {
    ko: {
        locale: 'ko-KR',
        langBtn: '🌐 English',
        boardSub: '모임 보드',
        infoTitle: '📅 모임 정보',
        timeLbl: '시간', placeLbl: '장소', tbd: '미정',
        teamAssign: '⚖️ 팀 배정',
        lineupTitle: '📋 라인업',
        team: (n) => `팀 ${n}`,
        teamShort: (n) => `팀${n}`,
        qShort: (n) => `${n}쿼터`,
        scoreTitle: '📊 쿼터 스코어',
        rateTitle: '🏅 오늘의 활약 투표',
        rateSub: '인기투표가 아닙니다 — 투표 결과는 쿼터 스코어와 함께 각 선수의 실력 데이터에 반영되어, 다음 팀 배정을 더 균형 있게 만드는 데 사용됩니다.',
        rateExplain: '골·어시스트뿐 아니라 수비·헌신·궂은일까지, 오늘 경기 전체에서 인상 깊었던 3명을 뽑아주세요. 투표가 쌓일수록 팀 나누기가 점점 정확해져 매주 더 팽팽한 경기가 됩니다.',
        none: '없음',
        rateNoRoster: '팀 배정 명단이 없어 투표를 열 수 없습니다.',
        ratePickMe: '경기가 끝나면 <b>오늘 인상적이었던 3명</b>을 뽑아주세요. 먼저 <b>본인 이름</b>을 선택하세요. (이 기기에 기억됩니다)',
        rateConfirmMe: (n) => `'${n}'님이 맞습니까?\n이 기기에 기억되며, 꼭 본인 이름으로만 투표해 주세요.`,
        ratePick3: (n) => `<b>${n}</b>님, 오늘 잘한 <b>3명</b>을 순서대로 탭하세요.`,
        rateChangeName: '이름 변경',
        rateConfirmChange: '이름을 다시 선택할까요? (꼭 본인 이름으로만 투표해 주세요)',
        rateMax3: '3명까지만 뽑을 수 있습니다. 다른 선수를 해제한 뒤 선택하세요.',
        rateSubmit: '투표 제출', rateUpdate: '투표 수정하기',
        rateSaved: '투표가 저장되었습니다! (다시 제출하면 수정됩니다)',
        rateFail: '저장 실패. 잠시 후 다시 시도해주세요.',
        rateTally: '📊 현재 집계',
        rateTallySub: (n) => `(${n}명 참여 · 누가 뽑았는지는 공개되지 않습니다)`,
        pts: '점',
        medals: ['🥇 3점', '🥈 2점', '🥉 1점'],
        footerNote: '© 2025 BareaPlay. Created by 송감독.'
    },
    en: {
        locale: 'en-US',
        langBtn: '🌐 한국어',
        boardSub: 'Match Board',
        infoTitle: '📅 Match Info',
        timeLbl: 'Time', placeLbl: 'Venue', tbd: 'TBD',
        teamAssign: '⚖️ Team Assignment',
        lineupTitle: '📋 Lineups',
        team: (n) => `TEAM ${n}`,
        teamShort: (n) => `TEAM ${n}`,
        qShort: (n) => `Q${n}`,
        scoreTitle: '📊 Quarter Scores',
        rateTitle: "🏅 Today's MVP Vote",
        rateSub: "Not a popularity contest — results feed into each player's skill data (together with quarter scores) to keep future team assignments balanced.",
        rateExplain: "Pick the 3 players who impressed you most today — not only goals and assists, but defending, effort and dirty work too. The more votes we collect, the tighter and more exciting next week's matches become.",
        none: 'None',
        rateNoRoster: 'No team roster yet, so voting is unavailable.',
        ratePickMe: 'After the match, pick <b>the 3 most impressive players</b> of the day. First, select <b>your own name</b>. (Remembered on this device)',
        rateConfirmMe: (n) => `Are you '${n}'?\nThis device will remember it. Please vote only under your own name.`,
        ratePick3: (n) => `<b>${n}</b>, tap today's top <b>3 players</b> in order.`,
        rateChangeName: 'Change name',
        rateConfirmChange: 'Select your name again? (Please vote only under your own name)',
        rateMax3: 'You can pick up to 3 players. Deselect one first.',
        rateSubmit: 'Submit vote', rateUpdate: 'Update vote',
        rateSaved: 'Your vote has been saved! (Submit again to change it)',
        rateFail: 'Save failed. Please try again shortly.',
        rateTally: '📊 Live tally',
        rateTallySub: (n) => `(${n} voted · individual choices are not disclosed)`,
        pts: ' pts',
        medals: ['🥇 3 pts', '🥈 2 pts', '🥉 1 pt'],
        footerNote: '© 2025 BareaPlay. Created by 송감독.'
    }
};

function renderSharePageView(shareData) {
    const POS_MAP = { '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ], '3-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 65, y: 25}, {pos: 'FW', x: 35, y: 25} ], '3-4-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 50, y: 20} ] };
    const T = BP_I18N[__bpLang]; // [v55] 현재 언어 사전
    const { meetingInfo = {}, teams: teamsObject = {}, lineups = {}, attendance = null } = shareData || {};
    // [v58] 🏷️ 팀 이름: 공유 데이터에 저장된 이름(Team A/B 또는 커스텀) → 없으면 언어별 '팀 N/TEAM N'
    const tName = (i) => (shareData && Array.isArray(shareData.teamNames) && shareData.teamNames[i]) ? esc(shareData.teamNames[i]) : T.team(i + 1);
    // [수정] 명단과 라인업을 '같은 키(teamN)'로 짝지어 렌더 → 팀1↔팀2 명단이 서로 뒤바뀌던 현상 방지
    const teamKeys = Object.keys(teamsObject || {}).sort((a, b) => {
        const na = parseInt(String(a).replace(/[^0-9]/g, ''), 10) || 0;
        const nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10) || 0;
        return na - nb;
    });
    const teams = teamKeys.map(k => teamsObject[k]);
    const colors = ["#0D9488", "#0288D1", "#7B1FA2", "#43A047", "#F4511E"];

    let timeStr = '';
    try { timeStr = meetingInfo.time ? new Date(meetingInfo.time).toLocaleString(T.locale) : ''; } catch (e) { timeStr = String(meetingInfo.time || ''); }
    const locationHtml = safeUrl(meetingInfo.locationUrl)
        ? `<a href="${esc(safeUrl(meetingInfo.locationUrl))}" target="_blank" style="color:#2563eb;text-decoration:underline">${esc(meetingInfo.location)}</a>`
        : (esc(meetingInfo.location) || T.tbd);

    const getQ = (obj, idx) => { if (!obj) return null; if (Array.isArray(obj)) return obj[idx]; return obj[`q${idx + 1}`] || obj[`q_${idx}`] || null; };

    function pitchHTML(teamLineup, qIndex, teamIdx) {
        if (!teamLineup || !teamLineup.lineups || !teamLineup.lineups[qIndex]) {
            return `<div class="bp-quarter"><div class="bp-pitch" style="display:flex;align-items:center;justify-content:center;color:#cbd5e1">-</div></div>`;
        }
        const lineup = teamLineup.lineups[qIndex];
        const formation = (teamLineup.formations && teamLineup.formations[qIndex]) || '';
        const referee = getQ(teamLineup.referees, qIndex);
        const rawResters = getQ(teamLineup.resters, qIndex) || [];
        const resters = Array.isArray(rawResters) ? rawResters.filter(r => r !== referee) : [];
        let marks = '';
        const counters = {};
        (POS_MAP[formation] || []).forEach(fc => {
            counters[fc.pos] = counters[fc.pos] || 0;
            const name = (lineup[fc.pos] || [])[counters[fc.pos]] || '미배정';
            let icon = '❓', bg = '#78909C';
            if (fc.pos === 'GK') { icon = '🧤'; bg = '#00C853'; }
            else if (['LB', 'RB', 'CB', 'DF'].includes(fc.pos)) { icon = '🛡'; bg = '#03A9F4'; }
            else if (['MF', 'CM'].includes(fc.pos)) { icon = '⚙'; bg = '#FBC02D'; }
            else if (['LW', 'RW', 'FW'].includes(fc.pos)) { icon = '🎯'; bg = '#FB8C00'; }
            marks += `<div class="bp-marker" title="${esc(roleTip(fc.pos, formation, __bpLang))}" style="left:${fc.x}%;top:${fc.y}%"><div class="bp-icon" style="background:${bg}">${name === '미배정' ? '❓' : icon}</div><div class="bp-name">${name === '미배정' ? '-' : esc(name)}</div></div>`;
            counters[fc.pos]++;
        });
        let foot = '';
        if (referee) foot += `<span style="margin-right:8px"><b>⚖️</b> ${esc(referee)}</span>`;
        foot += `<span><b>🛌</b> ${esc(resters.join(', ')) || T.none}</span>`;
        return `<div class="bp-quarter">
            <div class="bp-pitch">
                <div class="bp-qtitle">${tName(teamIdx ?? 0)} · ${T.qShort(qIndex + 1)} ${formation ? '(' + esc(formation) + ')' : ''}</div>
                <div class="bp-line" style="top:50%;left:0;width:100%;height:1.5px"></div>
                <div class="bp-circle" style="top:50%;left:50%;width:24%;height:17%;transform:translate(-50%,-50%)"></div>
                <div class="bp-box" style="top:83%;left:20%;width:60%;height:17%"></div>
                <div class="bp-box" style="top:0;left:20%;width:60%;height:17%"></div>
                ${marks}
            </div>
            <div class="bp-foot">${foot}</div>
            <details style="font-size:.75rem;padding:6px;background:#fff;border-radius:6px"><summary>${__bpLang==='en'?'My role this quarter':'이번 쿼터 역할'}</summary>${Object.entries(lineup).map(([pos,names])=>`<p style="margin:8px 0"><b>${esc(names.join(', '))} · ${esc(pos)}</b><br>${esc(roleTip(pos,formation,__bpLang))}</p>`).join('')}</details>
        </div>`;
    }

    // [수정] 공유 보드에서 참석 현황 섹션 제거 — 투표 결과만 반영하므로 수동 추가 인원과 불일치하여 혼란 방지
    let attendHtml = '';

    const teamHtml = teams.map((team, i) => `<div style="background:${colors[i % 5]};color:#fff;border-radius:12px;padding:12px"><div style="font-weight:800;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:6px;margin-bottom:6px">${tName(i)}</div>${[...team].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')).map(pp => `<div style="background:rgba(255,255,255,.18);border-radius:6px;padding:5px 8px;margin-bottom:4px">${esc(String(pp.name).replace(' (신규)', ''))}</div>`).join('')}</div>`).join('');

    const lineupHtml = teamKeys.map((teamKey, teamIdx) => {
        const lu = lineups[teamKey] || lineups[`team${teamIdx + 1}`] || lineups[teamIdx];
        let q = '';
        for (let i = 0; i < 6; i++) q += pitchHTML(lu, i, teamIdx);
        return `<div style="margin-bottom:18px"><h3 style="font-weight:800;text-align:center;margin-bottom:8px">${tName(teamIdx)}</h3><div class="bp-qgrid">${q}</div></div>`;
    }).join('');

    document.title = 'Barea 팀배정 및 라인업';
    document.body.className = 'bg-gray-100';
    document.body.innerHTML = `
    <style>
        .bp-wrap{max-width:1100px;margin:0 auto;padding:16px;font-family:'Noto Sans KR',sans-serif}
        .bp-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:16px 0}
        .bp-h2{font-size:1.3rem;font-weight:800;margin:0 0 12px;border-bottom:1px solid #eee;padding-bottom:8px}
        .bp-qgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
        .bp-quarter{display:flex;flex-direction:column}
        .bp-pitch{background:#2E7D32;position:relative;width:100%;aspect-ratio:7/10;border-radius:6px;overflow:hidden;border:1px solid #1b5e20}
        .bp-qtitle{position:absolute;top:6px;left:6px;font-size:.72rem;font-weight:700;color:#fff;background:rgba(0,0,0,.5);padding:2px 6px;border-radius:5px;z-index:5}
        .bp-circle{position:absolute;border:1.5px solid rgba(255,255,255,.5);border-radius:50%}
        .bp-box{position:absolute;border:1.5px solid rgba(255,255,255,.5)}
        .bp-line{position:absolute;background:rgba(255,255,255,.5)}
        .bp-marker{position:absolute;transform:translate(-50%,-50%);text-align:center;z-index:3}
        .bp-icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.7rem;border:1.5px solid #fff;margin:0 auto;box-shadow:0 1px 3px rgba(0,0,0,.4)}
        .bp-name{background:rgba(0,0,0,.7);color:#fff;font-size:.62rem;padding:1px 4px;border-radius:5px;margin-top:2px;white-space:nowrap}
        .bp-foot{text-align:center;margin-top:6px;padding:4px;font-size:.75rem;font-weight:700;background:#f3f4f6;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        details.bp-card>summary{list-style:none;cursor:pointer;font-size:1.3rem;font-weight:800;display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #eee}
        details.bp-card>summary::-webkit-details-marker{display:none}
        details.bp-card>summary::after{content:'▾';font-size:.9rem;color:#9ca3af;transition:transform .2s;margin-left:8px;flex-shrink:0}
        details.bp-card:not([open])>summary{border-bottom:none;padding-bottom:0}
        details.bp-card:not([open])>summary::after{transform:rotate(-90deg)}
        details.bp-card>.bp-body{margin-top:12px}
        .bp-sub{display:block;font-size:.72rem;color:#9ca3af;font-weight:400;line-height:1.5;margin-top:3px}
    </style>
    <div class="bp-wrap">
        <div style="text-align:center;margin:12px 0;position:relative">
            <h1 style="font-size:1.8rem;font-weight:800;color:#111827">BareaPlay ⚽</h1>
            <p style="color:#6b7280;margin-top:4px">${T.boardSub}</p>
            <button id="bp-lang-btn" style="position:absolute;top:0;right:0;font-size:.78rem;font-weight:700;color:#4f46e5;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:6px 10px;cursor:pointer">${T.langBtn}</button>
        </div>
        <div class="bp-card"><h2 class="bp-h2">${T.infoTitle}</h2><p style="margin:4px 0"><b>${T.timeLbl}:</b> ${esc(timeStr)}</p><p style="margin:4px 0"><b>${T.placeLbl}:</b> ${locationHtml}</p></div>
        ${attendHtml}
        <details class="bp-card"><summary>${T.teamAssign}</summary><div class="bp-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">${teamHtml}</div></details>
        <details class="bp-card" id="bp-score-card" style="display:none"><summary>${T.scoreTitle}</summary><div class="bp-body" id="bp-score-body"></div></details>
        <details class="bp-card" open><summary>${T.lineupTitle}</summary><div class="bp-body">${lineupHtml}</div></details>
        <footer style="text-align:center;padding:16px;color:#9ca3af;font-size:.8rem">${T.footerNote}</footer>
    </div>`;
    const __n = document.createElement('div'); __n.id = 'notification'; document.body.appendChild(__n);
    // [v55] 언어 전환: 활약 투표 실시간 구독을 해제한 뒤 보드 전체를 다시 그린다 (데이터 재요청 없음)
    const langBtn = document.getElementById('bp-lang-btn');
    if (langBtn) langBtn.onclick = () => {
        __bpLang = (__bpLang === 'en') ? 'ko' : 'en';
        try { localStorage.setItem('bp_lang', __bpLang); } catch (e) {}
        if (__bpRateUnsub) { try { __bpRateUnsub(); } catch (e) {} __bpRateUnsub = null; }
        renderSharePageView(shareData);
    };
    setupShareBoardExtras(shareData); // 쿼터 스코어 표시 + 활약 투표(피어 평점)
}

/* =========================================================
   공유 보드 부가 기능 — 로그인 없이 참여하는 '오늘의 활약 투표'
   신뢰 모델은 출석 투표와 동일: 그날 참가자 명단에서 본인 이름을 스스로 선택하고,
   기기(localStorage)에 기억된다. 문서 키가 투표자 이름이라 다시 제출하면 덮어써져
   중복 투표가 원천적으로 불가능하다. 결과는 익명 집계만 공개된다.
   [v55] 모든 안내 문구는 BP_I18N(한/영) 사전을 사용하고,
   실시간 구독은 __bpRateUnsub 에 보관해 언어 전환 시 중복 구독을 막는다.
   ========================================================= */
function setupShareBoardExtras(shareData) {
    try {
        const T = BP_I18N[__bpLang];
        const meetingInfo = shareData.meetingInfo || {};
        const dateStr = String(meetingInfo.time || '').split(' ')[0] || window.getLocalDate();
        // [v58] 스코어 표에도 팀 이름 반영
        const tShort = (i) => (Array.isArray(shareData.teamNames) && shareData.teamNames[i]) ? esc(shareData.teamNames[i]) : T.teamShort(i + 1);

        // 그날 참가자(팀 배정 명단 전체)
        const names = [];
        Object.values(shareData.teams || {}).forEach(team => (team || []).forEach(p => {
            const n = String(p.name || '').replace(' (신규)', '').trim();
            if (n && !names.includes(n)) names.push(n);
        }));
        names.sort((a, b) => a.localeCompare(b, 'ko-KR'));

        // ── 쿼터 스코어: 운영진이 경기기록 탭에 저장한 스코어가 있으면 표시 (기본 접힘)
        getDoc(doc(db, "matchRecords", dateStr)).then(snap => {
            if (!snap.exists()) return;
            const qs = snap.data().quarters || {};
            const rows = Object.keys(qs).sort().map(k => {
                const q = qs[k];
                const qNum = (parseInt(k.replace(/[^0-9]/g, ''), 10) + 1) || '';
                return `<div style="display:flex;justify-content:center;gap:12px;padding:6px 0;border-bottom:1px solid #f3f4f6;font-weight:700"><span style="color:#9ca3af;min-width:52px">${T.qShort(qNum)}</span><span>${tShort(q.a ?? 0)}</span><span style="color:#4f46e5">${q.sa} : ${q.sb}</span><span>${tShort(q.b ?? 1)}</span></div>`;
            }).join('');
            if (!rows) return;
            const card = document.getElementById('bp-score-card');
            const body = document.getElementById('bp-score-body');
            if (card && body) { body.innerHTML = rows; card.style.display = ''; }
        }).catch(() => {});

    } catch (e) { console.error('share board extras error:', e); }
}

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // [중요] 투표/보드 링크는 메인 앱을 그리기 전에 즉시 처리 -> 메인 화면 깜빡임 방지
    {
        const __p = new URLSearchParams(window.location.search);
        if(__p.has('preferences')) {
            if(loadingOverlay)loadingOverlay.style.display='none';
            renderPositionSurvey(db,auth);return;
        }
        const __voteId = __p.get('voteId');
        const __shareId = __p.get('shareId');
        const __voteCurrent = __p.get('vote'); // 고정 링크 ?vote=current
        if (__voteCurrent) {
            window.__db = db;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            await voteMgmt.renderCurrentVotePage();
            return;
        }
        if (__voteId) {
            window.__db = db;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            await voteMgmt.renderVotePage(__voteId);
            return;
        }
        if (__shareId) {
            window.__db = db;
            try {
                const sDoc = await getDoc(doc(db, "shares", __shareId));
                if (sDoc.exists()) renderSharePageView(sDoc.data());
                else document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">공유된 데이터를 찾을 수 없습니다.</p>`;
            } catch (e) {
                console.error("share load error", e);
                document.body.innerHTML = `<p class="text-center text-red-500 text-2xl mt-10">데이터를 불러오는 중 오류가 발생했습니다.</p>`;
            } finally {
                if (loadingOverlay) loadingOverlay.style.display = 'none';
            }
            return;
        }
    }

    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt, voteMgmt, lineupStats, matchRecord, coachWorkspace, adminWorkflow };
    const dependencies = { db, state };
    window.playerMgmt = playerMgmt;
    window.accounting = accounting;
    window.lineup = lineup;
    window.shareMgmt = shareMgmt;
    window.__db = db;
    window.voteMgmt = voteMgmt;
    window.saveDailyMeetingData = saveDailyMeetingData;

    for (const moduleName in modules) {
        if (modules[moduleName].init) {
            modules[moduleName].init(dependencies);
        }
    }
    mountPreferenceAdmin(db,state);
    
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');
    const voteId = urlParams.get('voteId');
    const voteCurrent = urlParams.get('vote'); // 고정 링크 ?vote=current

    if (voteCurrent) {
        loadingOverlay.style.display = 'none';
        await voteMgmt.renderCurrentVotePage();
        return;
    }

    if (voteId) {
        loadingOverlay.style.display = 'none';
        await voteMgmt.renderVotePage(voteId);
        return;
    }


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
        Object.assign(pages, { players: document.getElementById('page-players'), balancer: document.getElementById('page-balancer'), lineup: document.getElementById('page-lineup'), accounting: document.getElementById('page-accounting'), record: document.getElementById('page-record'), share: document.getElementById('page-share'), manual: document.getElementById('page-manual') });
        Object.assign(tabs, { players: document.getElementById('tab-players'), balancer: document.getElementById('tab-balancer'), lineup: document.getElementById('tab-lineup'), accounting: document.getElementById('tab-accounting'), record: document.getElementById('tab-record'), share: document.getElementById('tab-share'), manual: document.getElementById('tab-manual') });
        renderManual();
        adminModal = document.getElementById('admin-modal');
        modalCancelBtn = document.getElementById('modal-cancel-btn'); 

        const googleLoginBtn = document.getElementById('google-login-btn');
        
        if (googleLoginBtn) {
            googleLoginBtn.addEventListener('click', async () => {
                const provider = new GoogleAuthProvider();
                try {
                    await setPersistence(auth, browserLocalPersistence);
                    const result = await signInWithPopup(auth, provider);
                    const user = result.user;
                    const adminDocRef = doc(db, "admins", user.uid);
                    const adminDoc = await getDoc(adminDocRef);

                    if (adminDoc.exists()) {
                        console.log("관리자 인증 성공! UID:", user.uid);
                        setAdmin(true);
                        window.showNotification('관리자 인증에 성공했습니다.', 'success');
                        updateAdminUI();
                        adminModal.classList.add('hidden');
                        if (pendingTabSwitch) { switchTab(pendingTabSwitch, true); }
                    } else {
                        console.log("관리자가 아닌 사용자 로그인 시도:", user.uid);
                        window.showNotification('관리자 계정이 아닙니다.', 'error');
                    }

                } catch (error) {
                    console.error("Google 로그인 실패:", error);
                    window.showNotification('Google 로그인에 실패했습니다.', 'error');
                }
            });
        }
        
        modalCancelBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
        adminModal.addEventListener('click', (e) => { if (e.target === adminModal) adminModal.classList.add('hidden'); });

        Object.keys(tabs).forEach(key => { if (tabs[key]) tabs[key].addEventListener('click', () => switchTab(key)); });
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                console.log("자동 로그인 사용자 발견:", user.uid);
                try {
                    const adminDocRef = doc(db, "admins", user.uid);
                    const adminDoc = await getDoc(adminDocRef);

                    if (adminDoc.exists()) {
                        console.log("관리자 자동 로그인 성공.");
                        setAdmin(true);
                        updateAdminUI(); 
                        adminModal.classList.add('hidden'); 
                    } else {
                        console.log("관리자가 아닌 사용자 세션 발견.");
                        setAdmin(false);
                        updateAdminUI();
                    }
                } catch (error) {
                    console.error("자동 로그인 중 관리자 확인 실패:", error);
                    setAdmin(false);
                    updateAdminUI();
                }
            } else {
                console.log("로그인된 사용자 없음.");
                setAdmin(false);
                updateAdminUI();
            }
        });
        onSnapshot(doc(db, "settings", "activeMeeting"), (doc) => {
            const placeholder = document.getElementById('realtime-link-placeholder');
            placeholder.innerHTML = '';
            if (doc.exists() && doc.data().shareId) {
                const shareId = doc.data().shareId;
                const linkText = doc.data().linkText || "오늘 모임 결과 확인하기";
                const link = document.createElement('a');
                link.href = `${window.location.origin}/share.html?shareId=${shareId}`;
                link.target = "_blank";
                link.className = 'realtime-link-button';
                link.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" /></svg>${esc(linkText)}`;
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
            // [v58] ➕ 기타 수입(incomes) — 보안 규칙이 아직 없어도 앱 전체가 멈추지 않도록 별도 처리
            state.extraIncomeLog = [];
            try {
                const incSnap = await getDocs(collection(db, "incomes"));
                state.extraIncomeLog = incSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { console.warn('incomes 컬렉션을 읽지 못했습니다 (Firestore 규칙 확인):', e); }
            // [실시간 동기화] 선수 DB를 Firestore와 실시간 연결한다.
            // → PC에서 추가/수정/삭제한 선수가 폰 앱에 자동 반영되고, 그 반대도 자동 반영된다.
            //   (기존: localStorage에 캐시가 있으면 Firebase를 다시 안 읽어 신규 선수가 영영 안 보이던 버그 수정)
            onSnapshot(collection(db, "players"), (snapshot) => {
                const freshDB = {};
                snapshot.forEach(d => { freshDB[d.id] = d.data(); });
                state.playerDB = freshDB;
                try { localStorage.setItem('playerDB', JSON.stringify(freshDB)); } catch (e) {}
                if (playerMgmt) playerMgmt.renderPlayerTable();
            }, (err) => console.error('선수 DB 실시간 구독 오류:', err));
            // [수정] 회계 화면에서 무언가 입력 중일 때는 표를 다시 그리지 않음 (입력 끊김 방지)
            const isEditingAccounting = () => {
                const el = document.activeElement;
                const accountingPage = document.getElementById('page-accounting');
                return el && accountingPage && accountingPage.contains(el) &&
                    (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
            };
            onSnapshot(collection(db, "expenses"), (snapshot) => { state.expenseLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } });
            // [v58] 기타 수입 실시간 동기화 (오류 시 앱 동작에는 영향 없음)
            onSnapshot(collection(db, "incomes"), (snapshot) => { state.extraIncomeLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } }, (err) => console.warn('incomes 실시간 구독 오류 (Firestore 규칙 확인):', err));
            onSnapshot(collection(db, "attendance"), (snapshot) => { state.attendanceLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } if (playerMgmt) playerMgmt.renderPlayerTable(); });
            onSnapshot(doc(db, "memos", "accounting_memo"), (doc) => { const memoArea = document.getElementById('memo-area'); if (doc.exists() && memoArea && document.activeElement !== memoArea) { memoArea.value = doc.data().content; } });
            playerMgmt.renderPlayerTable();
            accounting.renderForDate();
            await changeMeetingDate(window.getLocalDate()); // [A방식] 오늘 날짜로 시작
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
