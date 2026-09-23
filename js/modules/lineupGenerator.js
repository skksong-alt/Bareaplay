// js/modules/lineupGenerator.js
// [v-매치사이즈 업데이트] 9vs9(3-4-1 고정) / 10vs10(3-4-2 고정) / 11vs11(자유) 경기 인원 선택 지원
//  - 휴식·심판 로테이션 로직은 기존과 동일 (매 쿼터 휴식 인원 = 명단 − 경기 인원)
import { roleTip, applyLocks, validateLineup, historyBonus, candidateCost, effectivePlayer } from './coachCore.js?v=1';
import { planDuties } from './dutyRotation.js?v=1';
let state;
let generateLineupButton, lineupDisplay, loadingLineupSpinner, placeholderLineup;
let teamSelectTabsContainer, lineupMembersTextarea;
let activeTeamIndex = -1;
let quarterView='0';

// [기능] 한글 자모 분리 현상 해결을 위한 정규화 함수
function normalizeName(name) {
    return name ? name.normalize('NFC').trim() : '';
}

// [성향] 포지션 → 라인 분류 (성향 제안·점수 계산 공용)
function lineOfPos(pos) {
    const p = String(pos || '').toUpperCase();
    if (p === 'GK') return 'GK';
    if (['LB', 'RB', 'CB', 'DF'].includes(p)) return 'DEF';
    if (['MF', 'CM'].includes(p)) return 'MID';
    if (['LW', 'RW', 'FW'].includes(p)) return 'ATT';
    return 'ETC';
}
const LINE_KO = { DEF: '수비', MID: '미들', ATT: '공격', GK: 'GK' };

// Display saved/generated shared referees without rewriting historical lineups on load.
function applySharedReferees() {
    const cache = state.teamLineupCache || {};
    return Array.from({length:6},(_,q)=>{
        for(const result of Object.values(cache)) {
            const name=Array.isArray(result.referees)?result.referees[q]:result.referees?.[`q${q+1}`]||result.referees?.[`q_${q}`];
            if(!name)continue;
            const team=Object.keys(cache).find(t=>{
                const rests=cache[t].resters;
                return (Array.isArray(rests)?rests[q]:rests?.[`q${q+1}`]||rests?.[`q_${q}`])?.includes(name);
            });
            if(team!==undefined)return {name,team:Number(team)};
        }
        return null;
    });
}

// [기능 1] 9인(3-4-1), 10인(3-4-2) 포메이션 좌표 추가
const posCellMap = { 
    '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], 
    '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], 
    '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], 
    '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ],
    '3-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 65, y: 25}, {pos: 'FW', x: 35, y: 25} ],
    '3-4-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 50, y: 20} ]
};

// [v-매치사이즈] 경기 인원(9vs9 / 10vs10 / 11vs11)별 허용 포메이션
// - 9vs9·10vs10은 쓰리백 유지: 10vs10 = 3-4-2 고정, 9vs9 = 3-4-1 고정
// - 11vs11은 기존 4가지 포메이션 자유 선택
let matchSize = 11;
const FORMATIONS_BY_SIZE = {
    11: ['4-4-2', '4-3-3', '3-5-2', '4-2-3-1'],
    10: ['3-4-2'],
    9: ['3-4-1']
};
const DEFAULT_FORMATION_BY_SIZE = { 11: '4-2-3-1', 10: '3-4-2', 9: '3-4-1' };

function formationSelects() {
    return Array.from(document.querySelectorAll('#page-lineup select[id^="formation-q"]'));
}

// 저장된 포메이션 배열에서 경기 인원 역추론 (팀 탭 전환 시 캐시 복원용)
function matchSizeOfFormations(formations) {
    if (!Array.isArray(formations) || formations.length === 0) return 11;
    const f = formations[0];
    if (FORMATIONS_BY_SIZE[9].includes(f)) return 9;
    if (FORMATIONS_BY_SIZE[10].includes(f)) return 10;
    return 11;
}

