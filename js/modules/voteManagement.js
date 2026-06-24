// js/modules/voteManagement.js
// 묶음 C: 참석 투표 (로그인 없이 링크로 참여) + 관리자 확정 → 팀 배정 연결
import { doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state;
let activeVoteId = null;          // 관리자 화면에서 현재 보고 있는 투표
let respUnsub = null;             // 응답 실시간 구독 해제 함수
let adminResponses = [];          // 관리자 화면용 응답 캐시

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

    try {
        const ref = await addDoc(collection(db, "votes"), {
            title, date, time, location,
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
    if (respUnsub) respUnsub();
    respUnsub = onSnapshot(collection(db, "votes", voteId, "responses"), (snap) => {
        adminResponses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminStatus();
    });
}

function renderAdminStatus() {
    const panel = document.getElementById('vote-status-panel');
    if (!panel) return;

    const attend = adminResponses.filter(r => r.status === 'attend')
        .sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
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
                <h3 class="text-xl font-bold">투표 현황 <span class="text-green-600">참석 ${attend.length}</span> / <span class="text-amber-600">미정 ${maybe.length}</span> / <span class="text-gray-400">불참 ${absent.length}</span></h3>
                <button id="vote-to-balancer" class="bg-indigo-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">이 투표로 팀 짜기 →</button>
            </div>
            <p class="text-xs text-gray-400 mb-2">※ 참석자는 투표가 늦은 사람일수록 아래쪽에 있으며, 팀 배정 후 아래(늦은 투표)부터 휴식·키퍼를 맡습니다. (미정은 팀 배정에 포함되지 않습니다)</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><p class="font-semibold text-green-700 mb-1">✅ 참석 (투표순)</p><ul class="text-sm">${attendRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul></div>
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
    await setDoc(ref, payload, { merge: true });
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
    const attend = adminResponses.filter(r => r.status === 'attend')
        .sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
    if (attend.length === 0) { window.showNotification('참석자가 없습니다.', 'error'); return; }
    // 투표가 이른 사람이 위, 늦은 사람이 아래 → 아래(늦은 투표)부터 휴식·키퍼
    const names = attend.map(r => r.name);
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
            return `<div class="border rounded-lg">
                <button type="button" data-vote="${esc(v.id)}" class="past-vote-item w-full text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center">
                    <span class="font-semibold text-gray-700">${label}</span>
                    <span class="text-xs text-gray-400">${sub} ▾</span>
                </button>
                <div id="past-detail-${esc(v.id)}" class="hidden px-3 pb-3"></div>
            </div>`;
        }).join('');
        panel.querySelectorAll('.past-vote-item').forEach(btn => {
            btn.addEventListener('click', () => togglePastVoteDetail(btn.getAttribute('data-vote')));
        });
    } catch (e) {
        console.error('지난 투표 로드 실패:', e);
        panel.innerHTML = '<p class="text-sm text-red-500">불러오기에 실패했습니다.</p>';
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
        const group = (st) => rs.filter(r => r.status === st).map(r => esc(r.name || '-'));
        const attend = group('attend'), maybe = group('maybe'), absent = group('absent');
        const col = (title, names, cls) => `<div>
            <p class="text-xs font-bold ${cls}">${title} (${names.length})</p>
            <p class="text-sm text-gray-600 mt-1">${names.length ? names.join(', ') : '-'}</p>
        </div>`;
        box.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1 bg-gray-50 rounded-lg p-3">
            ${col('✅ 참석', attend, 'text-emerald-600')}
            ${col('🤔 미정', maybe, 'text-amber-600')}
            ${col('❌ 불참', absent, 'text-yellow-700')}
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
    if (!voteId) {
        document.body.className = 'bg-gray-100';
        document.body.innerHTML = `<div style="max-width:480px;margin:60px auto;text-align:center;font-family:'Noto Sans KR',sans-serif"><h1 style="font-size:1.4rem;color:#111827">⚽ Barea 참석 투표</h1><p style="color:#6b7280;margin-top:10px">아직 진행 중인 투표가 없습니다.<br>운영진이 새 모임 투표를 시작하면 이 화면에 표시됩니다.</p></div>`;
        return;
    }
    return renderVotePage(voteId);
}

export async function renderVotePage(voteId) {
    db = window.__db || db;
    if (!db) { document.body.innerHTML = `<p style="text-align:center;margin-top:40px">초기화 오류. 새로고침 해주세요.</p>`; return; }

    let vote = null;
    try { const vs = await getDoc(doc(db, "votes", voteId)); if (vs.exists()) vote = vs.data(); } catch (e) { console.error(e); }
    if (!vote) {
        document.body.innerHTML = `<div style="max-width:480px;margin:60px auto;text-align:center;font-family:'Noto Sans KR',sans-serif"><h1 style="font-size:1.4rem;color:#ef4444">투표를 찾을 수 없습니다</h1><p style="color:#6b7280;margin-top:8px">링크가 만료되었거나 아직 투표가 만들어지지 않았습니다.</p></div>`;
        return;
    }

    let players = [];
    try { const ps = await getDocs(collection(db, "players")); players = ps.docs.map(d => d.data().name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko-KR')); } catch (e) { console.error(e); }
    const playerSet = new Set(players.map(normName));

    const info = [vote.date, vote.time, vote.location].filter(Boolean).join(' · ');
    const headerTitle = vote.title || `${vote.date || ''} 참석 투표`;

    document.body.className = 'bg-gray-100';
    document.body.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:16px;font-family:'Noto Sans KR',sans-serif">
        <div style="text-align:center;margin:16px 0 8px">
            <h1 style="font-size:1.6rem;font-weight:800;color:#111827">⚽ ${esc(headerTitle)}</h1>
            <p style="color:#6b7280;margin-top:6px">${esc(info)}</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
            <label style="display:block;font-weight:700;margin-bottom:6px">이름</label>
            <input id="v-name" list="v-players" autocomplete="off" placeholder="이름을 입력/선택하세요"
                style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;box-sizing:border-box">
            <datalist id="v-players">${players.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
            <p style="color:#9ca3af;font-size:.8rem;margin:6px 0 0">선수 명단에 없는 분은 이름을 그냥 입력한 후 투표해 주세요. (게스트로 등록됩니다)</p>
            <div style="display:flex;gap:8px;margin-top:16px">
                <button id="v-attend" style="flex:1;padding:15px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">참석</button>
                <button id="v-maybe" style="flex:1;padding:15px;border:0;border-radius:12px;background:#f59e0b;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">미정</button>
                <button id="v-absent" style="flex:1;padding:15px;border:0;border-radius:12px;background:#9ca3af;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">불참</button>
            </div>
            <p id="v-msg" style="text-align:center;margin-top:12px;font-weight:700;min-height:22px"></p>
            <p style="text-align:center;color:#9ca3af;font-size:.8rem">한 번 더 누르면 언제든 변경됩니다.</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin-top:16px">
            <div id="v-counts" style="font-weight:800;margin-bottom:10px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <div><div style="color:#16a34a;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">참석</div><div id="v-l-attend" style="font-size:.92rem;line-height:1.8"></div></div>
                <div><div style="color:#d97706;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">미정</div><div id="v-l-maybe" style="font-size:.92rem;line-height:1.8"></div></div>
                <div><div style="color:#9ca3af;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">불참</div><div id="v-l-absent" style="font-size:.92rem;line-height:1.8"></div></div>
            </div>
        </div>
        <p style="text-align:center;color:#cbd5e1;font-size:.75rem;margin-top:20px">BareaPlay ⚽</p>
    </div>`;

    const nameInput = document.getElementById('v-name');
    const msg = document.getElementById('v-msg');

    async function submitVote(status) {
        const name = normName(nameInput.value);
        if (!name) { msg.style.color = '#ef4444'; msg.textContent = '이름을 먼저 입력하세요.'; return; }
        const isGuest = !playerSet.has(name);
        try {
            const ref = doc(db, "votes", voteId, "responses", name);
            const existing = await getDoc(ref);
            const payload = { name, status, guest: isGuest, updatedAt: serverTimestamp() };
            if (status === 'attend') {
                const wasAttend = existing.exists() && existing.data().status === 'attend' && existing.data().attendingSince;
                if (!wasAttend) payload.attendingSince = serverTimestamp();
            }
            if (!existing.exists()) payload.createdAt = serverTimestamp();
            await setDoc(ref, payload, { merge: true });
            const label = status === 'attend' ? '참석' : (status === 'maybe' ? '미정' : '불참');
            msg.style.color = status === 'attend' ? '#16a34a' : (status === 'maybe' ? '#d97706' : '#6b7280');
            msg.textContent = `${name}님 -> ${label}으로 등록되었습니다!`;
        } catch (e) {
            console.error(e);
            msg.style.color = '#ef4444';
            msg.textContent = '저장 실패. 다시 시도해주세요.';
        }
    }
    document.getElementById('v-attend').addEventListener('click', () => submitVote('attend'));
    document.getElementById('v-maybe').addEventListener('click', () => submitVote('maybe'));
    document.getElementById('v-absent').addEventListener('click', () => submitVote('absent'));

    onSnapshot(collection(db, "votes", voteId, "responses"), (snap) => {
        const all = snap.docs.map(d => d.data());
        const attend = all.filter(r => r.status === 'attend').sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
        const maybe = all.filter(r => r.status === 'maybe').sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));
        const absent = all.filter(r => r.status === 'absent').sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));
        const cEl = document.getElementById('v-counts');
        if (cEl) cEl.innerHTML = `현황 &mdash; <span style="color:#16a34a">참석 ${attend.length}</span> &middot; <span style="color:#d97706">미정 ${maybe.length}</span> &middot; <span style="color:#9ca3af">불참 ${absent.length}</span>`;
        const fill = (id, arr, withNum) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = arr.length ? arr.map((r, i) => `<div>${withNum ? (i + 1) + '. ' : ''}${esc(r.name)}${r.guest ? ' <span style="color:#d97706;font-size:.78rem">(G)</span>' : ''}</div>`).join('') : '<span style="color:#cbd5e1">-</span>';
        };
        fill('v-l-attend', attend, true);
        fill('v-l-maybe', maybe, false);
        fill('v-l-absent', absent, false);
    });
}
