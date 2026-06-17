// js/modules/shareManagement.js
import { doc, setDoc, collection, onSnapshot, addDoc, getDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state;
let addLocationBtn, shareDate, shareTime, shareLocationSelect;
let generateShareBtn, shareLinkContainer, shareLinkAnchor;
let locationModal, closeLocationModalBtn, addNewLocationBtn, locationListDiv, newLocationNameInput, newLocationUrlInput;
let currentVoteId = null;       // 현재 열려있는 보드(=날짜) ID
let voteRespUnsub = null;       // 응답 실시간 구독 해제
let voteResponses = [];         // 응답 캐시

const posCellMap = { '4-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 75}, {pos: 'CB', x: 65, y: 80}, {pos: 'CB', x: 35, y: 80}, {pos: 'LB', x: 15, y: 75}, {pos: 'RW', x: 85, y: 45}, {pos: 'CM', x: 65, y: 55}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 15, y: 45}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-3-3': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 88, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 12, y: 78}, {pos: 'CM', x: 50, y: 65}, {pos: 'MF', x: 70, y: 50}, {pos: 'MF', x: 30, y: 50}, {pos: 'RW', x: 80, y: 25}, {pos: 'FW', x: 50, y: 18}, {pos: 'LW', x: 20, y: 25} ], '3-5-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 75, y: 80}, {pos: 'CB', x: 50, y: 85}, {pos: 'CB', x: 25, y: 80}, {pos: 'RW', x: 90, y: 50}, {pos: 'CM', x: 65, y: 55}, {pos: 'MF', x: 50, y: 65}, {pos: 'CM', x: 35, y: 55}, {pos: 'LW', x: 10, y: 50}, {pos: 'FW', x: 60, y: 20}, {pos: 'FW', x: 40, y: 20} ], '4-2-3-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'RB', x: 85, y: 78}, {pos: 'CB', x: 65, y: 82}, {pos: 'CB', x: 35, y: 82}, {pos: 'LB', x: 15, y: 78}, {pos: 'MF', x: 60, y: 65}, {pos: 'MF', x: 40, y: 65}, {pos: 'RW', x: 80, y: 40}, {pos: 'MF', x: 50, y: 45}, {pos: 'LW', x: 20, y: 40}, {pos: 'FW', x: 50, y: 18} ], '3-4-2': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 65, y: 25}, {pos: 'FW', x: 35, y: 25} ], '3-4-1': [ {pos: 'GK', x: 50, y: 92}, {pos: 'CB', x: 80, y: 80}, {pos: 'CB', x: 50, y: 82}, {pos: 'CB', x: 20, y: 80}, {pos: 'RW', x: 85, y: 50}, {pos: 'CM', x: 60, y: 60}, {pos: 'CM', x: 40, y: 60}, {pos: 'LW', x: 15, y: 50}, {pos: 'FW', x: 50, y: 20} ] };

function normalizeName(name) {
    return name ? name.normalize('NFC').trim() : '';
}

function populateLocations() {
    if (!shareLocationSelect) return;
    const currentVal = shareLocationSelect.value;
    shareLocationSelect.innerHTML = '<option value="">장소를 선택하세요</option>';
    const sortedLocations = [...state.locations].sort((a,b) => a.name.localeCompare(b.name, 'ko-KR'));
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

function renderLocationList() {
    if (!locationListDiv) return;
    locationListDiv.innerHTML = '';
    state.locations.forEach(loc => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center bg-gray-100 p-2 rounded-lg';
        div.innerHTML = `
            <div>
                <p class="font-semibold">${loc.name}</p>
                <p class="text-xs text-gray-500">${loc.url || 'URL 없음'}</p>
            </div>
            <button data-id="${loc.id}" class="delete-location-btn text-red-500 hover:text-red-700 font-bold p-1">삭제</button>
        `;
        locationListDiv.appendChild(div);
    });
}