// 경기 인원 변경: 버튼 활성 표시 + 쿼터별 포메이션 옵션 재구성 (9·10인은 단일 옵션 고정)
function setMatchSize(size, keepFormations = null) {
    if (!FORMATIONS_BY_SIZE[size]) size = 11;
    matchSize = size;
    document.querySelectorAll('.match-size-btn').forEach(btn => {
        const active = parseInt(btn.dataset.size, 10) === size;
        btn.classList.toggle('bg-teal-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('border-teal-600', active);
        btn.classList.toggle('bg-white', !active);
        btn.classList.toggle('text-gray-600', !active);
        btn.classList.toggle('border-gray-300', !active);
    });
    const hint = document.getElementById('match-size-hint');
    if (hint) {
        hint.textContent = size === 11
            ? '11vs11 · 쿼터별 포메이션 자유 선택'
            : (size === 10 ? '10vs10 · 쓰리백 유지 (3-4-2 고정)' : '9vs9 · 쓰리백 유지 (3-4-1 고정)');
    }
    const opts = FORMATIONS_BY_SIZE[size];
    formationSelects().forEach((sel, qIndex) => {
        const prev = keepFormations ? keepFormations[qIndex] : sel.value;
        sel.innerHTML = opts.map(f => `<option${f === DEFAULT_FORMATION_BY_SIZE[size] ? ' selected' : ''}>${f}</option>`).join('');
        if (opts.includes(prev)) sel.value = prev;
    });
}

function resetLineupUI() {
    loadingLineupSpinner.classList.add('hidden');
    generateLineupButton.disabled = false;
    generateLineupButton.textContent = '라인업 생성!';
}

function createPitchHTML() { 
    return `<div class="pitch w-full h-full relative border-2 border-white bg-green-600 bg-opacity-90 rounded-lg overflow-hidden" style="aspect-ratio: 7/10;">
        <div class="pitch-line absolute bg-white/60" style="top:50%; left:0; width:100%; height:1px;"></div>
        <div class="center-circle absolute border border-white/60 rounded-full" style="top:50%; left:50%; width:25%; height:17.5%; transform: translate(-50%,-50%);"></div>
        <div class="pitch-line absolute bg-white rounded-full" style="top:50%; left:50%; width:2px; height:2px; transform: translate(-50%, -50%);"></div>
        <div class="pitch-line absolute border border-white/60 border-b-0" style="top:83%; left:20%; width:60%; height:17%;"></div>
        <div class="pitch-line absolute border border-white/60 border-t-0" style="top:0%; left:20%; width:60%; height:17%;"></div>
    </div>`; 
}

function createPlayerMarker(name, pos, id, isMini = false) {
    const marker = document.createElement('div');
    marker.className = 'player-marker absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 cursor-grab transition-transform hover:scale-110 z-10';
    marker.dataset.name = name;
    marker.dataset.pos = pos;
    marker.dataset.id = `${pos}-${id}`;
    marker.draggable = name !== '미배정' && state.isAdmin;
    
    const sizeClass = isMini ? 'w-6 h-6 text-xs' : 'w-10 h-10 text-lg';
    const nameClass = isMini ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5';

    let icon = '❓', bgColor = '#78909C';
    if (pos === "GK") { icon = "🧤"; bgColor = "#00C853"; } 
    else if (["LB", "RB", "CB", "DF"].includes(pos)) { icon = "🛡"; bgColor = "#03A9F4"; } 
    else if (["MF", "CM"].includes(pos)) { icon = "⚙"; bgColor = "#FFEB3B"; } 
    else if (["LW", "RW", "FW"].includes(pos)) { icon = "🎯"; bgColor = "#FF9800"; }
    else if (pos === 'sub' || pos === 'rest') { icon = '🛌'; bgColor = '#9E9E9E'; marker.style.position = 'relative'; marker.style.transform = 'none'; }
    else if (pos === 'ref') { icon = '⚖️'; bgColor = '#000000'; marker.style.position = 'relative'; marker.style.transform = 'none'; } 
    
    const contentHtml = (name === '미배정') 
        ? `<div class="player-icon ${sizeClass} rounded-full flex items-center justify-center border-2 border-white text-white shadow-sm" style="background-color: ${bgColor}; border-style: dashed;">${icon}</div>
           <div class="player-name ${nameClass} bg-black/60 text-white rounded mt-0.5 whitespace-nowrap">미배정</div>` 
        : `<div class="player-icon ${sizeClass} rounded-full flex items-center justify-center border-2 border-white text-white shadow-sm" style="background-color: ${bgColor};">${icon}</div>
           <div class="player-name ${nameClass} bg-black/60 text-white rounded mt-0.5 whitespace-nowrap">${name}</div>`;
    
    marker.innerHTML = contentHtml;
    return marker;
}

function findInLineup(lineup, name) {
    for (const pos in lineup) {
        const idx = lineup[pos].indexOf(name);
        if (idx > -1) return { pos, idx };
    }
    return null;
}

// [수정] 선수 교체 공통 함수 (드래그와 탭이 함께 사용)
async function performSwap(qIndex, dragInfo, targetInfo) {
    if (!state.isAdmin) return;
    if([dragInfo.posType,targetInfo.posType].some(pos=>['ref','rest','GK'].includes(pos)) || state.lineupResults?.lineups?.[qIndex]?.GK?.some(n=>[dragInfo.name,targetInfo.name].includes(n))) {
        window.showNotification('심판·키퍼·휴식은 투표 시각 순번으로 배정합니다. 필드 포지션끼리만 교체할 수 있습니다.','error');return;
    }
    const teamAtStart=activeTeamIndex;
    try { if(window.prepareCoach) await window.prepareCoach(); }
    catch(error) {window.showNotification(error.message || '고정 조건 조회 실패', 'error');return;}
    if(teamAtStart!==activeTeamIndex)return;
    const locks = state.coachDate === document.getElementById('balancer-date')?.value ? state.coachPlan?.lineupLocks?.[activeTeamIndex] || [] : [];
    if (locks.some(l => l.q === qIndex && [dragInfo.name,targetInfo.name].includes(l.name))) {
        window.showNotification('고정된 선수입니다. 감독 보드에서 해당 쿼터 고정을 해제하세요.', 'error'); return;
    }
    const lineup = state.lineupResults.lineups[qIndex];
    const resters = state.lineupResults.resters[qIndex];

    // [추가] 심판이 관여하는 교체 처리
    const a = dragInfo, b = targetInfo;
    if (a.posType === 'ref' || b.posType === 'ref') {
        if (!Array.isArray(state.lineupResults.manualReferees)) {
            state.lineupResults.manualReferees = [null, null, null, null, null, null];
        }
        const aRef = a.posType === 'ref';
        const refM = aRef ? a : b;     // 심판 마커
        const other = aRef ? b : a;    // 상대 마커(필드 또는 휴식)
        const refIsDragged = aRef;     // 심판을 끌어서 상대에게 놓았는가

        // 심판이 지금 보는 팀 소속이 아니면(=상대팀 휴식자가 심판) 이 화면에선 변경 불가
        if (refM.team !== undefined && refM.team !== '' && Number(refM.team) !== activeTeamIndex) {
            window.showNotification(`이 심판은 팀 ${Number(refM.team) + 1} 탭에서 변경할 수 있습니다.`, 'error');
            return;
        }
        if (other.posType === 'ref') return; // 심판 ↔ 심판: 변화 없음

        const refIdxRest = resters.indexOf(refM.name);

        if (other.posType === 'rest') {
            // 심판 ↔ 휴식자: 위치는 그대로, 휴식자 쪽을 새 심판으로 지정
            state.lineupResults.manualReferees[qIndex] = other.name;
        } else {
            // 심판 ↔ 필드 선수: 실제로 자리를 맞바꾼다 (심판은 휴식자이므로 휴식↔필드와 동일)
            const t_loc = findInLineup(lineup, other.name);
            if (refIdxRest > -1 && t_loc) {
                const refPlayer = resters.splice(refIdxRest, 1)[0];
                const fieldPlayer = lineup[t_loc.pos].splice(t_loc.idx, 1)[0];
                resters.push(fieldPlayer);
                lineup[t_loc.pos].push(refPlayer);
                // 심판을 필드로 끌어냈으면 자동 재배정, 필드 선수를 심판으로 끌어왔으면 그 선수를 심판으로 지정
                state.lineupResults.manualReferees[qIndex] = refIsDragged ? null : other.name;
            }
        }

        if (state.teamLineupCache && activeTeamIndex !== -1) {
            state.teamLineupCache[activeTeamIndex] = state.lineupResults;
        }
        renderAllQuarters();
        window.saveDailyMeetingData();
        window.showNotification(`${a.name} ↔ ${b.name} 교체!`);
        return;
    }

    const draggingName = dragInfo.name, draggingPosType = dragInfo.posType;
    const targetName = targetInfo.name, targetPosType = targetInfo.posType;

    const d_loc_lineup = findInLineup(lineup, draggingName);
    const d_loc_rest = resters.indexOf(draggingName);
    const t_loc_lineup = findInLineup(lineup, targetName);
    const t_loc_rest = resters.indexOf(targetName);

    if (draggingPosType !== 'rest' && targetPosType !== 'rest') {
        if (d_loc_lineup && t_loc_lineup) {
            lineup[d_loc_lineup.pos][d_loc_lineup.idx] = targetName;
            lineup[t_loc_lineup.pos][t_loc_lineup.idx] = draggingName;
        }
    } else if (draggingPosType !== 'rest' && targetPosType === 'rest') {
        if (d_loc_lineup && t_loc_rest > -1) {
            const playerFromPitch = lineup[d_loc_lineup.pos].splice(d_loc_lineup.idx, 1)[0];
            const playerFromRest = resters.splice(t_loc_rest, 1)[0];
            lineup[d_loc_lineup.pos].push(playerFromRest);
            resters.push(playerFromPitch);
        }
    } else if (draggingPosType === 'rest' && targetPosType !== 'rest') {
        if (d_loc_rest > -1 && t_loc_lineup) {
            const playerFromRest = resters.splice(d_loc_rest, 1)[0];
            const playerFromPitch = lineup[t_loc_lineup.pos].splice(t_loc_lineup.idx, 1)[0];
            resters.push(playerFromPitch);
            lineup[t_loc_lineup.pos].push(playerFromRest);
        }
    } else {
        return; // 휴식자끼리는 교체할 필요 없음
    }

    if (state.teamLineupCache && activeTeamIndex !== -1) {
        state.teamLineupCache[activeTeamIndex] = state.lineupResults;
    }
    // [학습] 운영진의 수동 교체를 조용히 기록 → 반복 패턴이 쌓이면 '성향 제안 카드'로 표시됨
    if (window.logAdjustment) {
        window.logAdjustment({
            kind: 'lineup-swap', team: activeTeamIndex, q: qIndex,
            moves: [
                { name: draggingName, to: targetPosType },
                { name: targetName, to: draggingPosType }
            ]
        });
    }
    renderAllQuarters();
    window.saveDailyMeetingData();
    window.showNotification(`${draggingName} ↔ ${targetName} 교체!`);
}

// [수정] PC 드래그 + 모바일 '탭 두 번' 교체 모두 지원
let selectedSwapInfo = null;

function addDragAndDropHandlers() {
    selectedSwapInfo = null;
    const markers = document.querySelectorAll('.player-marker');

    markers.forEach(marker => {
        // --- PC: 드래그 앤 드롭 ---
        if (marker.draggable) {
            marker.addEventListener('dragstart', (e) => {
                marker.classList.add('dragging');
                const qb = marker.closest('.quarter-block');
                if (qb) e.dataTransfer.setData('text/quarter', qb.dataset.q);
            });
            marker.addEventListener('dragend', () => marker.classList.remove('dragging'));
        }
        marker.addEventListener('dragover', e => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            if (dragging && marker !== dragging) marker.classList.add('drop-target');
        });
        marker.addEventListener('dragleave', () => marker.classList.remove('drop-target'));
        marker.addEventListener('drop', e => {
            e.preventDefault();
            marker.classList.remove('drop-target');
            const dragging = document.querySelector('.dragging');
            if (!dragging || marker === dragging) return;
            const qb = marker.closest('.quarter-block');
            if (!qb) return;
            const qIndex = parseInt(qb.dataset.q, 10);
            const sourceQ = e.dataTransfer.getData('text/quarter');
            if (sourceQ && parseInt(sourceQ, 10) !== qIndex) {
                window.showNotification('다른 쿼터로 선수를 이동할 수 없습니다.', 'error');
                return;
            }
            performSwap(qIndex,
                { name: dragging.dataset.name, posType: dragging.dataset.pos, team: dragging.dataset.team },
                { name: marker.dataset.name, posType: marker.dataset.pos, team: marker.dataset.team });
        });

        // --- 모바일/PC 공통: 탭(클릭) 두 번으로 교체 ---
        marker.addEventListener('click', () => {
            if (!state.isAdmin) return;
            if (marker.dataset.name === '미배정') return;
            const qb = marker.closest('.quarter-block');
            if (!qb) return;
            const qIndex = parseInt(qb.dataset.q, 10);

            // 첫 번째 탭: 선수 선택
            if (!selectedSwapInfo) {
                selectedSwapInfo = { qIndex, name: marker.dataset.name, posType: marker.dataset.pos, team: marker.dataset.team };
                marker.classList.add('selected-for-swap');
                window.showNotification(`${marker.dataset.name} 선택됨. 바꿀 선수를 탭하세요.`);
                return;
            }
            // 같은 선수 다시 탭: 선택 취소
            if (selectedSwapInfo.name === marker.dataset.name && selectedSwapInfo.qIndex === qIndex) {
                selectedSwapInfo = null;
                document.querySelectorAll('.selected-for-swap').forEach(el => el.classList.remove('selected-for-swap'));
                window.showNotification('선택이 취소되었습니다.');
                return;
            }
            // 다른 쿼터 선수 탭: 안내
            if (selectedSwapInfo.qIndex !== qIndex) {
                window.showNotification('같은 쿼터 안에서만 교체할 수 있습니다.', 'error');
                return;
            }
            // 두 번째 탭: 교체 실행
            const first = selectedSwapInfo;
            selectedSwapInfo = null;
            performSwap(qIndex,
                { name: first.name, posType: first.posType, team: first.team },
                { name: marker.dataset.name, posType: marker.dataset.pos, team: marker.dataset.team });
        });
    });
}


