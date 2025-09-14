// js/modules/teamBalancer.js
let state, showNotification, lineupGenerator, accounting;

let generateButton, attendeesTextarea, teamCountSelect, resultContainer, loadingSpinner, placeholder, loadAllPlayersBtn;
let sliders = {};
let sliderVals = {};

function handlePlayerDragStart(e, playerName, fromTeamIndex) {
    // ... (기존과 동일)
}

function handleTeamDrop(e, toTeamIndex) {
    // ... (기존과 동일)
}

function allPosGroup(posArr) {
    // ... (기존과 동일)
}

function calculateScore(teamArr, W) {
    // ... (기존과 동일)
}

function renderResults(teams) {
    // ... (기존과 동일)
}

function executeTeamAssignment() {
    // ... (기존과 동일)
}

function resetUI() {
    // ... (기존과 동일)
}

export function init(dependencies) {
    state = dependencies.state;
    showNotification = dependencies.showNotification;
    lineupGenerator = dependencies.lineupGenerator;
    accounting = dependencies.accounting;

    // ▼▼▼ [오류 수정] 모듈이 자신의 HTML을 직접 렌더링 ▼▼▼
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
        setTimeout(executeTeamAssignment, 100);
    });
}