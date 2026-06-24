// js/modules/teamBalancer.js
import { state } from '../store.js?v=2'; // [중요] ?v=2를 붙여서 app.js와 주소를 통일함

let generateButton, attendeesTextarea, teamCountSelect, resultContainer, loadingSpinner, placeholder, loadAllPlayersBtn, acesTextarea, dateInput;
let sliders = {};
let sliderVals = {};

// [기능] 한글 자모 분리 현상 해결을 위한 정규화 함수
function normalizeName(name) {
    return name ? name.normalize('NFC').trim() : '';
}

function handlePlayerDragStart(e, playerName, fromTeamIndex) {
    const data = JSON.stringify({ playerName, fromTeamIndex });
    e.dataTransfer.setData("application/json", data);
    e.dataTransfer.effectAllowed = "move";
    // [수정] 글자 조각을 집은 경우에도 에러 없이 작동하도록 안전장치
    const tag = (e.target instanceof Element) ? e.target.closest('.player-tag') : null;
    if (tag) tag.classList.add('opacity-50');
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
            if(window.saveDailyMeetingData) window.saveDailyMeetingData();
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

export function renderResults(teams) {
    if(!resultContainer) return;
    resultContainer.innerHTML = ''; // 화면 초기화
    
    if (!teams || teams.length === 0) {
        if(placeholder) placeholder.classList.remove('hidden');
        return;
    }
    if(placeholder) placeholder.classList.add('hidden');

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
        
        [...team].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')).forEach(player => {
            const posGroups = allPosGroup([...(player.pos1||[]), ...(player.pos2||[])]);
            let posIcons = '';
            if (posGroups.includes('GK')) posIcons += '🧤'; if (posGroups.includes('DF')) posIcons += '🛡️'; if (posGroups.includes('MF')) posIcons += '⚙️'; if (posGroups.includes('FW')) posIcons += '🎯';
            
            const playerTag = document.createElement('div');
            playerTag.className = 'player-tag flex justify-between items-center bg-white/20 p-2 rounded-lg mb-2';
            playerTag.draggable = state.isAdmin;
            if (state.isAdmin) playerTag.classList.add('cursor-grab');
            
            // 신규 표시 로직
            const displayName = player.name.replace(' (신규)', '');
            const isNew = player.name.includes(' (신규)');
            const newBadge = isNew ? `<span class="ml-1 text-[10px] bg-yellow-400 text-black px-1 rounded">NEW</span>` : '';
            const aceBadge = player._ace ? '<span class="mr-1" title="에이스">⭐</span>' : '';

            playerTag.innerHTML = `<span class="font-semibold flex items-center">${aceBadge}${displayName}${newBadge}</span><div class="flex items-center"><span class="text-sm opacity-90 mr-2">${posIcons}</span></div>`;
            playerTag.addEventListener('dragstart', (e) => handlePlayerDragStart(e, player.name, index));
            playersContainer.appendChild(playerTag);
        });
        
        const header = document.createElement('div');
        header.className = 'mb-3';
        header.innerHTML = `<h3 class="text-2xl font-bold">팀 ${index + 1}</h3><div class="text-sm opacity-90 font-medium bg-black/20 inline-block px-2 py-1 rounded-md mt-1">총합: ${teamSkillSum.toFixed(1)} | 평균: ${teamSkillAvg} | 인원: ${team.length}명</div><div class="text-sm font-medium mt-2">🧤${posCounts.GK} 🛡️${posCounts.DF} ⚙️${posCounts.MF} 🎯${posCounts.FW}</div>`;

        teamCard.appendChild(header);
        teamCard.appendChild(playersContainer);
        resultContainer.appendChild(teamCard);
    });
}

function calculateScore(teamArr, W) {
    if (teamArr.some(t => t.length === 0)) return Infinity;
    const averages = teamArr.map(t => {
        const sum = t.reduce((acc, p) => acc + (p.s1 || 0), 0);
        return (t.length > 0) ? (sum / t.length) : 0;
    });
    const posStats = teamArr.map(team => {
        const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
        team.forEach(p => { let gg = allPosGroup([...(p.pos1 || []), ...(p.pos2 || [])]); if (gg.includes('GK')) c.GK++; if (gg.includes('DF')) c.DF++; if (gg.includes('MF')) c.MF++; if (gg.includes('FW')) c.FW++; });
        return c;
    });
    const avgMaxMin = averages.length > 1 ? Math.max(...averages) - Math.min(...averages) : 0;
    const sizeMaxMin = teamArr.length > 1 ? Math.max(...teamArr.map(t => t.length)) - Math.min(...teamArr.map(t => t.length)) : 0;
    let posDiffSum = 0;
    ['GK', 'DF', 'MF', 'FW'].forEach(pg => {
        const arr = posStats.map(c => c[pg]);
        if (arr.length > 1) { posDiffSum += (Math.max(...arr) - Math.min(...arr)); }
    });
    return (avgMaxMin * W.SKILL * 5) + (posDiffSum * W.POS) + (sizeMaxMin * W.SIZE * 5);
}