function renderAllQuarters() {
    if (!lineupDisplay) return;
    lineupDisplay.innerHTML = ''; 
    lineupDisplay.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"; 

    if (!state.lineupResults || !state.lineupResults.lineups) return;
    const viewBar=document.createElement('div');viewBar.className='lineup-view-bar';viewBar.style.gridColumn='1 / -1';
    viewBar.setAttribute('aria-label','표시할 쿼터');
    const updateView=()=>{
        lineupDisplay.style.gridTemplateColumns=quarterView==='all'?'':'minmax(0, 1fr)';
        lineupDisplay.querySelectorAll('.quarter-block').forEach(block=>block.hidden=quarterView!=='all'&&block.dataset.q!==quarterView);
        viewBar.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===quarterView)));
    };
    for(const [value,label] of [...Array.from({length:6},(_,q)=>[String(q),`${q+1}쿼터`]),['all','전체 보기']]){
        const button=document.createElement('button');button.type='button';button.dataset.view=value;button.textContent=label;
        button.onclick=()=>{quarterView=value;updateView();};viewBar.append(button);
    }
    lineupDisplay.append(viewBar);

    const sharedReferees = applySharedReferees(); // [수정] 양팀 공동 심판 계산
    const dutyNote=document.createElement('p');dutyNote.className='coach-note';dutyNote.style.gridColumn='1 / -1';
    dutyNote.textContent='심판: 전체 투표순 · 키퍼/휴식: 팀별 투표순 · 늦은 신청부터 순환 · 전담 GK 예외. '+(state.dutyNotes||[]).join(' ');
    lineupDisplay.append(dutyNote);

    for (let qIndex = 0; qIndex < 6; qIndex++) {
        const lineup = state.lineupResults.lineups[qIndex];
        const formation = state.lineupResults.formations[qIndex];
        const resters = state.lineupResults.resters[qIndex] || [];
        const refInfo = sharedReferees[qIndex] || null;
        const referees = refInfo ? [refInfo.name] : [];

        const quarterBlock = document.createElement('div');
        quarterBlock.className = 'quarter-block bg-gray-50 p-3 rounded-lg shadow border border-gray-200 flex flex-col';
        quarterBlock.dataset.q = qIndex;

        const title = document.createElement('h4');
        title.className = 'font-bold text-center mb-2 text-indigo-800';
        title.textContent = `${qIndex + 1}쿼터 (${formation})`;
        quarterBlock.appendChild(title);

        const pitchWrapper = document.createElement('div');
        pitchWrapper.className = 'relative w-full mb-2';
        pitchWrapper.innerHTML = createPitchHTML();
        const pitch = pitchWrapper.querySelector('.pitch');

        const formationLayout = posCellMap[formation] || [];
        let counters = {};
        
        formationLayout.forEach((fc, index) => {
            const pos = fc.pos;
            counters[pos] = (counters[pos] || 0);
            let name = (lineup[pos] || [])[counters[pos]] || '미배정';
            counters[pos]++;
            const marker = createPlayerMarker(name, pos, index, true); 
            marker.style.left = `${fc.x}%`; 
            marker.style.top = `${fc.y}%`;
            pitch.appendChild(marker);
        });
        quarterBlock.appendChild(pitchWrapper);

        // 휴식/심판 패널
        const restPanel = document.createElement('div');
        restPanel.className = 'mt-auto pt-2 border-t border-gray-200';
        
        // 심판 표시 (담당 팀 표기, 양팀 화면 모두에 표시됨)
        let refHtml = '';
        if (referees.length > 0) {
            const refTeamLabel = refInfo ? ` (팀${refInfo.team + 1} 휴식자)` : '';
            const refMarkersHtml = referees.map(r => {
                const rm = createPlayerMarker(r, 'ref', r, true);
                if (refInfo) rm.dataset.team = refInfo.team;
                return rm.outerHTML;
            }).join('');
            refHtml = `<div class="flex flex-col items-center mb-2"><span class="text-xs font-bold text-black mb-1">심판${refTeamLabel}</span><div class="flex gap-1">${refMarkersHtml}</div></div>`;
        }
        
        // 순수 휴식 인원 (심판 제외)
        const pureResters = resters.filter(r => !referees.includes(r));
        const restHtml = pureResters.length > 0 
            ? `<div class="flex flex-wrap gap-1 justify-center">${pureResters.map(r => createPlayerMarker(r, 'rest', r, true).outerHTML).join('')}</div>`
            : '<p class="text-xs text-gray-400 text-center">휴식 없음</p>';
        
        restPanel.innerHTML = `${refHtml}<div class="text-xs font-bold text-gray-600 mb-1 text-center">휴식 / 대기</div>${restHtml}`;
        quarterBlock.appendChild(restPanel);

        const instructions = document.createElement('details');
        instructions.className = 'text-xs mt-2 p-2 bg-white rounded';
        const summary = document.createElement('summary'); summary.textContent = '이번 쿼터 역할'; instructions.append(summary);
        Object.entries(lineup).forEach(([pos,names]) => {
            const p = document.createElement('p'); p.className='mt-2';
            p.textContent = `${names.join(', ')} (${pos}): ${roleTip(pos,formation)}`; instructions.append(p);
        });
        quarterBlock.append(instructions);

        lineupDisplay.appendChild(quarterBlock);
    }
    // [중요] 렌더링 후 드래그 핸들러 연결
    updateView();
    addDragAndDropHandlers();
}

