// js/modules/lineupGenerator.js
let state;
let generateLineupButton, lineupDisplay, loadingLineupSpinner, placeholderLineup;
let teamSelectTabsContainer, lineupMembersTextarea;
let activeTeamIndex = -1;

// [기능] 한글 자모 분리 현상 해결을 위한 정규화 함수
function normalizeName(name) {
    return name ? name.normalize('NFC').trim() : '';
}

// [기능] 양팀 공동 심판: 1·3·5쿼터=팀1 휴식자, 2·4·6쿼터=팀2 휴식자가 맡음
// (해당 팀에 휴식자가 없으면 상대팀 휴식자가 대신 맡음)
function applySharedReferees() {
    const cache = state.teamLineupCache || {};
    const teamIdxs = Object.keys(cache).filter(k => cache[k] && Array.isArray(cache[k].resters)).sort();
    if (teamIdxs.length === 0) return [];

    const restersOf = (t, q) => (cache[t].resters && Array.isArray(cache[t].resters[q])) ? cache[t].resters[q] : [];

    const usage = {}; // 심판 횟수 공평하게 배분용
    const shared = [];
    for (let q = 0; q < 6; q++) {
        let chosen = null;

        // [추가] 운영진이 수동 지정한 심판이 있고, 그 사람이 실제 해당 쿼터 휴식자라면 최우선 적용
        for (const t of teamIdxs) {
            const mr = Array.isArray(cache[t].manualReferees) ? cache[t].manualReferees[q] : null;
            if (mr && restersOf(t, q).includes(mr)) {
                chosen = { name: mr, team: Number(t) };
                break;
            }
        }

        // 수동 지정이 없으면 기존 자동 배분 (휴식자 중 심판 적게 본 사람 우선, 담당 팀 번갈아)
        if (!chosen) {
            const order = teamIdxs.map((_, i) => teamIdxs[(q + i) % teamIdxs.length]);
            for (const t of order) {
                const resters = restersOf(t, q);
                if (resters.length > 0) {
                    const sorted = [...resters].sort((a, b) => (usage[a] || 0) - (usage[b] || 0));
                    chosen = { name: sorted[0], team: Number(t) };
                    break;
                }
            }
        }

        if (chosen) usage[chosen.name] = (usage[chosen.name] || 0) + 1;
        shared.push(chosen);
    }
    // 계산된 공동 심판을 모든 팀의 데이터에 기록 (공유 페이지·인쇄물에도 자동 반영)
    teamIdxs.forEach(t => {
        cache[t].referees = shared.map(s => s ? s.name : null);
    });
    return shared;
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
function performSwap(qIndex, dragInfo, targetInfo) {
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

    const sharedReferees = applySharedReferees(); // [수정] 양팀 공동 심판 계산

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

        lineupDisplay.appendChild(quarterBlock);
    }
    // [중요] 렌더링 후 드래그 핸들러 연결
    addDragAndDropHandlers();
}

