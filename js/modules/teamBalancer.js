// js/modules/teamBalancer.js
import { state } from '../store.js?v=2'; // [중요] ?v=2를 붙여서 app.js와 주소를 통일함
import { rolePenalty, effectivePlayer } from './coachCore.js?v=1';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js"; // [추가] 최근 같은팀 조합 조회용

let db; // [추가] Firestore 핸들 (최근 조합 반복 방지용)
let generateButton, attendeesTextarea, teamCountSelect, resultContainer, loadingSpinner, placeholder, loadAllPlayersBtn, acesTextarea, dateInput;
let pinTogetherTextarea, pinApartTextarea, avoidRepeatCheckbox; // [추가] 함께/분리 지정 + 반복 방지
let currentPinTogether = [], currentPinApart = [];              // [추가] 이번 배정에 적용할 제약 (이름 그룹 배열)
let recentPairCounts = {};                                      // [추가] 최근 4주 '같은 팀이었던 쌍' 횟수
let sliders = {};
let sliderVals = {};

// [기능] 한글 자모 분리 현상 해결을 위한 정규화 함수
function normalizeName(name) {
    return name ? name.normalize('NFC').trim() : '';
}

// [v58 추가] 🏷️ 팀 이름: 기본값 Team A/B/C… , 결과 카드에서 관리자가 직접 수정 가능.
//   state.teamNames 배열로 관리하며 dailyMeetings/{날짜} 문서에 함께 저장/복원된다.
function defaultTeamName(i) {
    return 'Team ' + String.fromCharCode(65 + (i % 26));
}
function teamNameOf(i) {
    const n = (state.teamNames && state.teamNames[i]) ? String(state.teamNames[i]).trim() : '';
    return n || defaultTeamName(i);
}
function ensureTeamNames(count) {
    if (!Array.isArray(state.teamNames)) state.teamNames = [];
    for (let i = 0; i < count; i++) if (!state.teamNames[i]) state.teamNames[i] = defaultTeamName(i);
    state.teamNames = state.teamNames.slice(0, count);
}
// 다른 모듈(라인업 탭 등)에서도 같은 이름을 쓰도록 전역 노출
window.teamName = teamNameOf;

// [v58 추가] 등록 선수 DB에서 정규화 이름으로 검색 (없으면 null)
function findPlayerInDB(name) {
    const key = normalizeName(String(name || '').replace(' (신규)', ''));
    if (!key) return null;
    if (state.playerDB[key]) return state.playerDB[key];
    const found = Object.keys(state.playerDB || {}).find(k => normalizeName(k) === key);
    return found ? state.playerDB[found] : null;
}

// [v58 추가] 팀 명단 변경(추가/제거) 후 공통 후처리:
//   참가자 명단·회비 후보·라인업 탭을 동기화하고 날짜 문서에 저장한다.
//   (라인업 캐시는 지우지 않음 → 기존 라인업·공유 보드가 파괴되지 않는다)
function syncAfterRosterChange() {
    const names = [];
    (state.teams || []).forEach(t => (t || []).forEach(p => {
        const n = normalizeName(String(p.name || '').replace(' (신규)', ''));
        if (n && !names.includes(n)) names.push(n);
    }));
    state.initialAttendeeOrder = names;
    if (attendeesTextarea && document.activeElement !== attendeesTextarea) attendeesTextarea.value = names.join('\n');
    renderResults(state.teams);
    if (window.lineup && window.lineup.renderTeamSelectTabs) window.lineup.renderTeamSelectTabs(state.teams);
    // '오늘' 모임을 편집 중일 때만 출석&회계 탭의 참석 후보 명단도 즉시 갱신
    const todayStr = window.getLocalDate ? window.getLocalDate() : '';
    if (window.accounting && window.accounting.autoFillAttendees && dateInput && dateInput.value === todayStr) {
        window.accounting.autoFillAttendees(names);
    }
    if (window.saveDailyMeetingData) window.saveDailyMeetingData();
}

// [v58 추가] ➕ 배정 완료된 특정 팀에 선수 1명 추가 (현장 늦참자 대응 — 재배정 불필요)
function addPlayerToTeam(teamIndex, rawName) {
    const name = normalizeName(String(rawName || '').replace(' (신규)', ''));
    if (!name) { window.showNotification('추가할 선수 이름을 입력해주세요.', 'error'); return; }
    const existsIn = (state.teams || []).findIndex(t => (t || []).some(p => normalizeName(String(p.name || '').replace(' (신규)', '')) === name));
    if (existsIn > -1) { window.showNotification(`${name} 선수는 이미 ${teamNameOf(existsIn)}에 있습니다.`, 'error'); return; }
    const dbPlayer = findPlayerInDB(name);
    const player = dbPlayer ? { ...dbPlayer } : { name, s1: 65, pos1: [] };
    state.teams[teamIndex].push(player);
    if (window.logAdjustment) window.logAdjustment({ kind: 'team-add', name, to: teamIndex });
    syncAfterRosterChange();
    window.showNotification(`${name} 선수가 ${teamNameOf(teamIndex)}에 추가되었습니다.${dbPlayer ? '' : ' (미등록 → NEW 게스트)'}`);
}