// [기능 2, 3] 심판 및 슈퍼 GK 로직이 반영된 실행 함수
async function executeLineupGeneration(members, formations, isSilent = false, options = {}) {
    let chronologicalOrder=state.initialAttendeeOrder || [];
    if(window.voteMgmt?.getDutyOrder) {
        const requestedDate=document.getElementById('balancer-date')?.value;
        try {
            chronologicalOrder=await window.voteMgmt.getDutyOrder(requestedDate);
            if(document.getElementById('balancer-date')?.value!==requestedDate)throw new Error('날짜가 바뀌어 배정을 중단했습니다.');
        }
        catch(e) { window.showNotification(e.message || '투표 시각을 확인하지 못해 배정을 중단했습니다.','error');return null; }
    }
    return new Promise(resolve => {
        if(new Set(members).size!==members.length || members.some(n=>!n) || formations.length!==6) { resolve(null);return; }
        // [v-매치사이즈] 인원 검증 및 자동 전환
        // - 선택한 포메이션(경기 인원)보다 명단이 적으면 한 단계 아래로 자동 전환
        //   (10명 → 10vs10 · 3-4-2 / 9명 → 9vs9 · 3-4-1)  ※ 쓰리백 유지 규칙
        // - 휴식·심판 로테이션은 기존 그대로: 매 쿼터 휴식 인원 = 명단 − 경기 인원
        if (members.length < 9) {
            if(!isSilent) window.showNotification("최소 9명의 선수가 필요합니다.", 'error');
            resolve(null); return;
        }
        const requiredOnField = Math.max(...formations.map(f => (posCellMap[f] || []).length));
        if (members.length < requiredOnField) {
            if (members.length >= 10) {
                formations = Array(6).fill('3-4-2');
                if(!isSilent) window.showNotification("명단이 10명이므로 10vs10(3-4-2) 포메이션으로 자동 전환됩니다.");
            } else {
                formations = Array(6).fill('3-4-1');
                if(!isSilent) window.showNotification("명단이 9명이므로 9vs9(3-4-1) 포메이션으로 자동 전환됩니다.");
            }
        }

        const initialOrder = chronologicalOrder.map(name => normalizeName(name));
        const sortedMembers = [...members].sort((a, b) => { 
            const indexA = initialOrder.indexOf(normalizeName(a)); 
            const indexB = initialOrder.indexOf(normalizeName(b)); 
            if (indexA === -1) return 1; 
            if (indexB === -1) return -1; 
            return indexA - indexB; 
        });

        const localPlayerDB = {};
        members.forEach(name => { localPlayerDB[name] = effectivePlayer(state.playerDB[name] || { name, pos1: [], s1: 65, pos2: [], s2: 0 }, state.coachProfiles); });

        const primaryGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK'));
        const secondaryGks = members.filter(m => !(localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));
        // [기능 3] 1,2지망 모두 GK인 '슈퍼 GK' 식별
        const superGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));
        // [추가] 키퍼 최소 1회 보장 대상: 주/부에 GK가 있으나 전담(슈퍼GK)은 아닌 선수
        const gkGuarColumn = members.filter(m => !superGks.includes(m) && ((localPlayerDB[m].pos1 || []).includes('GK') || (localPlayerDB[m].pos2 || []).includes('GK')));
        const hasDedicatedGk = superGks.length > 0;
        const squads=(state.teams?.length?state.teams.map(team=>team.map(p=>normalizeName(String(p.name).replace(' (신규)','')))):[members]);
        const squadIndex=squads.findIndex(team=>team.length===members.length&&members.every(n=>team.includes(n)));
        if(squadIndex<0){window.showNotification('선택 팀과 참가 명단이 다릅니다. 팀 명단을 먼저 확인해 주세요.','error');resolve(null);return;}
        const counts=squads.map((team,t)=>Array.from({length:6},(_,q)=>{
            const f=t===squadIndex?formations[q]:state.teamLineupCache?.[t]?.formations?.[q]||formations[q];
            return Math.min(team.length,(posCellMap[f]||[]).length);
        }));
        const allDedicated=squads.flat().filter(n=>{
            const p=effectivePlayer(state.playerDB[n]||{name:n},state.coachProfiles);
            return p.pos1?.includes('GK')&&p.pos2?.includes('GK');
        });
        let duties;
        try { duties=planDuties(squads,initialOrder,counts,allDedicated); }
        catch(e){window.showNotification(e.message,'error');resolve(null);return;}
        const duty=duties.teams[squadIndex];
        state.dutyNotes=duties.notes;
        const rankOf = (m) => { const i = initialOrder.indexOf(normalizeName(m)); return i === -1 ? 9999 : i; }; // 클수록 명단 아래(늦은 투표)

        // [재설계] 선호 포지션 보장 + 무작위 탐색
        // 규칙: 주포지션 우선 → 같은 자리 경쟁 시 점수 높은 사람 먼저, 낮은 사람은 부포지션
        //       → 그래도 겹치면 같은 라인(공/미/수)의 남는 자리 → 그래도 안되면 최대한 공평
        //       단, 점수 낮은 사람도 주포지션을 최소 2회(가능하면 3회) 뛰도록 보장
        //       (이를 위해 점수 높은 사람은 일부 쿼터에 부포지션을 맡음)
        const LINE_OF = (pos) => {
            if (pos === 'GK') return 'GK';
            if (['LB', 'RB', 'CB', 'DF'].includes(pos)) return 'DEF';
            if (['MF', 'CM'].includes(pos)) return 'MID';
            if (['LW', 'RW', 'FW'].includes(pos)) return 'ATT';
            return 'ETC';
        };
        const linesOfPos1 = (p) => new Set((p.pos1 || []).map(LINE_OF));
        const shuffleArr = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

        let bestLineup = null;
        let bestCost = Infinity;
        const TRIAL = 400;
        const GUARANTEE = 2;     // 주포지션 최소 보장 횟수
        const PREF_TARGET = 3;   // 가능하면 여기까지 시켜주려 시도

        for (let tr = 0; tr < TRIAL; tr++) {
            // [개편] 휴식·심판을 '누적 횟수' 기반으로 공정 배분 (이전 큐/포인터 방식은 직전 키퍼 스킵 때문에
            //         로테이션 정렬이 어긋나 일부가 2번 연속 쉬고 일부는 한 번도 못 쉬는 문제가 있었음 → 해결)
            //  - 전담 키퍼(superGk)는 휴식 로테이션에서 제외 (항상 골문)
            //  - 휴식: 누적 휴식 수가 적은 사람 우선, 동률이면 늦은 투표(명단 아래)부터 → 전원이 ±1 이내로 공평
            const lineups = [];
            const resters = [];
            const referees = [];

            const pos1Usage = {};
            const pos2Usage = {};
            const onFieldCount = {};
            const gkCount = {};                 // 각자 키퍼 맡은 횟수
            const restCount = {};               // [추가] 각자 휴식한 횟수 (공정 배분용)
            const refCount = {};                // [추가] 각자 심판 본 횟수 (공정 배분용)
            const wishUsage = {};               // [성향] 각자 '희망 포지션'을 맡은 횟수 (wishQuota 보장용)
            members.forEach(m => { pos1Usage[m] = 0; pos2Usage[m] = 0; onFieldCount[m] = 0; gkCount[m] = 0; restCount[m] = 0; refCount[m] = 0; wishUsage[m] = 0; });
            let gkLast = null;                  // 직전 쿼터 키퍼(전담 제외)
            let restRefLast = new Set();        // 직전 쿼터 휴식/심판자 집합

            let qualityCost = 0; // 포지션 적합도 비용 (낮을수록 좋음)

            for (let q = 0; q < 6; q++) {
                const formation = formations[q];
                const slots = posCellMap[formation]?.map(c => c.pos) || [];
                const numToRest = members.length - slots.length;

                // ---- 휴식 선정: 누적 휴식 수가 적은 사람 우선, 동률이면 늦은 투표(아래)부터. 직전 키퍼(전담 제외)는 이번 휴식 제외 ----
                const quarterResters = [...duty.resters[q]];
                quarterResters.forEach(m => restCount[m]++);
                resters.push(quarterResters);

                // ---- 심판 배정: 휴식자 중 심판을 적게 본 사람 우선, 동률이면 늦은 투표(아래)부터 ----
                const assignedRef = duty.referees[q];
                if(quarterResters.includes(assignedRef))refCount[assignedRef]++;
                referees.push(assignedRef);

                let onField = sortedMembers.filter(m => !quarterResters.includes(m));
                onField.forEach(m => onFieldCount[m]++);
                let assignment = {};
                let availablePlayers = [...onField];

                // ---- 키퍼(GK) 배정: 전담 우선 / 그 외엔 투표 아래부터 로테이션 + 공정성 제약 ----
                let assignedGk = null;
                const gkSlotExists = slots.includes('GK');
                if (gkSlotExists) {
                    assignedGk = duty.gks[q];
                    if (assignedGk) {
                        assignment['GK'] = [assignedGk];
                        availablePlayers.splice(availablePlayers.indexOf(assignedGk), 1);
                        gkCount[assignedGk]++;
                        const gp = localPlayerDB[assignedGk];
                        if ((gp.wishPos || []).includes('GK')) wishUsage[assignedGk]++; // [성향]
                        if ((gp.pos1 || []).includes('GK')) { pos1Usage[assignedGk]++; }
                        else if ((gp.pos2 || []).includes('GK')) { pos2Usage[assignedGk]++; qualityCost += 2; }
                        else { qualityCost += 5; }
                    }
                }

                // ---- 필드 포지션 배정 (슬롯 순서를 매 시도마다 섞어 다양성 확보) ----
                const fieldSlots = shuffleArr(slots.filter(s => s !== 'GK'));
                for (const pos of fieldSlots) {
                    assignment[pos] = assignment[pos] || [];
                    if (availablePlayers.length === 0) { assignment[pos].push(null); continue; }
                    const posLine = LINE_OF(pos);
                    let bestPlayer = availablePlayers[0], bestVal = -Infinity;
                    for (const playerName of availablePlayers) {
                        const player = localPlayerDB[playerName];
                        const isPos1 = (player.pos1 || []).includes(pos);
                        const isPos2 = (player.pos2 || []).includes(pos);
                        const sameLine = linesOfPos1(player).has(posLine);
                        let val;
                        if (isPos1) {
                            // 주포지션: 아직 목표(3회)에 못 미친 사람일수록 우선권 ↑ (점수 낮아도 차례가 옴)
                            const need = Math.max(0, PREF_TARGET - (pos1Usage[playerName] || 0));
                            val = 1000 + need * 220 + (player.s1 || 65) * 0.6;
                        } else if (isPos2) {
                            val = 500 + (player.s2 || 0) * 0.6;
                        } else if (sameLine) {
                            val = 200 + (player.s1 || 65) * 0.3;
                        } else {
                            val = 30 + (player.s1 || 65) * 0.1;
                        }
                        // [성향 1] 본인 희망 포지션 보장: wishQuota(6쿼터 중 N회)에 못 미친 동안 강한 가산점
                        //          → 실제 주포지션과 달라도 '즐기고 가는' 쿼터가 자동으로 확보됨
                        const wq = player.wishQuota || 0;
                        if (wq > 0 && (player.wishPos || []).includes(pos) && (wishUsage[playerName] || 0) < wq) val += 380;
                        val += historyBonus(playerName, pos, state.coachHistory || {}, player);
                        // [성향 2] 좌/우 선호: L*/R* 자리(LW·LB / RW·RB)에서 선호측이면 가산, 반대측이면 감점
                        const sd = player.side || '';
                        if (sd && (pos[0] === 'L' || pos[0] === 'R')) {
                            if (pos[0] === sd) val += 90; else val -= 140;
                        }
                        val += Math.random() * 40; // 시도별 다양성
                        if (val > bestVal) { bestVal = val; bestPlayer = playerName; }
                    }
                    assignment[pos].push(bestPlayer);
                    if (bestPlayer) {
                        availablePlayers.splice(availablePlayers.indexOf(bestPlayer), 1);
                        const pinfo = localPlayerDB[bestPlayer];
                        if ((pinfo.wishPos || []).includes(pos)) wishUsage[bestPlayer] = (wishUsage[bestPlayer] || 0) + 1; // [성향]
                        if (pinfo.side && (pos[0] === 'L' || pos[0] === 'R') && pos[0] !== pinfo.side) qualityCost += 10;  // [성향] 반대측 배치 비용
                        if ((pinfo.pos1 || []).includes(pos)) { pos1Usage[bestPlayer]++; }
                        else if ((pinfo.pos2 || []).includes(pos)) { pos2Usage[bestPlayer]++; qualityCost += 2; }
                        else if (linesOfPos1(pinfo).has(posLine)) { qualityCost += 12; }
                        else { qualityCost += 60; }
                    }
                }
                lineups.push(assignment);

                // [추가] 다음 쿼터 제약용 상태 갱신 (직전 키퍼/휴식/심판 기록)
                if (assignedGk && superGks.includes(assignedGk)) {
                    gkLast = null; restRefLast = new Set();          // 전담 키퍼는 연속 허용
                } else {
                    gkLast = assignedGk || null;
                    restRefLast = new Set(quarterResters);
                    if (assignedRef) restRefLast.add(assignedRef);
                }
            }

            // ---- 최종 비용 계산 ----
            let guaranteeShort = 0; // 주포지션 2회 미달 (최우선 최소화)
            let preferShort = 0;    // 3회 목표 미달 (그 다음 최소화)
            members.forEach(m => {
                const ofq = onFieldCount[m];
                guaranteeShort += Math.max(0, Math.min(GUARANTEE, ofq) - pos1Usage[m]);
                preferShort += Math.max(0, Math.min(PREF_TARGET, ofq) - pos1Usage[m]);
            });

            // [추가] 키퍼 보장: 전담 키퍼가 없을 때, GK 보유자가 한 번도 골문에 안 서면 페널티
            let gkGuaranteeShort = 0;
            if (!hasDedicatedGk) {
                gkGuarColumn.forEach(m => { if ((gkCount[m] || 0) === 0 && onFieldCount[m] > 0) gkGuaranteeShort++; });
            }

            // [제안A] 한 사람이 키퍼를 1회 초과로 맡은 횟수(초과분 합계) → 중복 키퍼 강하게 억제
            let gkOverShort = 0;
            if (!hasDedicatedGk) {
                Object.keys(gkCount).forEach(m => { const c = gkCount[m] || 0; if (c > 1) gkOverShort += (c - 1); });
            }

            // 쿼터별 팀 전력 편차(표시용; 휴식 로테이션이 고정이라 시도와 무관하게 일정)
            const qScores = lineups.map(l => Object.values(l).flat().filter(Boolean).reduce((sum, name) => sum + (localPlayerDB[name]?.s1 || 65), 0));
            const balance = qScores.length > 1 ? Math.max(...qScores) - Math.min(...qScores) : 0;

            // [성향] 희망 포지션 보장(wishQuota) 미달 합계 → 시도 간 비교에서 강하게 최소화
            let wishShort = 0;
            members.forEach(m => {
                const p = localPlayerDB[m];
                const wq = Math.min(p.wishQuota || 0, onFieldCount[m]);
                if (wq > 0) wishShort += Math.max(0, wq - (wishUsage[m] || 0));
            });

            let totalCost = guaranteeShort * 1000 + gkGuaranteeShort * 800 + gkOverShort * 600 + wishShort * 250 + qualityCost + preferShort * 15;
            let candidate = { lineups, resters, referees, members, formations, score: balance, guaranteeShort, preferShort };
            if (options.original) {
                // Field-position preferences cannot exempt a player from their timed duty.
                const fieldLocks=(options.locks || []).filter(({name,q})=>{
                    const old=options.original.lineups?.[q];
                    return !duty.resters[q].includes(name)&&duty.gks[q]!==name&&!old?.GK?.includes(name)&&Object.entries(old||{}).some(([pos,ns])=>pos!=='GK'&&ns.includes(name));
                });
                candidate = applyLocks(candidate, options.original, fieldLocks);
                if (!candidate || !validateLineup(candidate, members)) continue;
                candidate.referees=[...duty.referees];
                delete candidate.manualReferees;
                totalCost = candidateCost(candidate,localPlayerDB,state.coachHistory || {},options.original);
                const scores=candidate.lineups.map(l=>Object.values(l).flat().reduce((s,n)=>s+(localPlayerDB[n]?.s1 ?? 65),0));
                candidate.score=Math.max(...scores)-Math.min(...scores);
            }

            if (totalCost < bestCost) {
                bestCost = totalCost;
                bestLineup = candidate;
            }
        }
        resolve(bestLineup);
    });
}

