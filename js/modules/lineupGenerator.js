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
    else if (pos === 'sub') { icon = '🔄'; bgColor = '#607D8B'; marker.style.position = 'relative'; marker.style.transform = 'none'; }
    marker.innerHTML = (name === '미배정') ? `<div class="player-icon" style="background-color: ${bgColor}; border-style: dashed;">${icon}</div><div class="player-name">미배정</div>` : `<div class="player-icon" style="background-color: ${bgColor};">${icon}</div><div class="player-name">${name}</div>`;
    return marker;
}

function addDragAndDropHandlers() {
    const draggables = document.querySelectorAll('.player-marker[draggable="true"]');
    const targets = document.querySelectorAll('.player-marker');
    draggables.forEach(d => {
        d.addEventListener('dragstart', () => d.classList.add('dragging'));
        d.addEventListener('dragend', () => d.classList.remove('dragging'));
    });
    targets.forEach(target => {
        target.addEventListener('dragover', e => { e.preventDefault(); if (target !== document.querySelector('.dragging')) target.classList.add('drop-target'); });
        target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
        target.addEventListener('drop', e => {
            e.preventDefault();
            target.classList.remove('drop-target');
            const dragging = document.querySelector('.dragging');
            if (!dragging || target === dragging) return;
            const targetName = target.dataset.name; const draggingName = dragging.dataset.name;
            const targetPos = target.dataset.pos; const draggingPos = dragging.dataset.pos;
            const lineup = state.lineupResults.lineups[currentQuarter];
            const findAndReplace = (pos, oldName, newName) => { if (!lineup[pos]) return; const index = lineup[pos].indexOf(oldName); if (index > -1) lineup[pos][index] = newName; };
            if (draggingPos !== 'sub') findAndReplace(draggingPos, draggingName, targetName === '미배정' ? null : targetName);
            if (targetPos !== 'sub') findAndReplace(targetPos, targetName, draggingName);
            else if (targetPos === 'sub') {
                const emptySlot = Object.entries(lineup).find(([pos, players]) => players.includes(null));
                if (emptySlot) { const emptyIndex = emptySlot[1].indexOf(null); lineup[emptySlot[0]][emptyIndex] = targetName; }
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
        marker.style.left = `${fc.x}%`;
        marker.style.top = `${fc.y}%`;
        pitch.appendChild(marker);
    });
    const resters = (state.lineupResults.resters[qIndex] || []).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    const unassigned = state.lineupResults.members.filter(m => !assignedPlayers.has(m) && !resters.includes(m)).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    restersPanel.innerHTML = `<h4 class="font-bold text-lg mb-2 text-gray-800">🛑 휴식 선수</h4><div id="resters-list" class="space-y-2">${resters.length > 0 ? resters.map(r => `<div class="bg-gray-200 p-2 rounded text-gray-800">🛌 ${r}</div>`).join('') : '<p class="text-gray-500">휴식 인원 없음</p>'}</div>`;
    unassignedPanel.innerHTML = `<h4 class="font-bold text-lg mb-2 text-gray-800">🤔 미배정 선수</h4><div id="unassigned-list" class="space-y-2">${unassigned.length > 0 ? unassigned.map((name, index) => createPlayerMarker(name, 'sub', index).outerHTML).join('') : '<p class="text-gray-500">미배정 인원 없음</p>'}</div>`;
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
            lineupMembersTextarea.value = team.map(p => p.name.replace(' (?)', '')).join('\n');
            window.showNotification(`팀 ${index + 1}이 선택되었습니다.`);
        });
        teamSelectTabsContainer.appendChild(teamButton);
    });
    if (teamSelectTabsContainer.firstChild) {
        teamSelectTabsContainer.firstChild.click();
    }
}

