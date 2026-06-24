// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { state, setAdmin } from './store.js?v=2';
import * as playerMgmt from './modules/playerManagement.js?v=3';
import * as balancer from './modules/teamBalancer.js?v=4';
import * as lineup from './modules/lineupGenerator.js?v=2';
import * as accounting from './modules/accounting.js?v=3';
import * as shareMgmt from './modules/shareManagement.js?v=2';
import * as voteMgmt from './modules/voteManagement.js?v=2';
import * as lineupStats from './modules/lineupStats.js?v=1';

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
                    refereesObject[`q_${qIndex}`] = ref;
                });
            }
            transformedCache[teamIndex] = { ...originalLineup, resters: restersObject, referees: refereesObject };
        } else {
            transformedCache[teamIndex] = originalLineup;
        }
    });

    const dataToSave = {
        date: today,
        teams: teamsObject,
        teamLineupCache: transformedCache,
        initialAttendeeOrder: state.initialAttendeeOrder || [],
        aceNames: state.aceNames || [], // [A방식] 에이스 명단도 날짜별로 함께 저장
        lastWriter: CLIENT_ID, // [수정] 누가 저장했는지 서명
        lastUpdatedAt: serverTimestamp()

    };

    try {
        await setDoc(doc(db, "dailyMeetings", today), dataToSave, { merge: true });
        console.log(`${today} 모임 데이터가 저장되었습니다.`);
    } catch (error) {
        console.error("일일 모임 데이터 저장 실패:", error);
        window.showNotification(`저장 실패: ${error.message}`, 'error');
    }
}, 1000);

// [A방식] 서버 문서 데이터를 화면/상태에 반영 (명단·에이스·팀배정·라인업 복원)
function applyMeetingData(data) {
    if (data) {
        state.teams = Object.values(data.teams || {});
        state.initialAttendeeOrder = data.initialAttendeeOrder || [];
        state.aceNames = data.aceNames || [];

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

            if (transformedLineup) {
                originalCache[teamIndex] = { ...transformedLineup, resters: restoredResters, referees: restoredReferees };
            }
        });
        state.teamLineupCache = originalCache;
    } else {
        // 해당 날짜에 저장된 내용이 없으면 빈 상태로 시작 (예: 다음주 날짜)
        state.teams = [];
        state.teamLineupCache = {};
        state.initialAttendeeOrder = [];
        state.aceNames = [];
    }

    // 명단·에이스 textarea 복원 (사용자가 그 칸을 편집 중이면 setAttendees/setAces 내부에서 건드리지 않음)
    if (balancer.setAttendees) balancer.setAttendees(state.initialAttendeeOrder);
    if (balancer.setAces) balancer.setAces(state.aceNames);
    balancer.renderResults(state.teams);
    lineup.renderTeamSelectTabs(state.teams);
}

