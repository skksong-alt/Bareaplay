// js/modules/matchRecord.js
// [신규] 🏆 경기기록 탭
//  ① 쿼터 스코어 입력: 운영진이 쿼터당 숫자 2개만 입력 (하루 30초)
//  ② 선수 평가는 8주 단위로 감독이 검토. 이 모듈은 players를 변경하지 않음.
//  ③ 활약 투표 집계: 공유 보드에서 회원들이 뽑은 '오늘 잘한 3명' 결과 확인
//  ④ 시즌 요약: 쌓인 기록에서 개인별 쿼터 승률·활약점수를 자동 파생 (추가 입력 없음)
//  ※ 출석(attendance)·회비(expenses) 데이터는 전혀 건드리지 않는다. 새 컬렉션(matchRecords, ratings)만 사용.
import { doc, getDoc, getDocs, runTransaction, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state;
let dateInput, teamsInfoEl, scoreRowsEl, eloBox, rateBox, seasonBox;
let currentTeams = [];     // 선택 날짜의 팀 명단 [[이름,...], ...]
let currentTeamNames = []; // [v58] 선택 날짜의 팀 이름 (dailyMeetings.teamNames)
let currentRecord = null;  // matchRecords/{date} 문서 데이터

// [v58] 팀 이름 표시: 저장된 이름 → 없으면 '팀 N'
function tn(i) {
    return (currentTeamNames && currentTeamNames[i]) ? String(currentTeamNames[i]) : `팀 ${i + 1}`;
}
let currentQuarterCount=6, loadVersion=0, loadedDate='', saving=false;

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
            <p class="text-sm text-gray-500 mb-4">쿼터가 끝날 때 <b>스코어 숫자만</b> 입력하면 됩니다. 팀 명단은 그날의 팀배정에서 자동으로 가져옵니다. 결과는 팀 운영 참고용이며 선수 능력치를 자동 변경하지 않습니다.</p>
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
            <p class="text-xs text-gray-400 mb-3">선택된 4·6쿼터의 팀 결과를 당시 팀 명단에 집계합니다. 휴식·심판을 제외한 실제 개인 출전 승률은 아니며 능력치 평가에 직접 사용하지 않습니다.</p>
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
    const date = dateInput.value || localToday(), version=++loadVersion;
    loadedDate='';document.getElementById('record-save-btn').disabled=true;
    teamsInfoEl.innerHTML = '<p class="text-gray-400">불러오는 중...</p>';
    scoreRowsEl.innerHTML = '';
    currentTeams = []; currentTeamNames = []; currentRecord = null;
    try {
        const [mSnap, rSnap] = await Promise.all([
            getDoc(doc(db, "dailyMeetings", date)),
            getDoc(doc(db, "matchRecords", date))
        ]);
        if(version!==loadVersion)return;
        loadedDate=date; currentQuarterCount=(mSnap.data()?.quarterCount ?? rSnap.data()?.quarterCount)===4?4:6;
        if (rSnap.exists()) currentRecord = rSnap.data();
        if(currentRecord?.teamsSnapshot) {
            currentTeams=Object.keys(currentRecord.teamsSnapshot).sort().map(k=>currentRecord.teamsSnapshot[k]||[]);
            currentTeamNames=mSnap.data()?.teamNames||[];
        } else if (mSnap.exists()) {
            currentTeamNames = mSnap.data().teamNames || []; // [v58]
            const teamsObj = mSnap.data().teams || {};
            currentTeams = Object.keys(teamsObj).sort().map(k => (teamsObj[k] || []).map(p => cleanName(p.name)).filter(Boolean));
        }
    } catch (e) { if(version!==loadVersion)return; teamsInfoEl.textContent='경기 정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.';return; }
    document.getElementById('record-save-btn').disabled=saving;
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
        `<span class="inline-block bg-gray-100 rounded-lg px-2 py-1 mr-2 mb-1 text-xs"><b>${tn(i)}</b> (${t.length}명): ${t.join(', ')}</span>`
    ).join('');
}