function tournamentSelection(rankedPop, k = 5) {
    let best = null;
    for (let i = 0; i < k; i++) {
        let individual = rankedPop[Math.floor(Math.random() * rankedPop.length)];
        if (best === null || individual.score < best.score) { best = individual; }
    }
    return best;
}

// [수정] 충돌 방지 및 안전장치 강화 (콘솔 에러 해결)
function orderedCrossover(parent1, parent2) {
    const size = parent1.length;
    if (size === 0) return []; 

    const start = Math.floor(Math.random() * size);
    const end = Math.floor(Math.random() * (size - start)) + start;
    let child = Array(size).fill(null);
    
    let parent1Slice = parent1.slice(start, end + 1);
    let parent1Names = new Set(parent1Slice.map(p => p.name));
    
    for (let i = start; i <= end; i++) { child[i] = parent1[i]; }
    
    let childIndex = (end + 1) % size;
    let parent2Index = (end + 1) % size;
    
    let safetyCounter = 0;
    while (child.includes(null)) {
        if (safetyCounter++ > size * 2) break; 
        
        // [중요] parent2[parent2Index]가 존재하는지 먼저 확인
        const p2Gene = parent2[parent2Index];
        if (p2Gene && !parent1Names.has(p2Gene.name)) {
            child[childIndex] = p2Gene;
            childIndex = (childIndex + 1) % size;
        }
        parent2Index = (parent2Index + 1) % size;
    }
    
    // 혹시라도 null이 남았다면 원본에서 채움 (최후의 안전장치)
    if (child.includes(null)) {
        for(let i=0; i<size; i++) {
            if(child[i] === null) child[i] = parent1[i]; 
        }
    }
    return child;
}

function mutate(chromosome, rate) {
    if (chromosome.length < 2) return;
    for (let i = 0; i < chromosome.length; i++) {
        if (Math.random() < rate) {
            const j = Math.floor(Math.random() * chromosome.length);
            [chromosome[i], chromosome[j]] = [chromosome[j], chromosome[i]];
        }
    }
}