// [v58 추가] ✕ 특정 팀에서 선수 1명 제외
function removePlayerFromTeam(teamIndex, playerName) {
    const team = state.teams && state.teams[teamIndex];
    if (!team) return;
    const idx = team.findIndex(p => p.name === playerName);
    if (idx < 0) return;
    const clean = String(playerName).replace(' (신규)', '');
    if (!confirm(`'${clean}' 선수를 ${teamNameOf(teamIndex)}에서 빼시겠습니까?\n(참가자 명단·회비 후보에서도 함께 제외됩니다)`)) return;
    team.splice(idx, 1);
    if (window.logAdjustment) window.logAdjustment({ kind: 'team-remove', name: clean, from: teamIndex });
    syncAfterRosterChange();
    window.showNotification(`${clean} 선수가 ${teamNameOf(teamIndex)}에서 제외되었습니다.`);
}

// [v58 추가] 🛡️ 재배정 덮어쓰기 경고: 이미 팀이 저장된 날짜에서 다시 배정하려 할 때 확인
function confirmExistingOverwrite() {
    if (!state.teams || state.teams.length === 0) return true;
    return confirm(
        '이 날짜에는 이미 팀배정이 저장되어 있습니다.\n' +
        '새로 배정하면 기존 팀·라인업이 덮어써지고, 공유 보드·활약 투표 명단도 바뀝니다.\n\n' +
        '※ 늦게 온 선수의 회비 처리만 필요하다면 재배정하지 마시고,\n' +
        '   팀 카드 아래의 [선수 추가] 칸이나 출석&회계 탭의 [수동 추가]를 이용하세요.\n\n' +
        '계속할까요?'
    );
}

function handlePlayerDragStart(e, playerName, fromTeamIndex) {
    const data = JSON.stringify({ playerName, fromTeamIndex });
    e.dataTransfer.setData("application/json", data);
    e.dataTransfer.effectAllowed = "move";
    // [수정] 글자 조각을 집은 경우에도 에러 없이 작동하도록 안전장치
    const tag = (e.target instanceof Element) ? e.target.closest('.player-tag') : null;
    if (tag) tag.classList.add('opacity-50');
}


