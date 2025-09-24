// js/modules/teamBalancer.js
let state;
let generateButton, attendeesTextarea, teamCountSelect, resultContainer, loadingSpinner, placeholder, loadAllPlayersBtn;
let sliders = {};
let sliderVals = {};

function handlePlayerDragStart(e, playerName, fromTeamIndex) {
    const data = JSON.stringify({ playerName, fromTeamIndex });
    e.dataTransfer.setData("application/json", data);
    e.dataTransfer.effectAllowed = "move";
    e.target.closest('.player-tag').classList.add('opacity-50');
}

function handleTeamDrop(e, toTeamIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('team-drop-target');
    
    const dataString = e.dataTransfer.getData("application/json");
    if (!dataString) return; 

    try {
        const { playerName, fromTeamIndex } = JSON.parse(dataString);
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
    } catch (err) {
        console.error("Drop Error: ", err);
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

function renderResults(teams) {
    resultContainer.innerHTML = '';
    if (!teams || teams.length === 0) { return; }

    state.teams = teams;

    teams.forEach((team, index) => {
        const teamSkillSum = team.reduce((acc, p) => acc + (p.s1 || 0), 0);
        const teamSkillAvg = team.length > 0 ? (teamSkillSum / team.length).toFixed(1) : 0;
        const posCounts = { GK: 0, DF: 0, MF: 0, FW: 0 };
        team.forEach(p => {
            const groups = allPosGroup([...(p.pos1||[]), ...(p.pos2||[])]);
            if(groups.includes('GK')) posCounts.GK++; if(groups.includes('DF')) posCounts.DF++; if(groups.includes('MF')) posCounts.MF++; if(groups.includes('FW')) posCounts.FW++;
        });
        
        const teamCard = document.createElement('div');
        const cardColorClass = `card-gradient-${(index % 5) + 1}`;
        teamCard.className = `p-4 rounded-xl shadow-md text-white ${cardColorClass} flex flex-col transition-transform`;
        
        teamCard.addEventListener('dragover', (e) => { e.preventDefault(); e.currentTarget.classList.add('team-drop-target'); });
        teamCard.addEventListener('dragleave', (e) => { e.currentTarget.classList.remove('team-drop-target'); });
        teamCard.addEventListener('drop', (e) => handleTeamDrop(e, index));

        const playersContainer = document.createElement('div');
        playersContainer.className = 'flex-grow overflow-y-auto pr-1';
        
        team.sort((a,b) => (b.s1 || 0) - (a.s1 || 0)).forEach(player => {
            const posGroups = allPosGroup([...(player.pos1||[]), ...(player.pos2||[])]);
            let posIcons = '';
            if (posGroups.includes('GK')) posIcons += '🧤'; if (posGroups.includes('DF')) posIcons += '🛡️'; if (posGroups.includes('MF')) posIcons += '⚙️'; if (posGroups.includes('FW')) posIcons += '🎯';
            
            const playerTag = document.createElement('div');
            playerTag.className = 'player-tag flex justify-between items-center bg-white/20 p-2 rounded-lg mb-2 cursor-grab';
            playerTag.draggable = true;
            playerTag.innerHTML = `<span class="font-semibold">${player.name}</span><div class="flex items-center"><span class="text-sm opacity-90 mr-2">${posIcons}</span></div>`;
            playerTag.addEventListener('dragstart', (e) => handlePlayerDragStart(e, player.name, index));
            playersContainer.appendChild(playerTag);
        });
        
        const header = document.createElement('div');
        header.className = 'mb-3';
        // [수정] toFixed(1)를 사용하여 소수점 첫째 자리까지만 표시
        header.innerHTML = `<h3 class="text-2xl font-bold">팀 ${index + 1}</h3><div class="text-sm opacity-90 font-medium bg-black/20 inline-block px-2 py-1 rounded-md mt-1">총합: ${teamSkillSum.toFixed(1)} | 평균: ${teamSkillAvg} | 인원: ${team.length}명</div><div class="text-sm font-medium mt-2">🧤${posCounts.GK} 🛡️${posCounts.DF} ⚙️${posCounts.MF} 🎯${posCounts.FW}</div>`;

        teamCard.appendChild(header);
        teamCard.appendChild(playersContainer);
        resultContainer.appendChild(teamCard);
    });
}

function calculateScore(teamArr, W) {
    if (teamArr.some(t => t.length === 0)) return Infinity;
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
    return (sumMaxMin * W.SKILL) + (posDiffSum * W.POS) + (sizeMaxMin * W.SIZE * 5);
}

function tournamentSelection(rankedPop, k = 5) {
    let best = null;
    for (let i = 0; i < k; i++) {
        let individual = rankedPop[Math.floor(Math.random() * rankedPop.length)];
        if (best === null || individual.score < best.score) { best = individual; }
    }
    return best;
}

function orderedCrossover(parent1, parent2) {
    const size = parent1.length;
    const start = Math.floor(Math.random() * size);
    const end = Math.floor(Math.random() * (size - start)) + start;
    let child = Array(size).fill(null);
    let parent1Slice = parent1.slice(start, end + 1);
    let parent1Names = new Set(parent1Slice.map(p => p.name));
    for (let i = start; i <= end; i++) { child[i] = parent1[i]; }
    let childIndex = (end + 1) % size;
    let parent2Index = (end + 1) % size;
    while (child.includes(null)) {
        if (!parent1Names.has(parent2[parent2Index].name)) {
            child[childIndex] = parent2[parent2Index];
            childIndex = (childIndex + 1) % size;
        }
        parent2Index = (parent2Index + 1) % size;
    }
    return child;
}

function mutate(chromosome, rate) {
    for (let i = 0; i < chromosome.length; i++) {
        if (Math.random() < rate) {
            const j = Math.floor(Math.random() * chromosome.length);
            [chromosome[i], chromosome[j]] = [chromosome[j], chromosome[i]];
        }
    }
}

function executeTeamAssignmentGA() {
    const attendNames = attendeesTextarea.value.split('\n').map(name => name.trim()).filter(Boolean);
    if (attendNames.length === 0) { window.showNotification("참가자 명단을 입력해주세요.", 'error'); resetUI(); return; }

    state.initialAttendeeOrder = [...attendNames];

    const teamCount = parseInt(teamCountSelect.value, 10);
    const W = { SKILL: Number(sliders.skill.value), POS: Number(sliders.pos.value), SIZE: Number(sliders.size.value) };
    let knownPlayers = []; let unknownPlayers = [];
    attendNames.forEach(name => { (state.playerDB[name]) ? knownPlayers.push({ ...state.playerDB[name] }) : unknownPlayers.push(name); });
    
    const POPULATION_SIZE = 50; const GENERATIONS = 100; const MUTATION_RATE = 0.1; const ELITISM_COUNT = 2;
    let population = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
        let chromosome = [...knownPlayers];
        window.shuffleLocal(chromosome);
        population.push(chromosome);
    }

    let bestOverallTeams = null; let bestOverallScore = Infinity;
    for (let gen = 0; gen < GENERATIONS; gen++) {
        let rankedPopulation = population.map(chromosome => {
            let teams = Array.from({ length: teamCount }, () => []);
            chromosome.forEach((player, index) => { teams[index % teamCount].push(player); });
            const score = calculateScore(teams, W);
            return { chromosome, teams, score };
        }).sort((a, b) => a.score - b.score);

        if (rankedPopulation[0].score < bestOverallScore) {
            bestOverallScore = rankedPopulation[0].score;
            bestOverallTeams = rankedPopulation[0].teams;
        }

        let newPopulation = [];
        for (let i = 0; i < ELITISM_COUNT; i++) { newPopulation.push(rankedPopulation[i].chromosome); }

        while (newPopulation.length < POPULATION_SIZE) {
            const parent1 = tournamentSelection(rankedPopulation).chromosome;
            const parent2 = tournamentSelection(rankedPopulation).chromosome;
            const child = orderedCrossover(parent1, parent2);
            mutate(child, MUTATION_RATE);
            newPopulation.push(child);
        }
        population = newPopulation;
    }
    
    unknownPlayers.forEach(nm => {
        let minIndex = bestOverallTeams.reduce((minIdx, team, i, arr) => team.length < arr[minIdx].length ? i : minIdx, 0);
        bestOverallTeams[minIndex].push({ name: `${nm} (신규)`, s1: 65, pos1: [] });
    });

    renderResults(bestOverallTeams);
    window.accounting.autoFillAttendees(attendNames);
    window.lineup.renderTeamSelectTabs(bestOverallTeams);
    window.shareMgmt.updateTeamData(bestOverallTeams);
    resetUI();
}

function resetUI() {
    loadingSpinner.classList.add('hidden');
    generateButton.disabled = false;
    generateButton.textContent = '팀 생성하기!';
}

export function init(dependencies) {
    state = dependencies.state;

    const pageElement = document.getElementById('page-balancer');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">입력 정보</h2><div class="mb-4"><div class="flex justify-between items-center mb-2"><label for="attendees" class="block text-md font-semibold text-gray-700">참가자 명단</label><button id="load-all-players-btn" class="text-sm text-indigo-600 hover:underline">모든 선수 불러오기</button></div><textarea id="attendees" rows="12" class="w-full p-3 border border-gray-300 rounded-lg bg-gray-50" placeholder="선수 이름을 한 줄에 한 명씩 입력하세요."></textarea></div><div class="mb-6"><label for="teamCount" class="block text-md font-semibold text-gray-700 mb-2">생성할 팀 수</label><select id="teamCount" class="w-full p-3 border border-gray-300 rounded-lg bg-white"><option value="2" selected>2팀</option><option value="3">3팀</option><option value="4">4팀</option><option value="5">5팀</option></select></div><div><h3 class="text-lg font-semibold text-gray-700 mb-3">밸런스 가중치</h3><div class="space-y-4"><div><label for="w_skill" class="flex justify-between items-center text-sm font-medium"><span>⚡ 능력치</span><span id="w_skill_val" class="font-bold text-indigo-600">100</span></label><input id="w_skill" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_pos" class="flex justify-between items-center text-sm font-medium"><span>🛡️ 포지션</span><span id="w_pos_val" class="font-bold text-indigo-600">100</span></label><input id="w_pos" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_size" class="flex justify-between items-center text-sm font-medium"><span>👥 인원수</span><span id="w_size_val" class="font-bold text-indigo-600">100</span></label><input id="w_size" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div></div></div><div class="mt-8"><button id="generateButton" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-transform transform hover:scale-105 shadow-lg">팀 생성하기!</button></div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">팀 배정 결과</h2><div id="loading-balancer" class="hidden"><svg class="animate-spin h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div></div><p class="text-sm text-gray-500 mb-4 -mt-2">💡 생성된 팀 간에 선수를 드래그하여 수동으로 조정할 수 있습니다.</p><div id="result-container-balancer" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-h-[60vh]"><div id="placeholder-balancer" class="col-span-full flex items-center justify-center text-gray-400"><p>팀 생성 버튼을 눌러주세요.</p></div></div></div></div>`;

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
    loadAllPlayersBtn.addEventListener('click', () => { attendeesTextarea.value = Object.keys(state.playerDB).sort((a,b) => a.localeCompare(b, 'ko-KR')).join('\n'); });
    
    generateButton.addEventListener('click', () => {
        loadingSpinner.classList.remove('hidden'); resultContainer.innerHTML = ''; placeholder.classList.add('hidden');
        generateButton.disabled = true; generateButton.textContent = '팀 생성 중...';
        setTimeout(executeTeamAssignmentGA, 100);
    });
}