function renderScoreRows() {
    if (currentTeams.length < 2) { scoreRowsEl.innerHTML = ''; return; }
    const teamOptions = (sel) => currentTeams.map((_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${tn(i)}</option>`).join('');
    const qs = (currentRecord && currentRecord.quarters) || {};
    let html = '';
    for (let q = 0; q < currentQuarterCount; q++) {
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
    scoreRowsEl.innerHTML = html + '<p class="text-xs text-gray-400">양쪽 점수를 입력한 쿼터만 갱신합니다. 빈칸과 보관 중인 5·6쿼터의 기존 점수는 삭제하지 않습니다. 팀 명단은 최초 기록의 스냅샷을 유지합니다.</p>';
}

async function saveScores() {
    if(saving||loadedDate!==dateInput.value)return;
    if (!state.isAdmin) { window.showNotification('관리자만 저장할 수 있습니다.', 'error'); return; }
    if (currentTeams.length < 2) { window.showNotification('팀배정이 없어 저장할 수 없습니다.', 'error'); return; }
    const date = dateInput.value || localToday();
    const quarters = {};
    let invalid=false;
    scoreRowsEl.querySelectorAll('[data-q]').forEach(row => {
        const q = parseInt(row.dataset.q, 10);
        const sa = row.querySelector('.rq-sa').value;
        const sb = row.querySelector('.rq-sb').value;
        if (sa === '' || sb === '') return; // 미입력 쿼터는 저장 안 함
        if(!Number.isInteger(Number(sa))||!Number.isInteger(Number(sb))||Number(sa)<0||Number(sb)<0||row.querySelector('.rq-a').value===row.querySelector('.rq-b').value){invalid=true;return;}
        quarters[`q_${q}`] = {
            a: parseInt(row.querySelector('.rq-a').value, 10),
            b: parseInt(row.querySelector('.rq-b').value, 10),
            sa: Math.max(0, parseInt(sa, 10) || 0),
            sb: Math.max(0, parseInt(sb, 10) || 0)
        };
    });
    if(invalid){window.showNotification('서로 다른 두 팀과 0 이상의 정수 점수를 입력하세요.','error');return;}
    const teamsSnapshot = {};
    currentTeams.forEach((t, i) => { teamsSnapshot[`team_${i}`] = t; });
    saving=true;document.getElementById('record-save-btn').disabled=true;
    const expected=JSON.stringify(currentRecord),count=currentQuarterCount;
    try {
        const value=await runTransaction(db,async tx=>{
            const ref=doc(db,'matchRecords',date), snap=await tx.get(ref), existing=snap.exists()?snap.data():null;
            if(JSON.stringify(existing)!==expected)throw new Error('다른 기기에서 기록을 수정했습니다. 덮어쓰지 않았습니다. 다시 불러와 확인하세요.');
            const value={...existing,
            date,
            teamsSnapshot,                                     // 저장 당시 팀 명단 (이후 팀배정이 바뀌어도 기록은 그대로)
            quarterCount:count,
            quarters:{...existing?.quarters,...Object.fromEntries(Object.entries(quarters).map(([key,value])=>[key,{...existing?.quarters?.[key],...value}]))},
            eloApplied: !!existing?.eloApplied, // 이미 보정했으면 플래그 유지
            lastUpdatedAt: serverTimestamp()
            };tx.set(ref,value);return value;
        });
        if(dateInput.value===date) {currentRecord=value;await loadDate();}
        window.showNotification(`${date} 스코어 ${Object.keys(quarters).length}개 쿼터 저장 완료!`);
        renderEloBox();
    } catch (e) {
        window.showNotification('저장 실패: ' + e.message, 'error');
    } finally {saving=false;document.getElementById('record-save-btn').disabled=loadedDate!==dateInput.value;}
}

// Team results cannot establish individual skill: do not write players here.
function renderEloBox() {
    if(!eloBox)return;
    eloBox.innerHTML=`<h3 class="text-xl font-bold mb-2">선수 평가는 8주 단위로</h3>
    <p>승패만으로 능력치를 올리거나 내리지 않습니다. 휴식·심판, 상대 전력, 포지션과 호흡이 결과에 영향을 주기 때문입니다.</p>
    <p>8주 동안 같은 역할에서의 기본기·판단·협력을 관찰하고, 선수 본인의 의견과 함께 감독이 검토해 주세요. 변경이 필요하면 선수 관리에서 직접 조정합니다.</p>
    ${currentRecord?.eloApplied?'<p class="coach-note">과거 자동 보정 이력은 보존되어 있습니다. 이 화면에서는 재반영하거나 되돌리지 않습니다.</p>':''}`;
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
                <p class="text-sm text-gray-400">아직 투표가 없습니다. 회원들은 <b>다음 경기 참석 투표의 ‘지난 경기 활약투표’</b>에서 경기 후 '오늘 잘한 3명'을 뽑을 수 있습니다. (1순위 3점 · 2순위 2점 · 3순위 1점)</p>`;
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
            Object.entries(rec.quarters || {}).filter(([key])=>Number(key.replace('q_',''))<(rec.quarterCount===4?4:6)).forEach(([,q]) => {
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
            <thead class="text-xs text-gray-600 uppercase bg-gray-50"><tr><th class="py-2 px-3">이름</th><th class="py-2 px-3 text-center">기록일수</th><th class="py-2 px-3 text-center">소속 팀 쿼터 승-무-패</th><th class="py-2 px-3 text-center">소속 팀 승률</th><th class="py-2 px-3 text-center">활약점수</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    } catch (e) {
        console.error(e);
        seasonBox.innerHTML = '<p class="text-sm text-red-500">집계에 실패했습니다.</p>';
    }
}