async function handleTeamDrop(e, toTeamIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('team-drop-target');
    
    const dataString = e.dataTransfer.getData("application/json");
    if (!dataString) return; 

    try {
        const { playerName, fromTeamIndex } = JSON.parse(dataString);
        if (fromTeamIndex === toTeamIndex) return;
        if (!state.isAdmin) return;
        const teamsBefore=JSON.stringify(state.teams);
        if (window.prepareCoachLocks) await window.prepareCoachLocks();
        else if (window.prepareCoach) await window.prepareCoach();
        if (teamsBefore!==JSON.stringify(state.teams)) throw new Error('명단이 변경되었습니다. 다시 시도하세요.');
        const locked=state.coachPlan?.teamLocks?.[playerName];
        if (locked!==undefined && locked!==toTeamIndex) throw new Error('팀이 고정된 선수입니다. 감독 보드에서 고정을 해제하세요.');
        if (Object.values(state.coachPlan?.lineupLocks || {}).some(list=>list.some(l=>l.name===playerName))) throw new Error('포지션이 고정된 선수입니다. 감독 보드에서 고정을 해제하세요.');

        const fromTeam = state.teams[fromTeamIndex];
        const toTeam = state.teams[toTeamIndex];
        const playerIndex = fromTeam.findIndex(p => p.name === playerName);
        
        if (playerIndex > -1) {
            const [player] = fromTeam.splice(playerIndex, 1);
            toTeam.push(player);
            renderResults(state.teams);
            if(window.saveDailyMeetingData) window.saveDailyMeetingData();
            // [학습] 운영진의 수동 팀 이동을 조용히 기록 (성향 분석용)
            if (window.logAdjustment) window.logAdjustment({ kind: 'team-move', name: playerName, from: fromTeamIndex, to: toTeamIndex });
            window.showNotification(`${playerName} 선수가 ${teamNameOf(fromTeamIndex)}에서 ${teamNameOf(toTeamIndex)}(으)로 이동했습니다.`); // [v58] 팀 이름 반영
        }
    } catch (err) {
        console.error("Drop Error: ", err);
        window.showNotification(err.message || '이동 실패', 'error');
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

// [수정] NEW 여부를 저장 데이터가 아닌 '현재 playerDB' 기준으로 매번 판정
function isInPlayerDB(rawName) {
    if (!rawName) return false;
    const clean = String(rawName).replace(' (신규)', '');   // 옛 데이터에 박힌 (신규)도 제거 후 비교
    const db = state.playerDB || {};
    if (db[clean]) return true;
    const key = normalizeName(clean);
    return Object.keys(db).some(k => normalizeName(k) === key);
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
    ensureTeamNames(teams.length); // [v58] 팀 이름 기본값(Team A/B…) 보장

    // [v58] 선수 추가 입력칸의 자동완성 목록 (등록 선수 전체)
    let dl = document.getElementById('balancer-player-datalist');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'balancer-player-datalist';
        resultContainer.parentNode.appendChild(dl);
    }
    dl.innerHTML = Object.keys(state.playerDB || {}).sort((a, b) => a.localeCompare(b, 'ko-KR')).map(n => `<option value="${window.esc(n)}"></option>`).join('');

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
            const isNew = !isInPlayerDB(player.name); // [수정] 현재 playerDB에 없을 때만 NEW
            const newBadge = isNew ? `<span class="ml-1 text-[10px] bg-yellow-400 text-black px-1 rounded">NEW</span>` : '';
            const aceBadge = player._ace ? '<span class="mr-1" title="에이스">⭐</span>' : '';

            // [v58] 관리자에게는 선수별 ✕ 제거 버튼 표시 (현장에서 잘못 추가한 선수 되돌리기)
            const removeBtn = state.isAdmin ? `<button type="button" class="team-remove-player-btn ml-1 text-white/70 hover:text-white font-bold px-1" title="이 팀에서 제외">✕</button>` : '';
            playerTag.innerHTML = `<span class="font-semibold flex items-center">${aceBadge}${displayName}${newBadge}</span><div class="flex items-center"><span class="text-sm opacity-90 mr-2">${posIcons}</span>${removeBtn}</div>`;
            playerTag.addEventListener('dragstart', (e) => handlePlayerDragStart(e, player.name, index));
            const __rmBtn = playerTag.querySelector('.team-remove-player-btn');
            if (__rmBtn) __rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removePlayerFromTeam(index, player.name); });
            playersContainer.appendChild(playerTag);
        });
        
        const header = document.createElement('div');
        header.className = 'mb-3';
        // [v58] 팀 이름 표시 + 관리자용 ✏️ 이름 수정 버튼
        const editNameBtn = state.isAdmin ? `<button type="button" class="team-name-edit-btn text-base opacity-70 hover:opacity-100" title="팀 이름 수정">✏️</button>` : '';
        header.innerHTML = `<h3 class="text-2xl font-bold flex items-center gap-2"><span>${window.esc(teamNameOf(index))}</span>${editNameBtn}</h3><div class="text-sm opacity-90 font-medium bg-black/20 inline-block px-2 py-1 rounded-md mt-1">총합: ${teamSkillSum.toFixed(1)} | 평균: ${teamSkillAvg} | 인원: ${team.length}명</div><div class="text-sm font-medium mt-2">🧤${posCounts.GK} 🛡️${posCounts.DF} ⚙️${posCounts.MF} 🎯${posCounts.FW}</div>`;
        const __editBtn = header.querySelector('.team-name-edit-btn');
        if (__editBtn) __editBtn.addEventListener('click', () => {
            const cur = teamNameOf(index);
            const nv = prompt('팀 이름을 입력하세요. (최대 20자)', cur);
            if (nv === null) return;
            const clean = nv.trim().slice(0, 20);
            if (!clean || clean === cur) return;
            ensureTeamNames(state.teams.length);
            state.teamNames[index] = clean;
            if (window.saveDailyMeetingData) window.saveDailyMeetingData();
            renderResults(state.teams);
            if (window.lineup && window.lineup.renderTeamSelectTabs) window.lineup.renderTeamSelectTabs(state.teams);
            window.showNotification(`팀 이름이 '${clean}'(으)로 변경되었습니다.`);
        });

        teamCard.appendChild(header);
        teamCard.appendChild(playersContainer);

        // [v58] ➕ 현장 선수 추가 입력칸 (관리자 전용) — 재배정 없이 이 팀에 바로 추가
        if (state.isAdmin) {
            const addBox = document.createElement('div');
            addBox.className = 'mt-2 pt-2 border-t border-white/30';
            addBox.innerHTML = `<div class="flex gap-1"><input type="text" list="balancer-player-datalist" class="team-add-player-input flex-grow min-w-0 p-1.5 rounded-md text-gray-800 text-sm" placeholder="선수 추가 (늦참자 등)..."><button type="button" class="team-add-player-btn bg-white/25 hover:bg-white/40 text-white text-sm font-bold px-3 rounded-md">추가</button></div>`;
            const __in = addBox.querySelector('.team-add-player-input');
            const __btn = addBox.querySelector('.team-add-player-btn');
            const doAdd = () => { addPlayerToTeam(index, __in.value); };
            __btn.addEventListener('click', doAdd);
            __in.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
            teamCard.appendChild(addBox);
        }

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
    // [추가] 🧲 함께/분리 지정 위반 (사실상 필수 제약 → 매우 큰 페널티)
    let pinPenalty = 0;
    const teamOf = {};
    teamArr.forEach((t, i) => t.forEach(p => { teamOf[normalizeName(String(p.name || '').replace(' (신규)', ''))] = i; }));
    (currentPinTogether || []).forEach(g => {
        const present = g.filter(n => teamOf[n] !== undefined);
        for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++)
            if (teamOf[present[i]] !== teamOf[present[j]]) pinPenalty++;
    });
    (currentPinApart || []).forEach(g => {
        const present = g.filter(n => teamOf[n] !== undefined);
        for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++)
            if (teamOf[present[i]] === teamOf[present[j]]) pinPenalty++;
    });

    // [추가] 🔄 최근 4주 같은 팀이었던 쌍은 다시 같은 팀이 되지 않도록 가벼운 페널티
    let repeatPenalty = 0;
    if (recentPairCounts && Object.keys(recentPairCounts).length > 0) {
        teamArr.forEach(t => {
            const names = t.map(p => normalizeName(String(p.name || '').replace(' (신규)', '')));
            for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
                const c = recentPairCounts[[names[i], names[j]].sort().join('|')];
                if (c) repeatPenalty += c;
            }
        });
    }

    let mentorPenalty = 0;
    teamArr.forEach((team,i) => team.forEach(p => {
        const mentor = state.coachProfiles?.[normalizeName(p.name)]?.mentor;
        if (mentor && teamOf[mentor] !== undefined && teamOf[mentor] !== i) mentorPenalty += 10000;
    }));
    return (avgMaxMin * W.SKILL * 5) + (posDiffSum * W.POS) + (sizeMaxMin * W.SIZE * 5) + (pinPenalty * 100000) + (repeatPenalty * 12) + rolePenalty(teamArr, state.coachProfiles) + mentorPenalty;
}

