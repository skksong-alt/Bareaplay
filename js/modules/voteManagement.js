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
            <p class="text-sm text-gray-500">카톡방에 링크만 보내면, 회원들이 로그인 없이 참석/불참을 누를 수 있습니다. 신규/게스트는 이름을 직접 입력합니다.</p>
            <div><label class="block text-sm font-medium">제목(선택)</label><input type="text" id="vote-title" class="mt-1 w-full p-2 border rounded-lg" placeholder="예: 11월 12일 수요일 풋살"></div>
            <div class="grid grid-cols-2 gap-2">
                <div><label class="block text-sm font-medium">날짜</label><input type="date" id="vote-date" class="mt-1 w-full p-2 border rounded-lg"></div>
                <div><label class="block text-sm font-medium">시간</label><input type="time" id="vote-time" class="mt-1 w-full p-2 border rounded-lg" value="20:00"></div>
            </div>
            <div><label class="block text-sm font-medium">장소(선택)</label><input type="text" id="vote-location" class="mt-1 w-full p-2 border rounded-lg" placeholder="예: 두바이 스포츠시티"></div>
            <button id="vote-create-btn" class="w-full bg-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-emerald-700">새 투표 만들기</button>
            <div id="vote-link-container" class="hidden p-4 bg-emerald-50 rounded-lg">
                <p class="text-sm font-semibold mb-2">투표 링크 (복사해서 카톡방에 공유):</p>
                <a id="vote-link-anchor" href="#" target="_blank" class="text-blue-600 break-all hover:underline text-sm"></a>
                <button id="vote-copy-btn" class="mt-2 w-full bg-blue-500 text-white text-sm font-bold py-2 rounded-lg hover:bg-blue-600">링크 복사</button>
            </div>
        </div>
        <div id="vote-status-panel" class="mt-6"></div>
    `;
    sharePage.appendChild(box);

    const today = new Date();
    const off = today.getTimezoneOffset() * 60000;
    document.getElementById('vote-date').value = new Date(today.getTime() - off).toISOString().split('T')[0];

    document.getElementById('vote-create-btn').addEventListener('click', createVote);

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

    try {
        const ref = await addDoc(collection(db, "votes"), {
            title, date, time, location,
            closed: false,
            createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "settings", "activeVote"), { voteId: ref.id });
        window.showNotification('투표가 생성되었습니다!');
        showVoteLink(ref.id);
        loadAdminVote(ref.id);
    } catch (e) {
        console.error(e);
        window.showNotification('투표 생성 실패: ' + e.message, 'error');
    }
}

function voteUrl(voteId) {
    return `${window.location.origin}${window.location.pathname}?voteId=${voteId}`;
}

function showVoteLink(voteId) {
    const c = document.getElementById('vote-link-container');
    const a = document.getElementById('vote-link-anchor');
    if (!c || !a) return;
    a.href = voteUrl(voteId);
    a.textContent = voteUrl(voteId);
    c.classList.remove('hidden');
    const copyBtn = document.getElementById('vote-copy-btn');
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(voteUrl(voteId))
            .then(() => window.showNotification('링크가 복사되었습니다.'))
            .catch(() => window.showNotification('복사 실패. 링크를 길게 눌러 복사하세요.', 'error'));
    };
}

function loadAdminVote(voteId) {
    if (activeVoteId === voteId && respUnsub) { showVoteLink(voteId); return; }
    activeVoteId = voteId;
    showVoteLink(voteId);
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
    const absent = adminResponses.filter(r => r.status === 'absent')
        .sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));

    const attendRows = attend.map((r, i) => `
        <li class="flex items-center justify-between py-1.5 border-b">
            <span><span class="text-gray-400 mr-2">${i + 1}</span><b>${esc(r.name)}</b>${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}
                <span class="text-xs text-gray-400 ml-2">투표 ${fmtTime(r.attendingSince)}</span></span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-to-absent text-xs text-yellow-600 hover:underline">불참 처리</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    const absentRows = absent.map(r => `
        <li class="flex items-center justify-between py-1.5 border-b text-gray-500">
            <span>${esc(r.name)}${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}</span>
            <span class="space-x-2">
                <button data-id="${esc(r.id)}" class="vote-to-attend text-xs text-green-600 hover:underline">참석 처리</button>
                <button data-id="${esc(r.id)}" class="vote-del text-xs text-red-500 hover:underline">삭제</button>
            </span>
        </li>`).join('');

    panel.innerHTML = `
        <div class="border-t pt-4">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-xl font-bold">투표 현황 <span class="text-green-600">참석 ${attend.length}</span> / <span class="text-gray-400">불참 ${absent.length}</span></h3>
                <button id="vote-to-balancer" class="bg-indigo-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">이 투표로 팀 짜기 →</button>
            </div>
            <p class="text-xs text-gray-400 mb-2">※ 참석자는 투표가 늦은 사람일수록 아래쪽에 있으며, 팀 배정 후 아래(늦은 투표)부터 휴식·키퍼를 맡습니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><p class="font-semibold text-green-700 mb-1">✅ 참석 (투표순)</p><ul class="text-sm">${attendRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul></div>
                <div><p class="font-semibold text-gray-600 mb-1">❌ 불참</p><ul class="text-sm">${absentRows || '<li class="text-gray-400 py-2">아직 없음</li>'}</ul></div>
            </div>
            <div class="mt-4 flex space-x-2">
                <input type="text" id="vote-admin-add-name" class="flex-grow p-2 border rounded-lg text-sm" placeholder="명단에 없는 사람 직접 추가">
                <button id="vote-admin-add-btn" class="bg-emerald-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-emerald-700">참석 추가</button>
            </div>
        </div>`;

    panel.querySelectorAll('.vote-to-absent').forEach(b => b.onclick = () => adminSetStatus(b.dataset.id, 'absent'));
    panel.querySelectorAll('.vote-to-attend').forEach(b => b.onclick = () => adminSetStatus(b.dataset.id, 'attend'));
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
export async function renderVotePage(voteId) {
    db = db || window.__db;
    let vote = null;
    try {
        const snap = await getDoc(doc(db, "votes", voteId));
        if (snap.exists()) vote = snap.data();
    } catch (e) { console.error(e); }

    if (!vote) {
        document.body.innerHTML = `<p style="text-align:center;margin-top:40px;font-size:1.3rem;color:#ef4444">투표를 찾을 수 없습니다.</p>`;
        return;
    }

    // 선수 명단 공개 조회 (드롭다운용)
    let players = [];
    try {
        const ps = await getDocs(collection(db, "players"));
        players = ps.docs.map(d => d.data().name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    } catch (e) { console.error(e); }

    const headerTitle = vote.title || `${vote.date || ''} 참석 투표`;
    const info = [vote.date, vote.time, vote.location].filter(Boolean).join(' · ');

    document.body.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:16px;font-family:'Noto Sans KR',sans-serif">
        <div style="text-align:center;margin:16px 0 8px">
            <h1 style="font-size:1.6rem;font-weight:800;color:#111827">⚽ ${esc(headerTitle)}</h1>
            <p style="color:#6b7280;margin-top:6px">${esc(info)}</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
            <label style="display:block;font-weight:700;margin-bottom:6px">이름 선택</label>
            <select id="v-name-select" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;background:#fff">
                <option value="">-- 이름을 선택하세요 --</option>
                ${players.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
                <option value="__guest__">+ 명단에 없어요 (게스트)</option>
            </select>
            <input id="v-guest-name" type="text" placeholder="게스트 이름 입력" style="display:none;width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;margin-top:8px;box-sizing:border-box">
            <div style="display:flex;gap:10px;margin-top:16px">
                <button id="v-attend" style="flex:1;padding:16px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:1.1rem;font-weight:800;cursor:pointer">참석 ✅</button>
                <button id="v-absent" style="flex:1;padding:16px;border:0;border-radius:12px;background:#9ca3af;color:#fff;font-size:1.1rem;font-weight:800;cursor:pointer">불참 ❌</button>
            </div>
            <p id="v-msg" style="text-align:center;margin-top:12px;font-weight:700;min-height:22px"></p>
            <p style="text-align:center;color:#9ca3af;font-size:.8rem">한 번 더 누르면 언제든 변경됩니다.</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin-top:16px">
            <h3 style="font-weight:800;margin-bottom:10px">현재 참석 현황 <span id="v-count" style="color:#16a34a"></span></h3>
            <div id="v-list" style="font-size:.95rem;line-height:1.9"></div>
        </div>
        <p style="text-align:center;color:#cbd5e1;font-size:.75rem;margin-top:20px">BareaPlay ⚽</p>
    </div>`;

    const sel = document.getElementById('v-name-select');
    const guestInput = document.getElementById('v-guest-name');
    const msg = document.getElementById('v-msg');

    sel.addEventListener('change', () => {
        guestInput.style.display = (sel.value === '__guest__') ? 'block' : 'none';
    });

    function chosenName() {
        if (sel.value === '__guest__') return normName(guestInput.value);
        return normName(sel.value);
    }

    async function submitVote(status) {
        const name = chosenName();
        if (!name) { msg.style.color = '#ef4444'; msg.textContent = '이름을 먼저 선택/입력하세요.'; return; }
        const isGuest = (sel.value === '__guest__');
        try {
            const ref = doc(db, "votes", voteId, "responses", name);
            const existing = await getDoc(ref);
            const payload = { name, status, guest: isGuest, updatedAt: serverTimestamp() };
            if (status === 'attend') {
                // 참석으로 바뀌는 순간의 시각 기록 (이미 참석 중이면 기존 시각 유지)
                if (existing.exists() && existing.data().status === 'attend' && existing.data().attendingSince) {
                    // 유지
                } else {
                    payload.attendingSince = serverTimestamp();
                }
            }
            if (!existing.exists()) payload.createdAt = serverTimestamp();
            await setDoc(ref, payload, { merge: true });
            msg.style.color = (status === 'attend') ? '#16a34a' : '#6b7280';
            msg.textContent = `${name}님 → ${status === 'attend' ? '참석' : '불참'}으로 등록되었습니다!`;
        } catch (e) {
            console.error(e);
            msg.style.color = '#ef4444';
            msg.textContent = '저장 실패. 다시 시도해주세요.';
        }
    }

    document.getElementById('v-attend').addEventListener('click', () => submitVote('attend'));
    document.getElementById('v-absent').addEventListener('click', () => submitVote('absent'));

    // 실시간 참석 현황
    onSnapshot(collection(db, "votes", voteId, "responses"), (snap) => {
        const all = snap.docs.map(d => d.data());
        const attend = all.filter(r => r.status === 'attend')
            .sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
        const cntEl = document.getElementById('v-count');
        const listEl = document.getElementById('v-list');
        if (cntEl) cntEl.textContent = `${attend.length}명`;
        if (listEl) {
            listEl.innerHTML = attend.length
                ? attend.map((r, i) => `<div>${i + 1}. ${esc(r.name)}${r.guest ? ' <span style="color:#d97706;font-size:.8rem">(게스트)</span>' : ''}</div>`).join('')
                : '<span style="color:#9ca3af">아직 참석자가 없습니다.</span>';
        }
    });
}
