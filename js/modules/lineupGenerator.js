// js/modules/lineupGenerator.js
let state;
let generateLineupButton, lineupDisplay, pitchContainer, restersPanel, unassignedPanel, loadingLineupSpinner, placeholderLineup;
let teamSelectTabsContainer, lineupMembersTextarea;
let currentQuarter = 0;

const posCellMap = { '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ] };

function resetLineupUI() {
    loadingLineupSpinner.classList.add('hidden');
    generateLineupButton.disabled = false;
    generateLineupButton.textContent = '라인업 생성!';
}

function createPitchHTML() { return `<div class="pitch"><div class="pitch-line" style="top:50%; left:0; width:100%; height:2px;"></div><div class="center-circle" style="top:50%; left:50%; width:25%; height:17.5%; transform: translate(-50%,-50%);"></div><div class="pitch-line" style="top:50%; left:50%; width:2px; height:2px; border-radius:50%; transform: translate(-50%, -50%); background:white;"></div><div class="pitch-line" style="top:83%; left:20%; width:60%; height:2px;"></div><div class="pitch-line" style="top:83%; left:20%; width:2px; height:15%;"></div><div class="pitch-line" style="top:83%; left:80%; width:2px; height:15%;"></div><div class="pitch-line" style="top:0%; left:20%; width:60%; height:2px;"></div><div class="pitch-line" style="top:0%; left:20%; width:2px; height:17%;"></div><div class="pitch-line" style="top:0%; left:80%; width:2px; height:17%;"></div></div>`; }

function createPlayerMarker(name, pos, id) {
    const marker = document.createElement('div');
    marker.className = 'player-marker';
    marker.dataset.name = name;
    marker.dataset.pos = pos;
    marker.dataset.id = `${pos}-${id}`;
    marker.draggable = name !== '미배정';

    let icon = '❓', bgColor = '#78909C';
    if (pos === "GK") { icon = "🧤"; bgColor = "#00C853"; } 
    else if (["LB", "RB", "CB", "DF"].includes(pos)) { icon = "🛡"; bgColor = "#03A9F4"; } 
    else if (["MF", "CM"].includes(pos)) { icon = "⚙"; bgColor = "#FFEB3B"; } 
    else if (["LW", "RW", "FW"].includes(pos)) { icon = "🎯"; bgColor = "#FF9800"; }
    else if (pos === 'sub' || pos === 'rest') { icon = (pos === 'sub' ? '🔄' : '🛌'); bgColor = (pos === 'sub' ? '#607D8B' : '#9E9E9E'); marker.style.position = 'relative'; marker.style.transform = 'none'; marker.style.cursor = 'grab'; }
    
    marker.innerHTML = (name === '미배정') ? `<div class="player-icon" style="background-color: ${bgColor}; border-style: dashed;">${icon}</div><div class="player-name">미배정</div>` : `<div class="player-icon" style="background-color: ${bgColor};">${icon}</div><div class="player-name">${name}</div>`;
    return marker;
}

function findInLineup(lineup, name) {
    for (const pos in lineup) {
        const idx = lineup[pos].indexOf(name);
        if (idx > -1) return { pos, idx };
    }
    return null;
}

function addDragAndDropHandlers() {
    const draggables = document.querySelectorAll('.player-marker[draggable="true"]');
    const targets = document.querySelectorAll('.player-marker');
    
    draggables.forEach(d => {
        d.addEventListener('dragstart', () => d.classList.add('dragging'));
        d.addEventListener('dragend', () => d.classList.remove('dragging'));
    });

    targets.forEach(target => {
        target.addEventListener('dragover', e => { e.preventDefault(); if(target !== document.querySelector('.dragging')) target.classList.add('drop-target'); });
        target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
        target.addEventListener('drop', e => {
            e.preventDefault(); target.classList.remove('drop-target');
            const dragging = document.querySelector('.dragging');
            if (!dragging || target === dragging) return;

            const lineup = state.lineupResults.lineups[currentQuarter];
            const resters = state.lineupResults.resters[currentQuarter];
            const draggingName = dragging.dataset.name;
            const targetName = target.dataset.name;
            const draggingPosType = dragging.dataset.pos;
            const targetPosType = target.dataset.pos;
            
            if (draggingPosType !== 'rest' && draggingPosType !== 'sub') {
                const d_loc = findInLineup(lineup, draggingName);
                if (!d_loc) return;

                if (targetPosType === 'rest') {
                    const t_idx = resters.indexOf(targetName);
                    if (t_idx > -1) {
                        resters[t_idx] = draggingName;
                        lineup[d_loc.pos][d_loc.idx] = targetName;
                    }
                } else if (targetPosType !== 'sub') {
                    const t_loc = findInLineup(lineup, targetName);
                    if (t_loc) {
                        lineup[d_loc.pos][d_loc.idx] = targetName;
                        lineup[t_loc.pos][t_loc.idx] = draggingName;
                    }
                }
            } 
            else if (draggingPosType === 'rest') {
                 const d_idx = resters.indexOf(draggingName);
                 if (targetPosType !== 'rest' && targetPosType !== 'sub') {
                    const t_loc = findInLineup(lineup, targetName);
                    if (t_loc && d_idx > -1) {
                        resters[d_idx] = targetName;
                        lineup[t_loc.pos][t_loc.idx] = draggingName;
                    }
                 }
            }
            renderQuarter(currentQuarter);
            window.showNotification(`${draggingName} ↔ ${targetName} 위치 변경!`);
        });
    });
}

function renderQuarter(qIndex) {
    if (!state.lineupResults) return;
    pitchContainer.innerHTML = createPitchHTML();
    const pitch = pitchContainer.querySelector('.pitch');
    const lineup = state.lineupResults.lineups[qIndex];
    const formation = state.lineupResults.formations[qIndex];
    const formationLayout = posCellMap[formation] || [];
    let counters = {};
    let assignedPlayers = new Set(Object.values(lineup).flat().filter(Boolean));

    formationLayout.forEach((fc, index) => {
        const pos = fc.pos;
        counters[pos] = (counters[pos] || 0);
        let name = (lineup[pos] || [])[counters[pos]] || '미배정';
        counters[pos]++;
        const marker = createPlayerMarker(name, pos, index);
        marker.style.left = `${fc.x}%`; marker.style.top = `${fc.y}%`;
        pitch.appendChild(marker);
    });

    const resters = (state.lineupResults.resters[qIndex] || []).sort((a,b) => a.localeCompare(b, 'ko-KR'));
    const unassigned = state.lineupResults.members.filter(m => !assignedPlayers.has(m) && !resters.includes(m)).sort((a,b) => a.localeCompare(b, 'ko-KR'));

    restersPanel.innerHTML = `<h4 class="font-bold text-lg mb-2">🛑 휴식 선수</h4><div class="space-y-2">${resters.length > 0 ? resters.map(r => createPlayerMarker(r, 'rest', r).outerHTML).join('') : '<p class="text-gray-500">휴식 인원 없음</p>'}</div>`;
    unassignedPanel.innerHTML = `<h4 class="font-bold text-lg mb-2">🤔 미배정 선수</h4><div class="space-y-2">${unassigned.length > 0 ? unassigned.map((name, index) => createPlayerMarker(name, 'sub', `${name}-${index}`).outerHTML).join('') : '<p class="text-gray-500">미배정 인원 없음</p>'}</div>`;
    
    addDragAndDropHandlers();
}


export function renderTeamSelectTabs(teams) {
    if (!teamSelectTabsContainer) return;
    teamSelectTabsContainer.innerHTML = '';
    teams.forEach((team, index) => {
        const teamButton = document.createElement('button');
        teamButton.className = `team-tab-btn p-2 rounded-lg border-2 font-semibold transition team-tab-btn-${(index % 5) + 1}`;
        teamButton.textContent = `팀 ${index + 1}`;
        teamButton.addEventListener('click', () => {
            document.querySelectorAll('.team-tab-btn').forEach(btn => btn.classList.remove('active'));
            teamButton.classList.add('active');
            lineupMembersTextarea.value = team.map(p => p.name.replace(' (신규)', '')).join('\n');
            window.showNotification(`팀 ${index + 1}이 선택되었습니다.`);
        });
        teamSelectTabsContainer.appendChild(teamButton);
    });
    if (teamSelectTabsContainer.firstChild) {
        teamSelectTabsContainer.firstChild.click();
    }
}

// [복원] 최초 index(1).html의 라인업 생성 알고리즘
function executeLineupGeneration(members, formations, isSilent = false) {
    return new Promise(resolve => {
        if (members.length < 11 && !isSilent) {
            window.showNotification("최소 11명의 선수가 필요합니다.", 'error');
            resolve(null);
            return;
        }

        let sortedMembers = [...members].sort((a, b) => (state.initialAttendeeOrder || []).indexOf(a) - (state.initialAttendeeOrder || []).indexOf(b));
        const localPlayerDB = {};
        members.forEach(name => {
            localPlayerDB[name] = state.playerDB[name] || { name, pos1: [], s1: 65, pos2: [], s2: 0 };
        });
        
        let bestLineup = null; let bestScore = Infinity;
        const TRIAL = 300;
        const FIXED_GK = "강석영";

        let restOrderQueue = sortedMembers.filter(m => m !== FIXED_GK).reverse();
        let fullRestQueue = [];
        let totalRestSlots = 0;
        formations.forEach(f => {
            const numOnField = posCellMap[f].length;
            totalRestSlots += Math.max(0, members.length - numOnField);
        });
        while (fullRestQueue.length < totalRestSlots) { fullRestQueue.push(...restOrderQueue); }
        fullRestQueue = fullRestQueue.slice(0, totalRestSlots);

        for (let tr = 0; tr < TRIAL; tr++) {
            const lineups = []; const resters = [];
            let restQueuePointer = 0;
            
            for (let q = 0; q < 4; q++) {
                const formation = formations[q];
                const slots = posCellMap[formation].map(c => c.pos);
                const numToRest = members.length - slots.length;

                const quarterResters = [...new Set(fullRestQueue.slice(restQueuePointer, restQueuePointer + numToRest))];
                restQueuePointer += numToRest;
                resters.push(quarterResters);
                
                let onField = members.filter(m => !quarterResters.includes(m));
                let assignment = {};
                let availablePlayers = [...onField];
                
                if (slots.includes('GK') && availablePlayers.includes(FIXED_GK)) {
                    assignment['GK'] = [FIXED_GK];
                    availablePlayers.splice(availablePlayers.indexOf(FIXED_GK), 1);
                }
                
                for (const pos of slots) {
                    if (pos === 'GK' && assignment['GK']) continue;
                    assignment[pos] = assignment[pos] || [];
                    if (availablePlayers.length === 0) {
                        assignment[pos].push(null); continue;
                    }

                    let bestPlayer = availablePlayers[0], bestFit = -1;
                    for (const playerName of availablePlayers) {
                        const player = localPlayerDB[playerName];
                        let fitScore = Math.random() * 0.1;
                        if ((player.pos1 || []).includes(pos)) fitScore += 2;
                        else if ((player.pos2 || []).includes(pos)) fitScore += 1;
                        if (fitScore > bestFit) {
                            bestFit = fitScore; bestPlayer = playerName;
                        }
                    }
                    assignment[pos].push(bestPlayer);
                    if (bestPlayer) availablePlayers.splice(availablePlayers.indexOf(bestPlayer), 1);
                }
                lineups.push(assignment);
            }
            
            const qScores = lineups.map(l => Object.values(l).flat().filter(Boolean).reduce((sum, name) => sum + (localPlayerDB[name]?.s1 || 65), 0));
            const score = qScores.length > 1 ? Math.max(...qScores) - Math.min(...qScores) : 0;
            if (score < bestScore) {
                bestScore = score;
                bestLineup = { lineups, resters, members, formations, score };
            }
        }
        resolve(bestLineup);
    });
}

export { executeLineupGeneration }; // Share Mgmt 모듈에서 호출할 수 있도록 export

export function init(dependencies) {
    state = dependencies.state;
    
    const pageElement = document.getElementById('page-lineup');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">라인업 조건</h2><div class="mb-4"><label class="block text-md font-semibold text-gray-700 mb-2">팀 선택</label><div id="team-select-tabs-container" class="flex flex-wrap gap-2"><p class="text-sm text-gray-500">팀 배정기에서 먼저 팀을 생성해주세요.</p></div><textarea id="lineup-members" class="hidden"></textarea></div><div class="grid grid-cols-2 gap-4 mb-6"><div><label for="formation-q1" class="block text-sm font-medium">1쿼터</label><select id="formation-q1" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option>4-2-3-1</option></select></div><div><label for="formation-q2" class="block text-sm font-medium">2쿼터</label><select id="formation-q2" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option>4-2-3-1</option></select></div><div><label for="formation-q3" class="block text-sm font-medium">3쿼터</label><select id="formation-q3" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option>4-2-3-1</option></select></div><div><label for="formation-q4" class="block text-sm font-medium">4쿼터</label><select id="formation-q4" class="mt-1 w-full p-2 border rounded-lg bg-white"><option>4-4-2</option><option>4-3-3</option><option>3-5-2</option><option>4-2-3-1</option></select></div></div><div class="mt-8"><button id="generateLineupButton" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700 transition-transform transform hover:scale-105 shadow-lg">라인업 생성!</button></div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">라인업 결과</h2><div id="loading-lineup" class="hidden"><svg class="animate-spin h-6 w-6 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div></div><div id="result-container-lineup"><div id="placeholder-lineup" class="flex items-center justify-center text-gray-400 min-h-[60vh]"><p>조건을 입력하고 라인업 생성을 눌러주세요.</p></div><div id="lineup-display" class="hidden"><div class="flex space-x-2 border-b mb-4"><button class="lineup-q-tab active-q-tab py-2 px-4 font-semibold" data-q="0">1쿼터</button><button class="lineup-q-tab py-2 px-4 font-semibold" data-q="1">2쿼터</button><button class="lineup-q-tab py-2 px-4 font-semibold" data-q="2">3쿼터</button><button class="lineup-q-tab py-2 px-4 font-semibold" data-q="3">4쿼터</button></div><div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="md:col-span-2"><div id="pitch-container"></div></div><div id="lineup-sidebar" class="md:col-span-1 p-4 bg-gray-50 rounded-lg space-y-4"><div id="resters-panel"></div><div id="unassigned-panel"></div></div></div></div></div></div></div>`;
    
    generateLineupButton = document.getElementById('generateLineupButton');
    lineupDisplay = document.getElementById('lineup-display');
    pitchContainer = document.getElementById('pitch-container');
    restersPanel = document.getElementById('resters-panel');
    unassignedPanel = document.getElementById('unassigned-panel');
    loadingLineupSpinner = document.getElementById('loading-lineup');
    placeholderLineup = document.getElementById('placeholder-lineup');
    teamSelectTabsContainer = document.getElementById('team-select-tabs-container');
    lineupMembersTextarea = document.getElementById('lineup-members');

    generateLineupButton.addEventListener('click', async () => {
        loadingLineupSpinner.classList.remove('hidden');
        lineupDisplay.classList.add('hidden');
        placeholderLineup.classList.add('hidden'); // placeholder는 숨겨야 합니다
        generateLineupButton.disabled = true;
        generateLineupButton.textContent = '라인업 생성 중...';

        const members = lineupMembersTextarea.value.split('\n').map(name => name.trim().replace(' (신규)', '')).filter(Boolean);
        const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
        
        const result = await executeLineupGeneration(members, formations);

        if (result) {
            state.lineupResults = result;
            window.shareMgmt.updateLineupData(result, formations);
            lineupDisplay.classList.remove('hidden');
            placeholderLineup.classList.add('hidden'); // 여기도 확인
            currentQuarter = 0;
            // 쿼터 탭을 클릭하는 효과를 줌
            const firstQuarterTab = document.querySelector('.lineup-q-tab[data-q="0"]');
            if (firstQuarterTab) {
                document.querySelectorAll('.lineup-q-tab').forEach(t => t.classList.remove('active-q-tab'));
                firstQuarterTab.classList.add('active-q-tab');
                renderQuarter(0);
            }
            window.showNotification(`라인업 생성 완료! (실력차: ${result.score.toFixed(1)})`);
        }
        resetLineupUI();
    });
    
    document.addEventListener('click', (e) => {
        if (e.target.closest('.lineup-q-tab')) {
            const tab = e.target.closest('.lineup-q-tab');
            document.querySelectorAll('.lineup-q-tab').forEach(t => t.classList.remove('active-q-tab'));
            tab.classList.add('active-q-tab');
            currentQuarter = parseInt(tab.dataset.q, 10);
            renderQuarter(currentQuarter);
        }
    });
}

export function getPosCellMap() {
    return posCellMap;
}