async function generateShareableLink() {
    if (!state.isAdmin) {
        window.promptForAdminPassword();
        return;
    }
    if (!state.teams || state.teams.length === 0) {
        window.showNotification("팀 배정 결과가 없습니다. 먼저 팀을 생성해주세요.", "error");
        return;
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.opacity = 1;

    try {
        const allTeamLineups = {};
        const lineupPromises = state.teams.map((team, i) => {
            if (state.teamLineupCache && state.teamLineupCache[i]) {
                return Promise.resolve(state.teamLineupCache[i]);
            }
            const teamMembers = team.map(p => p.name.replace(' (신규)', ''));
            const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
            return window.lineup.executeLineupGeneration(teamMembers, formations, true);
        });

        const lineups = await Promise.all(lineupPromises);
        
        lineups.forEach((originalLineup, i) => {
            if (originalLineup) {
                const lineup = JSON.parse(JSON.stringify(originalLineup));

                const restersObject = {};
                const refereesObject = {};

                (lineup.resters || []).forEach((resterArray, qIndex) => {
                    restersObject[`q${qIndex + 1}`] = resterArray;
                });
                // 심판 데이터도 저장
                (lineup.referees || []).forEach((ref, qIndex) => {
                    refereesObject[`q${qIndex + 1}`] = ref;
                });

                lineup.resters = restersObject; 
                lineup.referees = refereesObject;
                allTeamLineups[`team${i + 1}`] = lineup;
            }
        });

        const teamsObject = {};
        state.teams.forEach((team, index) => {
            teamsObject[`team${index + 1}`] = team;
        });

        const shareData = {
            meetingInfo: {
                time: `${shareDate.value} ${shareTime.value}`,
                location: shareLocationSelect.value,
                locationUrl: shareLocationSelect.options[shareLocationSelect.selectedIndex]?.dataset.url || ''
            },
            teams: teamsObject,
            lineups: allTeamLineups,
            createdAt: new Date().toISOString()
        };

        const shareDocRef = await addDoc(collection(db, "shares"), shareData);
        
        const meetingDate = new Date(shareData.meetingInfo.time);
        const year = meetingDate.getFullYear();
        const month = String(meetingDate.getMonth() + 1).padStart(2, '0');
        const day = String(meetingDate.getDate()).padStart(2, '0');
        const linkText = `${year}.${month}.${day}. 모임확인`;
        
        await setDoc(doc(db, "settings", "activeMeeting"), { 
            shareId: shareDocRef.id,
            linkText: linkText,
            meetingTime: shareData.meetingInfo.time
        });

        const shareUrl = `${window.location.origin}${window.location.pathname}?shareId=${shareDocRef.id}`;
        
        const shareLinkContainer = document.getElementById('share-link-container');
        const shareLinkAnchor = document.getElementById('share-link-anchor');
        shareLinkContainer.classList.remove('hidden');
        shareLinkAnchor.href = shareUrl;
        shareLinkAnchor.textContent = shareUrl;

        navigator.clipboard.writeText(shareUrl).then(() => {
            window.showNotification("공유 링크가 생성되어 클립보드에 복사되었습니다!");
        }).catch(() => {
            window.showNotification("공유 링크가 생성되었습니다.");
        });

    } catch (error) {
        console.error("Share link generation failed: ", error);
        window.showNotification("공유 링크 생성에 실패했습니다.", "error");
    } finally {
        loadingOverlay.style.opacity = 0;
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
    }
}

export function generatePrintView(shareData) {
    const teams = Object.values(shareData.teams || {});
    const { meetingInfo, lineups } = shareData;
    const colors = ["#0D9488","#0288D1","#7B1FA2","#43A047","#F4511E"];

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        window.showNotification('팝업이 차단되었습니다. 팝업을 허용해주세요.', 'error');
        return;
    }

    const createQuarterHTML = (teamLineup, teamIdx, qIndex) => {
        if (!teamLineup || !teamLineup.lineups || !teamLineup.lineups[qIndex]) return '<div class="pitch-print-placeholder"></div>';
        
        const lineup = teamLineup.lineups[qIndex];
        const formation = teamLineup.formations[qIndex];
        
        // [수정] 데이터 안전하게 가져오기 (배열 혹은 객체)
        const getQuarterData = (dataObj, idx) => {
            if (Array.isArray(dataObj)) return dataObj[idx];
            return dataObj[`q${idx + 1}`] || null;
        };

        const referee = getQuarterData(teamLineup.referees || [], qIndex);
        const rawResters = getQuarterData(teamLineup.resters || [], qIndex) || [];
        
        // [중요 수정] 생성기가 계산한 휴식 명단을 그대로 사용 (재계산 X)
        // 심판은 휴식자 명단에서 제외하여 중복 표시 방지
        const resters = rawResters.filter(r => r !== referee);

        let pitchHtml = `<div class="pitch-print">
            <div class="pitch-line-print" style="top:50%; left:0; width:100%; height:1.5px;"></div>
            <div class="center-circle-print" style="top:50%; left:50%; width:25%; height:17.5%; transform: translate(-50%,-50%);"></div>
            <div class="pitch-line-print" style="top:50%; left:50%; width:1.5px; height:1.5px; border-radius:50%; transform: translate(-50%, -50%); background:white;"></div>
            <div class="penalty-box-print" style="top: 83%; left: 20%; width: 60%; height: 17%;"></div>
            <div class="penalty-box-print" style="top: 0%; left: 20%; width: 60%; height: 17%;"></div>
            <div class="quarter-title-integrated">팀 ${teamIdx + 1} - ${qIndex + 1}쿼터 (${formation})</div>`;
        
        const counters = {};
        (posCellMap[formation] || []).forEach(fc => {
            counters[fc.pos] = (counters[fc.pos] || 0);
            const name = (lineup[fc.pos] || [])[counters[fc.pos]] || '미배정';
            
            let icon = '❓', bgColor = '#78909C';
            if (fc.pos === "GK") { icon = "🧤"; bgColor = "#00C853"; } 
            else if (["LB", "RB", "CB", "DF"].includes(fc.pos)) { icon = "🛡"; bgColor = "#03A9F4"; } 
            else if (["MF", "CM"].includes(fc.pos)) { icon = "⚙"; bgColor = "#FFEB3B"; } 
            else if (["LW", "RW", "FW"].includes(fc.pos)) { icon = "🎯"; bgColor = "#FF9800"; }
            
            pitchHtml += `
                <div class="player-marker-print" style="left: ${fc.x}%; top: ${fc.y}%;">
                    <div class="player-icon-print" style="background-color: ${bgColor};">
                        ${(name === '미배정' ? '❓' : icon)}
                    </div>
                    <div class="player-name-print">
                        ${name === '미배정' ? '-' : name}
                    </div>
                </div>`;
            counters[fc.pos]++;
        });
        pitchHtml += `</div>`;

        // [수정] 심판과 휴식자 분리 표시
        let footerHtml = '';
        if (referee) {
            footerHtml += `<span style="margin-right: 10px;"><b>⚖️ 심판:</b> ${referee}</span>`;
        }
        footerHtml += `<span><b>🛌 휴식:</b> ${resters.length > 0 ? resters.join(', ') : '없음'}</span>`;

        return `<div class="quarter-block">
                    ${pitchHtml}
                    <div class="rest-players-print">${footerHtml}</div>
                </div>`;
    };    

    let locationHtml = meetingInfo.locationUrl 
        ? `<a href="${meetingInfo.locationUrl}" target="_blank" style="color: #0000EE; text-decoration: underline;">${meetingInfo.location}</a>`
        : (meetingInfo.location || '미정');

    let fullHtml = `
    <html><head><title>BareaPlay 출력</title>
    <style>
        * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; box-sizing: border-box; }
        body { font-family:'Noto Sans KR', sans-serif; margin: 0; background-color: #f9fafb; }
        .page-break { page-break-after: always; }
        .print-container { padding: 1.5cm; }
        .print-header { text-align: center; margin-bottom: 1.5cm; }
        .print-header h1 { font-size: 28px; margin: 0 0 5px 0; }
        .print-header p { font-size: 16px; margin: 0; color: #6b7280; }
        .print-footer { position: fixed; bottom: 1cm; left: 1.5cm; right: 1.5cm; text-align: center; font-size: 10px; color: #9ca3af; }
        .info-box { background:#fff; padding:1rem; border:1px solid #e5e7eb; border-radius:.5rem; margin-bottom:1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .section-title { font-size:20px; margin:0 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
        .team-grid-print { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:15px; page-break-inside: avoid; }
        .team-box { border-radius:0.5rem; padding:0.8rem; color:white; }
        .team-box h3 { font-size: 1.1rem; margin:0 0 8px 0; padding-bottom:4px; border-bottom: 1px solid rgba(255,255,255,0.4); }
        .team-box ul {
            font-size:0.8rem;
            list-style:none;
            padding-left:0;
            margin:0;
            columns: 2;
            -webkit-columns: 2;
            -moz-columns: 2;
            column-gap: 15px;
        }
        .team-box li { margin-bottom:4px; }
        .single-team-title { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 1cm; padding-bottom: 10px; }
        .lineup-grid-final { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1cm; }
        .quarter-block { display:flex; flex-direction:column; }
        .pitch-print { background:#2E7D32; border:1px solid #999; position:relative; width:100%; aspect-ratio: 7/10; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .pitch-print-placeholder { border: 2px dashed #ccc; border-radius: 4px; width: 100%; aspect-ratio: 7/10; }
        .pitch-line-print { position: absolute; background-color: rgba(255,255,255,0.5); }
        .center-circle-print { position: absolute; border: 1.5px solid rgba(255,255,255,0.5); border-radius: 50%; }
        .penalty-box-print { position: absolute; border: 1.5px solid rgba(255,255,255,0.5); }
        .quarter-title-integrated { position: absolute; top: 8px; left: 8px; font-size: 0.8rem; font-weight: bold; color: white; background: rgba(0,0,0,0.5); padding: 3px 6px; border-radius: 5px; z-index: 10; }
        .rest-players-print { text-align: center; margin-top: 8px; padding: 4px; font-size: 0.8rem; font-weight: bold; background: #f3f4f6; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .player-marker-print { position:absolute; transform:translate(-50%,-50%); text-align:center; }
        .player-icon-print { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:.7rem; border:1.5px solid white; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
        .player-name-print { background:rgba(0,0,0,0.7); color:white; font-size:0.65rem; padding:2px 5px; border-radius:5px; margin-top:3px; white-space:nowrap; }
        @page { size: A4 landscape; margin: 0; }
    </style>
    </head><body>
    <div class="print-container">
        <div class="print-header"><h1>BareaPlay 모임 결과</h1><p>두바이 한인축구팀 Barea</p></div>
        <div class="info-box">
            <h2 class="section-title">📅 모임 정보</h2>
            <p style="margin: 4px 0;"><b>시간:</b> ${new Date(meetingInfo.time).toLocaleString('ko-KR')}</p>
            <p style="margin: 4px 0;"><b>장소:</b> ${locationHtml}</p>
        </div>
        <div>
            <h2 class="section-title">⚖️ 팀 배정 결과</h2>
            <div class="team-grid-print">`;
    teams.forEach((team, i) => {
        fullHtml += `<div class="team-box" style="background:${colors[i%5]}"><h3>팀 ${i+1}</h3><ul>${[...team].sort((a,b)=>a.name.localeCompare(b.name,'ko-KR')).map(p=>`<li>${p.name.replace(' (신규)','')}</li>`).join('')}</ul></div>`;
    });
    fullHtml += `</div></div><div class="print-footer">© 2025 BareaPlay. Created by 송감독.</div></div>`;
    
    teams.forEach((team, teamIdx) => {
        const lineup = lineups[`team${teamIdx + 1}`];
        const teamColor = colors[teamIdx % 5];
        
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<h2 class="single-team-title" style="border-bottom: 3px solid ${teamColor};">팀 ${teamIdx + 1} 라인업 (1-3쿼터)</h2>`;
        fullHtml += `<div class="lineup-grid-final">`;
        for (let i = 0; i < 3; i++) { fullHtml += createQuarterHTML(lineup, teamIdx, i); }
        fullHtml += `</div><div class="print-footer">© 2025 BareaPlay. Created by 송감독.</div></div>`;
        
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<h2 class="single-team-title" style="border-bottom: 3px solid ${teamColor};">팀 ${teamIdx + 1} 라인업 (4-6쿼터)</h2>`;
        fullHtml += `<div class="lineup-grid-final">`;
        for (let i = 3; i < 6; i++) { fullHtml += createQuarterHTML(lineup, teamIdx, i); }
        fullHtml += `</div><div class="print-footer">© 2025 BareaPlay. Created by 송감독.</div></div>`;
    });

    fullHtml += `</body></html>`;
    
    printWindow.document.open();
    printWindow.document.write(fullHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(()=>printWindow.print(), 500);
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;

    const pageElement = document.getElementById('page-share');
    pageElement.innerHTML = `<div class="bg-white p-6 rounded-2xl shadow-lg">
        <h2 class="text-2xl font-bold mb-1">📢 모임 보드 (관리자용)</h2>
        <p class="text-sm text-gray-500 mb-4">날짜를 고르면 그 날의 투표/현황이 열립니다. 링크 하나로 투표·모임정보·팀배정·라인업이 모두 공유됩니다.</p>
        <div class="space-y-4 max-w-lg mx-auto">
            <div class="grid grid-cols-2 gap-2">
                <div><label for="share-date" class="block text-sm font-medium">날짜</label><input type="date" id="share-date" class="mt-1 w-full p-2 border rounded-lg"></div>
                <div><label for="share-time" class="block text-sm font-medium">시간</label><input type="time" id="share-time" class="mt-1 w-full p-2 border rounded-lg"></div>
            </div>
            <div>
                <div class="flex justify-between items-center"><label for="share-location-select" class="block text-sm font-medium">장소</label><button id="manage-locations-btn" class="text-sm text-indigo-600 hover:underline">장소 관리</button></div>
                <select id="share-location-select" class="w-full p-2 border rounded-lg bg-white mt-1"></select>
            </div>
            <button id="board-open-btn" class="w-full bg-emerald-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-emerald-700">이 날짜 보드 열기 / 투표 만들기</button>
            <div id="board-link-container" class="hidden p-4 bg-emerald-50 rounded-lg">
                <p class="text-sm font-semibold mb-2">이 모임 링크 (카톡방에 공유):</p>
                <a id="board-link-anchor" href="#" target="_blank" class="text-blue-600 break-all hover:underline text-sm"></a>
                <button id="board-copy-btn" class="mt-2 w-full bg-blue-500 text-white text-sm font-bold py-2 rounded-lg hover:bg-blue-600">링크 복사</button>
            </div>
        </div>
        <div id="vote-status-panel" class="mt-6 max-w-2xl mx-auto"></div>
        <div id="board-publish-area" class="hidden mt-6 max-w-lg mx-auto border-t pt-4">
            <button id="board-publish-btn" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700">📋 팀배정·라인업 최종본 게시</button>
            <p id="board-publish-status" class="text-xs text-gray-500 mt-2 text-center">현재 만들어진 팀배정과 라인업을 위 링크에 공개합니다. (다시 누르면 갱신)</p>
        </div>
    </div>`;

    shareDate = document.getElementById('share-date');
    shareTime = document.getElementById('share-time');
    shareLocationSelect = document.getElementById('share-location-select');

    locationModal = document.getElementById('location-modal');
    closeLocationModalBtn = document.getElementById('close-location-modal-btn');
    addNewLocationBtn = document.getElementById('add-location-btn');
    locationListDiv = document.getElementById('location-list');
    newLocationNameInput = document.getElementById('new-location-name');
    newLocationUrlInput = document.getElementById('new-location-url');

    document.getElementById('manage-locations-btn').addEventListener('click', () => locationModal.classList.remove('hidden'));
    closeLocationModalBtn.addEventListener('click', () => locationModal.classList.add('hidden'));

    addNewLocationBtn.addEventListener('click', async () => {
        const name = newLocationNameInput.value.trim();
        const url = newLocationUrlInput.value.trim();
        if (name) {
            await addDoc(collection(db, "locations"), { name, url });
            newLocationNameInput.value = '';
            newLocationUrlInput.value = '';
            window.showNotification('새로운 장소가 추가되었습니다.');
        }
    });

    locationListDiv.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-location-btn')) {
            const id = e.target.dataset.id;
            if (confirm('이 장소를 정말 삭제하시겠습니까?')) {
                await deleteDoc(doc(db, "locations", id));
                window.showNotification('장소가 삭제되었습니다.');
            }
        }
    });

    onSnapshot(collection(db, "locations"), (snapshot) => {
        state.locations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        populateLocations();
        renderLocationList();
    });

    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const todayLocal = new Date(today.getTime() - offset);
    shareDate.value = todayLocal.toISOString().split("T")[0];
    shareTime.value = '20:00';

    // 날짜 바꾸면 그 날 보드를 자동으로 불러옴
    shareDate.addEventListener('change', onDateChange);
    // 시간/장소를 바꾸면 (보드가 열려있을 때) 공개 페이지에 자동 반영
    shareTime.addEventListener('change', autoUpdateMeetingInfo);
    shareLocationSelect.addEventListener('change', autoUpdateMeetingInfo);

    document.getElementById('board-open-btn').addEventListener('click', () => openBoard(shareDate.value, true));
    document.getElementById('board-copy-btn').addEventListener('click', copyBoardLink);
    document.getElementById('board-publish-btn').addEventListener('click', publishBoard);

    // 처음 진입 시 오늘 날짜 보드가 이미 있으면 불러오기
    onDateChange();
}