function executeTeamAssignmentGA() {
    // 1. 화면 초기화
    if(resultContainer) resultContainer.innerHTML = '';
    if(placeholder) placeholder.classList.remove('hidden');

    // 2. 한글 정규화 적용 및 중복 제거
    let rawNames = attendeesTextarea.value.split('\n')
        .map(name => normalizeName(name))
        .filter(Boolean);
    
    const attendNames = [...new Set(rawNames)];
    
    if (attendNames.length === 0) { 
        window.showNotification("참가자 명단을 입력해주세요.", 'error'); 
        resetUI(); 
        return; 
    }
    
    state.initialAttendeeOrder = [...attendNames];
    const teamCount = parseInt(teamCountSelect.value, 10);
    const W = { SKILL: Number(sliders.skill.value), POS: Number(sliders.pos.value), SIZE: Number(sliders.size.value) };
    
    let knownPlayers = []; 
    let unknownPlayers = [];
    
    // 3. DB 매칭 (이제 state.playerDB가 제대로 채워져 있을 것입니다)
    attendNames.forEach(name => { 
        let dbPlayer = state.playerDB[name];
        if (!dbPlayer) {
            // 키 정규화 검색
            const normalizedKey = Object.keys(state.playerDB).find(k => normalizeName(k) === name);
            if (normalizedKey) dbPlayer = state.playerDB[normalizedKey];
        }

        if (dbPlayer) {
            knownPlayers.push({ ...dbPlayer }); 
        } else {
            unknownPlayers.push(name); 
        }
    });
    
    // [추가] ⭐ 에이스 분리: 명단에 적힌 핵심 선수 중 'DB 등록되어 GA 대상이 된' 선수만 인정 (신규/미등록은 제외)
    let aceNameSet = new Set();
    if (acesTextarea) {
        acesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean).forEach(n => aceNameSet.add(n));
    }
    state.aceNames = [...aceNameSet]; // [A방식] 에이스 명단도 날짜별 저장 대상에 포함
    let aces = [];
    let regulars = [];
    knownPlayers.forEach(p => {
        if (aceNameSet.has(normalizeName(p.name))) { p._ace = true; aces.push(p); }
        else { p._ace = false; regulars.push(p); }
    });

    // [추가] 에이스를 스네이크 드래프트로 각 팀에 균등 배치 → 인원차 ≤ 1, 실력 순으로 교차 배분
    //   예) 에이스 6명·2팀 → 3:3, 5명(홀수)·2팀 → 3:2 (남는 1명은 실력 흐름상 가장 약한 팀으로)
    const aceBase = Array.from({ length: teamCount }, () => []);
    const sortedAces = [...aces].sort((a, b) => (b.s1 || 0) - (a.s1 || 0));
    sortedAces.forEach((p, i) => {
        const round = Math.floor(i / teamCount);
        const pos = i % teamCount;
        const teamIdx = (round % 2 === 0) ? pos : (teamCount - 1 - pos);
        aceBase[teamIdx].push(p);
    });

    // [추가] 에이스가 먼저 배치된 팀 위에 일반 선수를 '가장 적은 팀'부터 채워 전체 인원을 균형화하는 헬퍼
    const buildTeams = (regularOrder) => {
        const teams = aceBase.map(t => [...t]);
        regularOrder.forEach(player => {
            let minIdx = 0;
            for (let t = 1; t < teamCount; t++) { if (teams[t].length < teams[minIdx].length) minIdx = t; }
            teams[minIdx].push(player);
        });
        return teams;
    };

    let bestOverallTeams = buildTeams(regulars);

    // 4. GA 실행 (일반 선수의 배치만 최적화 — 에이스는 위에서 고정 균등 배분됨)
    if (regulars.length > 0) {
        let bestOverallScore = calculateScore(bestOverallTeams, W);

        const POPULATION_SIZE = 50; 
        const GENERATIONS = 100; 
        const MUTATION_RATE = 0.1; 
        const ELITISM_COUNT = 2;
        
        let population = [];
        for (let i = 0; i < POPULATION_SIZE; i++) { 
            let chromosome = [...regulars]; 
            window.shuffleLocal(chromosome); 
            population.push(chromosome); 
        }

        try {
            for (let gen = 0; gen < GENERATIONS; gen++) {
                let rankedPopulation = population.map(chromosome => {
                    const teams = buildTeams(chromosome);
                    const score = calculateScore(teams, W);
                    return { chromosome, teams, score };
                }).sort((a, b) => a.score - b.score);

                if (rankedPopulation[0].score < bestOverallScore) { 
                    bestOverallScore = rankedPopulation[0].score; 
                    bestOverallTeams = rankedPopulation[0].teams; 
                }

                let newPopulation = [];
                for (let i = 0; i < ELITISM_COUNT; i++) { 
                    if (rankedPopulation[i]) newPopulation.push(rankedPopulation[i].chromosome); 
                }
                
                while (newPopulation.length < POPULATION_SIZE) {
                    if (rankedPopulation.length === 0) break;
                    const parent1 = tournamentSelection(rankedPopulation).chromosome;
                    const parent2 = tournamentSelection(rankedPopulation).chromosome;
                    const child = orderedCrossover(parent1, parent2);
                    mutate(child, MUTATION_RATE);
                    newPopulation.push(child);
                }
                population = newPopulation;
            }
        } catch (err) {
            console.error("GA Error:", err);
            // 오류 발생 시 기본 배치 유지
        }
    }

    if (!bestOverallTeams || bestOverallTeams.length !== teamCount) {
        bestOverallTeams = Array.from({ length: teamCount }, () => []);
    }

    // 5. 신규 선수 배정
    unknownPlayers.forEach(nm => {
        let minIndex = bestOverallTeams.reduce((minIdx, team, i, arr) => team.length < arr[minIdx].length ? i : minIdx, 0);
        bestOverallTeams[minIndex].push({ name: `${nm} (신규)`, s1: 65, pos1: [] });
    });

    renderResults(bestOverallTeams);
    
    // 타 모듈 데이터 연동
    if (window.accounting && window.accounting.autoFillAttendees) window.accounting.autoFillAttendees(attendNames);
    if (window.lineup && window.lineup.renderTeamSelectTabs) window.lineup.renderTeamSelectTabs(bestOverallTeams);
    if (window.shareMgmt && window.shareMgmt.updateTeamData) window.shareMgmt.updateTeamData(bestOverallTeams);
    if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    
    resetUI();
}

