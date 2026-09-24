// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { state, setAdmin } from './store.js?v=3';
let playerMgmt, balancer, lineup, accounting, shareMgmt, voteMgmt, lineupStats, coachWorkspace, adminWorkflow;
import { createMeetingSession, meetingFingerprint, meetingConflict } from './modules/meetingSession.js?v=1';
import { ensureLibrary } from './modules/optionalLibraries.js?v=1';
import { roleTip } from './modules/coachCore.js?v=2';
let matchRecord;
import { sharedRefereesFromLineups } from './modules/dutyRotation.js?v=3';

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

let meetingLoading = false, applyingMeeting = false, writeSequence = 0;
const meetingSession = createMeetingSession({
    changed: info => {
        state.meetingSave = info;
        document.dispatchEvent(new CustomEvent('barea:save'));
    },
    commit: async (date, payload, expected) => {
        if (!state.isAdmin) throw new Error('관리자 로그인이 필요합니다.');
        const ref = doc(db, 'dailyMeetings', date);
        const next = await runTransaction(db, async tx => {
            const snap = await tx.get(ref), current = snap.exists() ? snap.data() : null;
            if (meetingFingerprint(current) !== meetingFingerprint(expected)) throw meetingConflict();
            // Replace known team maps, but retain unknown top-level legacy fields.
            const value = {...current, ...payload, lastWriter: `${CLIENT_ID}:${++writeSequence}`, lastUpdatedAt: serverTimestamp()};
            tx.set(ref, value);return value;
        });
        return next;
    }
});
window.flushMeetingSave = () => meetingSession.flush();
window.hasUnsavedMeeting = () => meetingSession.dirty || !!window.hasUnsavedAccounting?.();
window.addEventListener('beforeunload', event => {
    if (window.hasUnsavedMeeting()) {event.preventDefault();event.returnValue = '';}
});
function saveDailyMeetingData() {
    if (!state.isAdmin || applyingMeeting) return;
    const today = selectedMeetingDate;
    if (meetingLoading || !today || meetingSession.date !== today) {
        window.showNotification('경기 정보를 불러오는 중입니다. 완료 후 수정해 주세요.', 'error');return;
    }

    const teamsObject = {};
    (state.teams || []).forEach((team, index) => {
        teamsObject[`team_${index}`] = team;
    });

    const transformedCache = {};
    // Do not silently rewrite historical referee records during an unrelated edit.
    const sharedReferees = today >= window.getLocalDate()
        ? sharedRefereesFromLineups(state.teamLineupCache || {}, state.initialAttendeeOrder || [],state.quarterCount===4?4:6) : [];
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
        quarterCount: state.quarterCount===4?4:6,
        teams: teamsObject,
        teamLineupCache: transformedCache,
        initialAttendeeOrder: state.initialAttendeeOrder || [],
        teamNames: state.teamNames || [], // [v58] 🏷️ 팀 이름(Team A/B 또는 커스텀)도 날짜별 저장
        aceNames: state.aceNames || [], // [A방식] 에이스 명단도 날짜별로 함께 저장
        pinTogether: state.pinTogether || [], // [추가] 🧲 같은 팀 묶기 지정 (날짜별 저장)
        pinApart: state.pinApart || [],       // [추가] 🚧 다른 팀 나누기 지정
    };
    meetingSession.schedule(dataToSave);
}

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
    state.quarterCount=data?.quarterCount===4?4:6;
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
    const input = document.getElementById('balancer-date');
    if (meetingLoading) {if(input)input.value=selectedMeetingDate||'';return false;}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    meetingLoading = true;
    const pages = ['page-balancer','page-lineup'].map(id=>document.getElementById(id)).filter(Boolean);
    pages.forEach(p=>p.inert=true);
    state.meetingLoading=true;document.dispatchEvent(new CustomEvent('barea:save'));
    try {
        await meetingSession.flush();
        const meetingDocRef=doc(db,'dailyMeetings',date),snap=await getDoc(meetingDocRef);
        if(snap.metadata?.fromCache)throw new Error('서버에 연결한 후 경기 날짜를 변경해 주세요.');
        if(meetingUnsub){meetingUnsub();meetingUnsub=null;}
        selectedMeetingDate=date;state.meetingDate=date;if(input)input.value=date;
        meetingSession.load(date,snap.exists()?snap.data():null);
        applyingMeeting=true;
        try {applyMeetingData(snap.exists()?snap.data():null);} finally {applyingMeeting=false;}
        document.dispatchEvent(new CustomEvent('barea:meeting'));
        meetingUnsub=onSnapshot(meetingDocRef,docSnap=>{
            if(selectedMeetingDate!==date || docSnap.metadata.hasPendingWrites || docSnap.metadata.fromCache)return;
            const data=docSnap.exists()?docSnap.data():null;
            if(!meetingSession.acceptRemote(data))return;
            applyingMeeting=true;try {applyMeetingData(data);} finally {applyingMeeting=false;}
            window.showNotification('다른 기기 내용이 동기화되었습니다.');
        },()=>window.showNotification('실시간 연결이 끊겼습니다. 저장 상태를 확인해 주세요.','error'));
        return true;
    } catch (error) {
        if(input)input.value=selectedMeetingDate||'';
        window.showNotification(error.code==='meeting-conflict'?error.message:'저장 또는 경기 불러오기에 실패했습니다. 현재 편집을 유지했습니다. 연결·저장 상태를 확인해 주세요.','error');
        return false;
    } finally {
        meetingLoading=false;state.meetingLoading=false;pages.forEach(p=>p.inert=false);
        document.dispatchEvent(new CustomEvent('barea:save'));
    }
}
window.changeMeetingDate = changeMeetingDate;
window.reloadMeeting = async () => {
    if (meetingLoading) return;
    if (meetingSession.dirty && !confirm('현재 기기의 미저장 편집을 버리고 서버에 저장된 경기로 다시 불러올까요? 서버 데이터는 변경하지 않습니다.')) return;
    try {meetingSession.discard();await changeMeetingDate(selectedMeetingDate||window.getLocalDate());}
    catch {window.showNotification('저장 중입니다. 잠시 후 다시 시도하세요.','error');}
};

