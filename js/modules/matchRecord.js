// js/modules/matchRecord.js
// [신규] 🏆 경기기록 탭
//  ① 쿼터 스코어 입력: 운영진이 쿼터당 숫자 2개만 입력 (하루 30초)
//  ② 능력치 자동 보정(개인 Elo): 스코어를 바탕으로 s1을 소폭 자동 조정 — 미리보기 후 [반영]을 눌러야 적용
//  ③ 활약 투표 집계: 공유 보드에서 회원들이 뽑은 '오늘 잘한 3명' 결과 확인
//  ④ 시즌 요약: 쌓인 기록에서 개인별 쿼터 승률·활약점수를 자동 파생 (추가 입력 없음)
//  ※ 출석(attendance)·회비(expenses) 데이터는 전혀 건드리지 않는다. 새 컬렉션(matchRecords, ratings)만 사용.
import { doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state;
let dateInput, teamsInfoEl, scoreRowsEl, eloBox, rateBox, seasonBox;
let currentTeams = [];     // 선택 날짜의 팀 명단 [[이름,...], ...]
let currentRecord = null;  // matchRecords/{date} 문서 데이터
const QUARTERS = 6;

function localToday() { return window.getLocalDate ? window.getLocalDate() : new Date().toISOString().split('T')[0]; }
function cleanName(s) { return String(s == null ? '' : s).replace(' (신규)', '').normalize('NFC').trim(); }

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;

    const pageElement = document.getElementById('page-record');
    if (!pageElement) return;
    pageElement.innerHTML = `
        <div class="bg-white p-6 rounded-2xl shadow-lg">
            <h2 class="text-2xl font-bold mb-1">🏆 경기 기록 (운영진용)</h2>
            <p class="text-sm text-gray-500 mb-4">쿼터가 끝날 때 <b>스코어 숫자만</b> 입력하면 됩니다. 팀 명단은 그날의 팀배정에서 자동으로 가져옵니다. 이 기록이 쌓이면 아래의 능력치 자동 보정과 시즌 요약이 계산됩니다.</p>
            <div class="flex flex-wrap items-end gap-3 mb-4">
                <div><label class="block text-sm font-medium mb-1">📅 경기 날짜</label><input type="date" id="record-date" class="p-2 border rounded-lg"></div>
                <button id="record-load-btn" class="bg-gray-100 border px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200">불러오기</button>
            </div>
            <div id="record-teams-info" class="text-sm text-gray-600 mb-3"></div>
            <div id="record-score-rows" class="space-y-2 mb-4"></div>
            <button id="record-save-btn" class="w-full md:w-auto bg-indigo-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-indigo-700">💾 스코어 저장</button>
        </div>
        <div id="record-elo-box" class="bg-white p-6 rounded-2xl shadow-lg mt-6"></div>
        <div id="record-rate-box" class="bg-white p-6 rounded-2xl shadow-lg mt-6"></div>
        <div class="bg-white p-6 rounded-2xl shadow-lg mt-6">
            <div class="flex items-center justify-between mb-2"><h3 class="text-xl font-bold">📈 시즌 요약</h3><button id="season-refresh-btn" class="text-sm text-indigo-600 hover:underline">집계 새로고침</button></div>
            <p class="text-xs text-gray-400 mb-3">저장된 모든 쿼터 스코어와 활약 투표를 자동 집계합니다. (추가 입력 없음)</p>
            <div id="season-box" class="overflow-x-auto"><p class="text-sm text-gray-400">[집계 새로고침]을 누르면 계산됩니다.</p></div>
        </div>`;

    dateInput = document.getElementById('record-date');
    teamsInfoEl = document.getElementById('record-teams-info');
    scoreRowsEl = document.getElementById('record-score-rows');
    eloBox = document.getElementById('record-elo-box');
    rateBox = document.getElementById('record-rate-box');
    seasonBox = document.getElementById('season-box');

    dateInput.value = localToday();
    dateInput.addEventListener('change', loadDate);
    document.getElementById('record-load-btn').addEventListener('click', loadDate);
    document.getElementById('record-save-btn').addEventListener('click', saveScores);
    document.getElementById('season-refresh-btn').addEventListener('click', renderSeason);
}

// 탭이 열릴 때 호출 (app.js switchTab)
let shownOnce = false;
export function onShow() {
    if (!dateInput) return;
    if (!shownOnce) { shownOnce = true; loadDate(); }
}