// [추가] 최근 28일간의 dailyMeetings에서 '같은 팀이었던 쌍'을 집계 (팀 생성 직전에 호출)
async function loadRecentPairCounts() {
    recentPairCounts = {};
    if (!avoidRepeatCheckbox || !avoidRepeatCheckbox.checked || !db) return;
    try {
        const baseDate = (dateInput && dateInput.value) || (window.getLocalDate ? window.getLocalDate() : '');
        if (!baseDate) return;
        const snap = await getDocs(collection(db, "dailyMeetings"));
        snap.forEach(d => {
            const data = d.data();
            const date = data.date || d.id;
            if (!date || date >= baseDate) return; // 선택한 날짜 '이전' 기록만
            const diffDays = (Date.parse(baseDate) - Date.parse(date)) / 86400000;
            if (isNaN(diffDays) || diffDays > 28) return;
            Object.values(data.teams || {}).forEach(team => {
                const names = (team || []).map(p => normalizeName(String(p.name || '').replace(' (신규)', ''))).filter(Boolean);
                for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
                    const key = [names[i], names[j]].sort().join('|');
                    recentPairCounts[key] = (recentPairCounts[key] || 0) + 1;
                }
            });
        });
    } catch (e) { console.error('최근 같은팀 조합 로드 실패:', e); }
}

