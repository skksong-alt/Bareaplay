// js/modules/shareManagement.js
let state;
let generateBtn, printBtn, shareContentArea;
let shareDate, shareTime, shareLocation, shareMapLink, printArea;

function generateContent() {
    const dateVal = shareDate.value;
    const timeVal = shareTime.value;
    const locationVal = shareLocation.value;
    const mapLinkVal = shareMapLink.value;
    
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
    const locationVal = shareLocation.value;
    const mapLinkVal = shareMapLink.value;
    
    let printHtml = `<h1 class="print-title">Barea 모임 공지</h1>`;
    printHtml += `<p><strong>일시:</strong> ${dateVal || '미정'}</p>`;
    printHtml += `<p><strong>시간:</strong> ${timeVal || '미정'}</p>`;
    printHtml += `<p><strong>장소:</strong> ${locationVal || '미정'}</p>`;
    if (mapLinkVal) printHtml += `<p><strong>지도:</strong> <a href="${mapLinkVal}">${mapLinkVal}</a></p>`;
    
    if (state.teams && state.teams.length > 0) {
        printHtml += `<div class="print-section"><h2>팀 배정 결과</h2></div>`;
        printHtml += `<div class="print-grid">`;
        state.teams.forEach((team, index) => {
            printHtml += `<div class="print-team-card"><h3>팀 ${index + 1}</h3><ul>`;
            team.forEach(p => { printHtml += `<li>${p.name}</li>`; });
            printHtml += `</ul></div>`;
        });
        printHtml += `</div>`;
    }

    if (state.lineupResults && state.lineupResults.lineups) {
         printHtml += `<div class="print-section"><h2>쿼터별 라인업</h2></div>`;
         printHtml += `<div class="print-grid">`;
         state.lineupResults.lineups.forEach((lineup, index) => {
            printHtml += `<div class="print-team-card"><h3>${index+1}쿼터 (${state.lineupResults.formations[index]})</h3><ul>`;
            const onField = new Set(Object.values(lineup).flat().filter(Boolean));
            onField.forEach(p => { printHtml += `<li>${p}</li>`; });
            const resters = state.lineupResults.resters[index] || [];
            printHtml += `</ul><p style="margin-top:10px; font-size:12px;"><strong>휴식:</strong> ${resters.join(', ') || '없음'}</p></div>`;
         });
         printHtml += `</div>`;
    }
    
    printArea.innerHTML = printHtml;
    window.print();
}

export function init(firestoreDB, globalState) {
    state = globalState;
    generateBtn = document.getElementById('generate-share-content-btn');
    printBtn = document.getElementById('print-btn');
    shareContentArea = document.getElementById('share-content');
    shareDate = document.getElementById('share-date');
    shareTime = document.getElementById('share-time');
    shareLocation = document.getElementById('share-location');
    shareMapLink = document.getElementById('share-map-link');
    printArea = document.getElementById('print-area');

    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const todayLocal = new Date(today.getTime() - offset);
    shareDate.value = todayLocal.toISOString().split("T")[0];
    shareTime.value = '20:00';

    generateBtn.addEventListener('click', generateContent);
    printBtn.addEventListener('click', printContent);
}