function executeLineupGeneration() {
    const members = lineupMembersTextarea.value.split('\n').map(name => name.trim()).filter(Boolean);
    if (members.length === 0) {
        window.showNotification("팀 선택 탭에서 팀을 먼저 선택해주세요.", 'error');
        resetLineupUI();
        return;
    }
    const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
    const localPlayerDB = {};
    members.forEach(name => {
        localPlayerDB[name] = state.playerDB[name] || { name, pos1: [], s1: 65, pos2: [], s2: 0 };
    });

    let bestLineup = null, bestScore = Infinity;
    const TRIAL = 800, BETA = 7;
    for (let tr = 0; tr < TRIAL; tr++) {
        const assignHist = {}, lineups = [];
        let restCount = {};
        members.forEach(n => restCount[n] = 0);
        let allResterInQ = [];
        for (let qIdx = 0; qIdx < 4; qIdx++) {
            let resters = [];
            const onFieldNeeded = (posCellMap[formations[qIdx]] || []).length;
            const requiredRestCount = Math.max(0, members.length - onFieldNeeded);
            const candidates = members.filter(n => restCount[n] < 1);
            window.shuffleLocal(candidates);
            for (const n of candidates) {
                if (resters.length >= requiredRestCount) break;
                resters.push(n);
                restCount[n]++;
            }
            allResterInQ[qIdx] = [...resters];
        }
        for (let qIdx = 0; qIdx < 4; qIdx++) {
            const formCells = posCellMap[formations[qIdx]];
            if (!formCells) { lineups.push({}); continue; }
            let assignQ = {}, resters = allResterInQ[qIdx] || [];
            let available = members.filter(n => !resters.includes(n) && localPlayerDB[n]);
            const slots = formCells.map(c => c.pos);
            for (const pos of slots) { assignQ[pos] = assignQ[pos] || []; }
            let candidates = available.map(n => ({ name: n, ...localPlayerDB[n] }));
            let assignedCount = 0;
            const onFieldNeeded = formCells.length;
            while (assignedCount < onFieldNeeded && candidates.length > 0) {
                let bestFitScore = Infinity, bestPlayerIdx = -1, bestSlotPos = null, bestSlotIdx = -1;
                for (let p_idx = 0; p_idx < candidates.length; p_idx++) {
                    const player = candidates[p_idx];
                    for (const pos in assignQ) {
                        for (let s_idx = 0; s_idx < formCells.filter(c => c.pos === pos).length; s_idx++) {
                            if (assignQ[pos].length > s_idx && assignQ[pos][s_idx]) continue;
                            let fitScore = 3;
                            if ((player.pos1 || []).includes(pos)) fitScore = 0;
                            else if ((player.pos2 || []).includes(pos)) fitScore = 0.5;
                            fitScore -= ((player.s1 || 0) + (player.s2 || 0)) / 40;
                            let rotPenalty = (assignHist[player.name] && assignHist[player.name][pos]) ? assignHist[player.name][pos] * BETA : 0;
                            const totalScore = fitScore + rotPenalty + Math.random() * 0.1;
                            if (totalScore < bestFitScore) {
                                bestFitScore = totalScore; bestPlayerIdx = p_idx; bestSlotPos = pos; bestSlotIdx = s_idx;
                            }
                        }
                    }
                }
                if (bestPlayerIdx !== -1) {
                    const playerToAssign = candidates[bestPlayerIdx];
                    assignQ[bestSlotPos][bestSlotIdx] = playerToAssign.name;
                    assignHist[playerToAssign.name] = assignHist[playerToAssign.name] || {};
                    assignHist[playerToAssign.name][bestSlotPos] = (assignHist[playerToAssign.name][bestSlotPos] || 0) + 1;
                    candidates.splice(bestPlayerIdx, 1);
                    assignedCount++;
                } else { break; }
            }
            lineups.push(JSON.parse(JSON.stringify(assignQ)));
        }
        let quarterSums = lineups.map(lineup => Object.values(lineup).flat().filter(Boolean).reduce((sum, name) => sum + (localPlayerDB[name]?.s1 || 65), 0));
        const score = quarterSums.length > 1 ? Math.max(...quarterSums) - Math.min(...quarterSums) : 0;
        if (score < bestScore) {
            bestLineup = { lineups, resters: allResterInQ, members };
            bestScore = score;
        }
    }
if (!bestLineup) {
        window.showNotification('최적의 라인업을 찾지 못했습니다.', 'error');
    } else {
        state.lineupResults = bestLineup;
        state.lineupResults.formations = formations;
        state.lineupResults.posCellMap = posCellMap; // ✨ state에 posCellMap 정보 추가
        lineupDisplay.classList.remove('hidden');
        placeholderLineup.classList.add('hidden');
        currentQuarter = 0;
        document.querySelector('.lineup-q-tab[data-q="0"]').click();
        window.showNotification(`라인업 생성 완료! (실력차: ${bestScore.toFixed(1)})`);
    }
    resetLineupUI();
}

export function init(firestoreDB, globalState) {
    state = globalState;
    generateLineupButton = document.getElementById('generateLineupButton');
    lineupDisplay = document.getElementById('lineup-display');
    pitchContainer = document.getElementById('pitch-container');
    restersPanel = document.getElementById('resters-panel');
    unassignedPanel = document.getElementById('unassigned-panel');
    loadingLineupSpinner = document.getElementById('loading-lineup');
    placeholderLineup = document.getElementById('placeholder-lineup');
    teamSelectTabsContainer = document.getElementById('team-select-tabs-container');
    lineupMembersTextarea = document.getElementById('lineup-members');

    generateLineupButton.addEventListener('click', () => {
        loadingLineupSpinner.classList.remove('hidden');
        lineupDisplay.classList.add('hidden');
        placeholderLineup.classList.remove('hidden');
        generateLineupButton.disabled = true;
        generateLineupButton.textContent = '라인업 생성 중...';
        setTimeout(executeLineupGeneration, 100);
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