function boardUrl(voteId) {
    return `${window.location.origin}${window.location.pathname}?voteId=${encodeURIComponent(voteId)}`;
}

function copyBoardLink() {
    if (!currentVoteId) return;
    navigator.clipboard.writeText(boardUrl(currentVoteId))
        .then(() => window.showNotification('링크가 복사되었습니다.'))
        .catch(() => window.showNotification('복사 실패. 링크를 길게 눌러 복사하세요.', 'error'));
}

function showBoardLink(voteId) {
    const c = document.getElementById('board-link-container');
    const a = document.getElementById('board-link-anchor');
    if (!c || !a) return;
    a.href = boardUrl(voteId);
    a.textContent = boardUrl(voteId);
    c.classList.remove('hidden');
    const pub = document.getElementById('board-publish-area');
    if (pub) pub.classList.remove('hidden');
}

async function onDateChange() {
    const date = shareDate.value;
    if (!date) return;
    try {
        const snap = await getDoc(doc(db, "votes", date));
        if (snap.exists()) {
            const v = snap.data();
            if (v.time) shareTime.value = v.time;
            if (v.location) { shareLocationSelect.value = v.location; }
            openBoard(date, false); // 이미 있으면 그대로 열기 (덮어쓰지 않음)
        } else {
            // 아직 없는 날짜: 상태판 비우고 안내
            currentVoteId = null;
            if (voteRespUnsub) { voteRespUnsub(); voteRespUnsub = null; }
            const panel = document.getElementById('vote-status-panel');
            if (panel) panel.innerHTML = '<p class="text-sm text-gray-400 text-center">아직 이 날짜의 보드가 없습니다. 위 버튼으로 만들어주세요.</p>';
            const c = document.getElementById('board-link-container');
            if (c) c.classList.add('hidden');
            const pub = document.getElementById('board-publish-area');
            if (pub) pub.classList.add('hidden');
        }
    } catch (e) { console.error(e); }
}

