// js/modules/playerManagement.js
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state, showNotification;
let tableBody, form, formTitle, cancelBtn, playerIdInput;

function parsePositions(posCell) {
    if (!posCell) return [];
    const VALID = ['GK', 'LB', 'RB', 'CB', 'LW', 'RW', 'MF', 'CM', 'FW', 'DF'];
    const positions = Array.isArray(posCell) ? posCell : String(posCell).split(/[\/\\,]/);
    return Array.from(new Set(positions.map(p => p.toUpperCase().trim()).filter(p => VALID.includes(p))));
}

function resetForm() {
    form.reset();
    playerIdInput.value = '';
    formTitle.textContent = '새 선수 추가';
    cancelBtn.classList.add('hidden');
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const id = playerIdInput.value;
    const name = document.getElementById('player-name').value.trim();
    if (!name) {
        showNotification('선수 이름은 필수입니다.', 'error');
        return;
    }
    if (!id && state.playerDB[name]) {
        showNotification('이미 존재하는 선수 이름입니다.', 'error');
        return;
    }
    if (id && id !== name && state.playerDB[name]) {
        showNotification('변경하려는 이름이 이미 존재합니다.', 'error');
        return;
    }
    const newPlayerData = {
        name,
        pos1: parsePositions(document.getElementById('player-pos1').value),
        s1: parseInt(document.getElementById('player-s1').value) || 0,
        pos2: parsePositions(document.getElementById('player-pos2').value),
        s2: parseInt(document.getElementById('player-s2').value) || 0,
    };
    await setDoc(doc(db, "players", name), newPlayerData);
    if (id && id !== name) await deleteDoc(doc(db, "players", id));
    resetForm();
    showNotification(id ? '선수 정보가 수정되었습니다.' : '새로운 선수가 추가되었습니다.');
}

async function handleTableClick(e) {
    const target = e.target;
    const playerName = target.dataset.name;
    if (!playerName) return;

    if (target.classList.contains('edit-btn')) {
        const p = state.playerDB[playerName];
        formTitle.textContent = '선수 정보 수정';
        playerIdInput.value = p.name;
        document.getElementById('player-name').value = p.name;
        document.getElementById('player-pos1').value = (p.pos1 || []).join(', ');
        document.getElementById('player-s1').value = p.s1;
        document.getElementById('player-pos2').value = (p.pos2 || []).join(', ');
        document.getElementById('player-s2').value = p.s2;
        cancelBtn.classList.remove('hidden');
        form.scrollIntoView({ behavior: 'smooth' });
    }
    if (target.classList.contains('delete-btn')) {
        if (confirm(`'${playerName}' 선수를 정말 삭제하시겠습니까?`)) {
            await deleteDoc(doc(db, "players", playerName));
            showNotification('선수가 삭제되었습니다.');
        }
    }
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;
    showNotification = dependencies.showNotification;
    
    dependencies.pages.players.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">선수 목록</h2><div class="overflow-x-auto"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr><th scope="col" class="py-3 px-6">이름</th><th scope="col" class="py-3 px-6">주 포지션 / 능력치</th><th scope="col" class="py-3 px-6">부 포지션 / 능력치</th><th scope="col" class="py-3 px-6">출석률</th><th scope="col" class="py-3 px-6">관리</th></tr></thead><tbody id="player-table-body"></tbody></table></div></div><div class="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg"><h2 id="player-form-title" class="text-2xl font-bold mb-4">새 선수 추가</h2><form id="player-form" class="space-y-4"><input type="hidden" id="player-id"><div><label for="player-name" class="block mb-2 text-sm font-medium">이름</label><input type="text" id="player-name" class="bg-gray-50 border border-gray-300 text-sm rounded-lg block w-full p-2.5" required></div><div><label for="player-pos1" class="block mb-2 text-sm font-medium">주 포지션 (쉼표로 구분)</label><input type="text" id="player-pos1" placeholder="예: FW, LW" class="bg-gray-50 border border-gray-300 text-sm rounded-lg block w-full p-2.5"></div><div><label for="player-s1" class="block mb-2 text-sm font-medium">주 능력치</label><input type="number" id="player-s1" min="0" max="100" class="bg-gray-50 border border-gray-300 text-sm rounded-lg block w-full p-2.5"></div><div><label for="player-pos2" class="block mb-2 text-sm font-medium">부 포지션</label><input type="text" id="player-pos2" placeholder="예: MF" class="bg-gray-50 border border-gray-300 text-sm rounded-lg block w-full p-2.5"></div><div><label for="player-s2" class="block mb-2 text-sm font-medium">부 능력치</label><input type="number" id="player-s2" min="0" max="100" class="bg-gray-50 border border-gray-300 text-sm rounded-lg block w-full p-2.5"></div><div class="flex space-x-2"><button type="submit" class="w-full text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-5 py-2.5 text-center">저장</button><button type="button" id="cancel-edit-btn" class="w-full text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 font-medium rounded-lg text-sm px-5 py-2.5 text-center hidden">취소</button></div></form></div></div>`;

    tableBody = document.getElementById('player-table-body');
    form = document.getElementById('player-form');
    formTitle = document.getElementById('player-form-title');
    cancelBtn = document.getElementById('cancel-edit-btn');
    playerIdInput = document.getElementById('player-id');

    form.addEventListener('submit', handleFormSubmit);
    tableBody.addEventListener('click', handleTableClick);
    cancelBtn.addEventListener('click', resetForm);
}

export function renderPlayerTable() {
    if(!tableBody) return;

    const uniqueDates = new Set(state.attendanceLog.map(log => log.date));
    const totalMeetings = uniqueDates.size > 0 ? uniqueDates.size : 1;
    const playerAttendance = {};
    state.attendanceLog.forEach(log => {
        playerAttendance[log.name] = (playerAttendance[log.name] || 0) + 1;
    });

    tableBody.innerHTML = '';
    const playerNames = Object.keys(state.playerDB).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    if (playerNames.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">등록된 선수가 없습니다.</td></tr>`;
        return;
    }
    playerNames.forEach(name => {
        const p = state.playerDB[name];
        const attendanceCount = playerAttendance[name] || 0;
        const attendanceRate = ((attendanceCount / totalMeetings) * 100).toFixed(1);
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        row.innerHTML = `<td class="py-4 px-6 font-medium text-gray-900 whitespace-nowrap">${p.name}</td><td class="py-4 px-6 text-gray-700">${(p.pos1 || []).join(', ')} (${p.s1 || 0})</td><td class="py-4 px-6 text-gray-700">${(p.pos2 || []).join(', ')} (${p.s2 || 0})</td><td class="py-4 px-6 text-gray-700">${attendanceRate}% (${attendanceCount}/${totalMeetings})</td><td class="py-4 px-6"><button class="edit-btn font-medium text-blue-600 hover:underline mr-3" data-name="${p.name}">수정</button><button class="delete-btn font-medium text-red-600 hover:underline" data-name="${p.name}">삭제</button></td>`;
        tableBody.appendChild(row);
    });
}