// [추가] textarea 한 줄("철수, 영희") → 정규화된 이름 그룹
function parsePinLines(ta) {
    if (!ta) return [];
    return ta.value.split('\n')
        .map(l => l.split(',').map(n => normalizeName(n)).filter(Boolean))
        .filter(g => g.length >= 2);
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
    if(state.playersReady===false){window.showNotification('선수 정보를 아직 받지 못했습니다. 기존 배정을 유지합니다.','error');renderResults(state.teams);resetUI();return;}
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
    if (attendNames.length < teamCount) throw new Error('참가자 수가 팀 수보다 적습니다.');
    ensureTeamNames(teamCount); // [v58] 팀 이름 기본값 보장 (기존 커스텀 이름은 유지)
    const W = { SKILL: Number(sliders.skill.value), POS: Number(sliders.pos.value), SIZE: Number(sliders.size.value) };

    // [추가] 🧲 함께/분리 지정 파싱 (이번 배정의 점수 계산에 반영)
    currentPinTogether = parsePinLines(pinTogetherTextarea);
    currentPinApart = parsePinLines(pinApartTextarea);
    
    let knownPlayers = []; 
    
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
            // Guests participate in the same optimisation instead of being appended afterwards.
            knownPlayers.push(effectivePlayer({ name, s1:65, pos1:[] }, state.coachProfiles));
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
    const locks = state.coachPlan?.teamLocks || {};
    if (Object.values(locks).some(i => !Number.isInteger(i) || i < 0 || i >= teamCount)) throw new Error('팀 수와 고정 조건이 맞지 않습니다. 감독 보드에서 고정 조건을 수정하세요.');
    const sortedAces = [...aces].sort((a, b) => (b.s1 || 0) - (a.s1 || 0));
    sortedAces.forEach((p, i) => {
        const round = Math.floor(i / teamCount);
        const pos = i % teamCount;
        const teamIdx = (round % 2 === 0) ? pos : (teamCount - 1 - pos);
        aceBase[locks[p.name] ?? teamIdx].push(p);
    });
    regulars = regulars.filter(p => {
        if (locks[p.name] === undefined) return true;
        aceBase[locks[p.name]].push(p); return false;
    });
    if (aceBase.some(t=>t.length>Math.ceil(knownPlayers.length/teamCount))) throw new Error('한 팀에 고정된 인원이 너무 많습니다. 고정 조건을 줄이세요.');

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

    const assignedNames=bestOverallTeams.flat().map(p=>normalizeName(p.name));
    if(assignedNames.length!==attendNames.length || new Set(assignedNames).size!==attendNames.length || attendNames.some(n=>!assignedNames.includes(n))) throw new Error('배정 명단 검증 실패. 기존 팀을 유지합니다.');

    const assignedTeam = Object.fromEntries(bestOverallTeams.flatMap((t,i)=>t.map(p=>[normalizeName(p.name),i])));
    const violations = [];
    currentPinTogether.forEach(g=>{const ids=g.filter(n=>assignedTeam[n]!==undefined).map(n=>assignedTeam[n]);if(new Set(ids).size>1)violations.push('같은 팀 지정');});
    currentPinApart.forEach(g=>{const ids=g.filter(n=>assignedTeam[n]!==undefined).map(n=>assignedTeam[n]);if(new Set(ids).size<ids.length)violations.push('다른 팀 지정');});
    bestOverallTeams.flat().forEach(p=>{const m=state.coachProfiles?.[p.name]?.mentor;if(m && assignedTeam[m]!==undefined && assignedTeam[m]!==assignedTeam[p.name])violations.push(`${p.name} 안내 선수 조합`);});
    if (violations.length && !confirm(`동시에 만족하지 못한 조건: ${[...new Set(violations)].join(', ')}.\n이 후보를 적용할까요? 취소하면 기존 팀을 유지합니다.`)) { renderResults(state.teams); resetUI(); return; }
    renderResults(bestOverallTeams);
    
    // 타 모듈 데이터 연동
    if (window.accounting && window.accounting.autoFillAttendees) window.accounting.autoFillAttendees(attendNames);
    if (window.shareMgmt && window.shareMgmt.updateTeamData) window.shareMgmt.updateTeamData(bestOverallTeams);
    if (window.lineup && window.lineup.renderTeamSelectTabs) window.lineup.renderTeamSelectTabs(bestOverallTeams);
    if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    
    resetUI();
}

