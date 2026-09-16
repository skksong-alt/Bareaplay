// js/modules/voteManagement.js
// 묶음 C: 참석 투표 (로그인 없이 링크로 참여) + 관리자 확정 → 팀 배정 연결
import { doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { renderVote } from './votePage.js?v=1';

let db, state;
let activeVoteId = null;          // 관리자 화면에서 현재 보고 있는 투표
let respUnsub = null;             // 응답 실시간 구독 해제 함수
let adminResponses = [];          // 관리자 화면용 응답 캐시
let adminVoteInfo = null;         // [추가] 현재 활성 투표의 문서 데이터(마감시각 표시용)

function normName(s) {
    return (s == null ? '' : String(s)).normalize('NFC').trim();
}
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function tsSeconds(t) {
    if (!t) return Infinity;            // 아직 서버시간 미확정이면 맨 뒤로
    if (typeof t.seconds === 'number') return t.seconds;
    return Infinity;
}
function fmtTime(t) {
    const s = tsSeconds(t);
    if (!isFinite(s)) return '-';
    const d = new Date(s * 1000);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// [추가] ms 타임스탬프 → MM/DD HH:MM (투표 마감 시각 표시용)
function fmtMs(ms) {
    const d = new Date(ms);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* =========================================================
   관리자 영역 (모임배포 페이지에 주입)
   ========================================================= */
export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;

    const sharePage = document.getElementById('page-share');
    if (!sharePage) return;

    const box = document.createElement('div');
    box.className = 'bg-white p-6 rounded-2xl shadow-lg mt-8';
    box.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">🗳️ 참석 투표 (관리자용)</h2>
        <div class="space-y-3 max-w-lg mx-auto">
            <div id="vote-link-container" class="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                <p class="text-sm font-bold text-indigo-800 mb-1">📌 회원 공유용 고정 링크</p>
                <p class="text-xs text-gray-500 mb-2">이 주소는 <b>매주 바뀌지 않습니다.</b> 단톡방 공지에 한 번만 등록해두면, 아래에서 새 모임을 시작할 때마다 자동으로 이번 주 투표로 연결됩니다.</p>
                <a id="vote-link-anchor" href="#" target="_blank" class="text-blue-600 break-all hover:underline text-sm"></a>
                <button id="vote-copy-btn" class="mt-2 w-full bg-blue-500 text-white text-sm font-bold py-2 rounded-lg hover:bg-blue-600">고정 링크 복사</button>
            </div>
            <hr class="my-2">
            <p class="text-sm text-gray-500">아래 정보를 입력하고 <b>새 모임 투표 시작</b>을 누르면, 위 고정 링크가 이번 주 투표를 가리킵니다. (지난 투표는 자동으로 보관됩니다)</p>
            <div><label class="block text-sm font-medium">제목(선택)</label><input type="text" id="vote-title" class="mt-1 w-full p-2 border rounded-lg" placeholder="예: 11월 12일 수요일 풋살"></div>
            <div class="grid grid-cols-2 gap-2">
                <div><label class="block text-sm font-medium">날짜</label><input type="date" id="vote-date" class="mt-1 w-full p-2 border rounded-lg"></div>
                <div><label class="block text-sm font-medium">시간</label><input type="time" id="vote-time" class="mt-1 w-full p-2 border rounded-lg" value="20:00"></div>
            </div>
            <div><label class="block text-sm font-medium">장소(선택)</label><input type="text" id="vote-location" class="mt-1 w-full p-2 border rounded-lg" placeholder="예: 두바이 스포츠시티"></div>
            <button id="vote-create-btn" class="w-full bg-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-emerald-700">🆕 새 모임 투표 시작</button>
        </div>
        <div id="vote-status-panel" class="mt-6"></div>
        <div class="mt-8 border-t pt-4">
            <button id="past-votes-toggle" type="button" class="w-full flex items-center justify-between text-left font-bold text-gray-700 hover:text-gray-900">
                <span>📜 지난 투표 기록</span>
                <span id="past-votes-caret" class="text-gray-400">▼</span>
            </button>
            <div id="past-votes-panel" class="mt-3 hidden space-y-2"></div>
        </div>
    `;
    sharePage.appendChild(box);

    // [추가] 지난 투표 기록 토글 + 로드
    const __pastToggle = document.getElementById('past-votes-toggle');
    if (__pastToggle) {
        __pastToggle.addEventListener('click', () => {
            const p = document.getElementById('past-votes-panel');
            const c = document.getElementById('past-votes-caret');
            if (!p) return;
            const willShow = p.classList.contains('hidden');
            p.classList.toggle('hidden');
            if (c) c.textContent = willShow ? '▲' : '▼';
            if (willShow) renderPastVotes();
        });
    }

    const today = new Date();
    const off = today.getTimezoneOffset() * 60000;
    document.getElementById('vote-date').value = new Date(today.getTime() - off).toISOString().split('T')[0];

    document.getElementById('vote-create-btn').addEventListener('click', createVote);

    // 고정 링크는 항상 동일하므로 즉시 표시 (활성 투표 유무와 무관)
    showVoteLink();

    // 마지막으로 활성화된 투표를 자동으로 불러오기 (기기 간 공유)
    onSnapshot(doc(db, "settings", "activeVote"), (snap) => {
        if (snap.exists() && snap.data().voteId) {
            loadAdminVote(snap.data().voteId);
        }
    });
}

async function createVote() {
    if (!state.isAdmin) { window.showNotification('관리자만 투표를 만들 수 있습니다.', 'error'); return; }
    const title = document.getElementById('vote-title').value.trim();
    const date = document.getElementById('vote-date').value;
    const time = document.getElementById('vote-time').value;
    const location = document.getElementById('vote-location').value.trim();
    if (!date) { window.showNotification('날짜를 선택해주세요.', 'error'); return; }

    // [A방식] 진행 중인 투표가 있으면 새로 시작할지 확인 → 지난 투표는 삭제하지 않고 '보관(closed)' 처리
    let prevVoteId = null;
    try {
        const cur = await getDoc(doc(db, "settings", "activeVote"));
        if (cur.exists() && cur.data().voteId) prevVoteId = cur.data().voteId;
    } catch (e) { console.error(e); }
    if (prevVoteId) {
        if (!confirm('새 모임 투표를 시작하면, 현재 진행 중인 투표는 종료되어 지난 기록으로 보관됩니다.\n(고정 링크는 새 투표로 연결됩니다)\n\n계속할까요?')) return;
    }

    // [v55 변경] 투표 자동 마감: 운동 시작 시각 '2시간 전'.
    // 마감 후에도 참석 투표 자체는 가능하지만, 그 사람은 '대기자(waitlist)'로 따로 등록된다.
    let startAtMs = null, deadlineMs = null;
    if (date && time) {
        const t = Date.parse(`${date}T${time}:00`);
        if (!isNaN(t)) { startAtMs = t; deadlineMs = t - 2 * 60 * 60 * 1000; }
    }

    try {
        const ref = await addDoc(collection(db, "votes"), {
            title, date, time, location,
            startAtMs, deadlineMs,      // [추가] 자동 마감 계산용 (구버전 투표에는 없어도 무방)
            closed: false,
            createdAt: serverTimestamp()
        });
        // 지난 투표 보관 처리(데이터는 그대로 남고, 종료 표시만)
        if (prevVoteId) {
            try { await setDoc(doc(db, "votes", prevVoteId), { closed: true, closedAt: serverTimestamp() }, { merge: true }); } catch (e) { console.error('이전 투표 보관 실패:', e); }
        }
        await setDoc(doc(db, "settings", "activeVote"), { voteId: ref.id });
        window.showNotification('새 모임 투표가 시작되었습니다! 고정 링크가 이번 주 투표로 연결됩니다.');
        showVoteLink();
        loadAdminVote(ref.id);
    } catch (e) {
        console.error(e);
        window.showNotification('투표 생성 실패: ' + e.message, 'error');
    }
}

function voteUrl() {
    // [고정 링크] 항상 동일한 주소(?vote=current). 이 링크가 "현재 진행 중인 투표"를 자동으로 가리킨다.
    // → 매주 새 투표를 만들어도 회원에게 공유하는 링크는 바뀌지 않는다.
    return `${window.location.origin}${window.location.pathname}?vote=current`;
}

function showVoteLink() {
    const c = document.getElementById('vote-link-container');
    const a = document.getElementById('vote-link-anchor');
    if (!c || !a) return;
    a.href = voteUrl();
    a.textContent = voteUrl();
    c.classList.remove('hidden');
    const copyBtn = document.getElementById('vote-copy-btn');
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(voteUrl())
            .then(() => window.showNotification('고정 링크가 복사되었습니다.'))
            .catch(() => window.showNotification('복사 실패. 링크를 길게 눌러 복사하세요.', 'error'));
    };
}

function loadAdminVote(voteId) {
    if (activeVoteId === voteId && respUnsub) { showVoteLink(); return; }
    activeVoteId = voteId;
    showVoteLink();
    // [추가] 투표 문서(마감시각 포함)도 불러와 관리자 화면에 표시
    adminVoteInfo = null;
    getDoc(doc(db, "votes", voteId)).then(s => {
        adminVoteInfo = s.exists() ? s.data() : null;
        renderAdminStatus();
    }).catch(() => {});
    if (respUnsub) respUnsub();
    respUnsub = onSnapshot(collection(db, "votes", voteId, "responses"), (snap) => {
        adminResponses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminStatus();
    });
}

function renderAdminStatus() {
    const panel = document.getElementById('vote-status-panel');
    if (!panel) return;

    // [v55] 참석자를 정규 참석 / 대기자(마감 후 참석)로 분리. 각각 투표순(선착순) 정렬.
    const attendAll = adminResponses.filter(r => r.status === 'attend')
        .sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
    const attend = attendAll.filter(r => !r.waitlist);
    const waitlist = attendAll.filter(r => !!r.waitlist);
    const maybe = adminResponses.filter(r => r.status === 'maybe')
        .sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));
    const absent = adminResponses.filter(r => r.status === 'absent')
        .sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));

    const attendRows = attend.map((r, i) => `
        <li class="flex items-center justify-between py-1.5 border-b">
            <span><span class="text-gray-400 mr-2">${i + 1}</span><b>${esc(r.name)}</b>${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}
                <span class="text-xs text-gray-400 ml-2">투표 ${fmtTime(r.attendingSince)}</span></span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-to-maybe text-xs text-amber-600 hover:underline">미정</button>
                <button data-id="${esc(r.id)}" class="vote-to-absent text-xs text-yellow-600 hover:underline">불참</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    // [v55] 대기자 목록: 마감 후 참석 투표자. 선착순 번호. '참석 확정' 버튼으로 정규 참석 전환 가능.
    const waitRows = waitlist.map((r, i) => `
        <li class="flex items-center justify-between py-1.5 border-b text-orange-700">
            <span><span class="text-gray-400 mr-2">${i + 1}</span><b>${esc(r.name)}</b>${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}
                <span class="text-xs text-gray-400 ml-2">투표 ${fmtTime(r.attendingSince)}</span></span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-confirm text-xs text-green-600 hover:underline">참석 확정</button>
                <button data-id="${esc(r.id)}" class="vote-to-absent text-xs text-yellow-600 hover:underline">불참</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    const maybeRows = maybe.map(r => `
        <li class="flex items-center justify-between py-1.5 border-b text-amber-700">
            <span>${esc(r.name)}${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}</span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-to-attend text-xs text-green-600 hover:underline">참석</button>
                <button data-id="${esc(r.id)}" class="vote-to-absent text-xs text-yellow-600 hover:underline">불참</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    const absentRows = absent.map(r => `
        <li class="flex items-center justify-between py-1.5 border-b text-gray-500">
            <span>${esc(r.name)}${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}</span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-to-attend text-xs text-green-600 hover:underline">참석</button>
                <button data-id="${esc(r.id)}" class="vote-to-maybe text-xs text-amber-600 hover:underline">미정</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    panel.innerHTML = `
        <div class="border-t pt-4">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-xl font-bold">투표 현황 <span class="text-green-600">참석 ${attend.length}</span>${waitlist.length ? ` / <span class="text-orange-600">대기 ${waitlist.length}</span>` : ''} / <span class="text-amber-600">미정 ${maybe.length}</span> / <span class="text-gray-400">불참 ${absent.length}</span></h3>
                <button id="vote-to-balancer" class="bg-indigo-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">이 투표로 팀 짜기 →</button>
            </div>
            ${adminVoteInfo && adminVoteInfo.deadlineMs ? `<p class="text-xs font-bold mb-1 ${Date.now() > adminVoteInfo.deadlineMs ? 'text-red-500' : 'text-emerald-600'}">⏰ 자동 마감: ${fmtMs(adminVoteInfo.deadlineMs)} — 경기 시작 2시간 전${Date.now() > adminVoteInfo.deadlineMs ? ' · 마감됨 (이후 참석 투표는 대기자로 등록됩니다)' : ''}</p>` : ''}
            <p class="text-xs text-gray-400 mb-2">※ 참석자는 투표가 늦은 사람일수록 아래쪽에 있으며, 팀 배정 후 아래(늦은 투표)부터 휴식·키퍼를 맡습니다. (미정은 팀 배정에 포함되지 않습니다)</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><p class="font-semibold text-green-700 mb-1">✅ 참석 (투표순)</p><ul class="text-sm">${attendRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul>
                    ${waitlist.length ? `<p class="font-semibold text-orange-600 mt-3 mb-1">⏳ 대기자 (마감 후 참석 · 선착순)</p><ul class="text-sm">${waitRows}</ul>` : ''}</div>
                <div><p class="font-semibold text-amber-700 mb-1">🤔 미정</p><ul class="text-sm">${maybeRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul></div>
                <div><p class="font-semibold text-gray-600 mb-1">❌ 불참</p><ul class="text-sm">${absentRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul></div>
            </div>
            <div class="mt-4 flex space-x-2">
                <input type="text" id="vote-admin-add-name" class="flex-grow p-2 border rounded-lg text-sm" placeholder="명단에 없는 사람 직접 추가">
                <button id="vote-admin-add-btn" class="bg-emerald-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-emerald-700">참석 추가</button>
            </div>
        </div>`;

    panel.querySelectorAll('.vote-to-absent').forEach(b => b.onclick = () => adminSetStatus(b.dataset.id, 'absent'));
    panel.querySelectorAll('.vote-to-attend').forEach(b => b.onclick = () => adminSetStatus(b.dataset.id, 'attend'));
    panel.querySelectorAll('.vote-to-maybe').forEach(b => b.onclick = () => adminSetStatus(b.dataset.id, 'maybe'));
    panel.querySelectorAll('.vote-del').forEach(b => b.onclick = () => adminDelete(b.dataset.id));
    panel.querySelectorAll('.vote-confirm').forEach(b => b.onclick = () => adminConfirmWaitlist(b.dataset.id)); // [v55] 대기자 → 정규 참석
    const addBtn = document.getElementById('vote-admin-add-btn');
    if (addBtn) addBtn.onclick = adminAdd;
    const balBtn = document.getElementById('vote-to-balancer');
    if (balBtn) balBtn.onclick = sendToBalancer;
}

async function adminSetStatus(respId, status) {
    if (!state.isAdmin || !activeVoteId) return;
    const ref = doc(db, "votes", activeVoteId, "responses", respId);
    const payload = { status, updatedAt: serverTimestamp() };
    if (status === 'attend') payload.attendingSince = serverTimestamp(); // 참석 처리 시각 갱신
    payload.waitlist = false; // [v55] 관리자가 상태를 바꾸면 대기 표시는 해제 (관리자 결정 = 확정)
    await setDoc(ref, payload, { merge: true });
}

// [v55] 대기자 → 정규 참석 확정 (투표 시각은 그대로 보존 → 휴식 순번 형평성 유지)
async function adminConfirmWaitlist(respId) {
    if (!state.isAdmin || !activeVoteId) return;
    await setDoc(doc(db, "votes", activeVoteId, "responses", respId), { waitlist: false, updatedAt: serverTimestamp() }, { merge: true });
    window.showNotification('대기자를 참석으로 확정했습니다.');
}

async function adminDelete(respId) {
    if (!state.isAdmin || !activeVoteId) return;
    if (!confirm('이 응답을 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, "votes", activeVoteId, "responses", respId));
}

async function adminAdd() {
    if (!state.isAdmin || !activeVoteId) return;
    const input = document.getElementById('vote-admin-add-name');
    const name = normName(input.value);
    if (!name) return;
    const known = !!state.playerDB[name] || Object.keys(state.playerDB).some(k => normName(k) === name);
    await setDoc(doc(db, "votes", activeVoteId, "responses", name), {
        name, status: 'attend', guest: !known,
        attendingSince: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    input.value = '';
    window.showNotification(`${name} 참석 추가됨`);
}

function sendToBalancer() {
    const attendAll = adminResponses.filter(r => r.status === 'attend')
        .sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
    const attend = attendAll.filter(r => !r.waitlist);
    const waitlist = attendAll.filter(r => !!r.waitlist);
    if (attendAll.length === 0) { window.showNotification('참석자가 없습니다.', 'error'); return; }
    // 투표가 이른 사람이 위, 늦은 사람이 아래 → 아래(늦은 투표)부터 휴식·키퍼
    let names = attend.map(r => r.name);
    // [v55] 대기자가 있으면 포함 여부를 확인. 포함 시 명단 맨 아래(선착순)로 붙는다 → 휴식·키퍼 우선.
    if (waitlist.length > 0) {
        const inc = confirm(`대기자가 ${waitlist.length}명 있습니다. 대기자까지 함께 불러올까요?\n\n[확인] 참석 ${attend.length}명 + 대기 ${waitlist.length}명\n[취소] 참석 ${attend.length}명만`);
        if (inc) names = names.concat(waitlist.map(r => r.name));
    }
    if (names.length === 0) { window.showNotification('불러올 참석자가 없습니다. (대기자만 있는 경우 대기자를 포함하거나 참석 확정하세요)', 'error'); return; }
    const textarea = document.getElementById('attendees');
    if (textarea) textarea.value = names.join('\n');
    const balTab = document.getElementById('tab-balancer');
    if (balTab) balTab.click();
    window.showNotification(`참석자 ${names.length}명을 팀 배정기로 가져왔습니다. (투표순 정렬됨)`);
}

/* =========================================================
   공개 투표 페이지 (로그인 없이 ?voteId=... 로 진입)
   ========================================================= */
// [고정 링크] ?vote=current 진입 시: 현재 활성 투표(settings/activeVote)를 찾아 자동으로 렌더
// [추가] 지난 투표 기록 목록 렌더 (votes 컬렉션에서 종료(closed)된 투표를 날짜 내림차순으로)
async function renderPastVotes() {
    const panel = document.getElementById('past-votes-panel');
    if (!panel) return;
    panel.innerHTML = '<p class="text-sm text-gray-400">불러오는 중...</p>';
    try {
        const snap = await getDocs(collection(db, "votes"));
        let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // 현재 진행 중(활성) 투표는 제외, 종료된 것만
        list = list.filter(v => v.id !== activeVoteId && v.closed === true);
        // 날짜(date) → 없으면 생성시각 기준 내림차순
        const keyOf = (v) => (v.date ? Date.parse(v.date + 'T00:00:00') : tsSeconds(v.createdAt) * 1000) || 0;
        list.sort((a, b) => keyOf(b) - keyOf(a));
        if (list.length === 0) {
            panel.innerHTML = '<p class="text-sm text-gray-400">보관된 지난 투표가 없습니다.</p>';
            return;
        }
        panel.innerHTML = list.map(v => {
            const label = esc(v.title || v.date || '(제목 없음)');
            const sub = esc([v.date, v.time, v.location].filter(Boolean).join(' · '));
            // [v58] 목록 오른쪽에 🗑 삭제 버튼 (관리자 전용) — 투표 문서 + responses 하위 문서를 함께 삭제
            const delBtn = state && state.isAdmin
                ? `<button type="button" data-vote-del="${esc(v.id)}" data-vote-label="${label}" class="past-vote-del-btn flex-shrink-0 text-red-400 hover:text-red-600 px-3 py-2" title="이 투표를 영구 삭제">🗑</button>`
                : '';
            return `<div class="border rounded-lg">
                <div class="flex items-center">
                    <button type="button" data-vote="${esc(v.id)}" class="past-vote-item flex-grow min-w-0 text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center">
                        <span class="font-semibold text-gray-700 truncate">${label}</span>
                        <span class="text-xs text-gray-400 flex-shrink-0 ml-2">${sub} ▾</span>
                    </button>
                    ${delBtn}
                </div>
                <div id="past-detail-${esc(v.id)}" class="hidden px-3 pb-3"></div>
            </div>`;
        }).join('');
        panel.querySelectorAll('.past-vote-item').forEach(btn => {
            btn.addEventListener('click', () => togglePastVoteDetail(btn.getAttribute('data-vote')));
        });
        // [v58] 지난 투표 삭제
        panel.querySelectorAll('.past-vote-del-btn').forEach(btn => {
            btn.addEventListener('click', () => deletePastVote(btn.getAttribute('data-vote-del'), btn.getAttribute('data-vote-label')));
        });
    } catch (e) {
        console.error('지난 투표 로드 실패:', e);
        panel.innerHTML = '<p class="text-sm text-red-500">불러오기에 실패했습니다.</p>';
    }
}

// [v58 추가] 🗑 지난 투표 영구 삭제 (관리자 전용)
//   Firestore는 문서를 지워도 하위 컬렉션이 자동 삭제되지 않으므로,
//   responses 하위 문서를 먼저 전부 지운 뒤 투표 문서를 삭제한다.
//   진행 중(활성) 투표는 목록에 표시되지 않아 삭제 대상에서 원천 제외된다.
async function deletePastVote(voteId, label) {
    if (!state || !state.isAdmin) { window.showNotification('관리자만 삭제할 수 있습니다.', 'error'); return; }
    if (!voteId) return;
    if (voteId === activeVoteId) { window.showNotification('진행 중인 투표는 삭제할 수 없습니다.', 'error'); return; }
    let respDocs = [];
    try {
        const snap = await getDocs(collection(db, "votes", voteId, "responses"));
        respDocs = snap.docs;
    } catch (e) { console.error('응답 조회 실패:', e); }
    if (!confirm(`'${label || '(제목 없음)'}' 투표와 응답 ${respDocs.length}건을 영구 삭제합니다.\n(되돌릴 수 없습니다)\n\n계속할까요?`)) return;
    try {
        // 하위 responses 먼저 삭제 (100건씩 나눠 실행)
        for (let i = 0; i < respDocs.length; i += 100) {
            await Promise.all(respDocs.slice(i, i + 100).map(d => deleteDoc(d.ref)));
        }
        await deleteDoc(doc(db, "votes", voteId));
        window.showNotification('지난 투표가 삭제되었습니다.');
        renderPastVotes();
    } catch (e) {
        console.error('투표 삭제 실패:', e);
        window.showNotification('삭제 실패: ' + e.message + ' (Firestore의 votes 삭제 권한 확인)', 'error');
    }
}

// [추가] 지난 투표 1건의 참석/미정/불참 명단 표시 (votes/{id}/responses)
async function togglePastVoteDetail(voteId) {
    const box = document.getElementById('past-detail-' + voteId);
    if (!box) return;
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<p class="text-sm text-gray-400">불러오는 중...</p>';
    try {
        const snap = await getDocs(collection(db, "votes", voteId, "responses"));
        const rs = snap.docs.map(d => d.data());
        const group = (st) => rs.filter(r => r.status === st && !r.waitlist).map(r => esc(r.name || '-'));
        const attend = group('attend'), maybe = group('maybe'), absent = group('absent');
        const wait = rs.filter(r => r.status === 'attend' && !!r.waitlist).map(r => esc(r.name || '-')); // [v55]
        const col = (title, names, cls) => `<div>
            <p class="text-xs font-bold ${cls}">${title} (${names.length})</p>
            <p class="text-sm text-gray-600 mt-1">${names.length ? names.join(', ') : '-'}</p>
        </div>`;
        box.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1 bg-gray-50 rounded-lg p-3">
            ${col('✅ 참석', attend, 'text-emerald-600')}
            ${col('🤔 미정', maybe, 'text-amber-600')}
            ${col('❌ 불참', absent, 'text-yellow-700')}
            ${wait.length ? col('⏳ 대기 (마감 후 참석)', wait, 'text-orange-600') : ''}
        </div>`;
    } catch (e) {
        console.error('지난 투표 상세 실패:', e);
        box.innerHTML = '<p class="text-sm text-red-500">상세를 불러오지 못했습니다.</p>';
    }
}

export async function renderCurrentVotePage() {
    db = window.__db || db;
    if (!db) { document.body.innerHTML = `<p style="text-align:center;margin-top:40px">초기화 오류. 새로고침 해주세요.</p>`; return; }
    let voteId = null;
    try {
        const s = await getDoc(doc(db, "settings", "activeVote"));
        if (s.exists() && s.data().voteId) voteId = s.data().voteId;
    } catch (e) { console.error(e); }
    if (!voteId) return renderVote(db, null);
    return renderVotePage(voteId);
}

export async function renderVotePage(voteId) {
    return renderVote(window.__db || db, voteId);
}
