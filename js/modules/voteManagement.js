// js/modules/voteManagement.js
// 묶음 C: 공개 "모임 보드" 페이지 (로그인 없이 ?voteId=날짜 로 진입)
//  - 참석/미정/불참 투표 (이름 자동완성, 명단 없으면 게스트 자동 처리)
//  - 모임정보(장소/시간) 실시간 반영
//  - 운영진이 '최종본 게시'를 누른 경우에만 팀배정·라인업 표시
import { doc, setDoc, getDoc, getDocs, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db = null;

function normName(s) {
    return (s == null ? '' : String(s)).normalize('NFC').trim();
}
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(url) {
    const u = String(url == null ? '' : url);
    return (u.startsWith('http://') || u.startsWith('https://')) ? u : '';
}
function tsSeconds(t) {
    if (!t) return Infinity;
    if (typeof t.seconds === 'number') return t.seconds;
    return Infinity;
}

// 라인업 한 쿼터 데이터 안전 접근 (q1.. 또는 q_0.. 또는 배열 모두 지원)
function getQData(dataObj, idx) {
    if (!dataObj) return null;
    if (Array.isArray(dataObj)) return dataObj[idx];
    return dataObj[`q${idx + 1}`] || dataObj[`q_${idx}`] || null;
}

export async function renderVotePage(voteId) {
    db = window.__db;
    if (!db) {
        document.body.innerHTML = `<p style="text-align:center;margin-top:40px">초기화 오류. 새로고침 해주세요.</p>`;
        return;
    }

    // 선수 명단(자동완성용) 1회 조회
    let players = [];
    try {
        const ps = await getDocs(collection(db, "players"));
        players = ps.docs.map(d => d.data().name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    } catch (e) { console.error(e); }
    const playerSet = new Set(players.map(normName));

    // 최초 1회: 문서 존재 확인
    let firstSnap = null;
    try { firstSnap = await getDoc(doc(db, "votes", voteId)); } catch (e) { console.error(e); }
    if (!firstSnap || !firstSnap.exists()) {
        document.body.innerHTML = `<div style="max-width:480px;margin:60px auto;text-align:center;font-family:'Noto Sans KR',sans-serif">
            <h1 style="font-size:1.4rem;color:#ef4444">투표를 찾을 수 없습니다</h1>
            <p style="color:#6b7280;margin-top:8px">링크가 만료되었거나 아직 보드가 만들어지지 않았습니다.</p></div>`;
        return;
    }

    // 페이지 뼈대
    document.body.className = 'bg-gray-100';
    document.body.innerHTML = `
    <div style="max-width:1000px;margin:0 auto;padding:16px;font-family:'Noto Sans KR',sans-serif">
        <div style="text-align:center;margin:12px 0">
            <h1 style="font-size:1.7rem;font-weight:800;color:#111827">⚽ BareaPlay</h1>
            <p id="vp-info" style="color:#6b7280;margin-top:6px"></p>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;max-width:520px;margin:0 auto">
            <label style="display:block;font-weight:700;margin-bottom:6px">이름</label>
            <input id="vp-name" list="vp-players" autocomplete="off" placeholder="이름을 입력/선택하세요"
                style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;box-sizing:border-box">
            <datalist id="vp-players">${players.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
            <p style="color:#9ca3af;font-size:.8rem;margin:6px 0 0">선수 명단에 없는 분은 이름을 그냥 입력한 후 투표해 주세요. (게스트로 등록됩니다)</p>
            <div style="display:flex;gap:8px;margin-top:16px">
                <button id="vp-attend" style="flex:1;padding:15px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">참석</button>
                <button id="vp-maybe" style="flex:1;padding:15px;border:0;border-radius:12px;background:#f59e0b;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">미정</button>
                <button id="vp-absent" style="flex:1;padding:15px;border:0;border-radius:12px;background:#9ca3af;color:#fff;font-size:1.05rem;font-weight:800;cursor:pointer">불참</button>
            </div>
            <p id="vp-msg" style="text-align:center;margin-top:12px;font-weight:700;min-height:22px"></p>
            <p style="text-align:center;color:#9ca3af;font-size:.8rem">한 번 더 누르면 언제든 변경됩니다.</p>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:16px auto;max-width:520px">
            <div id="vp-counts" style="font-weight:800;margin-bottom:10px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <div><div style="color:#16a34a;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">참석</div><div id="vp-list-attend" style="font-size:.92rem;line-height:1.8"></div></div>
                <div><div style="color:#d97706;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">미정</div><div id="vp-list-maybe" style="font-size:.92rem;line-height:1.8"></div></div>
                <div><div style="color:#9ca3af;font-weight:700;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px">불참</div><div id="vp-list-absent" style="font-size:.92rem;line-height:1.8"></div></div>
            </div>
        </div>

        <div id="vp-board"></div>

        <p style="text-align:center;color:#cbd5e1;font-size:.75rem;margin:24px 0">© 2025 BareaPlay. Created by 송감독.</p>
    </div>`;

    const nameInput = document.getElementById('vp-name');
    const msg = document.getElementById('vp-msg');

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
                if (!wasAttend) payload.attendingSince = serverTimestamp(); // 참석으로 바뀐 시각 기록 (휴식/키퍼 순서용)
            }
            if (!existing.exists()) payload.createdAt = serverTimestamp();
            await setDoc(ref, payload, { merge: true });
            const label = status === 'attend' ? '참석' : (status === 'maybe' ? '미정' : '불참');
            msg.style.color = status === 'attend' ? '#16a34a' : (status === 'maybe' ? '#d97706' : '#6b7280');
            msg.textContent = `${name}님 → ${label}으로 등록되었습니다!`;
        } catch (e) {
            console.error(e);
            msg.style.color = '#ef4444';
            msg.textContent = '저장 실패. 다시 시도해주세요.';
        }
    }
    document.getElementById('vp-attend').addEventListener('click', () => submitVote('attend'));
    document.getElementById('vp-maybe').addEventListener('click', () => submitVote('maybe'));
    document.getElementById('vp-absent').addEventListener('click', () => submitVote('absent'));

    // 모임정보 + 게시된 보드 실시간 반영
    onSnapshot(doc(db, "votes", voteId), (snap) => {
        if (!snap.exists()) return;
        const v = snap.data();
        const infoEl = document.getElementById('vp-info');
        let locHtml = '미정';
        if (v.location) {
            locHtml = safeUrl(v.locationUrl)
                ? `<a href="${esc(safeUrl(v.locationUrl))}" target="_blank" style="color:#2563eb;text-decoration:underline">${esc(v.location)}</a>`
                : esc(v.location);
        }
        const dateTime = [v.date, v.time].filter(Boolean).join(' ');
        if (infoEl) infoEl.innerHTML = `${esc(v.title || dateTime)} · 📍 ${locHtml}`;
        renderBoard(v.board && v.published ? v.board : null);
    });

    // 투표 현황 실시간
    onSnapshot(collection(db, "votes", voteId, "responses"), (snap) => {
        const all = snap.docs.map(d => d.data());
        const attend = all.filter(r => r.status === 'attend').sort((a, b) => tsSeconds(a.attendingSince) - tsSeconds(b.attendingSince));
        const maybe = all.filter(r => r.status === 'maybe').sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));
        const absent = all.filter(r => r.status === 'absent').sort((a, b) => tsSeconds(a.updatedAt) - tsSeconds(b.updatedAt));

        const cEl = document.getElementById('vp-counts');
        if (cEl) cEl.innerHTML = `현황 — <span style="color:#16a34a">참석 ${attend.length}</span> · <span style="color:#d97706">미정 ${maybe.length}</span> · <span style="color:#9ca3af">불참 ${absent.length}</span>`;

        const fill = (id, arr, withNum) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = arr.length
                ? arr.map((r, i) => `<div>${withNum ? (i + 1) + '. ' : ''}${esc(r.name)}${r.guest ? ' <span style="color:#d97706;font-size:.78rem">(G)</span>' : ''}</div>`).join('')
                : '<span style="color:#cbd5e1">-</span>';
        };
        fill('vp-list-attend', attend, true);
        fill('vp-list-maybe', maybe, false);
        fill('vp-list-absent', absent, false);
    });
}