function updateUIAccess() {
    const isViewOnly = !state.isAdmin;
    document.getElementById('page-balancer').classList.toggle('view-only', isViewOnly);
    document.getElementById('page-lineup').classList.toggle('view-only', isViewOnly);
}

function loadPlayerDB() {
    try {
        const cached=JSON.parse(localStorage.getItem('playerDB')||'null');
        if(cached && typeof cached==='object' && !Array.isArray(cached))state.playerDB=cached;
    } catch { /* Broken/unavailable local cache must not block the server read. */ }
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

    uploader.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {await ensureLibrary('XLSX');}catch(error){window.showNotification(error.message,'error');return;}
        if(!state.isAdmin || uploader.files[0]!==file)return;

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
    document.dispatchEvent(new Event('barea:admin'));
}

window.promptForAdminPassword = function() {
    if (state.isAdmin) {
        window.showNotification('이미 관리자 권한으로 로그인되어 있습니다.');
        return;
    }
    adminModal.classList.remove('hidden');
}

function renderManual() {
    const el=document.getElementById('page-manual');if(!el)return;
    el.innerHTML=`<article class="operator-guide">
      <p class="coach-eyebrow">감독 인수인계 가이드</p><h2>한 경기 운영은 이 순서로</h2>
      <p>참석 신청, 실제 출석·회비, 팀원에게 공개한 결과는 서로 다른 기록입니다. 새 감독도 아래 순서대로 진행하면 됩니다.</p>
      <ol>
        <li><h3>참석·모임정보</h3><p>경기 날짜·시각·구장을 확인하고 참석 투표를 만들어 공유합니다. 경기 2시간 전 마감 이후 신청은 대기입니다. 참석자를 가져오면 해당 경기 날짜로 이동합니다.</p></li>
        <li><h3>팀 배정</h3><p>상단의 작업 날짜를 확인합니다. 기존 자동 배정 또는 직접 입력을 사용하세요. 8주 고정팀 운영 시 계획과 당일 결원 보충을 먼저 미리보기하고, 명단을 확인한 후 적용합니다. 당일 차출로 원소속은 바뀌지 않습니다.</p></li>
        <li><h3>4·6쿼터 라인업</h3><p>팀·9/10/11인제·포메이션을 고르고 6쿼터(기본) 또는 4쿼터를 선택해 생성한 뒤 전체 쿼터를 한눈에 보며 수정합니다. 이미 만든 결과를 유지하려면 다시 생성하지 마세요. 심판은 양 팀 공동 순번, 키퍼·휴식은 팀별 늦은 참석 신청순으로 순환합니다. 전담 GK는 예외입니다.</p><p>고정팀 훈련 포지션은 별도로 켠 후 새로 생성할 때만 우선합니다. 수동 고정·의무 순번과 인원 조건이 먼저이며 모든 희망 자리를 보장하지는 않습니다. 날짜 전환·새로고침 후에는 다시 선택하세요.</p></li>
        <li><h3>저장 확인 → 팀원에게 공개</h3><p>상단의 ‘저장됨’을 확인한 뒤 라인업·공개 탭 맨 아래에서 확정·공개합니다. 저장과 공개는 별개입니다. 공개 뒤 편집했으면 확인 후 다시 공개해야 합니다. 기존 공유 링크는 당시 결과를 유지합니다.</p><p>공개 페이지의 이미지 버튼으로 팀별 전체 쿼터 PNG를 저장하거나 공유할 수 있습니다. 카카오톡에 파일을 직접 올려 두면 사이트가 안 열리는 팀원도 볼 수 있습니다.</p></li>
        <li><h3>경기 후 기록</h3><p>출석·회계에서 실제 출석과 납부를 확인합니다. 참석 투표를 했다고 회비 납부나 실제 출석이 기록되는 것은 아닙니다. 경기기록에서 스코어를 남기고, 선수 능력치는 승패로 자동 변경하지 않습니다.</p></li>
      </ol>
      <details><summary>8주 고정팀과 비공개 희망 포지션</summary><p>선수 관리에서 응답·수요를 확인합니다. 두 지망이 같으면 한 자리 집중 희망, 다르면 두 역할을 배우고 싶은 뜻입니다. 비공개 설문은 지정된 감독 계정만 전체 조회할 수 있습니다. 고정팀 도구의 최근 3개월 명단에서 미응답·중복을 확인하고 포지션별 인원과 실력을 나눠 초안을 만드세요. 실제 저장은 권한 적용 후 가능합니다.</p><p>매주 고정팀에서 참석자만 추리고 부족한 팀에 최소한의 차출을 제안합니다. 차출 이유와 미등록 참석자를 확인하세요. 8주가 끝나면 새 계획을 만들며, 이전 계획·선수 평가·설문을 자동 변경하지 않습니다.</p></details>
      <details><summary>필요할 때만 쓰는 고급 도구</summary><p>감독 보드의 최근 이력·부분 재배정·고정 조건은 선택 도구입니다. 단순 수동 편집에는 필요하지 않습니다. 이력은 실제 출전시간이 아닌 저장된 배정 기록입니다. 영상·15분 연습 자료는 참석·모임정보에서 날짜별로 편집합니다.</p></details>
      <details><summary>저장 실패·충돌·접속 지연</summary><p>저장 실패나 충돌이 보이면 창을 닫지 마세요. 연결 문제는 ‘저장 다시 시도’, 다른 기기와 충돌했다면 현재 작업을 확인한 후 ‘서버 내용 다시 불러오기’를 선택합니다. 다시 불러올 때 미저장 편집을 버릴지 묻습니다. 다른 기기의 결과를 자동 덮어쓰지 않습니다.</p><p>접속이 오래 걸리면 네트워크를 바꾸거나 카카오톡 밖의 브라우저로 열어 보세요. 활약투표에서 한도 오류가 나면 재투표를 반복하지 말고 운영자에게 알려 주세요. 선택 원본을 공개하거나 권한을 완화해서 해결하면 안 됩니다.</p></details>
      <details><summary>삭제·엑셀 업로드와 감독 계정 인계</summary><p>선수 엑셀 업로드는 기존 선수 목록을 통째로 교체하는 기능입니다. 일반적인 수정에는 개별 선수 편집을 사용하세요. 출석 체크 저장은 이제 추가만 합니다. 체크 해제·중복 기록은 삭제하지 않습니다. 행별 삭제·범위 삭제·지난 투표 삭제는 여전히 영구 삭제이므로 확인과 별도 승인이 필요합니다.</p><p>새 감독에게 관리자 권한을 주는 것과 비공개 설문 전체 조회 권한을 주는 것은 별도입니다. 계정을 공유하지 말고 소유자의 승인 아래 인계하세요. Firebase 설정·Rules·배포는 저장소 운영 문서를 기준으로 별도 승인 후 진행합니다.</p></details>
      <details><summary>경기 인원·4/6쿼터를 바꿀 때</summary><p>9인제는 3-4-1, 10인제는 3-4-2, 11인제는 포메이션을 선택합니다. 인원 수와 쿼터 수는 다릅니다. 4쿼터로 바꾸면 보관된 5·6쿼터는 공개·집계에 포함되지 않습니다. 다시 6쿼터로 바꾼 뒤 명단·포메이션·빈자리를 확인하고 공개하세요. 쿼터 선택만으로 필드 배치를 다시 만들지 않습니다.</p><p>팀별 탭에서 모든 쿼터를 보며 선수를 이동합니다. ‘라인업 생성’은 해당 팀의 배치를 다시 만들므로 수동으로 완성한 뒤에는 누르지 마세요. 마지막으로 양 팀 심판·키퍼·휴식을 함께 확인합니다.</p></details>
      <details><summary>현장 출석·수금: 한 명씩 눌러도 저장되나요?</summary><p>참석 투표를 실제 출석으로 간주하지 마세요. 경기 날짜와 실제 도착자를 확인해 출석에 추가한 뒤 수금 체크를 사용합니다. 완납은 정해진 회비를 자동 채우고, 일부 납부는 실제 받은 금액과 납부방식을 입력합니다. 일부 납부자는 미수금 목록에 계속 남습니다.</p><p>일반·학생·운영진 구분과 천연잔디 여부를 먼저 확인하세요. 기록을 추가한 뒤 선수의 회비유형을 바꾸어도 과거 금액을 일괄 변경하지 않습니다. 비고는 해당 날짜 기록과 다음 모임용 선수 비고에 각각 저장됩니다. 과거 비고를 자동 고치지 않습니다.</p><p>회계 상단의 ‘모든 변경 저장됨’을 확인합니다. 실패 시 창을 닫지 않고 ‘다시 저장’을 누르세요. 입력은 기기 메모리에만 남아 있으므로 새로고침하면 잃을 수 있습니다. 불참 처리는 단순 체크 해제가 아니라 해당 날짜의 실제 기록을 검토해 결정하세요.</p></details>
      <details><summary>새 감독에게 인계: 앱 권한과 서비스 소유권은 다릅니다</summary><p><b>비밀번호를 넘기지 말고 새 감독 본인 계정을 초대하세요.</b> ① 앱 운영자 권한 ② 비공개 포지션 설문 전체 조회 권한 ③ Firebase/Google Cloud 운영·청구 권한 ④ GitHub 저장소 권한 ⑤ Vercel 프로젝트 권한을 각각 확인해야 합니다.</p><p>Firebase는 기존 프로젝트의 담당자를 인계하는 것이 기본입니다. 새 프로젝트로 데이터를 옮기는 작업은 필요하지 않습니다. 기존 담당자는 새 담당자의 접근과 비용 책임이 확인될 때까지 남아 있어야 합니다. 앱 관리자 등록만으로 Firebase Console 권한이나 비공개 설문 권한이 생기지는 않습니다.</p><p>GitHub·Vercel은 먼저 공동 접근을 설정하고, 소유권을 실제로 옮길 필요가 있을 때 별도 승인 후 이전하세요. 저장소 이름·연결·운영 브랜치 master·도메인·배포 설정을 확인합니다. Vercel 팀을 바꾸면 Firebase 서버 연결에 사용 중인 OIDC 신뢰 조건도 재검토해야 합니다. 설정값과 토큰은 카톡이나 문서에 붙이지 마세요.</p><p>상세 체크리스트는 저장소 <b>docs/HANDOVER.md</b>에 있습니다. 새 담당자 확인 → 승인된 변경 → 운영 읽기 확인 → 기존 담당자 권한 정리 순서를 지킵니다. 코드를 이전 배포로 돌려도 이미 저장된 운영 데이터가 자동 복구되지는 않습니다.</p></details>
    </article>`;
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
        rateSub: '동료의 좋은 플레이를 기억하고 응원하는 투표입니다. 결과는 선수 능력치를 자동 변경하지 않습니다.',
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
        rateSub: "Recognise and encourage your teammates. Results do not automatically change player skills.",
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
        for (let i = 0; i < (shareData.quarterCount===4?4:6); i++) q += pitchHTML(lu, i, teamIdx);
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
            <div class="match-brand"><span class="match-crest" aria-hidden="true">B</span><div><strong>BareaPlay</strong><small>DUBAI · FOOTBALL CLUB</small></div></div>
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
    // Local export of the published snapshot only; load the renderer on demand.
    const imageHost=document.createElement('div');
    const exportButton=document.createElement('button');exportButton.type='button';
    exportButton.textContent=__bpLang==='en'?'Save / share lineup image':'라인업 이미지 저장·공유';
    exportButton.style.cssText='padding:12px 16px;border:1px solid #b6cabc;border-radius:8px;background:#17664d;color:white;font-weight:700;margin:8px 0';
    exportButton.id='bp-image-open';imageHost.append(exportButton);
    document.querySelector('.bp-wrap > footer').before(imageHost);
    exportButton.onclick=async()=>{
        exportButton.disabled=true;
        try{const {mountLineupImage}=await import('./modules/lineupImage.js?v=2');
            if(!imageHost.isConnected)return;
            mountLineupImage(imageHost,shareData,POS_MAP,__bpLang==='en');exportButton.remove();
        }catch{exportButton.disabled=false;exportButton.textContent=__bpLang==='en'?'Retry image tools':'이미지 도구 다시 불러오기';}
    };
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
            const visibleCount=Math.min(shareData.quarterCount===4?4:6,snap.data().quarterCount===4?4:6);
            const rows = Object.keys(qs).filter(k=>Number(k.replace('q_',''))<visibleCount).sort().map(k => {
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
            const {renderPositionSurvey}=await import('./modules/positionPreferences.js?v=6');
            await renderPositionSurvey(db,auth);window.bareaBootReady?.();return;
        }
        const __voteId = __p.get('voteId');
        const __shareId = __p.get('shareId');
        const __voteCurrent = __p.get('vote'); // 고정 링크 ?vote=current
        if (__voteCurrent || __voteId) voteMgmt=await import('./modules/voteManagement.js?v=24');
        if (__voteCurrent) {
            window.__db = db;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            await voteMgmt.renderCurrentVotePage();
            window.bareaBootReady?.();
            return;
        }
        if (__voteId) {
            window.__db = db;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            await voteMgmt.renderVotePage(__voteId);
            window.bareaBootReady?.();
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
                window.bareaBootReady?.();
            }
            return;
        }
    }

    [playerMgmt,balancer,lineup,accounting,shareMgmt,voteMgmt,lineupStats,matchRecord,coachWorkspace,adminWorkflow]=await Promise.all([
        import('./modules/playerManagement.js?v=6'),import('./modules/teamBalancer.js?v=11'),
        import('./modules/lineupGenerator.js?v=12'),import('./modules/accounting.js?v=9'),
        import('./modules/shareManagement.js?v=13'),import('./modules/voteManagement.js?v=24'),
        import('./modules/lineupStats.js?v=3'),import('./modules/matchRecord.js?v=3'),
        import('./modules/coachWorkspace.js?v=6'),import('./modules/adminWorkflow.js?v=3')
    ]);
    const modules = { playerMgmt, balancer, lineup, accounting, shareMgmt, voteMgmt, lineupStats, matchRecord, coachWorkspace, adminWorkflow };
    const dependencies = { db, state, auth };
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
    const {mountPreferenceAdmin}=await import('./modules/positionPreferences.js?v=6');
    mountPreferenceAdmin(db,state);
    // Do not add the cycle-planning bundle to public RSVP, survey or lineup loads.
    try { const cycles=await import('./modules/teamCycles.js?v=3');cycles.init(dependencies); }
    catch { window.showNotification('고정팀 도구를 불러오지 못했습니다. 기존 팀 배정은 계속 사용할 수 있습니다.','error'); }
    
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
            // One subscription per ledger, not getDocs followed by the same full read.
            state.accountingReady=false;state.playersReady=false;state.attendanceReady=false;pages.accounting.inert=true;
            const ledgerStatus=document.createElement('p');ledgerStatus.id='ledger-load-status';
            ledgerStatus.setAttribute('role','status');ledgerStatus.textContent='출석·회계 자료를 불러오는 중입니다. 완료 전에는 편집할 수 없습니다.';
            pages.accounting.prepend(ledgerStatus);
            const ready=new Set();
            const markReady=(key,snapshot)=>{
                if(snapshot.metadata?.fromCache){ledgerFailed(key);return;}
                if(key==='players')state.playersReady=true;
                if(key==='attendance')state.attendanceReady=true;
                ready.add(key);
                if(ready.size===4 && !state.accountingReady){state.accountingReady=true;pages.accounting.inert=false;ledgerStatus.hidden=true;accounting.renderForDate();}
            };
            const ledgerFailed=key=>{ready.delete(key);if(key==='players')state.playersReady=false;if(key==='attendance')state.attendanceReady=false;state.accountingReady=false;pages.accounting.inert=true;ledgerStatus.hidden=false;ledgerStatus.textContent='출석·회계 자료를 모두 받지 못해 편집을 막았습니다. 연결·접근 권한을 확인하고 다시 불러와 주세요. 팀·라인업은 별도로 사용할 수 있습니다.';};
            // [실시간 동기화] 선수 DB를 Firestore와 실시간 연결한다.
            // → PC에서 추가/수정/삭제한 선수가 폰 앱에 자동 반영되고, 그 반대도 자동 반영된다.
            //   (기존: localStorage에 캐시가 있으면 Firebase를 다시 안 읽어 신규 선수가 영영 안 보이던 버그 수정)