async function loadDate() {
    const date = dateInput.value || localToday();
    teamsInfoEl.innerHTML = '<p class="text-gray-400">불러오는 중...</p>';
    scoreRowsEl.innerHTML = '';
    currentTeams = []; currentRecord = null;
    try {
        const [mSnap, rSnap] = await Promise.all([
            getDoc(doc(db, "dailyMeetings", date)),
            getDoc(doc(db, "matchRecords", date))
        ]);
        if (rSnap.exists()) currentRecord = rSnap.data();
        if (mSnap.exists()) {
            const teamsObj = mSnap.data().teams || {};
            currentTeams = Object.keys(teamsObj).sort().map(k => (teamsObj[k] || []).map(p => cleanName(p.name)).filter(Boolean));
        } else if (currentRecord && currentRecord.teamsSnapshot) {
            // 팀배정 문서가 없어도(예: 과거 데이터 정리) 기록 저장 당시의 팀 스냅샷으로 표시
            const ts = currentRecord.teamsSnapshot;
            currentTeams = Object.keys(ts).sort().map(k => ts[k] || []);
        }
    } catch (e) { console.error('경기기록 로드 실패:', e); }
    renderTeamsInfo();
    renderScoreRows();
    renderEloBox();
    renderRateBox();
}

function renderTeamsInfo() {
    if (currentTeams.length < 2) {
        teamsInfoEl.innerHTML = '<p class="text-amber-600 font-semibold">이 날짜에 저장된 팀배정이 없습니다. 팀 배정기에서 먼저 팀을 만들어 주세요.</p>';
        return;
    }
    teamsInfoEl.innerHTML = currentTeams.map((t, i) =>
        `<span class="inline-block bg-gray-100 rounded-lg px-2 py-1 mr-2 mb-1 text-xs"><b>팀 ${i + 1}</b> (${t.length}명): ${t.join(', ')}</span>`
    ).join('');
}