async function openBoard(date, allowCreate) {
    if (!date) { window.showNotification('날짜를 선택해주세요.', 'error'); return; }
    if (!state.isAdmin) { window.promptForAdminPassword(); return; }
    const ref = doc(db, "votes", date);
    const opt = shareLocationSelect.options[shareLocationSelect.selectedIndex];
    const meetingInfo = {
        date,
        time: shareTime.value || '',
        location: shareLocationSelect.value || '',
        locationUrl: (opt && opt.dataset.url) || ''
    };
    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            if (!allowCreate) return;
            await setDoc(ref, { ...meetingInfo, published: false, createdAt: serverTimestamp() });
            window.showNotification(`${date} 보드(투표)가 만들어졌습니다!`);
        }
        currentVoteId = date;
        showBoardLink(date);
        // 메인 화면 실시간 링크에도 노출
        await setDoc(doc(db, "settings", "activeMeeting"), { voteId: date, linkText: `${date} 모임 보드` }, { merge: true });
        subscribeResponses(date);
    } catch (e) {
        console.error(e);
        window.showNotification('보드 열기 실패: ' + e.message, 'error');
    }
}

const autoUpdateMeetingInfo = window.debounce(async () => {
    if (!currentVoteId) return;
    const opt = shareLocationSelect.options[shareLocationSelect.selectedIndex];
    try {
        await setDoc(doc(db, "votes", currentVoteId), {
            time: shareTime.value || '',
            location: shareLocationSelect.value || '',
            locationUrl: (opt && opt.dataset.url) || ''
        }, { merge: true });
        window.showNotification('모임 정보가 갱신되어 링크에 반영되었습니다.');
    } catch (e) { console.error(e); }
}, 700);

