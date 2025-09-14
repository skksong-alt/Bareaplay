// js/modules/teamBalancer.js

let state;
let generateButton, attendeesTextarea, teamCountSelect, resultContainer, loadingSpinner, placeholder, loadAllPlayersBtn;
let sliders = {};
let sliderVals = {};

function handlePlayerDragStart(e, playerName, fromTeamIndex) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ playerName, fromTeamIndex }));
    e.target.closest('.player-tag').classList.add('opacity-50');
}

function handleTeamDrop(e, toTeamIndex) {
    e.preventDefault();
    const { playerName, fromTeamIndex } = JSON.parse(e.dataTransfer.getData("text/plain"));
    e.currentTarget.classList.remove('team-drop-target');

    if (fromTeamIndex === toTeamIndex) return;

    const fromTeam = state.teams[fromTeamIndex];
    const toTeam = state.teams[toTeamIndex];
    const playerIndex = fromTeam.findIndex(p => p.name === playerName);
    if (playerIndex > -1) {
        const [player] = fromTeam.splice(playerIndex, 1);
        toTeam.push(player);
        renderResults(state.teams);
        window.showNotification(`${playerName} 선수가 팀 ${fromTeamIndex + 1}에서 팀 ${toTeamIndex + 1}로 이동했습니다.`);
    }
}

function allPosGroup(posArr) {
    let out = new Set();
    (posArr || []).forEach(p => {
        const u = p.toUpperCase();
        if (['GK'].includes(u)) out.add('GK');
        if (['LB', 'RB', 'CB'].includes(u) || u === 'DF') out.add('DF');
        if (['MF', 'CM', 'LW', 'RW'].includes(u)) out.add('MF');
        if (['FW'].includes(u)) out.add('FW');
    });
    return Array.from(out);
}

function calculateScore(teamArr, W) {
    const sums = teamArr.map(t => t.reduce((acc, p) => acc + (p.s1 || 0), 0));
    const posStats = teamArr.map(team => {
        const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
        team.forEach(p => {
            let gg = allPosGroup([...(p.pos1 || []), ...(p.pos2 || [])]);
            if (gg.includes('GK')) c.GK++; if (gg.includes('DF')) c.DF++; if (gg.includes('MF')) c.MF++; if (gg.includes('FW')) c.FW++;
        });
        return c;
    });
    const sumMaxMin = sums.length > 1 ? Math.max(...sums) - Math.min(...sums) : 0;
    const sizeMaxMin = teamArr.length > 1 ? Math.max(...teamArr.map(t => t.length)) - Math.min(...teamArr.map(t => t.length)) : 0;
    let posDiffSum = 0;
    ['GK', 'DF', 'MF', 'FW'].forEach(pg => {
        const arr = posStats.map(c => c[pg]);
        if (arr.length > 1) { posDiffSum += (Math.max(...arr) - Math.min(...arr)); }
    });
    return (sumMaxMin * W.SKILL) + (posDiffSum * W.POS) + (sizeMaxMin * W.SIZE);
}

function renderResults(teams) {
    resultContainer.innerHTML = '';
    if (!teams || teams.length === 0) { return; }

    state.teams = teams;

    teams.forEach((team, index) => {
        const teamSkillSum = team.reduce((acc, p) => acc + (p.s1 || 0), 0);
        const teamSkillAvg = team.length > 0 ? (teamSkillSum / team.length).toFixed(1) : 0;
        const posCounts = { GK: 0, DF: 0, MF: 0, FW: 0 };
        team.forEach(p => {
            const groups = allPosGroup([...(p.pos1 || []), ...(p.pos2 || [])]);
            if (groups.includes('GK')) posCounts.GK++; if (groups.includes('DF')) posCounts.DF++; if (groups.includes('MF')) posCounts.MF++; if (groups.includes('FW')) posCounts.FW++;
        });
        
        const teamCard = document.createElement('div');
        const cardColorClass = `card-gradient-${(index % 5) + 1}`;
        teamCard.className = `p-4 rounded-xl shadow-md text-white ${cardColorClass} flex flex-col transition-transform`;
        teamCard.dataset.teamMembers = team.map(p => p.name.replace(' (?)', '')).join('\n');
        
        teamCard.addEventListener('dragover', (e) => { e.preventDefault(); e.currentTarget.classList.add('team-drop-target'); });
        teamCard.addEventListener('dragleave', (e) => { e.currentTarget.classList.remove('team-drop-target'); });
        teamCard.addEventListener('drop', (e) => handleTeamDrop(e, index));

        let playersHtml = '';
        team.sort((a, b) => (b.s1 || 0) - (a.s1 || 0)).forEach(player => {
            const posGroups = allPosGroup([...(player.pos1 || []), ...(player.pos2 || [])]);
            let posIcons = '';
            if (posGroups.includes('GK')) posIcons += '🧤'; if (posGroups.includes('DF')) posIcons += '🛡️'; if (posGroups.includes('MF')) posIcons += '⚙️'; if (posGroups.includes('FW')) posIcons += '🎯';
            
            playersHtml += `<div class="player-tag flex justify-between items-center bg-white/20 p-2 rounded-lg mb-2 cursor-grab" draggable="true" ondragstart="window.teamBalancer.handlePlayerDragStart(event, '${player.name}', ${index})">
                <span class="font-semibold">${player.name}</span>
                <div class="flex items-center"><span class="text-sm opacity-90 mr-2">${posIcons}</span><span class="text-sm font-bold bg-white/30 px-2 py-0.5 rounded-full">${player.s1 || 0}</span></div>
            </div>`;
        });
        
        teamCard.innerHTML = `<div class="mb-3"><h3 class="text-2xl font-bold">팀 ${index + 1}</h3><div class="text-sm opacity-90 font-medium bg-black/20 inline-block px-2 py-1 rounded-md mt-1">총합: ${teamSkillSum} | 평균: ${teamSkillAvg} | 인원: ${team.length}명</div><div class="text-sm font-medium mt-2">🧤${posCounts.GK} 🛡️${posCounts.DF} ⚙️${posCounts.MF} 🎯${posCounts.FW}</div></div><div class="flex-grow overflow-y-auto pr-1">${playersHtml}</div>`;
        resultContainer.appendChild(teamCard);
    });
}

