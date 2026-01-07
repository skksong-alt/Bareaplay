// js/modules/lineupGenerator.js
let state;
let generateLineupButton, lineupDisplay, loadingLineupSpinner, placeholderLineup;
let teamSelectTabsContainer, lineupMembersTextarea;
let activeTeamIndex = -1;

// [수정] 9인(3-4-1), 10인(3-4-2) 포메이션 좌표 추가
const posCellMap = { 
    '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], 
    '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], 
    '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], 
    '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ],
    // 신규 추가
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

// [기존 파일에서 복원] 드래그 앤 드롭 핸들러
function addDragAndDropHandlers() {
    const draggables = document.querySelectorAll('.player-marker[draggable="true"]');
    const targets = document.querySelectorAll('.player-marker');
    
    draggables.forEach(d => {
        d.addEventListener('dragstart', (e) => {
            d.classList.add('dragging');
            const quarterBlock = d.closest('.quarter-block');
            if (quarterBlock) {
                e.dataTransfer.setData('text/quarter', quarterBlock.dataset.q);
            }
        });
        d.addEventListener('dragend', () => d.classList.remove('dragging'));
    });

    targets.forEach(target => {
        target.addEventListener('dragover', e => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            if (dragging && target !== dragging) {
                target.classList.add('drop-target');
            }
        });

        target.addEventListener('dragleave', () => {
            target.classList.remove('drop-target');
        });

        target.addEventListener('drop', e => {
            e.preventDefault(); 
            target.classList.remove('drop-target');
            
            const dragging = document.querySelector('.dragging');
            if (!dragging || target === dragging) return;

            const quarterBlock = target.closest('.quarter-block');
            if (!quarterBlock) return;
            const qIndex = parseInt(quarterBlock.dataset.q, 10);

            const sourceQ = e.dataTransfer.getData('text/quarter');
            if (sourceQ && parseInt(sourceQ, 10) !== qIndex) {
                window.showNotification('다른 쿼터로 선수를 이동할 수 없습니다.', 'error');
                return;
            }

            const lineup = state.lineupResults.lineups[qIndex];
            const resters = state.lineupResults.resters[qIndex];
            
            const draggingName = dragging.dataset.name;
            const draggingPosType = dragging.dataset.pos;
            const targetName = target.dataset.name;
            const targetPosType = target.dataset.pos;

            const d_loc_lineup = findInLineup(lineup, draggingName);
            const d_loc_rest = resters.indexOf(draggingName);
            const t_loc_lineup = findInLineup(lineup, targetName);
            const t_loc_rest = resters.indexOf(targetName);

            let message = `${draggingName} ↔ ${targetName} 교체!`;

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
            }
            
            if (state.teamLineupCache && activeTeamIndex !== -1) {
                state.teamLineupCache[activeTeamIndex] = state.lineupResults;
            }
            renderAllQuarters(); 
            window.saveDailyMeetingData();
            window.showNotification(message);
        });
    });
}

