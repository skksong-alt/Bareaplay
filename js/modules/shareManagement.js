// js/modules/shareManagement.js
import { collection, onSnapshot, addDoc, doc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let state, db, showNotification, pages;
let generateBtn, printBtn, shareContentArea, addLocationBtn;
let shareDate, shareTime, shareLocationSelect, printArea;

function populateLocations() {
    const currentVal = shareLocationSelect.value;
    shareLocationSelect.innerHTML = '<option value="">장소를 선택하세요</option>';
    const sortedLocations = [...state.locations].sort((a,b) => a.name.localeCompare(b.name));
    sortedLocations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc.name;
        option.textContent = loc.name;
        option.dataset.url = loc.url || '';
        shareLocationSelect.appendChild(option);
    });
    if (currentVal) {
        shareLocationSelect.value = currentVal;
    }
}

async function addNewLocation() {
    const name = prompt("새로운 장소의 이름을 입력하세요:");
    if (!name || !name.trim()) return;
    const url = prompt("해당 장소의 Google Maps URL을 입력하세요 (선택사항):");
    try {
        await addDoc(collection(db, "locations"), { name: name.trim(), url: url || '' });
        showNotification("새로운 장소가 추가되었습니다.");
    } catch (e) {
        console.error("장소 추가 실패: ", e);
        showNotification("장소 추가에 실패했습니다.", "error");
    }
}

function generateContent() {
    const dateVal = shareDate.value;
    const timeVal = shareTime.value;
    
    const selectedOption = shareLocationSelect.options[shareLocationSelect.selectedIndex];
    const locationVal = selectedOption.value;
    const mapLinkVal = selectedOption.dataset.url;
    
    let content = `[Barea 모임 공지]\n\n`;
    content += `- 일시: ${dateVal || '미정'}\n`;
    content += `- 시간: ${timeVal || '미정'}\n`;
    content += `- 장소: ${locationVal || '미정'}\n`;
    if (mapLinkVal) content += `- 지도: ${mapLinkVal}\n`;
    content += "\n====================\n";
    content += "⚽️ 팀 배정 결과\n";
    
    if (state.teams && state.teams.length > 0) {
        state.teams.forEach((team, index) => {
            content += `\n[팀 ${index + 1}]\n`;
            team.forEach(player => { content += `- ${player.name}\n`; });
        });
    } else { content += "팀 배정 결과가 없습니다.\n"; }

    content += "\n\n📋 라인업\n";
    content += "====================\n";

    if (state.lineupResults && state.lineupResults.lineups) {
        const lineupTeamMembers = state.lineupResults.members;
        const lineupTeam = state.teams.find(team => 
            team.map(p => p.name.replace(' (?)', '')).toString() === lineupTeamMembers.toString()
        );

        if (lineupTeam) {
            state.lineupResults.lineups.forEach((lineup, index) => {
                content += `\n[${index + 1}쿼터 - ${state.lineupResults.formations[index]}]\n`;
                const onField = new Set(Object.values(lineup).flat().filter(Boolean));
                onField.forEach(player => { content += `- ${player}\n`; });
                const resters = state.lineupResults.resters[index] || [];
                content += `(휴식: ${resters.join(', ') || '없음'})\n`;
            });
        } else {
             content += "선택된 팀의 라인업이 없습니다.\n";
        }
    } else { content += "생성된 라인업이 없습니다.\n"; }

    shareContentArea.value = content;
    showNotification("공지 내용이 생성되었습니다.");
}