function subscribeResponses(date) {
    if (voteRespUnsub) voteRespUnsub();
    voteRespUnsub = onSnapshot(collection(db, "votes", date, "responses"), (snap) => {
        voteResponses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderVoteStatus();
    });
}

function vts(t) { return (t && typeof t.seconds === 'number') ? t.seconds : Infinity; }

function renderVoteStatus() {
    const panel = document.getElementById('vote-status-panel');
    if (!panel) return;

    const attend = voteResponses.filter(r => r.status === 'attend').sort((a, b) => vts(a.attendingSince) - vts(b.attendingSince));
    const maybe = voteResponses.filter(r => r.status === 'maybe').sort((a, b) => vts(a.updatedAt) - vts(b.updatedAt));
    const absent = voteResponses.filter(r => r.status === 'absent').sort((a, b) => vts(a.updatedAt) - vts(b.updatedAt));

    const li = (r, i, withNum) => `<li class="flex items-center justify-between py-1 border-b">
        <span>${withNum ? '<span class="text-gray-400 mr-1">' + (i + 1) + '</span>' : ''}<b>${window.esc(r.name)}</b>${r.guest ? ' <span class="text-xs text-amber-600">(게스트)</span>' : ''}</span>
        <span class="space-x-1 text-xs">
            ${r.status !== 'attend' ? `<button data-id="${window.esc(r.id)}" class="vs-attend text-green-600 hover:underline">참석</button>` : ''}
            ${r.status !== 'maybe' ? `<button data-id="${window.esc(r.id)}" class="vs-maybe text-yellow-600 hover:underline">미정</button>` : ''}
            ${r.status !== 'absent' ? `<button data-id="${window.esc(r.id)}" class="vs-absent text-gray-500 hover:underline">불참</button>` : ''}
            <button data-id="${window.esc(r.id)}" class="vs-del text-red-500 hover:underline">삭제</button>
        </span></li>`;

    panel.innerHTML = `<div class="border-t pt-4">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 class="text-lg font-bold">투표 현황 <span class="text-green-600">참석 ${attend.length}</span> · <span class="text-yellow-600">미정 ${maybe.length}</span> · <span class="text-gray-400">불참 ${absent.length}</span></h3>
            <button id="vote-to-balancer" class="bg-indigo-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">이 투표로 팀 짜기 →</button>
        </div>
        <p class="text-xs text-gray-400 mb-2">참석자는 투표가 늦을수록 아래쪽이며, 팀 배정 후 아래(늦은 투표)부터 휴식·키퍼를 맡습니다.</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div><p class="font-semibold text-green-700 mb-1">참석 (투표순)</p><ul>${attend.map((r, i) => li(r, i, true)).join('') || '<li class="text-gray-400 py-1">없음</li>'}</ul></div>
            <div><p class="font-semibold text-yellow-700 mb-1">미정</p><ul>${maybe.map((r, i) => li(r, i, false)).join('') || '<li class="text-gray-400 py-1">없음</li>'}</ul></div>
            <div><p class="font-semibold text-gray-600 mb-1">불참</p><ul>${absent.map((r, i) => li(r, i, false)).join('') || '<li class="text-gray-400 py-1">없음</li>'}</ul></div>
        </div>
        <div class="mt-3 flex space-x-2">
            <input type="text" id="vote-admin-add-name" class="flex-grow p-2 border rounded-lg text-sm" placeholder="명단에 없는 사람 직접 추가 (참석)">
            <button id="vote-admin-add-btn" class="bg-emerald-600 text-white text-sm font-bold py-2 px-4 rounded-lg hover:bg-emerald-700">참석 추가</button>
        </div>
    </div>`;

    panel.querySelectorAll('.vs-attend').forEach(b => b.onclick = () => setRespStatus(b.dataset.id, 'attend'));
    panel.querySelectorAll('.vs-maybe').forEach(b => b.onclick = () => setRespStatus(b.dataset.id, 'maybe'));
    panel.querySelectorAll('.vs-absent').forEach(b => b.onclick = () => setRespStatus(b.dataset.id, 'absent'));
    panel.querySelectorAll('.vs-del').forEach(b => b.onclick = () => delResp(b.dataset.id));
    const addBtn = document.getElementById('vote-admin-add-btn');
    if (addBtn) addBtn.onclick = addResp;
    const balBtn = document.getElementById('vote-to-balancer');
    if (balBtn) balBtn.onclick = sendToBalancer;
}