function renderScoreRows() {
    if (currentTeams.length < 2) { scoreRowsEl.innerHTML = ''; return; }
    const teamOptions = (sel) => currentTeams.map((_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>팀 ${i + 1}</option>`).join('');
    const qs = (currentRecord && currentRecord.quarters) || {};
    let html = '';
    for (let q = 0; q < QUARTERS; q++) {
        const d = qs[`q_${q}`] || {};
        const a = (d.a !== undefined) ? d.a : 0;
        const b = (d.b !== undefined) ? d.b : 1;
        const sa = (d.sa !== undefined) ? d.sa : '';
        const sb = (d.sb !== undefined) ? d.sb : '';
        html += `<div class="flex items-center gap-2 flex-wrap" data-q="${q}">
            <span class="w-14 font-bold text-indigo-800 text-sm">${q + 1}쿼터</span>
            <select class="rq-a p-1.5 border rounded-lg text-sm bg-white">${teamOptions(a)}</select>
            <input type="number" min="0" class="rq-sa w-16 p-1.5 border rounded-lg text-center font-bold" placeholder="-" value="${sa}">
            <span class="font-bold text-gray-400">:</span>
            <input type="number" min="0" class="rq-sb w-16 p-1.5 border rounded-lg text-center font-bold" placeholder="-" value="${sb}">
            <select class="rq-b p-1.5 border rounded-lg text-sm bg-white">${teamOptions(b)}</select>
        </div>`;
    }
    scoreRowsEl.innerHTML = html + '<p class="text-xs text-gray-400">스코어를 입력하지 않은 쿼터는 저장되지 않습니다. (일부 쿼터만 입력해도 됩니다)</p>';
}

async function saveScores() {
    if (!state.isAdmin) { window.showNotification('관리자만 저장할 수 있습니다.', 'error'); return; }
    if (currentTeams.length < 2) { window.showNotification('팀배정이 없어 저장할 수 없습니다.', 'error'); return; }
    const date = dateInput.value || localToday();
    const quarters = {};
    scoreRowsEl.querySelectorAll('[data-q]').forEach(row => {
        const q = parseInt(row.dataset.q, 10);
        const sa = row.querySelector('.rq-sa').value;
        const sb = row.querySelector('.rq-sb').value;
        if (sa === '' || sb === '') return; // 미입력 쿼터는 저장 안 함
        quarters[`q_${q}`] = {
            a: parseInt(row.querySelector('.rq-a').value, 10),
            b: parseInt(row.querySelector('.rq-b').value, 10),
            sa: Math.max(0, parseInt(sa, 10) || 0),
            sb: Math.max(0, parseInt(sb, 10) || 0)
        };
    });
    const teamsSnapshot = {};
    currentTeams.forEach((t, i) => { teamsSnapshot[`team_${i}`] = t; });
    try {
        await setDoc(doc(db, "matchRecords", date), {
            date,
            teamsSnapshot,                                     // 저장 당시 팀 명단 (이후 팀배정이 바뀌어도 기록은 그대로)
            quarters,
            eloApplied: !!(currentRecord && currentRecord.eloApplied), // 이미 보정했으면 플래그 유지
            lastUpdatedAt: serverTimestamp()
        });
        currentRecord = { date, teamsSnapshot, quarters, eloApplied: !!(currentRecord && currentRecord.eloApplied) };
        window.showNotification(`${date} 스코어 ${Object.keys(quarters).length}개 쿼터 저장 완료!`);
        renderEloBox();
    } catch (e) {
        console.error(e);
        window.showNotification('저장 실패: ' + e.message, 'error');
    }
}

/* ── ② 능력치 자동 보정 (개인 Elo) ───────────────────────────
   그날 팀의 실력 = 팀원 s1 평균. 예상 승률 대비 실제 결과의 차이를
   팀원 전원에게 소량(K=0.8/쿼터)씩 나눠준다. 매주 팀 조합이 바뀌기 때문에
   여러 주가 쌓이면 개인별 기여 신호가 자연스럽게 분리된다. */
function computeEloDeltas() {
    const rec = currentRecord;
    if (!rec || !rec.quarters) return {};
    const teams = rec.teamsSnapshot
        ? Object.keys(rec.teamsSnapshot).sort().map(k => rec.teamsSnapshot[k])
        : currentTeams;
    const s1Of = (n) => {
        const p = state.playerDB[n];
        return (p && typeof p.s1 === 'number') ? p.s1 : 65;
    };
    const K = 0.8; // 쿼터당 최대 변화폭
    const deltas = {};
    Object.keys(rec.quarters).sort().forEach(k => {
        const q = rec.quarters[k];
        const A = teams[q.a] || [], B = teams[q.b] || [];
        if (!A.length || !B.length || q.a === q.b) return;
        const ra = A.reduce((s, n) => s + s1Of(n) + (deltas[n] || 0), 0) / A.length;
        const rb = B.reduce((s, n) => s + s1Of(n) + (deltas[n] || 0), 0) / B.length;
        const expA = 1 / (1 + Math.pow(10, -(ra - rb) / 10)); // 평균 5점 차이 ≈ 76% 예상 승률
        const resA = q.sa > q.sb ? 1 : (q.sa < q.sb ? 0 : 0.5);
        const dA = K * (resA - expA);
        A.forEach(n => { deltas[n] = (deltas[n] || 0) + dA; });
        B.forEach(n => { deltas[n] = (deltas[n] || 0) - dA; });
    });
    return deltas;
}

function renderEloBox() {
    if (!eloBox) return;
    const has = currentRecord && currentRecord.quarters && Object.keys(currentRecord.quarters).length > 0;
    eloBox.innerHTML = `
        <h3 class="text-xl font-bold mb-2">⚡ 능력치 자동 보정 (개인 Elo)</h3>
        <p class="text-xs text-gray-400 mb-3">쿼터 스코어를 바탕으로 이긴 팀원의 능력치(s1)를 소폭 올리고 진 팀원을 소폭 내립니다 (쿼터당 최대 ±0.8, 30~99 범위 유지). <b>미리보기를 확인한 뒤 [반영]을 눌러야만</b> 실제 선수 정보에 적용됩니다.</p>
        ${currentRecord && currentRecord.eloApplied ? '<p class="text-sm font-bold text-emerald-600 mb-2">✅ 이 날짜는 이미 반영되었습니다. 다시 반영하면 중복 적용되니 주의하세요.</p>' : ''}
        <button id="elo-preview-btn" class="bg-amber-500 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-amber-600" ${has ? '' : 'disabled style="opacity:.5;cursor:not-allowed"'}>${has ? '보정 미리보기' : '먼저 쿼터 스코어를 저장하세요'}</button>
        <div id="elo-preview-area" class="mt-3"></div>`;
    const btn = document.getElementById('elo-preview-btn');
    if (btn && has) btn.addEventListener('click', renderEloPreview);
}

function renderEloPreview() {
    const area = document.getElementById('elo-preview-area');
    if (!area) return;
    const deltas = computeEloDeltas();
    const names = Object.keys(deltas).sort((a, b) => Math.abs(deltas[b]) - Math.abs(deltas[a]));
    if (names.length === 0) { area.innerHTML = '<p class="text-sm text-gray-400">계산할 스코어가 없습니다.</p>'; return; }
    const rows = names.map(n => {
        const p = state.playerDB[n];
        const registered = !!p;
        const cur = registered ? (p.s1 || 65) : 65;
        const d = deltas[n];
        const next = Math.max(30, Math.min(99, Math.round((cur + d) * 10) / 10));
        const dTxt = (d >= 0 ? '+' : '') + (Math.round(d * 100) / 100);
        const color = d > 0.01 ? 'text-emerald-600' : (d < -0.01 ? 'text-red-500' : 'text-gray-400');
        return `<tr class="border-b">
            <td class="py-1.5 px-3 font-medium">${n}${registered ? '' : ' <span class="text-xs text-amber-600">(미등록 · 반영 안 됨)</span>'}</td>
            <td class="py-1.5 px-3 text-center">${registered ? cur : '-'}</td>
            <td class="py-1.5 px-3 text-center font-bold ${color}">${dTxt}</td>
            <td class="py-1.5 px-3 text-center font-bold">${registered ? next : '-'}</td>
        </tr>`;
    }).join('');
    area.innerHTML = `
        <div class="overflow-x-auto"><table class="w-full text-sm text-left">
            <thead class="text-xs text-gray-600 uppercase bg-gray-50"><tr><th class="py-2 px-3">이름</th><th class="py-2 px-3 text-center">현재</th><th class="py-2 px-3 text-center">변화</th><th class="py-2 px-3 text-center">반영 후</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
        <button id="elo-apply-btn" class="mt-3 bg-emerald-600 text-white text-sm font-bold py-2 px-5 rounded-lg hover:bg-emerald-700">✅ 이대로 선수 능력치에 반영</button>`;
    document.getElementById('elo-apply-btn').addEventListener('click', () => applyElo(deltas));
}

async function applyElo(deltas) {
    if (!state.isAdmin) { window.showNotification('관리자만 반영할 수 있습니다.', 'error'); return; }
    if (currentRecord && currentRecord.eloApplied) {
        if (!confirm('이 날짜는 이미 반영된 기록이 있습니다.\n다시 반영하면 중복 적용됩니다. 계속할까요?')) return;
    }
    const date = dateInput.value || localToday();
    try {
        const updates = [];
        Object.keys(deltas).forEach(n => {
            const p = state.playerDB[n];
            if (!p) return; // 미등록(게스트)은 건너뜀
            const next = Math.max(30, Math.min(99, Math.round(((p.s1 || 65) + deltas[n]) * 10) / 10));
            updates.push(setDoc(doc(db, "players", n), { s1: next }, { merge: true }));
        });
        await Promise.all(updates);
        await setDoc(doc(db, "matchRecords", date), { eloApplied: true, eloAppliedAt: serverTimestamp() }, { merge: true });
        if (currentRecord) currentRecord.eloApplied = true;
        window.showNotification(`${updates.length}명의 능력치가 보정되었습니다.`);
        renderEloBox();
    } catch (e) {
        console.error(e);
        window.showNotification('반영 실패: ' + e.message, 'error');
    }
}

/* ── ③ 활약 투표 집계 (공유 보드에서 회원들이 투표) ── */
async function renderRateBox() {
    if (!rateBox) return;
    const date = dateInput.value || localToday();
    rateBox.innerHTML = `<h3 class="text-xl font-bold mb-2">🏅 활약 투표 결과 <span class="text-sm font-normal text-gray-400">(${date})</span></h3><p class="text-sm text-gray-400">불러오는 중...</p>`;
    try {
        const snap = await getDoc(doc(db, "ratings", date));
        const votes = (snap.exists() && snap.data().votes) || {};
        const voters = Object.keys(votes);
        if (voters.length === 0) {
            rateBox.innerHTML = `<h3 class="text-xl font-bold mb-2">🏅 활약 투표 결과 <span class="text-sm font-normal text-gray-400">(${date})</span></h3>
                <p class="text-sm text-gray-400">아직 투표가 없습니다. 회원들은 <b>공유 보드 링크</b> 하단에서 경기 후 '오늘 잘한 3명'을 뽑을 수 있습니다. (1순위 3점 · 2순위 2점 · 3순위 1점)</p>`;
            return;
        }
        const pts = {};
        voters.forEach(v => ((votes[v] && votes[v].picks) || []).forEach((n, i) => { pts[n] = (pts[n] || 0) + (3 - i); }));
        const ranked = Object.keys(pts).sort((a, b) => pts[b] - pts[a]);
        const max = pts[ranked[0]] || 1;
        rateBox.innerHTML = `
            <h3 class="text-xl font-bold mb-2">🏅 활약 투표 결과 <span class="text-sm font-normal text-gray-400">(${date} · ${voters.length}명 참여)</span></h3>
            <p class="text-xs text-gray-400 mb-3">결과는 익명으로 집계됩니다. (누가 누구를 뽑았는지는 화면에 표시하지 않음)</p>
            ${ranked.map((n, i) => `<div class="flex items-center gap-2 mb-1.5 text-sm">
                <span class="w-6 text-center">${i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : (i + 1)))}</span>
                <span class="w-20 font-bold">${n}</span>
                <div class="flex-1 bg-gray-100 rounded h-4"><div class="bg-indigo-400 h-4 rounded" style="width:${Math.round(pts[n] / max * 100)}%"></div></div>
                <span class="w-10 text-right font-bold text-indigo-600">${pts[n]}점</span>
            </div>`).join('')}`;
    } catch (e) {
        console.error(e);
        rateBox.innerHTML = `<h3 class="text-xl font-bold mb-2">🏅 활약 투표 결과</h3><p class="text-sm text-red-500">불러오기에 실패했습니다.</p>`;
    }
}

/* ── ④ 시즌 요약 (전체 기록 자동 파생) ── */
async function renderSeason() {
    if (!seasonBox) return;
    seasonBox.innerHTML = '<p class="text-sm text-gray-400">집계 중...</p>';
    try {
        const [mrSnap, rtSnap] = await Promise.all([
            getDocs(collection(db, "matchRecords")),
            getDocs(collection(db, "ratings"))
        ]);
        const stats = {}; // name -> { days:Set, w, d, l, pts }
        const ensure = (n) => { if (!stats[n]) stats[n] = { days: new Set(), w: 0, d: 0, l: 0, pts: 0 }; return stats[n]; };

        mrSnap.forEach(dSnap => {
            const rec = dSnap.data();
            const teams = rec.teamsSnapshot ? Object.keys(rec.teamsSnapshot).sort().map(k => rec.teamsSnapshot[k]) : [];
            if (!teams.length) return;
            teams.forEach(t => (t || []).forEach(n => ensure(n).days.add(rec.date || dSnap.id)));
            Object.values(rec.quarters || {}).forEach(q => {
                const A = teams[q.a] || [], B = teams[q.b] || [];
                const resA = q.sa > q.sb ? 'w' : (q.sa < q.sb ? 'l' : 'd');
                const resB = resA === 'w' ? 'l' : (resA === 'l' ? 'w' : 'd');
                A.forEach(n => ensure(n)[resA]++);
                B.forEach(n => ensure(n)[resB]++);
            });
        });
        rtSnap.forEach(dSnap => {
            const votes = dSnap.data().votes || {};
            Object.values(votes).forEach(v => ((v && v.picks) || []).forEach((n, i) => { ensure(n).pts += (3 - i); }));
        });

        const names = Object.keys(stats).sort((a, b) => {
            const sa = stats[a], sb = stats[b];
            const ra = (sa.w + sa.d + sa.l) ? sa.w / (sa.w + sa.d + sa.l) : 0;
            const rb = (sb.w + sb.d + sb.l) ? sb.w / (sb.w + sb.d + sb.l) : 0;
            return (rb - ra) || (sb.pts - sa.pts);
        });
        if (names.length === 0) {
            seasonBox.innerHTML = '<p class="text-sm text-gray-400">아직 집계할 기록이 없습니다. 쿼터 스코어를 저장하면 여기에 쌓입니다.</p>';
            return;
        }
        const rows = names.map(n => {
            const s = stats[n];
            const total = s.w + s.d + s.l;
            const rate = total ? Math.round(s.w / total * 100) : 0;
            return `<tr class="border-b">
                <td class="py-1.5 px-3 font-medium whitespace-nowrap">${n}</td>
                <td class="py-1.5 px-3 text-center">${s.days.size}</td>
                <td class="py-1.5 px-3 text-center whitespace-nowrap"><span class="text-emerald-600 font-bold">${s.w}</span> - ${s.d} - <span class="text-red-500 font-bold">${s.l}</span></td>
                <td class="py-1.5 px-3 text-center font-bold">${total ? rate + '%' : '-'}</td>
                <td class="py-1.5 px-3 text-center font-bold text-indigo-600">${s.pts || ''}</td>
            </tr>`;
        }).join('');
        seasonBox.innerHTML = `<table class="w-full text-sm text-left">
            <thead class="text-xs text-gray-600 uppercase bg-gray-50"><tr><th class="py-2 px-3">이름</th><th class="py-2 px-3 text-center">기록일수</th><th class="py-2 px-3 text-center">쿼터 승-무-패</th><th class="py-2 px-3 text-center">승률</th><th class="py-2 px-3 text-center">활약점수</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    } catch (e) {
        console.error(e);
        seasonBox.innerHTML = '<p class="text-sm text-red-500">집계에 실패했습니다.</p>';
    }
}