function printContent() {
    const dateVal = shareDate.value;
    const timeVal = shareTime.value;
    const selectedOption = shareLocationSelect.options[shareLocationSelect.selectedIndex];
    const locationVal = selectedOption.value;
    const mapLinkVal = selectedOption.dataset.url;
    
    let printHtml = '';

    printHtml += `<div class="print-page">`;
    printHtml += `<h1 class="print-title">Barea 모임 공지</h1>`;
    printHtml += `<div class="print-info">`;
    printHtml += `<p><strong>일시:</strong> ${dateVal || '미정'}</p>`;
    printHtml += `<p><strong>시간:</strong> ${timeVal || '미정'}</p>`;
    printHtml += `<p><strong>장소:</strong> ${locationVal || '미정'}</p>`;
    if (mapLinkVal) printHtml += `<p><strong>지도:</strong> <a href="${mapLinkVal}" target="_blank">${mapLinkVal}</a></p>`;
    printHtml += `</div>`;
    
    if (state.teams && state.teams.length > 0) {
        printHtml += `<div class="print-section"><h2>팀 배정 결과</h2></div>`;
        printHtml += `<div class="print-team-grid">`;
        state.teams.forEach((team, index) => {
            printHtml += `<div class="print-team-card"><h3>팀 ${index + 1}</h3><ul>`;
            team.forEach(p => { printHtml += `<li>${p.name}</li>`; });
            printHtml += `</ul></div>`;
        });
        printHtml += `</div>`;
    }
    printHtml += `</div>`;

    if (state.lineupResults && state.lineupResults.lineups) {
        const lineupTeamMembers = state.lineupResults.members;
        let teamCounter = 1;
        state.teams.forEach(team => {
            const currentTeamMembers = team.map(p => p.name.replace(' (?)', ''));
            if (currentTeamMembers.toString() === lineupTeamMembers.toString()) {
                printHtml += `<div class="print-page">`;
                printHtml += `<div class="print-section"><h2>팀 ${teamCounter} 라인업</h2></div>`;
                
                state.lineupResults.lineups.forEach((lineup, qIndex) => {
                    printHtml += `<div class="print-team-card">`;
                    printHtml += `<h3>${qIndex+1}쿼터 (${state.lineupResults.formations[qIndex]})</h3>`;
                    printHtml += `<div class="print-lineup-container">`;
                    
                    printHtml += `<div class="print-pitch">`;
                    const posCellMap = lineupGenerator.getPosCellMap();
                    const formationLayout = posCellMap[state.lineupResults.formations[qIndex]] || [];
                    let counters = {};
                    formationLayout.forEach((fc) => {
                        const pos = fc.pos;
                        counters[pos] = (counters[pos] || 0);
                        let name = (lineup[pos] || [])[counters[pos]] || '';
                        counters[pos]++;
                        if (name) {
                            let icon = '❓', bgColor = '#B0BEC5';
                            if (pos === "GK") { icon = "🧤"; bgColor = "#a5d6a7"; } 
                            else if (["LB", "RB", "CB", "DF"].includes(pos)) { icon = "🛡"; bgColor = "#90caf9"; } 
                            else if (["MF", "CM"].includes(pos)) { icon = "⚙"; bgColor = "#fff59d"; } 
                            else if (["LW", "RW", "FW"].includes(pos)) { icon = "🎯"; bgColor = "#ffcc80"; }
                            printHtml += `<div class="print-player-marker" style="left:${fc.x}%; top:${fc.y}%;"><div class="print-player-icon" style="background-color:${bgColor};">${icon}</div><span class="print-player-name">${name}</span></div>`;
                        }
                    });
                    printHtml += `</div>`;

                    const resters = state.lineupResults.resters[qIndex] || [];
                    printHtml += `<div class="print-rester-list"><h4>휴식 선수</h4><ul>`;
                    resters.forEach(r => { printHtml += `<li>${r}</li>` });
                    printHtml += `</ul></div>`;

                    printHtml += `</div></div>`;
                });
                printHtml += `</div>`;
            }
            teamCounter++;
        });
    }
    
    printArea.innerHTML = printHtml;
    window.print();
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;
    showNotification = dependencies.showNotification;
    pages = dependencies.pages;

    pages.share.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">모임 정보 입력</h2><div class="space-y-4"><div><label for="share-date" class="block text-sm font-medium">날짜</label><input type="date" id="share-date" class="mt-1 w-full p-2 border rounded-lg"></div><div><label for="share-time" class="block text-sm font-medium">시간</label><input type="time" id="share-time" class="mt-1 w-full p-2 border rounded-lg"></div><div><label for="share-location-select" class="block text-sm font-medium">장소 선택</label><div class="flex items-center gap-2 mt-1"><select id="share-location-select" class="w-full p-2 border rounded-lg bg-white"></select><button id="add-location-btn" class="p-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-lg admin-control" disabled>➕</button></div></div></div><div class="flex space-x-2 mt-6"><button id="generate-share-content-btn" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">공지 생성</button><button id="print-btn" class="w-full bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600">인쇄/PDF 저장</button></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">미리보기 및 복사</h2><textarea id="share-content" readonly class="w-full h-96 p-3 border rounded-lg bg-gray-50" placeholder="'공지 생성' 버튼을 누르면 팀 배정 및 라인업 결과가 여기에 표시됩니다."></textarea></div></div>`;
    
    generateBtn = document.getElementById('generate-share-content-btn');
    printBtn = document.getElementById('print-btn');
    shareContentArea = document.getElementById('share-content');
    shareDate = document.getElementById('share-date');
    shareTime = document.getElementById('share-time');
    shareLocationSelect = document.getElementById('share-location-select');
    addLocationBtn = document.getElementById('add-location-btn');
    printArea = document.getElementById('print-area');

    onSnapshot(collection(db, "locations"), (snapshot) => {
        state.locations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        populateLocations();
    });

    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const todayLocal = new Date(today.getTime() - offset);
    shareDate.value = todayLocal.toISOString().split("T")[0];
    shareTime.value = '20:00';

    generateBtn.addEventListener('click', generateContent);
    printBtn.addEventListener('click', printContent);
    addLocationBtn.addEventListener('click', addNewLocation);
}

export { populateLocations };