export function init(dependencies) {
    state = dependencies.state;
    const pageElement = document.getElementById('page-lineup');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg">
            <h2 class="text-2xl font-bold mb-4 border-b pb-2">라인업 조건</h2>
            <div class="mb-4">
                <label class="block text-md font-semibold text-gray-700 mb-2">팀 선택</label>
                <div id="team-select-tabs-container" class="flex flex-wrap gap-2"><p class="text-sm text-gray-500">팀 배정기에서 먼저 팀을 생성해주세요.</p></div>
                <textarea id="lineup-members" class="hidden"></textarea>
            </div>
            <div class="mb-4">
                <label class="block text-md font-semibold text-gray-700 mb-2">경기 인원</label>
                <div id="match-size-tabs" class="flex gap-2">
                    <button type="button" data-size="11" class="match-size-btn flex-1 p-2 rounded-lg border-2 font-semibold transition bg-teal-600 text-white border-teal-600">11vs11</button>
                    <button type="button" data-size="10" class="match-size-btn flex-1 p-2 rounded-lg border-2 font-semibold transition bg-white text-gray-600 border-gray-300">10vs10</button>
                    <button type="button" data-size="9" class="match-size-btn flex-1 p-2 rounded-lg border-2 font-semibold transition bg-white text-gray-600 border-gray-300">9vs9</button>
                </div>
                <p id="match-size-hint" class="text-xs text-gray-500 mt-1">11vs11 · 쿼터별 포메이션 자유 선택</p>
            </div>
            <div class="grid grid-cols-2 gap-4 mb-6">
                <div><label for="formation-q1" class="block text-sm font-medium">1쿼터</label><select id="formation-q1" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q2" class="block text-sm font-medium">2쿼터</label><select id="formation-q2" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q3" class="block text-sm font-medium">3쿼터</label><select id="formation-q3" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q4" class="block text-sm font-medium">4쿼터</label><select id="formation-q4" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q5" class="block text-sm font-medium">5쿼터</label><select id="formation-q5" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q6" class="block text-sm font-medium">6쿼터</label><select id="formation-q6" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
            </div>
            <div class="mt-8"><button id="generateLineupButton" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700 transition-transform transform hover:scale-105 shadow-lg">라인업 생성!</button></div>
            <div id="pref-suggestions" class="mt-4 space-y-2"></div>
        </div>
        <div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg">
            <div class="flex justify-between items-center mb-4 border-b pb-2">
                <h2 class="text-2xl font-bold">라인업 결과 (전체)</h2>
                <div id="loading-lineup" class="hidden"><svg class="animate-spin h-6 w-6 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
            </div>
            <div id="result-container-lineup" class="min-h-[60vh]">
                <div id="placeholder-lineup" class="flex items-center justify-center text-gray-400 h-full">
                    <p>조건을 입력하고 라인업 생성을 눌러주세요.</p>
                </div>
                <div id="lineup-display" class="hidden grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    </div>
            </div>
        </div>
    </div>`;
    
    generateLineupButton = document.getElementById('generateLineupButton');
    lineupDisplay = document.getElementById('lineup-display');
    loadingLineupSpinner = document.getElementById('loading-lineup');
    placeholderLineup = document.getElementById('placeholder-lineup');
    teamSelectTabsContainer = document.getElementById('team-select-tabs-container');
    lineupMembersTextarea = document.getElementById('lineup-members');

    // [v-매치사이즈] 경기 인원 버튼 연결 (관리자 전용)
    document.querySelectorAll('.match-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (pageElement.classList.contains('view-only')) return; // 비관리자 클릭은 아래 공용 핸들러가 처리
            setMatchSize(parseInt(btn.dataset.size, 10));
        });
    });
    setMatchSize(11);

    generateLineupButton.addEventListener('click', async () => {
        if (!state.isAdmin) { window.promptForAdminPassword(); return; }
        try { if (window.prepareCoach) await window.prepareCoach(); }
        catch(error) { window.showNotification(error.message || '고정 조건을 불러오지 못했습니다.', 'error'); return; }
        loadingLineupSpinner.classList.remove('hidden');
        lineupDisplay.classList.add('hidden');
        placeholderLineup.classList.add('hidden');
        generateLineupButton.disabled = true;
        generateLineupButton.textContent = '라인업 생성 중...';
        const members = lineupMembersTextarea.value.split('\n').map(name => name.trim().replace(' (신규)', '')).filter(Boolean);
        const formations = formationSelects().map(s => s.value);
        const locks = state.coachPlan?.lineupLocks?.[activeTeamIndex] || [];
        const original = state.teamLineupCache?.[activeTeamIndex];
        if (locks.length && !original) { window.showNotification('고정할 기존 라인업이 없습니다. 고정 조건을 확인하세요.', 'error'); resetLineupUI(); return; }
        const result = await executeLineupGeneration(members, formations, false, locks.length ? { locks, original } : {});
        if (result) {
            // [v-매치사이즈] 인원 부족으로 자동 전환된 경우 버튼/셀렉트 UI 동기화
            setMatchSize(matchSizeOfFormations(result.formations), result.formations);
            state.lineupResults = result;
            state.teamLineupCache[activeTeamIndex] = result;
            lineupDisplay.classList.remove('hidden');
            placeholderLineup.classList.add('hidden');
            renderAllQuarters(); // 이 안에서 공동 심판이 계산됨
            if(window.shareMgmt && window.shareMgmt.updateLineupData) {
                window.shareMgmt.updateLineupData(state.lineupResults, result.formations);
            }
            if(window.saveDailyMeetingData) window.saveDailyMeetingData();
            window.showNotification(`라인업 생성 완료! (우리 팀 쿼터별 점수 편차: ${result.score.toFixed(1)})`);
        } else {
            window.showNotification('조건을 만족하는 라인업을 찾지 못했습니다. 기존 배정을 유지합니다.', 'error');
            if (original) { state.lineupResults=original; lineupDisplay.classList.remove('hidden'); renderAllQuarters(); }
        }
        resetLineupUI();
        renderPrefSuggestions(); // [학습] 쌓인 드래그 기록에서 반복 패턴을 찾아 제안 카드 표시
    });

    // 관리자 로그인 등 초기화가 끝난 뒤 한 번 시도 (실패해도 무해)
    setTimeout(() => { try { renderPrefSuggestions(); } catch (e) {} }, 5000);
    
    pageElement.addEventListener('click', (e) => {
        if (pageElement.classList.contains('view-only')) {
            if (e.target.closest('select, button, .player-marker')) {
                e.preventDefault();
                e.stopPropagation();
                window.promptForAdminPassword();
            }
        }
    });
}

export function renderTeamSelectTabs(teams) {
    if (!teamSelectTabsContainer) return;
    const previouslyActiveIndex = activeTeamIndex;
    teamSelectTabsContainer.innerHTML = '';
    
    const handleTabClick = (team, index) => {
        activeTeamIndex = index;
        document.querySelectorAll('.team-tab-btn').forEach(btn => btn.classList.remove('active'));
        const currentButton = document.querySelector(`.team-tab-btn[data-team-index="${index}"]`);
        if (currentButton) currentButton.classList.add('active');
        
        lineupMembersTextarea.value = team.map(p => p.name.replace(' (신규)', '')).join('\n');
        
        if (state.teamLineupCache && state.teamLineupCache[index]) {
            state.lineupResults = state.teamLineupCache[index];
            if (state.lineupResults.formations && state.lineupResults.formations.length === 6) {
                // [v-매치사이즈] 저장된 포메이션으로 경기 인원(9/10/11)을 역추론해 UI 복원
                setMatchSize(matchSizeOfFormations(state.lineupResults.formations), state.lineupResults.formations);
            }
            lineupDisplay.classList.remove('hidden');
            placeholderLineup.classList.add('hidden');
            renderAllQuarters();
        } else {
            state.lineupResults = null;
            lineupDisplay.classList.add('hidden');
            placeholderLineup.classList.remove('hidden');
        }
    };

    teams.forEach((team, index) => {
        const teamButton = document.createElement('button');
        teamButton.className = `team-tab-btn p-2 rounded-lg border-2 font-semibold transition team-tab-btn-${(index % 5) + 1}`;
        teamButton.textContent = (window.teamName ? window.teamName(index) : `팀 ${index + 1}`); // [v58] 팀 배정기에서 정한 팀 이름 표시
        teamButton.dataset.teamIndex = index;
        if (index === previouslyActiveIndex) {
            teamButton.classList.add('active');
        }
        teamButton.addEventListener('click', () => handleTabClick(team, index));
        teamSelectTabsContainer.appendChild(teamButton);
    });

    if (teams.length > 0) {
        const currentActive = document.querySelector('.team-tab-btn.active');
        if (currentActive) {
            handleTabClick(teams[previouslyActiveIndex], previouslyActiveIndex);
        } else {
            handleTabClick(teams[0], 0);
        }
    } else {
        lineupDisplay.classList.add('hidden');
        placeholderLineup.classList.remove('hidden');
        lineupMembersTextarea.value = '';
    }
}

export function getPosCellMap() {
    return posCellMap;
}

export { executeLineupGeneration };

/* =========================================================
   [학습] 성향 제안 카드 — "앱과 논의하기"
   운영진이 라인업에서 선수를 드래그로 옮길 때마다 조용히 기록(adjustLogs)하고,
   최근 6주 동안 같은 방향의 이동이 서로 다른 날짜에 3회 이상 반복되면
   "이 성향을 선수 정보에 저장할까요?" 카드를 띄운다.
   [반영]을 눌러야만 실제로 저장되고, [무시]하면 이 기기에서 다시 묻지 않는다.
   ========================================================= */
const FIELD_POS_SET = new Set(['GK', 'LB', 'RB', 'CB', 'DF', 'MF', 'CM', 'LW', 'RW', 'FW']);

function getDismissedPrefs() {
    try { return JSON.parse(localStorage.getItem('bp_prefDismissed') || '{}'); } catch (e) { return {}; }
}
function dismissPref(key) {
    const d = getDismissedPrefs();
    d[key] = Date.now();
    try { localStorage.setItem('bp_prefDismissed', JSON.stringify(d)); } catch (e) {}
}

async function renderPrefSuggestions() {
    const box = document.getElementById('pref-suggestions');
    if (!box) return;
    if (!state.isAdmin || !window.fetchAdjustLogs) { box.innerHTML = ''; return; }

    let logs = [];
    try { logs = await window.fetchAdjustLogs(42); } catch (e) { return; }

    // 선수별 이동 집계: 어느 라인으로/어느 측면으로 옮겨졌는지, 서로 다른 날짜 기준으로 센다
    const acc = {}; // name -> { line: {DEF: Set(dates)...}, pos: {CB: n...}, side: {L: Set, R: Set} }
    logs.forEach(log => {
        if (log.kind !== 'lineup-swap' || log.reason !== 'roleFit' || !Array.isArray(log.moves)) return;
        log.moves.forEach(mv => {
            const name = normalizeName(mv.name);
            const to = String(mv.to || '').toUpperCase();
            if (!name || !FIELD_POS_SET.has(to)) return;
            if (!acc[name]) acc[name] = { line: {}, pos: {}, side: { L: new Set(), R: new Set() } };
            const a = acc[name];
            const line = lineOfPos(to);
            if (line !== 'ETC' && line !== 'GK') {
                (a.line[line] = a.line[line] || new Set()).add(log.date);
                a.pos[to] = (a.pos[to] || 0) + 1;
            }
            if (['LW', 'LB'].includes(to)) a.side.L.add(log.date);
            if (['RW', 'RB'].includes(to)) a.side.R.add(log.date);
        });
    });

    const dismissed = getDismissedPrefs();
    const suggestions = [];
    Object.keys(acc).forEach(name => {
        const p = state.playerDB[name];
        if (!p) return; // 미등록(게스트)은 제안 대상 아님
        const a = acc[name];
        const myLines = new Set((p.pos1 || []).map(lineOfPos));

        // ① 반복적으로 '주포지션이 아닌 라인'으로 옮김 → 주포지션 추가 제안
        Object.keys(a.line).forEach(line => {
            const dates = a.line[line];
            if (dates.size < 3 || myLines.has(line)) return;
            const linePos = Object.keys(a.pos).filter(ps => lineOfPos(ps) === line);
            const repPos = linePos.sort((x, y) => (a.pos[y] || 0) - (a.pos[x] || 0))[0];
            if (!repPos) return;
            const key = `${name}|pos1|${repPos}`;
            if (dismissed[key]) return;
            suggestions.push({
                key, name,
                text: `최근 <b>${dates.size}번의 모임</b>에서 <b>${name}</b>님을 <b>${LINE_KO[line]}(${repPos})</b> 자리로 직접 옮기셨어요. 주포지션에 <b>${repPos}</b>를 추가할까요?`,
                apply: async () => {
                    const cur = state.playerDB[name] || {};
                    const newPos1 = Array.from(new Set([...(cur.pos1 || []), repPos]));
                    await window.updatePlayerPref(name, { pos1: newPos1 });
                }
            });
        });

        // ② 반복적으로 왼쪽(또는 오른쪽) 자리로만 옮김 → 좌/우 선호 저장 제안
        ['L', 'R'].forEach(sd => {
            const other = sd === 'L' ? 'R' : 'L';
            if (a.side[sd].size >= 3 && a.side[other].size === 0 && (p.side || '') !== sd) {
                const key = `${name}|side|${sd}`;
                if (dismissed[key]) return;
                const ko = sd === 'L' ? '왼쪽' : '오른쪽';
                suggestions.push({
                    key, name,
                    text: `<b>${name}</b>님을 최근 <b>${a.side[sd].size}번</b> 모두 <b>${ko}</b> 자리로 옮기셨어요. <b>${ko} 선호</b>로 저장할까요?`,
                    apply: async () => { await window.updatePlayerPref(name, { side: sd }); }
                });
            }
        });
    });

    if (suggestions.length === 0) { box.innerHTML = ''; return; }

    box.innerHTML = `<p class="text-sm font-bold text-indigo-700">🧠 감지된 성향 제안 <span class="text-xs font-normal text-gray-400">(드래그 기록 기반 · 반영해야만 저장됩니다)</span></p>` +
        suggestions.slice(0, 4).map((s, i) => `
        <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm" data-sug="${i}">
            <p class="text-gray-800">${s.text}</p>
            <div class="flex gap-2 mt-2">
                <button class="sug-apply bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700" data-i="${i}">✅ 반영</button>
                <button class="sug-dismiss bg-white border text-gray-500 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-gray-100" data-i="${i}">무시</button>
            </div>
        </div>`).join('');

    box.querySelectorAll('.sug-apply').forEach(b => b.onclick = async () => {
        const s = suggestions[parseInt(b.dataset.i, 10)];
        try {
            await s.apply();
            dismissPref(s.key);
            renderPrefSuggestions();
        } catch (e) {
            console.error(e);
            window.showNotification('반영에 실패했습니다.', 'error');
        }
    });
    box.querySelectorAll('.sug-dismiss').forEach(b => b.onclick = () => {
        const s = suggestions[parseInt(b.dataset.i, 10)];
        dismissPref(s.key);
        renderPrefSuggestions();
    });
}