function renderBoard(board) {
    const wrap = document.getElementById('vp-board');
    if (!wrap) return;
    if (!board) { wrap.innerHTML = ''; return; }

    const teams = Object.keys(board.teams || {}).sort().map(k => board.teams[k]);
    const lineups = board.lineups || {};
    const colors = ["#14B8A6", "#0288D1", "#7B1FA2", "#43A047", "#F4511E"];

    // 팀 배정
    let html = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:16px 0">
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:12px;border-bottom:1px solid #eee;padding-bottom:8px">⚖️ 팀 배정</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">`;
    teams.forEach((team, i) => {
        const members = [...(team || [])].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
        html += `<div style="background:${colors[i % 5]};color:#fff;border-radius:12px;padding:12px">
            <div style="font-weight:800;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:6px;margin-bottom:6px">팀 ${i + 1}</div>
            ${members.map(p => `<div style="background:rgba(255,255,255,.18);border-radius:6px;padding:5px 8px;margin-bottom:4px">${esc(String(p.name).replace(' (신규)', ''))}</div>`).join('')}
        </div>`;
    });
    html += `</div></div>`;

    // 라인업
    html += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:16px 0">
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:12px;border-bottom:1px solid #eee;padding-bottom:8px">📋 라인업</h2>`;
    teams.forEach((team, teamIdx) => {
        const lu = lineups[`team${teamIdx + 1}`] || lineups[teamIdx];
        html += `<div style="margin-bottom:18px"><h3 style="font-weight:800;text-align:center;margin-bottom:8px">팀 ${teamIdx + 1}</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">`;
        for (let q = 0; q < 6; q++) html += quarterHtml(lu, q);
        html += `</div></div>`;
    });
    html += `</div>
        <div style="text-align:center;margin:8px 0 24px"><button onclick="window.print()" style="background:#374151;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:700;cursor:pointer">인쇄 / PDF 저장</button></div>`;

    wrap.innerHTML = html;
}