// [v58 추가] 📝 직접 팀 입력 칸 렌더 (팀 수에 맞춰 textarea 생성 · 기존 입력값 보존)
function renderManualTeamInputs() {
    const box = document.getElementById('manual-team-inputs');
    if (!box) return;
    const teamCount = parseInt(teamCountSelect.value, 10) || 2;
    const prev = {};
    box.querySelectorAll('textarea').forEach((ta, i) => { prev[i] = ta.value; });
    box.innerHTML = '';
    for (let i = 0; i < teamCount; i++) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<label class="block text-sm font-medium mb-1">${window.esc(teamNameOf(i))}</label><textarea id="manual-team-ta-${i}" rows="4" class="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm" placeholder="한 줄에 한 명씩 입력하세요."></textarea>`;
        box.appendChild(wrap);
        const ta = wrap.querySelector('textarea');
        if (prev[i]) ta.value = prev[i];
    }
}

// [v58 추가] 📝 직접 팀 입력 → 자동 배정(GA)을 건너뛰고 입력한 그대로 팀 생성.
//   이후 흐름(결과 카드·라인업 탭·공유 보드·회비 명단·날짜 문서 저장)은 자동 배정과 완전히 동일하다.
function executeManualTeamAssignment() {
    if(state.playersReady===false){window.showNotification('선수 정보를 모두 받은 후 팀을 적용해 주세요.','error');return;}
    const teamCount = parseInt(teamCountSelect.value, 10) || 2;
    ensureTeamNames(teamCount);
    const teams = [];
    const seen = new Set();
    const orderedNames = [];
    for (let i = 0; i < teamCount; i++) {
        const ta = document.getElementById(`manual-team-ta-${i}`);
        const names = (ta ? ta.value : '').split('\n').map(n => normalizeName(String(n).replace(' (신규)', ''))).filter(Boolean);
        const team = [];
        names.forEach(n => {
            if (seen.has(n)) return; // 두 팀에 중복 입력된 이름은 먼저 적힌 팀 우선
            seen.add(n);
            orderedNames.push(n);
            const dbPlayer = findPlayerInDB(n);
            team.push(dbPlayer ? { ...dbPlayer } : { name: n, s1: 65, pos1: [] });
        });
        teams.push(team);
    }
    if (orderedNames.length === 0) { window.showNotification('팀별 명단을 입력해주세요.', 'error'); return; }
    if (teams.some(t => t.length === 0)) { window.showNotification('비어 있는 팀이 있습니다. 모든 팀에 최소 1명을 입력해주세요.', 'error'); return; }
    if (!confirmExistingOverwrite()) return; // [v58] 기존 배정 덮어쓰기 경고

    state.initialAttendeeOrder = orderedNames;
    if (attendeesTextarea) attendeesTextarea.value = orderedNames.join('\n');

    renderResults(teams);

    // 타 모듈 데이터 연동 (자동 배정과 동일한 파이프라인)
    if (window.accounting && window.accounting.autoFillAttendees) window.accounting.autoFillAttendees(orderedNames);
    if (window.shareMgmt && window.shareMgmt.updateTeamData) window.shareMgmt.updateTeamData(teams);
    if (window.lineup && window.lineup.renderTeamSelectTabs) window.lineup.renderTeamSelectTabs(teams);
    if (window.saveDailyMeetingData) window.saveDailyMeetingData();

    window.showNotification('입력한 명단 그대로 팀을 만들었습니다.');
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
    db = dependencies.db; // [추가] 최근 조합 반복 방지용
    
    const pageElement = document.getElementById('page-balancer');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">입력 정보</h2><div class="mb-4"><label for="balancer-date" class="block text-md font-semibold text-gray-700 mb-2">📅 모임 날짜</label><input type="date" id="balancer-date" class="w-full p-3 border border-gray-300 rounded-lg bg-white"><p class="text-xs text-gray-400 mt-1">날짜를 바꾸면 그 날짜의 명단·팀배정·라인업을 불러옵니다. 저장된 내용이 없는 날(예: 다음주)은 빈 상태로 시작합니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label for="attendees" class="block text-md font-semibold text-gray-700">참가자 명단</label><div class="flex items-center gap-3"><button id="reset-attendees-btn" class="text-sm text-red-500 hover:underline">명단 초기화</button><button id="load-all-players-btn" class="text-sm text-indigo-600 hover:underline">모든 선수 불러오기</button></div></div><textarea id="attendees" rows="12" class="w-full p-3 border border-gray-300 rounded-lg bg-gray-50" placeholder="선수 이름을 한 줄에 한 명씩 입력하세요."></textarea></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label for="aces" class="block text-md font-semibold text-gray-700">⭐ 에이스 지정 (선택)</label><button id="reset-aces-btn" class="text-sm text-red-500 hover:underline">비우기</button></div><textarea id="aces" rows="3" class="w-full p-3 border border-gray-300 rounded-lg bg-amber-50" placeholder="잘하는 핵심 선수를 한 줄에 한 명씩 입력하세요. 여기 적은 선수는 한 팀에 몰리지 않게, 설정한 팀 수에 맞춰 각 팀으로 고르게 나뉩니다."></textarea></div><details class="mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50"><summary class="text-md font-semibold text-gray-700 cursor-pointer select-none">🧲 함께/분리·반복 방지 (선택)</summary><div class="space-y-3 mt-3"><div><label for="pin-together" class="block text-sm font-medium mb-1">🤝 같은 팀으로 묶기 <span class="text-xs text-gray-400">(한 줄에 쉼표로)</span></label><textarea id="pin-together" rows="2" class="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm" placeholder="예: 김철수, 김민수&#10;(형제·차량 동승 등)"></textarea></div><div><label for="pin-apart" class="block text-sm font-medium mb-1">🚧 다른 팀으로 나누기 <span class="text-xs text-gray-400">(한 줄에 쉼표로)</span></label><textarea id="pin-apart" rows="2" class="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm" placeholder="예: 박영수, 이재현"></textarea></div><label class="flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" id="avoid-repeat" checked class="w-4 h-4 rounded"> 🔄 최근 4주 같은 팀 조합 반복 최소화</label><p class="text-xs text-gray-400">에이스 자동 균등 배치와 충돌하면 함께/분리가 완벽히 지켜지지 않을 수 있습니다. 그 경우 드래그로 조정하세요.</p></div></details><details id="manual-team-box" class="mb-4 border border-emerald-200 rounded-lg p-3 bg-emerald-50"><summary class="text-md font-semibold text-emerald-800 cursor-pointer select-none">📝 직접 팀 입력 (자동 배정 없이 그대로 만들기)</summary><div class="mt-3 space-y-3"><p class="text-xs text-gray-500">이미 정해둔 팀이 있으면 팀별로 이름을 한 줄에 한 명씩 넣고 <b>이대로 팀 만들기</b>를 누르세요. 자동 배정을 건너뛰고 입력 그대로 팀이 만들어지며, 라인업·공유 보드·회비 명단에 똑같이 연결됩니다.</p><div id="manual-team-inputs" class="space-y-2"></div><button id="manual-team-create-btn" type="button" class="w-full bg-emerald-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-emerald-700">이대로 팀 만들기</button></div></details><div class="mb-6"><label for="teamCount" class="block text-md font-semibold text-gray-700 mb-2">생성할 팀 수</label><select id="teamCount" class="w-full p-3 border border-gray-300 rounded-lg bg-white"><option value="2" selected>2팀</option><option value="3">3팀</option><option value="4">4팀</option><option value="5">5팀</option></select></div><details class="mt-2 border border-gray-200 rounded-lg p-3 bg-gray-50"><summary class="text-md font-semibold text-gray-700 cursor-pointer select-none">⚙️ 밸런스 가중치 (고급 설정 · 평소엔 안 건드려도 됩니다)</summary><div class="space-y-4 mt-3"><div><label for="w_skill" class="flex justify-between items-center text-sm font-medium"><span>⚡ 능력치</span><span id="w_skill_val" class="font-bold text-indigo-600">100</span></label><input id="w_skill" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_pos" class="flex justify-between items-center text-sm font-medium"><span>🛡️ 포지션</span><span id="w_pos_val" class="font-bold text-indigo-600">100</span></label><input id="w_pos" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div><div><label for="w_size" class="flex justify-between items-center text-sm font-medium"><span>👥 인원수</span><span id="w_size_val" class="font-bold text-indigo-600">100</span></label><input id="w_size" type="range" min="0" max="100" value="100" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"></div></div></details><div class="mt-8"><button id="generateButton" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-transform transform hover:scale-105 shadow-lg">팀 생성하기!</button></div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">팀 배정 결과</h2><div id="loading-balancer" class="hidden"><svg class="animate-spin h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div></div><p class="text-sm text-gray-500 mb-4 -mt-2">💡 생성된 팀 간에 선수를 드래그하여 수동으로 조정할 수 있습니다.</p><div id="result-container-balancer" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 min-h-[60vh]"><div id="placeholder-balancer" class="col-span-full flex items-center justify-center text-gray-400"><p>팀 생성 버튼을 눌러주세요.</p></div></div></div></div>`;
    
    generateButton = document.getElementById('generateButton');
    attendeesTextarea = document.getElementById('attendees');
    acesTextarea = document.getElementById('aces');
    teamCountSelect = document.getElementById('teamCount');
    resultContainer = document.getElementById('result-container-balancer');
    loadingSpinner = document.getElementById('loading-balancer');
    placeholder = document.getElementById('placeholder-balancer');
    loadAllPlayersBtn = document.getElementById('load-all-players-btn');
    dateInput = document.getElementById('balancer-date');
    pinTogetherTextarea = document.getElementById('pin-together');
    pinApartTextarea = document.getElementById('pin-apart');
    avoidRepeatCheckbox = document.getElementById('avoid-repeat');
    // Eight-week continuity trial: do not encourage reshuffling familiar combinations by default.
    if(avoidRepeatCheckbox)avoidRepeatCheckbox.checked=false;
    sliders = { skill: document.getElementById('w_skill'), pos: document.getElementById('w_pos'), size: document.getElementById('w_size') };
    sliderVals = { skill: document.getElementById('w_skill_val'), pos: document.getElementById('w_pos_val'), size: document.getElementById('w_size_val') };

    Object.keys(sliders).forEach(key => { sliders[key].addEventListener('input', () => { sliderVals[key].textContent = sliders[key].value; }); });

    // [A방식] 명단·에이스는 더 이상 localStorage가 아니라 '선택한 날짜 문서(dailyMeetings/{날짜})'에 저장한다.
    //   → 같은 날 새로고침/재접속하면 그대로 유지되고, 다음주(저장 없는 날)로 가면 빈 상태로 시작한다.
    // 날짜 입력칸 기본값 = 오늘 (현지 시각 기준)
    const localToday = () => (window.getLocalDate ? window.getLocalDate() : new Date().toISOString().split('T')[0]);
    if (dateInput && !dateInput.value) dateInput.value = localToday();

    // 명단(textarea) → state 동기화 후 그 날짜 문서에 저장 (타이핑이 멈추면 저장)
    const persistAttendees = () => {
        state.initialAttendeeOrder = attendeesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean);
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    };
    attendeesTextarea.addEventListener('input', persistAttendees);

    // 에이스(textarea) → state 동기화 후 저장
    const persistAces = () => {
        if (acesTextarea) state.aceNames = acesTextarea.value.split('\n').map(n => normalizeName(n)).filter(Boolean);
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    };
    if (acesTextarea) acesTextarea.addEventListener('input', persistAces);

    // [추가] 함께/분리 지정도 날짜 문서에 함께 저장 (원본 줄 그대로 보관)
    const persistPins = () => {
        state.pinTogether = pinTogetherTextarea ? pinTogetherTextarea.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
        state.pinApart = pinApartTextarea ? pinApartTextarea.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
        if (window.saveDailyMeetingData) window.saveDailyMeetingData();
    };
    if (pinTogetherTextarea) pinTogetherTextarea.addEventListener('input', persistPins);
    if (pinApartTextarea) pinApartTextarea.addEventListener('input', persistPins);

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

    // [v58] 팀 수 변경 → 직접 팀 입력 칸 개수 동기화
    if (teamCountSelect) teamCountSelect.addEventListener('change', renderManualTeamInputs);
    renderManualTeamInputs();

    // [v58] 📝 직접 팀 입력 생성 버튼
    const manualCreateBtn = document.getElementById('manual-team-create-btn');
    if (manualCreateBtn) manualCreateBtn.addEventListener('click', () => {
        if (pageElement.classList.contains('view-only')) { window.promptForAdminPassword(); return; }
        executeManualTeamAssignment();
    });

    generateButton.addEventListener('click', () => {
        if (!state.isAdmin) { window.promptForAdminPassword(); return; }
        if (!confirmExistingOverwrite()) return; // [v58] 기존 배정 덮어쓰기 경고
        const inputKey=()=>JSON.stringify([state.meetingDate,state.teams,attendeesTextarea.value,acesTextarea?.value,pinTogetherTextarea?.value,pinApartTextarea?.value,teamCountSelect.value]);
        const requested=inputKey();
        loadingSpinner.classList.remove('hidden');
        placeholder.classList.add('hidden');
        generateButton.disabled = true;
        generateButton.textContent = '팀 생성 중...';
        if(resultContainer) resultContainer.innerHTML = ''; // 버튼 클릭 즉시 결과창 초기화
        setTimeout(async () => {
            try {
                if(!state.isAdmin || inputKey()!==requested)throw new Error('날짜·명단·조건이 변경되어 생성을 중단했습니다.');
                if (window.prepareCoach) await window.prepareCoach();
                if (Object.values(state.coachPlan?.lineupLocks || {}).some(locks=>locks.length)) throw new Error('포지션 고정 조건이 있습니다. 부분 라인업 재배정을 사용하거나 감독 보드에서 고정을 해제하세요.');
                await loadRecentPairCounts();
                if(!state.isAdmin || inputKey()!==requested)throw new Error('날짜·명단·조건이 변경되어 생성을 중단했습니다.');
                executeTeamAssignmentGA();
            } catch (error) { renderResults(state.teams); resetUI(); window.showNotification(error.message || '배정 실패', 'error'); }
        }, 100);
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
// [추가] 외부(날짜별 모임 데이터 로드)에서 함께/분리 지정을 textarea에 채움 (편집 중이면 건드리지 않음)
export function setPins(together, apart) {
    if (pinTogetherTextarea && Array.isArray(together) && document.activeElement !== pinTogetherTextarea) {
        pinTogetherTextarea.value = together.join('\n');
    }
    if (pinApartTextarea && Array.isArray(apart) && document.activeElement !== pinApartTextarea) {
        pinApartTextarea.value = apart.join('\n');
    }
}