onSnapshot(collection(db, "players"), {includeMetadataChanges:true}, (snapshot) => {
                const freshDB = {};
                snapshot.forEach(d => { freshDB[d.id] = d.data(); });
                state.playerDB = freshDB;
                try { localStorage.setItem('playerDB', JSON.stringify(freshDB)); } catch (e) {}
                if (playerMgmt) playerMgmt.renderPlayerTable();
                markReady('players',snapshot);
            }, ()=>ledgerFailed('players'));
            // [수정] 회계 화면에서 무언가 입력 중일 때는 표를 다시 그리지 않음 (입력 끊김 방지)
            const isEditingAccounting = () => {
                const el = document.activeElement;
                const accountingPage = document.getElementById('page-accounting');
                return el && accountingPage && accountingPage.contains(el) &&
                    (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
            };
            onSnapshot(collection(db, "expenses"), {includeMetadataChanges:true}, (snapshot) => { state.expenseLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); markReady('expenses',snapshot);if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } },()=>ledgerFailed('expenses'));
            // [v58] 기타 수입 실시간 동기화 (오류 시 앱 동작에는 영향 없음)
            onSnapshot(collection(db, "incomes"), {includeMetadataChanges:true}, (snapshot) => { state.extraIncomeLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));markReady('incomes',snapshot); if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } }, ()=>ledgerFailed('incomes'));
            onSnapshot(collection(db, "attendance"), {includeMetadataChanges:true}, (snapshot) => { state.attendanceLog = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));markReady('attendance',snapshot); if(!isEditingAccounting() && pages.accounting && !pages.accounting.classList.contains('hidden')) { accounting.renderForDate(); } if (playerMgmt) playerMgmt.renderPlayerTable(); },()=>ledgerFailed('attendance'));
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
            window.bareaBootReady?.();
        }
    }
});