function renderAllQuarters() {
    if (!lineupDisplay) return;
    lineupDisplay.innerHTML = ''; 
    lineupDisplay.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"; 

    if (!state.lineupResults || !state.lineupResults.lineups) return;

    for (let qIndex = 0; qIndex < 6; qIndex++) {
        const lineup = state.lineupResults.lineups[qIndex];
        const formation = state.lineupResults.formations[qIndex];
        const resters = state.lineupResults.resters[qIndex] || [];
        const referees = (state.lineupResults.referees && state.lineupResults.referees[qIndex]) ? [state.lineupResults.referees[qIndex]] : []; 

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

        // [수정] 휴식/심판 패널
        const restPanel = document.createElement('div');
        restPanel.className = 'mt-auto pt-2 border-t border-gray-200';
        
        // 심판 표시
        let refHtml = '';
        if (referees.length > 0) {
            refHtml = `<div class="flex flex-col items-center mb-2"><span class="text-xs font-bold text-black mb-1">심판</span><div class="flex gap-1">${referees.map(r => createPlayerMarker(r, 'ref', r, true).outerHTML).join('')}</div></div>`;
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

// [수정] 3가지 요구사항이 반영된 로직
function executeLineupGeneration(members, formations, isSilent = false) {
    return new Promise(resolve => {
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

        const initialOrder = state.initialAttendeeOrder || [];
        const sortedMembers = [...members].sort((a, b) => { 
            const indexA = initialOrder.indexOf(a); 
            const indexB = initialOrder.indexOf(b); 
            if (indexA === -1) return 1; 
            if (indexB === -1) return -1; 
            return indexA - indexB; 
        });

        const localPlayerDB = {};
        members.forEach(name => { localPlayerDB[name] = state.playerDB[name] || { name, pos1: [], s1: 65, pos2: [], s2: 0 }; });

        const primaryGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK'));
        const secondaryGks = members.filter(m => !(localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));
        // 1,2지망 모두 GK인 '슈퍼 GK'
        const superGks = members.filter(m => (localPlayerDB[m].pos1 || []).includes('GK') && (localPlayerDB[m].pos2 || []).includes('GK'));

        let bestLineup = null; 
        let bestScore = Infinity;
        const TRIAL = 300; 

        for (let tr = 0; tr < TRIAL; tr++) {
            // SuperGK는 휴식 로테이션에서 제외
            let membersForRest = sortedMembers.filter(m => !superGks.includes(m));
            let restOrderQueue = [...membersForRest].reverse(); 
            let fullRestQueue = []; 
            let totalRestSlots = 0;
            
            formations.forEach(f => { 
                const numOnField = posCellMap[f]?.length || 11; 
                totalRestSlots += Math.max(0, members.length - numOnField); 
            });
            
            while (fullRestQueue.length < totalRestSlots) { fullRestQueue.push(...restOrderQueue); }
            fullRestQueue = fullRestQueue.slice(0, totalRestSlots);

            const lineups = []; 
            const resters = []; 
            const referees = []; 
            let refereeUsage = {}; 
            members.forEach(m => refereeUsage[m] = 0);

            let restQueuePointer = 0;
            let secondaryGkUsage = {}; 
            let fillerGkUsage = {}; 
            const pos1Usage = {}; 
            const pos2Usage = {};
            members.forEach(m => { pos1Usage[m] = 0; pos2Usage[m] = 0; });

            for (let q = 0; q < 6; q++) {
                const formation = formations[q]; 
                const slots = posCellMap[formation]?.map(c => c.pos) || []; 
                const numToRest = members.length - slots.length;
                
                const quarterResters = [...new Set(fullRestQueue.slice(restQueuePointer, restQueuePointer + numToRest))];
                restQueuePointer += numToRest; 
                resters.push(quarterResters);

                // 심판 배정 (휴식자 중 횟수 적은 순 -> 늦게 온 순)
                let assignedRef = null;
                if (quarterResters.length > 0) {
                    let candidates = [...quarterResters];
                    candidates.sort((a, b) => {
                        if (refereeUsage[a] !== refereeUsage[b]) {
                            return refereeUsage[a] - refereeUsage[b];
                        }
                        const idxA = initialOrder.indexOf(a);
                        const idxB = initialOrder.indexOf(b);
                        return idxB - idxA; 
                    });
                    assignedRef = candidates[0];
                    refereeUsage[assignedRef]++;
                }
                referees.push(assignedRef);

                let onField = sortedMembers.filter(m => !quarterResters.includes(m)); 
                let assignment = {}; 
                let availablePlayers = [...onField];
                
                const gkSlotExists = slots.includes('GK');

                if (gkSlotExists) {
                    let assignedGk = null;
                    let availableSuperGks = superGks.filter(gk => availablePlayers.includes(gk));
                    if (availableSuperGks.length > 0) {
                        assignedGk = availableSuperGks[0];
                    }
                    if (!assignedGk) {
                        let availablePrimaryGks = primaryGks.filter(gk => availablePlayers.includes(gk));
                        if (availablePrimaryGks.length > 0) assignedGk = availablePrimaryGks[0]; 
                    }
                    if (!assignedGk) {
                        let availableSecondaryGks = secondaryGks.filter(gk => availablePlayers.includes(gk) && !secondaryGkUsage[gk]);
                        if (availableSecondaryGks.length > 0) { 
                            assignedGk = availableSecondaryGks[0]; 
                            secondaryGkUsage[assignedGk] = 1; 
                        }
                    }
                    if (!assignedGk) {
                        for (let i = availablePlayers.length - 1; i >= 0; i--) {
                            const candidate = availablePlayers[i];
                            if (!fillerGkUsage[candidate]) {
                                assignedGk = candidate;
                                fillerGkUsage[assignedGk] = 1;
                                break;
                            }
                        }
                        if (!assignedGk && availablePlayers.length > 0) assignedGk = availablePlayers[availablePlayers.length - 1];
                    }
                    if (assignedGk) { 
                        assignment['GK'] = [assignedGk]; 
                        availablePlayers.splice(availablePlayers.indexOf(assignedGk), 1); 
                    }
                }

                for (const pos of slots) {
                    if (pos === 'GK') continue;
                    assignment[pos] = assignment[pos] || [];
                    if (availablePlayers.length === 0) { assignment[pos].push(null); continue; }
                    let bestPlayer = availablePlayers[0], bestFit = -1;
                    for (const playerName of availablePlayers) {
                        const player = localPlayerDB[playerName]; 
                        let fitScore = 0;
                        const isPos1 = (player.pos1 || []).includes(pos);
                        const isPos2 = (player.pos2 || []).includes(pos);
                        const pos1Used = pos1Usage[playerName] || 0;
                        const pos2Used = pos2Usage[playerName] || 0;
                        if (isPos1) {
                            let usagePenalty = Math.max(0.2, 1.0 - (pos1Used * 0.2));
                            fitScore = (100 + (player.s1 || 65)) * usagePenalty; 
                        } else if (isPos2) {
                            let usagePenalty = Math.max(0.2, 1.0 - (pos2Used * 0.2));
                            fitScore = (50 + (player.s2 || 0)) * usagePenalty;
                        } else { 
                            fitScore = (localPlayerDB[playerName]?.s1 || 65) / 10; 
                        }
                        if (fitScore > bestFit) { bestFit = fitScore; bestPlayer = playerName; }
                    }
                    assignment[pos].push(bestPlayer);
                    if (bestPlayer) {
                        availablePlayers.splice(availablePlayers.indexOf(bestPlayer), 1);
                        const playerInfo = localPlayerDB[bestPlayer]; 
                        if ((playerInfo.pos1 || []).includes(pos)) { pos1Usage[bestPlayer]++; } 
                        else if ((playerInfo.pos2 || []).includes(pos)) { pos2Usage[bestPlayer]++; }
                    }
                }
                lineups.push(assignment);
            }
            const qScores = lineups.map(l => Object.values(l).flat().filter(Boolean).reduce((sum, name) => {
                const score = localPlayerDB[name]?.s1 || 65;
                return sum + (score || 0);
            }, 0));
            const score = qScores.length > 1 ? Math.max(...qScores) - Math.min(...qScores) : 0;
            if (score < bestScore) { 
                bestScore = score; 
                bestLineup = { lineups, resters, referees, members, formations, score }; 
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
            if(window.shareMgmt && window.shareMgmt.updateLineupData) {
                window.shareMgmt.updateLineupData(result, result.formations);
            }
            lineupDisplay.classList.remove('hidden');
            placeholderLineup.classList.add('hidden');
            renderAllQuarters(); 
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