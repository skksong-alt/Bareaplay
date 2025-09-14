// js/modules/shareManagement.js
import { collection, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let state, db;
let generateBtn, printBtn, shareContentArea, addLocationBtn;
let shareDate, shareTime, shareLocationSelect, printArea;

function populateLocations() {
    shareLocationSelect.innerHTML = '<option value="">장소를 선택하세요</option>';
    const sortedLocations = [...state.locations].sort((a,b) => a.name.localeCompare(b.name));
    sortedLocations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc.name;
        option.textContent = loc.name;
        option.dataset.url = loc.url || '';
        shareLocationSelect.appendChild(option);
    });
}

async function addNewLocation() {
    const name = prompt("새로운 장소의 이름을 입력하세요:");
    if (!name || !name.trim()) return;
    const url = prompt("해당 장소의 Google Maps URL을 입력하세요 (선택사항):");
    try {
        await addDoc(collection(db, "locations"), { name: name.trim(), url: url || '' });
        window.showNotification("새로운 장소가 추가되었습니다.");
    } catch (e) {
        console.error("장소 추가 실패: ", e);
        window.showNotification("장소 추가에 실패했습니다.", "error");
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
        state.lineupResults.lineups.forEach((lineup, index) => {
            content += `\n[${index + 1}쿼터 - ${state.lineupResults.formations[index]}]\n`;
            const onField = new Set(Object.values(lineup).flat().filter(Boolean));
            onField.forEach(player => { content += `- ${player}\n`; });
            const resters = state.lineupResults.resters[index] || [];
            content += `(휴식: ${resters.join(', ') || '없음'})\n`;
        });
    } else { content += "생성된 라인업이 없습니다.\n"; }

    shareContentArea.value = content;
    window.showNotification("공지 내용이 생성되었습니다.");
}

function printContent() {
    const dateVal = shareDate.value;
    const timeVal = shareTime.value;
    const selectedOption = shareLocationSelect.options[shareLocationSelect.selectedIndex];
    const locationVal = selectedOption.value;
    const mapLinkVal = selectedOption.dataset.url;
    
    let printHtml = '';

    // Page 1: Info & Teams
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
        // lineupResults.members를 기준으로 팀을 찾아서 순서대로 출력
        const lineupTeamMembers = state.lineupResults.members;
        const lineupTeamIndex = state.teams.findIndex(team => 
            team.map(p => p.name.replace(' (?)', '')).toString() === lineupTeamMembers.toString()
        );

        if(lineupTeamIndex > -1) {
            printHtml += `<div class="print-page">`;
            printHtml += `<div class="print-section"><h2>팀 ${lineupTeamIndex + 1} 라인업</h2></div>`;
            
            state.lineupResults.lineups.forEach((lineup, qIndex) => {
                printHtml += `<div class="print-team-card">`;
                printHtml += `<h3>${qIndex+1}쿼터 (${state.lineupResults.formations[qIndex]})</h3>`;
                printHtml += `<div class="print-lineup-container">`;
                
                printHtml += `<div class="print-pitch">`;
                const posCellMap = state.lineupResults.posCellMap; // state에서 posCellMap을 가져옴
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
    }
    
    printArea.innerHTML = printHtml;
    window.print();
}


export function init(firestoreDB, globalState) {
    db = firestoreDB;
    state = globalState;
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