function executeTeamAssignment() {
    const attendNames = attendeesTextarea.value.split('\n').map(name => name.trim()).filter(Boolean);
    if (attendNames.length === 0) { window.showNotification("참가자 명단을 입력해주세요.", 'error'); resetUI(); return; }
    const teamCount = parseInt(teamCountSelect.value, 10);
    const W = { SKILL: Number(sliders.skill.value), POS: Number(sliders.pos.value), SIZE: Number(sliders.size.value) };
    let known = []; let unknown = [];
    attendNames.forEach(name => { (state.playerDB[name]) ? known.push({ ...state.playerDB[name] }) : unknown.push(name); });
    let bestTeams = null, bestScore = Infinity;
    const trialCount = 2000;
    for (let trial = 0; trial < trialCount; trial++) {
        let pool = [...known]; window.shuffleLocal(pool);
        let tempTeams = Array.from({ length: teamCount }, () => []);
        pool.forEach((player, index) => { tempTeams[index % teamCount].push(player); });
        const score = calculateScore(tempTeams, W);
        if (score < bestScore) { bestScore = score; bestTeams = JSON.parse(JSON.stringify(tempTeams)); }
    }
    let unknownPool = [...unknown]; window.shuffleLocal(unknownPool);
    unknownPool.forEach(nm => {
        let minIndex = bestTeams.reduce((minIndex, team, i, arr) => team.length < arr[minIndex].length ? i : minIndex, 0);
        bestTeams[minIndex].push({ name: `${nm} (?)`, s1: 65, pos1: [] });
    });
    renderResults(bestTeams);
    window.accounting.autoFillAttendees(attendNames);
    window.lineup.renderTeamSelectTabs(bestTeams);
    resetUI();
}

function resetUI() {
    loadingSpinner.classList.add('hidden');
    generateButton.disabled = false;
    generateButton.textContent = '팀 생성하기!';
}

export function init(firestoreDB, globalState) {
    state = globalState;
    generateButton = document.getElementById('generateButton');
    attendeesTextarea = document.getElementById('attendees');
    teamCountSelect = document.getElementById('teamCount');
    resultContainer = document.getElementById('result-container-balancer');
    loadingSpinner = document.getElementById('loading-balancer');
    placeholder = document.getElementById('placeholder-balancer');
    loadAllPlayersBtn = document.getElementById('load-all-players-btn');
    sliders = { skill: document.getElementById('w_skill'), pos: document.getElementById('w_pos'), size: document.getElementById('w_size') };
    sliderVals = { skill: document.getElementById('w_skill_val'), pos: document.getElementById('w_pos_val'), size: document.getElementById('w_size_val') };

    Object.keys(sliders).forEach(key => { sliders[key].addEventListener('input', () => { sliderVals[key].textContent = sliders[key].value; }); });
    loadAllPlayersBtn.addEventListener('click', () => { attendeesTextarea.value = Object.keys(state.playerDB).sort().join('\n'); });
    generateButton.addEventListener('click', () => {
        loadingSpinner.classList.remove('hidden'); resultContainer.innerHTML = ''; placeholder.classList.add('hidden');
        generateButton.disabled = true; generateButton.textContent = '팀 생성 중...';
        setTimeout(executeTeamAssignment, 100);
    });

    window.teamBalancer = { handlePlayerDragStart };
}