async function setRespStatus(respId, status) {
    if (!state.isAdmin || !currentVoteId) return;
    const payload = { status, updatedAt: serverTimestamp() };
    if (status === 'attend') payload.attendingSince = serverTimestamp();
    await setDoc(doc(db, "votes", currentVoteId, "responses", respId), payload, { merge: true });
}

async function delResp(respId) {
    if (!state.isAdmin || !currentVoteId) return;
    if (!confirm('이 응답을 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, "votes", currentVoteId, "responses", respId));
}

async function addResp() {
    if (!state.isAdmin || !currentVoteId) return;
    const input = document.getElementById('vote-admin-add-name');
    const name = normalizeName(input.value);
    if (!name) return;
    const known = !!state.playerDB[name] || Object.keys(state.playerDB).some(k => normalizeName(k) === name);
    await setDoc(doc(db, "votes", currentVoteId, "responses", name), {
        name, status: 'attend', guest: !known,
        attendingSince: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
    input.value = '';
    window.showNotification(`${name} 참석 추가됨`);
}

function sendToBalancer() {
    const attend = voteResponses.filter(r => r.status === 'attend').sort((a, b) => vts(a.attendingSince) - vts(b.attendingSince));
    if (attend.length === 0) { window.showNotification('참석자가 없습니다.', 'error'); return; }
    const names = attend.map(r => r.name); // 이른 투표가 위, 늦은 투표가 아래
    const textarea = document.getElementById('attendees');
    if (textarea) textarea.value = names.join('\n');
    const balTab = document.getElementById('tab-balancer');
    if (balTab) balTab.click();
    window.showNotification(`참석자 ${names.length}명을 팀 배정기로 가져왔습니다. (투표순)`);
}

async function buildBoardData() {
    const allTeamLineups = {};
    const lineupPromises = state.teams.map((team, i) => {
        if (state.teamLineupCache && state.teamLineupCache[i]) {
            return Promise.resolve(state.teamLineupCache[i]);
        }
        const teamMembers = team.map(p => p.name.replace(' (신규)', ''));
        const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
        return window.lineup.executeLineupGeneration(teamMembers, formations, true);
    });
    const lineups = await Promise.all(lineupPromises);
    lineups.forEach((originalLineup, i) => {
        if (originalLineup) {
            const lineup = JSON.parse(JSON.stringify(originalLineup));
            const restersObject = {};
            const refereesObject = {};
            (lineup.resters || []).forEach((resterArray, qIndex) => { restersObject[`q${qIndex + 1}`] = resterArray; });
            (lineup.referees || []).forEach((ref, qIndex) => { refereesObject[`q${qIndex + 1}`] = ref; });
            lineup.resters = restersObject;
            lineup.referees = refereesObject;
            allTeamLineups[`team${i + 1}`] = lineup;
        }
    });
    const teamsObject = {};
    state.teams.forEach((team, index) => { teamsObject[`team${index + 1}`] = team; });
    return { teams: teamsObject, lineups: allTeamLineups };
}

async function publishBoard() {
    if (!state.isAdmin) { window.promptForAdminPassword(); return; }
    if (!currentVoteId) { window.showNotification('먼저 날짜 보드를 열어주세요.', 'error'); return; }
    if (!state.teams || state.teams.length === 0) { window.showNotification('팀 배정 결과가 없습니다. 먼저 팀을 생성해주세요.', 'error'); return; }

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) { loadingOverlay.style.display = 'flex'; loadingOverlay.style.opacity = 1; }
    try {
        const board = await buildBoardData();
        await setDoc(doc(db, "votes", currentVoteId), { board, published: true, publishedAt: serverTimestamp() }, { merge: true });
        const statusEl = document.getElementById('board-publish-status');
        if (statusEl) statusEl.innerHTML = '<span class="text-green-600 font-semibold">게시 완료! 링크에서 팀배정·라인업이 보입니다.</span>';
        window.showNotification('팀배정·라인업 최종본이 링크에 게시되었습니다!');
    } catch (e) {
        console.error(e);
        window.showNotification('게시 실패: ' + e.message, 'error');
    } finally {
        if (loadingOverlay) { loadingOverlay.style.opacity = 0; setTimeout(() => loadingOverlay.style.display = 'none', 300); }
    }
}

export function updateTeamData(teams) {
    state.teams = teams;
    state.teamLineupCache = {};
}

export function updateLineupData(lineupData, formations) {
    state.lineupResults = lineupData;
    if (state.lineupResults) {
        state.lineupResults.formations = formations;
    }
}