function resetUI() {
    if(loadingSpinner) loadingSpinner.classList.add('hidden');
    if(generateButton) {
        generateButton.disabled = false;
        generateButton.textContent = '팀 생성하기!';
    }
}

export function init(dependencies) {
    if (dependencies.state) Object.assign(state, dependencies.state);
    
    const pageElement = document.getElementById('page-balancer');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">입력 정보</h2><div class="mb-4"><label for="balancer-date" class="block text-md font-semibold text-gray-700 mb-2">📅 모임 날짜</label><input type="date" id="balancer-date" class="w-full p-3 border border-gray-300 rounded-lg bg-white"><p class="text-xs text-gray-400 mt-1">날짜를 바꾸면 그 날짜의 명단·팀배정·라인업을 불러옵니다. 저장된 내용이 없는 날(예: 다음주)은 빈 상태로 시작합니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label for="attendees" class="block text-md font-semibold text-gray-700">참가자 명단</label><div class="flex items-center gap-3"><button id="reset-attendees-btn" class="text-sm text-red-500 hover:underline">명단 초기화</button><button id="load-all-players-btn" class="text-sm text-indigo-600 hover:underline">모든 선수 불러오기</button></div></div><textarea id="attendees" rows="12" class="w-full p-3 border border-gray-300 rounded-lg bg-gray-50" placeholder="선수 이름을 한 줄에 한 명씩 입력하세요."></textarea></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label for="aces" class="block text-md font-semibold text-gray-700">⭐ 에이스 지정 (선택)</label><button id="reset-aces-btn" class="text-sm text-red-500 hover:underline">비우기</button></div><textarea id="aces" rows="3" class="w-full p-3 border border-gray-300 rounded-lg bg-amber-50" placeholder="잘하는 핵심 선수를 한 줄에 한 명씩 입력하세요. 여기 적은 선수는 한 팀에 몰리지 않게, 설정한 팀 수에 맞춰 각 팀으로 고르게 나뉩니다."></textarea></div><div class="mb-6"><label for="teamCount" class="block text-md font-semibold text-gray-700 mb-2">생성할 팀 수</label><select id="teamCount" class="w-full p-3 border border-gray-300 rounded-lg bg-white"><option value="2" selected>2팀</option><option value="3">3팀</option><option value="4">4팀</option><option value="5">5팀</option></select></div><details class="mt-2 border border-gray-200 rounded-lg p-3 bg-gray-50"><summary class="text-md font-semibold text-gray-700 cursor-pointer select-none">⚙️ 밸런스 가중치 (고급 설정 · 평소엔 안 건드려도 됩니다)</summary><div class="space-y-4 mt-3"><div><label for="w_skill" class="flex justify-between items-center text-sm font-medium"><span>⚡ 능력치</span><span id="w_skill_val" class="font-bold text-indigo-600">100</span></label><input id="w_skill" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_pos" class="flex justify-between items-center text-sm font-medium"><span>🛡️ 포지션</span><span id="w_pos_val" class="font-bold text-indigo-600">100</span></label><input id="w_pos" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_size" class="flex justify-between items-center text-sm font-medium"><span>👥 인원수</span><span id="w_size_val" class="font-bold text-indigo-600">100</span></label><input id="w_size" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div></div></details><div class="mt-8"><button id="generateButton" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-transform transform hover:scale-105 shadow-lg">팀 생성하기!</button></div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">팀 배정 결과</h2><div id="loading-balancer" class="hidden"><svg class="animate-spin h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div></div><p class="text-sm text-gray-500 mb-4 -mt-2">💡 생성된 팀 간에 선수를 드래그하여 수동으로 조정할 수 있습니다.</p><div id="result-container-balancer" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-h-[60vh]"><div id="placeholder-balancer" class="col-span-full flex items-center justify-center text-gray-400"><p>팀 생성 버튼을 눌러주세요.</p></div></div></div></div>`;
    
    generateButton = document.getElementById('generateButton');
    attendeesTextarea = document.getElementById('attendees');
    acesTextarea = document.getElementById('aces');
    teamCountSelect = document.getElementById('teamCount');
    resultContainer = document.getElementById('result-container-balancer');
    loadingSpinner = document.getElementById('loading-balancer');
    placeholder = document.getElementById('placeholder-balancer');
    loadAllPlayersBtn = document.getElementById('load-all-players-btn');
    dateInput = document.getElementById('balancer-date');
    sliders = { skill: document.getElementById('w_skill'), pos: document.getElementById('w_pos'), size: document.getElementById('w_size') };
    sliderVals = { skill: document.getElementById('w_skill_val'), pos: document.getElementById('w_pos_val'), size: document.getElementById('w_size_val') };

    Object.keys(sliders).forEach(key => { sliders[key].addEventListener('input', () => { sliderVals[key].textContent = sliders[key].value; }); });

    // [A방식] 명단·에이스는 더 이상 localStorage가 아니라 '선택한 날짜 문서(dailyMeetings/{날짜})'에 저장한다.
    //   → 같은 날 새로고침/재접속하면 그대로 유지되고, 다음주(저장 없는 날)로 가면 빈 상태로 시작한다.
    // 날짜 입력칸 기본값 = 오늘 (현지 시각 기준)
    const localToday = () => (window.getLocalDate ? window.getLocalDate() : new Date().toISOString().split('T')[0]);
    if (dateInput && !dateInput.value) dateInput.value = localToday();

    // 명단(textarea) → state 동기화 후 그 날짜 문서에 저장 (타이핑이 멈추면 저장)
    const persistAttendees = window.debounce(() => {
        state.initialAttendeeOrder = attendeesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean);
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    }, 600);
    attendeesTextarea.addEventListener('input', persistAttendees);

    // 에이스(textarea) → state 동기화 후 저장
    const persistAces = window.debounce(() => {
        if (acesTextarea) state.aceNames = acesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean);
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    }, 600);
    if (acesTextarea) acesTextarea.addEventListener('input', persistAces);

    // [A방식] 날짜 변경 → 그 날짜의 명단·팀배정·라인업을 불러온다 (없으면 빈 상태).
    if (dateInput) dateInput.addEventListener('change', () => {
        if (pageElement.classList.contains('view-only')) { window.promptForAdminPassword(); return; }
        const d = dateInput.value || localToday();
        if (window.changeMeetingDate) window.changeMeetingDate(d);
    });

    const resetAttendeesBtn = document.getElementById('reset-attendees-btn');
    if (resetAttendeesBtn) resetAttendeesBtn.addEventListener('click', () => {
        if (pageElement.classList.contains('view-only')) { window.promptForAdminPassword(); return; }
        attendeesTextarea.value = '';
        state.initialAttendeeOrder = [];
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
        attendeesTextarea.focus();
        if (window.showNotification) window.showNotification('참가자 명단을 비웠습니다. (이 날짜 기준)');
    });

    const resetAcesBtn = document.getElementById('reset-aces-btn');
    if (resetAcesBtn) resetAcesBtn.addEventListener('click', () => {
        if (pageElement.classList.contains('view-only')) { window.promptForAdminPassword(); return; }
        if (acesTextarea) acesTextarea.value = '';
        state.aceNames = [];
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
        if (acesTextarea) acesTextarea.focus();
        if (window.showNotification) window.showNotification('에이스 명단을 비웠습니다. (이 날짜 기준)');
    });

    loadAllPlayersBtn.addEventListener('click', () => {
        attendeesTextarea.value = Object.keys(state.playerDB).sort((a,b) => a.localeCompare(b, 'ko-KR')).join('\n');
        state.initialAttendeeOrder = attendeesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean);
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    });

    generateButton.addEventListener('click', () => {
        loadingSpinner.classList.remove('hidden');
        placeholder.classList.add('hidden');
        generateButton.disabled = true;
        generateButton.textContent = '팀 생성 중...';
        if(resultContainer) resultContainer.innerHTML = ''; // 버튼 클릭 즉시 결과창 초기화
        setTimeout(executeTeamAssignmentGA, 100);
    });
    
    pageElement.addEventListener('click', (e) => {
        if (pageElement.classList.contains('view-only')) {
            if (e.target.closest('textarea, input, select, button')) {
                e.preventDefault();
                e.stopPropagation();
                window.promptForAdminPassword();
            }
        }
    });
}

// [A방식] 외부(날짜별 모임 데이터 로드)에서 참가자 명단을 textarea에 채움
export function setAttendees(names) {
    if (!attendeesTextarea || !Array.isArray(names)) return;
    if (document.activeElement === attendeesTextarea) return; // 편집 중이면 덮어쓰지 않음
    attendeesTextarea.value = names.join('\n');
}

// [A방식] 외부(날짜별 모임 데이터 로드)에서 에이스 명단을 textarea에 채움 (편집 중이면 건드리지 않음)
export function setAces(names) {
    if (!acesTextarea || !Array.isArray(names)) return;
    if (document.activeElement === acesTextarea) return;
    acesTextarea.value = names.join('\n');
}