// [A방식] 선택한 날짜의 문서를 즉시 강제 로드하고, 그 날짜에 대한 실시간 동기화를 건다.
async function changeMeetingDate(date) {
    selectedMeetingDate = date;
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
            const newPlayerDB = {};
            json.forEach(player => {
                const name = player.이름;
                if (!name) return;
                newPlayerDB[name] = {
                    name: name,
                    pos1: (player.주포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s1:   player.주포지션숙련도 || 65,
                    pos2: (player.부포지션 || "").toString().split(',').map(p => p.trim()).filter(Boolean),
                    s2:   player.부포지션숙련도 || 0,
                    feeType: parseFeeType(player.회비유형, name)
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
            <li>이 앱은 <b>누구나 화면을 볼 수 있지만</b>, 팀 배정\u00B7라인업\u00B7출석\u00B7회비\u00B7선수 정보를 <b>수정하는 것은 운영진(관리자)만</b> 할 수 있습니다.</li>
            <li>수정 기능을 누르면 <b>Google 로그인</b> 창이 뜹니다. 운영진 계정으로 로그인하면 모든 편집 기능이 열립니다.</li>
            <li>로그인하지 않은 사람은 버튼이 잠겨 있거나, 누르면 로그인 안내가 뜹니다. (구경은 자유, 수정은 운영진만)</li>
        </ul>
        ${tip('새 운영진을 추가하려면 맨 아래 <b>인수인계</b> 항목의 Firebase 설정이 필요합니다. 앱 안에서는 추가할 수 없습니다.')}`);

    const sBalancer = sec('\u2696\uFE0F', '팀 배정기 \u2014 팀 나누기', `
        <p class="text-sm mb-2">참가자 이름을 넣고 버튼 한 번이면 실력\u00B7포지션\u00B7인원이 균형 잡힌 팀으로 자동으로 나눠집니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>참가자 명단</b>: 한 줄에 한 명씩 이름을 적습니다. <b>모든 선수 불러오기</b> 버튼을 누르면 등록된 선수 전체가 한 번에 채워집니다.</li>
            <li><b>명단은 저장됩니다</b>: 새로고침하거나 앱을 껐다 켜도 입력한 명단이 그대로 남아 있습니다. <b>명단 초기화</b> 버튼을 눌러야만 비워집니다.</li>
            <li><b>\u2B50 에이스 지정 (선택)</b>: 잘하는 핵심 선수를 여기에 적으면, 그 선수들이 <b>각 팀에 고르게 나뉩니다</b>. 예를 들어 에이스 6명을 적고 2팀으로 나누면 한 팀에 몰리지 않고 <b>3:3</b>으로 갈립니다. 홀수(5명)면 3:2로 나뉘고 남는 1명은 팀 평균 실력에 맞춰 배정됩니다. 배정 결과에 \u2B50 표시가 붙습니다.</li>
            <li><b>밸런스 가중치</b>: 능력치\u00B7포지션\u00B7인원수 슬라이더로 "무엇을 더 중요하게 맞출지"를 조절합니다. 능력치를 높이면 실력 균형을, 포지션을 높이면 포지션 분포를 우선합니다.</li>
            <li><b>수동 이동</b>: 자동 배정 후 마음에 안 들면 선수를 <b>드래그</b>해서 다른 팀으로 옮길 수 있습니다.</li>
        </ul>
        ${warn('에이스는 <b>선수관리에 등록된 선수만</b> 인정됩니다. 명단에만 있고 등록 안 된 "신규" 선수는 에이스로 지정되지 않습니다.')}`);

    const sLineup = sec('\uD83D\uDCCB', '라인업 생성기 \u2014 쿼터별 포지션', `
        <p class="text-sm mb-2">팀을 나눈 뒤, 팀별로 <b>6쿼터 라인업</b>(누가 어느 쿼터에 어느 포지션을 보는지)을 자동으로 만들어 줍니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>각 선수의 <b>주 포지션을 우선</b> 배치하고, 모두가 비슷하게 뛰도록 <b>휴식을 돌아가며</b> 배정합니다.</li>
            <li><b>골키퍼\u00B7심판</b>도 자동으로 공평하게 나눠집니다.</li>
            <li><b>최소 9명</b>이 있어야 라인업을 만들 수 있습니다.</li>
            <li><b>교체 방법</b>: PC는 선수를 <b>드래그</b>, 휴대폰은 <b>두 선수를 차례로 톡톡</b> 누르면 같은 쿼터 안에서 자리가 바뀝니다.</li>
        </ul>`);

    const sAccounting = sec('\uD83D\uDCC8', '출석 & 회계 \u2014 참석/회비 관리', `
        <p class="text-sm mb-2">경기 날짜별로 참석자를 체크하고 회비를 기록\u00B7정산하는 곳입니다.</p>
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>날짜 선택</b>: 위쪽 날짜를 바꾸면 그 날짜의 출석\u00B7회비 기록이 나타납니다. 과거 날짜를 고르면 그날의 기록이 그대로 보입니다.</li>
            <li><b>참석자 체크</b>: 명단에서 온 사람을 체크하면 회비 표에 추가됩니다.</li>
            <li><b>납부 상태</b>: <b>\u25CF 완납 / \u25B3 일부 / \u2715 미납 / N 노쇼</b> 중에서 고릅니다.</li>
            <li><b>금액 자동 0</b>: 납부 상태를 <b>\u2715 미납</b> 또는 <b>N 노쇼</b>로 바꾸면 그 사람의 납부액이 <b>자동으로 0원</b>이 됩니다. (완납\u00B7일부는 적은 금액 그대로 유지)</li>
            <li><b>노쇼 기록</b>: "온다고 해놓고 안 온" 사람을 N 노쇼로 표시하면, 벌금 같은 불이익 없이 <b>기록만</b> 남습니다. 이름 옆에 <b>누적 노쇼 횟수</b>가 표시되고 엑셀에도 집계됩니다.</li>
        </ul>
        ${tip('<b>비고(메모)는 한 번 적으면 계속 따라다닙니다.</b> 어떤 선수의 비고란에 메모(예: "지난주 회비 5천원 남음")를 적어두면, <b>다른 날짜에 그 선수를 다시 불러와도 같은 메모가 자동으로 떠 있습니다.</b> 해결돼서 <b>메모를 지우면</b> 그 다음부터는 더 이상 보이지 않습니다. 날짜마다 다시 적을 필요가 없어요.')}
        ${tip('<b>엑셀 내보내기</b>로 기간별\u00B7사람별 정산 내역(참석 횟수, 납부액, 완납/일부/미납/노쇼 횟수)을 한 번에 받을 수 있습니다.')}`);

    const sShare = sec('\uD83D\uDCE2', '모임배포 \u2014 투표 & 공유 링크', `
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li><b>투표 링크</b>: 링크를 만들어 단톡방에 올리면 멤버들이 <b>참석/미정/불참</b>을 직접 누릅니다. 그 결과를 팀 배정기로 불러올 수 있습니다.</li>
            <li><b>공유 보드 링크</b>: 팀배정\u00B7라인업이 끝난 결과를 한 화면으로 공유합니다. 받는 사람은 <b>토글(접고 펴기)</b>로 보고 싶은 것만 봅니다 \u2014 <b>팀 배정은 접힌 상태, 라인업은 펼쳐진 상태</b>가 기본입니다.</li>
        </ul>
        ${tip('공유 보드에는 <b>참석 현황(투표 결과)이 표시되지 않습니다.</b> 투표를 안 한 사람을 나중에 팀배정에 직접 추가하는 경우 투표 결과와 어긋나 혼란을 줄 수 있어, 팀배정\u00B7라인업 결과만 깔끔하게 보여주도록 했습니다.')}`);

    const sPlayers = sec('\uD83D\uDC64', '선수관리 \u2014 실력 & 포지션 등록', `
        <ul class="list-disc pl-5 space-y-1.5 text-sm">
            <li>각 선수의 <b>실력(능력치)</b>과 <b>주 포지션\u00B7부 포지션</b>을 등록\u00B7수정합니다.</li>
            <li>이 정보가 정확할수록 <b>팀 배정과 라인업의 품질</b>이 좋아집니다. (능력치가 비어 있으면 균형을 맞추기 어렵습니다)</li>
            <li><b>엑셀 양식</b>으로 여러 선수를 한 번에 일괄 등록\u00B7수정할 수 있습니다.</li>
        </ul>`);

    el.innerHTML = `
    <div class="bg-white p-6 md:p-8 rounded-2xl shadow-lg max-w-4xl mx-auto leading-relaxed text-gray-800">
        <h2 class="text-3xl font-bold mb-1">\uD83D\uDCD6 BareaPlay 사용설명서</h2>
        <p class="text-gray-500 mb-6">처음 쓰시는 분도 이 문서만 천천히 따라 하면 팀배정부터 공유까지 모두 할 수 있습니다. (로그인 없이 누구나 열람 가능)</p>

        <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-8">
            <h3 class="font-bold text-indigo-800 mb-2">\u26A1 한눈에 보는 전체 흐름</h3>
            <ol class="list-decimal pl-5 space-y-1 text-sm text-indigo-900">
                <li><b>모임배포</b> 탭에서 투표 링크를 만들어 단톡방에 공유 \u2192 참석 응답을 받습니다.</li>
                <li><b>출석 & 회계</b> 탭에서 그날 참석자와 회비를 정리합니다.</li>
                <li><b>팀 배정기</b>에서 명단을 넣고 팀을 나눕니다.</li>
                <li><b>라인업 생성기</b>에서 쿼터별 라인업을 만듭니다.</li>
                <li><b>모임배포</b>에서 최종 공유 링크를 단톡방에 뿌립니다.</li>
            </ol>
        </div>
        ${sLogin}${sBalancer}${sLineup}${sAccounting}${sShare}${sPlayers}
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mt-10">
            <h3 class="text-xl font-bold mb-3 text-amber-900">\uD83D\uDEE0\uFE0F 인수인계 (기술 담당용)</h3>
            <p class="text-sm text-amber-900 mb-3">이 앱은 <b>GitHub</b>에 코드를 올리면 <b>Vercel</b>이 자동 배포하고, 데이터는 <b>Firebase</b>에 저장됩니다.</p>
            <ol class="list-decimal pl-5 space-y-2 text-sm text-amber-900">
                <li><b>코드 수정\u00B7배포</b>: 파일을 고친 뒤 터미널에서
                    <div class="bg-gray-800 text-gray-100 rounded-md p-3 mt-1 font-mono text-xs">git add .<br>git commit -m "수정 내용"<br>git push</div>
                    push하면 Vercel이 자동 배포합니다.</li>
                <li><b>\u2757 저장 사고 주의</b>: 코드 에디터에서 여러 파일을 열어둔 채 "모두 저장"을 누르면, 새로 교체한 파일이 에디터에 열려 있던 옛날 내용으로 다시 덮어쓰일 수 있습니다. <b>파일 교체 후에는 에디터 탭을 모두 닫고 저장\u00B7push하세요.</b></li>
                <li><b>캐시\u00B7버전 규칙</b>: 내용을 바꾼 파일은 불러오는 주소 끝 <code class="bg-amber-100 px-1 rounded">?v=숫자</code>를 한 단계 올리고, <code class="bg-amber-100 px-1 rounded">sw.js</code>의 <code class="bg-amber-100 px-1 rounded">CACHE_NAME</code> 숫자도 함께 올립니다.</li>
                <li><b>배포 후 확인법</b>: GitHub 레포 웹에서 그 파일을 열고 <code class="bg-amber-100 px-1 rounded">Ctrl+F</code>로 바꾼 내용을 검색해 실제 반영됐는지 확인하세요.</li>
                <li><b>운영진(관리자) 추가</b>: Firebase Console \u2192 Firestore의 <code class="bg-amber-100 px-1 rounded">admins</code> 컬렉션에 새 운영진 계정 UID를 등록해야 관리자 권한이 생깁니다.</li>
                <li><b>날짜 기준</b>: 모든 날짜는 두바이 현지 시각으로 저장됩니다.</li>
            </ol>
        </div>
        <p class="text-xs text-gray-400 mt-8 text-center">\u00A9 BareaPlay \u00B7 두바이 한인축구팀 Barea</p>
    </div>`;
}

function switchTab(activeKey, force = false) {
    if ((activeKey === 'players' || activeKey === 'share' || activeKey === 'balancer' || activeKey === 'lineup') && !state.isAdmin && !force) {
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
    const POS_MAP = { '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ], '3-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 65, y: 25}, {pos: 'FW', x: 35, y: 25} ], '3-4-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 50, y: 20} ] };
    const { meetingInfo = {}, teams: teamsObject = {}, lineups = {}, attendance = null } = shareData || {};
    const teams = Object.values(teamsObject || {});
    const colors = ["#0D9488", "#0288D1", "#7B1FA2", "#43A047", "#F4511E"];

    let timeStr = '';
    try { timeStr = meetingInfo.time ? new Date(meetingInfo.time).toLocaleString('ko-KR') : ''; } catch (e) { timeStr = String(meetingInfo.time || ''); }
    const locationHtml = safeUrl(meetingInfo.locationUrl)
        ? `<a href="${esc(safeUrl(meetingInfo.locationUrl))}" target="_blank" style="color:#2563eb;text-decoration:underline">${esc(meetingInfo.location)}</a>`
        : (esc(meetingInfo.location) || '미정');

    const getQ = (obj, idx) => { if (!obj) return null; if (Array.isArray(obj)) return obj[idx]; return obj[`q${idx + 1}`] || obj[`q_${idx}`] || null; };

    function pitchHTML(teamLineup, qIndex) {
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
            marks += `<div class="bp-marker" style="left:${fc.x}%;top:${fc.y}%"><div class="bp-icon" style="background:${bg}">${name === '미배정' ? '❓' : icon}</div><div class="bp-name">${name === '미배정' ? '-' : esc(name)}</div></div>`;
            counters[fc.pos]++;
        });
        let foot = '';
        if (referee) foot += `<span style="margin-right:8px"><b>⚖️</b> ${esc(referee)}</span>`;
        foot += `<span><b>🛌</b> ${esc(resters.join(', ')) || '없음'}</span>`;
        return `<div class="bp-quarter">
            <div class="bp-pitch">
                <div class="bp-qtitle">${qIndex + 1}쿼터 ${formation ? '(' + esc(formation) + ')' : ''}</div>
                <div class="bp-line" style="top:50%;left:0;width:100%;height:1.5px"></div>
                <div class="bp-circle" style="top:50%;left:50%;width:24%;height:17%;transform:translate(-50%,-50%)"></div>
                <div class="bp-box" style="top:83%;left:20%;width:60%;height:17%"></div>
                <div class="bp-box" style="top:0;left:20%;width:60%;height:17%"></div>
                ${marks}
            </div>
            <div class="bp-foot">${foot}</div>
        </div>`;
    }

    // [수정] 공유 보드에서 참석 현황 섹션 제거 — 투표 결과만 반영하므로 수동 추가 인원과 불일치하여 혼란 방지
    let attendHtml = '';

    const teamHtml = teams.map((team, i) => `<div style="background:${colors[i % 5]};color:#fff;border-radius:12px;padding:12px"><div style="font-weight:800;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:6px;margin-bottom:6px">팀 ${i + 1}</div>${[...team].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')).map(pp => `<div style="background:rgba(255,255,255,.18);border-radius:6px;padding:5px 8px;margin-bottom:4px">${esc(String(pp.name).replace(' (신규)', ''))}</div>`).join('')}</div>`).join('');

    const lineupHtml = teams.map((team, teamIdx) => {
        const lu = lineups[`team${teamIdx + 1}`] || lineups[teamIdx];
        let q = '';
        for (let i = 0; i < 6; i++) q += pitchHTML(lu, i);
        return `<div style="margin-bottom:18px"><h3 style="font-weight:800;text-align:center;margin-bottom:8px">팀 ${teamIdx + 1}</h3><div class="bp-qgrid">${q}</div></div>`;
    }).join('');

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
        details.bp-card>summary::after{content:'▾';font-size:.9rem;color:#9ca3af;transition:transform .2s;margin-left:8px}
        details.bp-card:not([open])>summary{border-bottom:none;padding-bottom:0}
        details.bp-card:not([open])>summary::after{transform:rotate(-90deg)}
        details.bp-card>.bp-body{margin-top:12px}
    </style>
    <div class="bp-wrap">
        <div style="text-align:center;margin:12px 0"><h1 style="font-size:1.8rem;font-weight:800;color:#111827">BareaPlay ⚽</h1><p style="color:#6b7280;margin-top:4px">모임 보드</p></div>
        <div class="bp-card"><h2 class="bp-h2">📅 모임 정보</h2><p style="margin:4px 0"><b>시간:</b> ${esc(timeStr)}</p><p style="margin:4px 0"><b>장소:</b> ${locationHtml}</p></div>
        ${attendHtml}
        <details class="bp-card"><summary>⚖️ 팀 배정</summary><div class="bp-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">${teamHtml}</div></details>
        <details class="bp-card" open><summary>📋 라인업</summary><div class="bp-body">${lineupHtml}</div></details>
        <footer style="text-align:center;padding:16px;color:#9ca3af;font-size:.8rem">© 2025 BareaPlay. Created by 송감독.</footer>
    </div>`;
    const __n = document.createElement('div'); __n.id = 'notification'; document.body.appendChild(__n);
}

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // [중요] 투표/보드 링크는 메인 앱을 그리기 전에 즉시 처리 -> 메인 화면 깜빡임 방지
    {
        const __p = new URLSearchParams(window.location.search);
        const __voteId = __p.get('voteId');
        const __shareId = __p.get('shareId');
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

    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt, voteMgmt, lineupStats };
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
    
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');
    const voteId = urlParams.get('voteId');

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
        Object.assign(pages, { players: document.getElementById('page-players'), balancer: document.getElementById('page-balancer'), lineup: document.getElementById('page-lineup'), accounting: document.getElementById('page-accounting'), share: document.getElementById('page-share'), manual: document.getElementById('page-manual') });
        Object.assign(tabs, { players: document.getElementById('tab-players'), balancer: document.getElementById('tab-balancer'), lineup: document.getElementById('tab-lineup'), accounting: document.getElementById('tab-accounting'), share: document.getElementById('tab-share'), manual: document.getElementById('tab-manual') });
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
                link.href = `${window.location.origin}${window.location.pathname}?shareId=${shareId}`;
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