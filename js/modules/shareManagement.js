// js/modules/shareManagement.js
let state;
let generateBtn, printBtn, shareContentArea;

function generateContent() {
    const today = new Date();
    const dateString = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
    let content = `[Barea ${dateString} 모임 공지]\n\n`;
    content += "⚽️ 팀 배정 결과\n";
    content += "====================\n";

    if (state.teams && state.teams.length > 0) {
        state.teams.forEach((team, index) => {
            content += `\n[팀 ${index + 1}]\n`;
            team.forEach(player => {
                content += `- ${player.name}\n`;
            });
        });
    } else {
        content += "팀 배정 결과가 없습니다.\n";
    }

    content += "\n\n📋 라인업\n";
    content += "====================\n";

    if (state.lineupResults && state.lineupResults.lineups) {
        state.lineupResults.lineups.forEach((lineup, index) => {
            content += `\n[${index + 1}쿼터 - ${state.lineupResults.formations[index]}]\n`;
            const onField = new Set(Object.values(lineup).flat().filter(Boolean));
            onField.forEach(player => {
                content += `- ${player}\n`;
            });
            content += `(휴식: ${state.lineupResults.resters[index].join(', ') || '없음'})\n`;
        });
    } else {
        content += "생성된 라인업이 없습니다.\n";
    }

    shareContentArea.value = content;
    window.showNotification("공지 내용이 생성되었습니다.");
}

function printContent() {
    const content = shareContentArea.value.replace(/\n/g, '<br>');
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>BareaPlay 출력</title><style>body { font-family: sans-serif; white-space: pre-wrap; }</style></head><body>${content}</body></html>`);
    printWindow.document.close();
    printWindow.print();
}

export function init(firestoreDB, globalState) {
    state = globalState;
    generateBtn = document.getElementById('generate-share-content-btn');
    printBtn = document.getElementById('print-btn');
    shareContentArea = document.getElementById('share-content');

    generateBtn.addEventListener('click', generateContent);
    printBtn.addEventListener('click', printContent);
}