// [기능 2, 3] 심판 및 슈퍼 GK 로직이 반영된 실행 함수
function executeLineupGeneration(members, formations, isSilent = false) {
    return new Promise(resolve => {
        // [기능 1] 인원수에 따른 포메이션 자동 고정
        if (members.length === 9) {
            formations = Array(6).fill('3-4-1');
            if(!isSilent) window.showNotification("9명이므로 3-4-1 포메이션으로 고정됩니다.");
        } else if (members.length === 10) {
            formations = Array(6).fill('3-4-2');
            if(!isSilent) window.showNotification("10명이므로 3-4-2 포메이션으로 고정됩니다.");
        } else if (members.length < 9 && !isSilent) {
             window.showNotification("최소 9명의 선수가 필요합니다.", 'error');
             resolve(null); return;
        }

        const initialOrder = (state.initialAttendeeOrder || []).map(name => normalizeName(name));
        const sortedMembers = [...members].sort((a, b) => { 
            const indexA = initialOrder.indexOf(normalizeName(a)); 
            const indexB = initialOrder.indexOf(normalizeName(b)); 
            if (indexA === -1) return 1; 
            if (indexB === -1) return -1; 
            return indexA - indexB; 
        });

        const localPlayerDB = {};
        members.forEach(name => { localPlayerDB[name] = state.playerDB[name] || { name, pos1: [], s1: 65, pos2: [], s2: 0 }; });

        const primaryGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK'));
        const secondaryGks = members.filter(m => !(localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));
        // [기능 3] 1,2지망 모두 GK인 '슈퍼 GK' 식별
        const superGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));
        // [추가] 키퍼 최소 1회 보장 대상: 주/부에 GK가 있으나 전담(슈퍼GK)은 아닌 선수
        const gkGuarColumn = members.filter(m => !superGks.includes(m) && ((localPlayerDB[m].pos1 || []).includes('GK') || (localPlayerDB[m].pos2 || []).includes('GK')));
        const hasDedicatedGk = superGks.length > 0;
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
            members.forEach(m => { pos1Usage[m] = 0; pos2Usage[m] = 0; onFieldCount[m] = 0; gkCount[m] = 0; restCount[m] = 0; refCount[m] = 0; });
            let gkLast = null;                  // 직전 쿼터 키퍼(전담 제외)
            let restRefLast = new Set();        // 직전 쿼터 휴식/심판자 집합

            let qualityCost = 0; // 포지션 적합도 비용 (낮을수록 좋음)

            for (let q = 0; q < 6; q++) {
                const formation = formations[q];
                const slots = posCellMap[formation]?.map(c => c.pos) || [];
                const numToRest = members.length - slots.length;

                // ---- 휴식 선정: 누적 휴식 수가 적은 사람 우선, 동률이면 늦은 투표(아래)부터. 직전 키퍼(전담 제외)는 이번 휴식 제외 ----
                let restElig = sortedMembers.filter(m => !superGks.includes(m) && m !== gkLast);
                restElig.sort((a, b) => (restCount[a] - restCount[b]) || (rankOf(b) - rankOf(a)));
                let quarterResters = restElig.slice(0, numToRest);
                if (quarterResters.length < numToRest) {
                    // 전담/직전 키퍼 제외로 인원이 모자라면 불가피하게 보충 (그래도 누적 적은 사람 우선)
                    const extra = sortedMembers
                        .filter(m => !superGks.includes(m) && !quarterResters.includes(m))
                        .sort((a, b) => (restCount[a] - restCount[b]) || (rankOf(b) - rankOf(a)));
                    quarterResters = quarterResters.concat(extra.slice(0, numToRest - quarterResters.length));
                }
                quarterResters.forEach(m => restCount[m]++);
                resters.push(quarterResters);

                // ---- 심판 배정: 휴식자 중 심판을 적게 본 사람 우선, 동률이면 늦은 투표(아래)부터 ----
                let assignedRef = null;
                if (quarterResters.length > 0) {
                    const refCands = [...quarterResters].sort((a, b) => (refCount[a] - refCount[b]) || (rankOf(b) - rankOf(a)));
                    assignedRef = refCands[0];
                    refCount[assignedRef]++;
                }
                referees.push(assignedRef);

                let onField = sortedMembers.filter(m => !quarterResters.includes(m));
                onField.forEach(m => onFieldCount[m]++);
                let assignment = {};
                let availablePlayers = [...onField];

                // ---- 키퍼(GK) 배정: 전담 우선 / 그 외엔 투표 아래부터 로테이션 + 공정성 제약 ----
                let assignedGk = null;
                const gkSlotExists = slots.includes('GK');
                if (gkSlotExists) {
                    const onFieldSuper = onField.filter(m => superGks.includes(m));
                    if (onFieldSuper.length > 0) {
                        assignedGk = onFieldSuper[0];        // 전담 키퍼는 항상 골문
                    } else {
                        const banned = new Set(restRefLast); // 직전 휴식/심판자 → 이번 키퍼 금지
                        if (gkLast) banned.add(gkLast);      // 직전 키퍼 → 연속 금지
                        let elig = availablePlayers.filter(m => !banned.has(m));
                        if (elig.length === 0) elig = [...availablePlayers]; // 불가피하면 완화
                        // 1순위: 키퍼 보장 미충족(주/부 GK) 중 투표 아래부터 → 부GK ≥1회 보장
                        const need = elig.filter(m => gkGuarColumn.includes(m) && gkCount[m] === 0);
                        const pool = need.length > 0 ? need : elig;
                        // [제안A] 키퍼를 적게 맡은 사람 우선 → 같으면 GK 보유자 우선 → 같으면 늦은 투표 순
                        pool.sort((a, b) => {
                            const ca = gkCount[a] || 0, cb = gkCount[b] || 0;
                            if (ca !== cb) return ca - cb;                 // 키퍼 횟수 적은 사람 먼저
                            const ga = gkGuarColumn.includes(a) ? 1 : 0;
                            const gb = gkGuarColumn.includes(b) ? 1 : 0;
                            if (ga !== gb) return gb - ga;                 // GK 보유자 먼저
                            return rankOf(b) - rankOf(a);                  // 아래(늦은 투표)부터
                        });
                        assignedGk = pool[0];
                    }
                    if (assignedGk) {
                        assignment['GK'] = [assignedGk];
                        availablePlayers.splice(availablePlayers.indexOf(assignedGk), 1);
                        gkCount[assignedGk]++;
                        const gp = localPlayerDB[assignedGk];
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
                        val += Math.random() * 40; // 시도별 다양성
                        if (val > bestVal) { bestVal = val; bestPlayer = playerName; }
                    }
                    assignment[pos].push(bestPlayer);
                    if (bestPlayer) {
                        availablePlayers.splice(availablePlayers.indexOf(bestPlayer), 1);
                        const pinfo = localPlayerDB[bestPlayer];
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

            const totalCost = guaranteeShort * 1000 + gkGuaranteeShort * 800 + gkOverShort * 600 + qualityCost + preferShort * 15;

            if (totalCost < bestCost) {
                bestCost = totalCost;
                bestLineup = { lineups, resters, referees, members, formations, score: balance, guaranteeShort, preferShort };
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
            <div class="grid grid-cols-2 gap-4 mb-6">
                <div><label for="formation-q1" class="block text-sm font-medium">1쿼터</label><select id="formation-q1" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q2" class="block text-sm font-medium">2쿼터</label><select id="formation-q2" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q3" class="block text-sm font-medium">3쿼터</label><select id="formation-q3" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q4" class="block text-sm font-medium">4쿼터</label><select id="formation-q4" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q5" class="block text-sm font-medium">5쿼터</label><select id="formation-q5" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
                <div><label for="formation-q6" class="block text-sm font-medium">6쿼터</label><select id="formation-q6" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option selected>4-2-3-1</option></select></div>
            </div>
            <div class="mt-8"><button id="generateLineupButton" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700 transition-transform transform hover:scale-105 shadow-lg">라인업 생성!</button></div>
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

    generateLineupButton.addEventListener('click', async () => {
        loadingLineupSpinner.classList.remove('hidden');
        lineupDisplay.classList.add('hidden');
        placeholderLineup.classList.add('hidden');
        generateLineupButton.disabled = true;
        generateLineupButton.textContent = '라인업 생성 중...';
        const members = lineupMembersTextarea.value.split('\n').map(name => name.trim().replace(' (신규)', '')).filter(Boolean);
        const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
        const result = await executeLineupGeneration(members, formations);
        if (result) {
            state.lineupResults = result;
            state.teamLineupCache[activeTeamIndex] = result;
            lineupDisplay.classList.remove('hidden');
            placeholderLineup.classList.add('hidden');
            renderAllQuarters(); // 이 안에서 공동 심판이 계산됨
            if(window.shareMgmt && window.shareMgmt.updateLineupData) {
                window.shareMgmt.updateLineupData(state.lineupResults, result.formations);
            }
            if(window.saveDailyMeetingData) window.saveDailyMeetingData();
            window.showNotification(`라인업 생성 완료! (실력차: ${result.score.toFixed(1)})`);
        }
        resetLineupUI();
    });
    
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
                const formationSelects = document.querySelectorAll('#page-lineup select');
                formationSelects.forEach((select, qIndex) => {
                    select.value = state.lineupResults.formations[qIndex];
                });
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
        teamButton.textContent = `팀 ${index + 1}`;
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