function quarterHtml(lu, qIndex) {
    if (!lu || !lu.lineups) return `<div style="border:1px solid #eee;border-radius:8px;padding:8px;text-align:center;color:#cbd5e1">-</div>`;
    const lineup = lu.lineups[qIndex];
    if (!lineup) return `<div style="border:1px solid #eee;border-radius:8px;padding:8px;text-align:center;color:#cbd5e1">-</div>`;
    const formation = (lu.formations && lu.formations[qIndex]) || '';
    const referee = getQData(lu.referees, qIndex);
    const rawResters = getQData(lu.resters, qIndex) || [];
    const resters = Array.isArray(rawResters) ? rawResters.filter(r => r !== referee) : [];

    let body = '';
    Object.keys(lineup).sort().forEach(pos => {
        (lineup[pos] || []).forEach(player => {
            if (player) body += `<div style="background:#f3f4f6;border-radius:5px;padding:3px 6px;margin-bottom:3px;font-size:.82rem">${esc(pos)}: ${esc(player)}</div>`;
        });
    });
    let foot = '';
    if (referee) foot += `<div style="font-size:.8rem;margin-top:4px"><b>⚖️ 심판:</b> ${esc(referee)}</div>`;
    foot += `<div style="font-size:.8rem"><b>🛌 휴식:</b> ${esc(resters.join(', ')) || '없음'}</div>`;

    return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px">
        <div style="font-weight:700;text-align:center;margin-bottom:6px">${qIndex + 1}쿼터 ${formation ? '(' + esc(formation) + ')' : ''}</div>
        ${body}<hr style="margin:6px 0;border:0;border-top:1px solid #eee">${foot}
    </div>`;
}
