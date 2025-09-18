// js/modules/shareManagement.js
import { doc, setDoc, collection, onSnapshot, addDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

let db, state;
let addLocationBtn, shareDate, shareTime, shareLocationSelect;
let generateShareBtn, shareLinkContainer, shareLinkAnchor;
let locationModal, closeLocationModalBtn, addNewLocationBtn, locationListDiv, newLocationNameInput, newLocationUrlInput;

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
        window.showNotification("관리자만 공유 링크를 생성할 수 있습니다.", "error");
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
        const lineupPromises = state.teams.map((team) => {
            const teamMembers = team.map(p => p.name.replace(' (신규)', ''));
            const formations = Array.from(document.querySelectorAll('#page-lineup select')).map(s => s.value);
            return window.lineup.executeLineupGeneration(teamMembers, formations, true);
        });
        const lineups = await Promise.all(lineupPromises);
        
        lineups.forEach((lineup, i) => {
            if (lineup) {
                // [수정] resters 데이터를 객체로 변환
                const restersObject = {};
                lineup.resters.forEach((resterArray, qIndex) => {
                    restersObject[`q${qIndex + 1}`] = resterArray;
                });
                lineup.resters = restersObject;
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
        
        const shareUrl = `${window.location.origin}${window.location.pathname}?shareId=${shareDocRef.id}`;
        
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

// [수정] 6쿼터 및 새로운 인쇄 레이아웃 적용
export function generatePrintView(shareData) {
    const teams = Object.values(shareData.teams || {});
    const { meetingInfo, lineups } = shareData;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        window.showNotification('팝업이 차단되었습니다. 팝업을 허용해주세요.', 'error');
        return;
    }

    const createQuarterHTML = (teamLineup, qIndex) => {
        if (!teamLineup || !teamLineup.lineups || !teamLineup.lineups[qIndex]) return '<div class="quarter-block"></div>';
        const lineup = teamLineup.lineups[qIndex];
        const formation = teamLineup.formations[qIndex];
        const posCellMap = window.lineup.getPosCellMap();
        
        let html = `<div class="quarter-block"><div class="pitch-print"><div class="formation-title-print">${qIndex + 1}쿼터 (${formation})</div>`;
        const counters = {};
        (posCellMap[formation] || []).forEach(fc => {
            counters[fc.pos] = (counters[fc.pos] || 0);
            const name = (lineup[fc.pos] || [])[counters[fc.pos]] || '';
            let icon = "❓", bg = "#555";
            if(fc.pos=="GK"){icon="🧤";bg="#00C853"}
            else if(["CB","RB","LB","DF"].includes(fc.pos)){icon="🛡";bg="#0288D1"}
            else if(["MF","CM"].includes(fc.pos)){icon="⚙";bg="#FBC02D"}
            else if(["LW","RW","FW"].includes(fc.pos)){icon="🎯";bg="#EF6C00"}

            html += `<div class="player-marker-print" style="left:${fc.x}%;top:${fc.y}%;"><div class="player-icon-print" style="background:${bg}">${icon}</div><div class="player-name-print">${name||'-'}</div></div>`;
            counters[fc.pos]++;
        });
        const resters = teamLineup.resters[`q${qIndex + 1}`] || [];
        html += `</div><div class="rest-players-print"><b>휴식:</b> ${resters.join(', ') || '없음'}</div></div>`;
        return html;
    };
    
    let locationHtml = meetingInfo.locationUrl 
        ? `<a href="${meetingInfo.locationUrl}" target="_blank" style="color: #0000EE; text-decoration: underline;">${meetingInfo.location}</a>`
        : (meetingInfo.location || '미정');

    let fullHtml = `
    <html><head><title>BareaPlay 출력</title>
    <style>
        * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; box-sizing: border-box; }
        body { font-family:'Noto Sans KR', sans-serif; }
        .page-break { page-break-after: always; }
        .print-container { padding: 1cm; }
        .team-lineup-title { text-align:center; margin-bottom: 5px; font-size: 20px; }
        .lineup-grid { display:grid; grid-template-columns:1fr 1fr; gap: 1cm; } /* 팀 간 간격 */
        .team-quarters-block { display: grid; grid-template-rows: auto 1fr 1fr; gap: 0.5cm; } /* 쿼터 간 간격 */
        .quarter-block { padding: 0.1rem; }
        .pitch-print { background:#4CAF50; border:1px solid #ddd; position:relative; width:100%; aspect-ratio:7/10; border-radius: 4px; }
        .player-marker-print{position:absolute;transform:translate(-50%,-50%);text-align:center;}
        .formation-title-print { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 8px; font-size: 0.65rem; font-weight: bold; white-space: nowrap; z-index: 10; }
        .player-icon-print{ width:20px; height:20px; border-radius:50%; display:flex;align-items:center;justify-content:center; color:white;font-size:.65rem;border:1.5px solid white; box-shadow: 0 0 2px rgba(0,0,0,0.5); }
        .player-name-print{ background:rgba(0,0,0,0.7); color:white; font-size:.5rem; padding:1px 3px; border-radius:4px; margin-top:1px; white-space:nowrap; }
        .rest-players-print { text-align: center; margin-top: 2px; font-size: 0.6rem; }
        .team-box{border-radius:0.5rem;padding:0.8rem;color:white;font-weight:bold;}
        @page { size: A4 landscape; margin: 1cm; }
    </style>
    </head><body>
    <div class="print-container">
        <h1 style="text-align:center;font-size:28px;margin-bottom:20px;">Barea 모임 결과</h1>
        <div style="background:#f8f9fa;padding:1rem;border:1px solid #dee2e6;border-radius:.5rem;margin-bottom:1.5rem;">
            <h2 style="font-size:20px;margin:0 0 10px 0; padding-bottom: 8px; border-bottom: 1px solid #ccc;">📅 모임 정보</h2>
            <p style="margin: 4px 0;"><b>시간:</b> ${new Date(meetingInfo.time).toLocaleString('ko-KR')}</p>
            <p style="margin: 4px 0;"><b>장소:</b> ${locationHtml}</p>
        </div>
        <div>
            <h2 style="font-size:20px;margin:0 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid #ccc;">⚖️ 팀 배정 결과</h2>
            <div style="display:grid;grid-template-columns:repeat(${teams.length},1fr);gap:10px;">`;

    const colors = ["#14B8A6","#0288D1","#7B1FA2","#43A047","#F4511E"];
    teams.forEach((team, i) => {
        fullHtml += `<div class="team-box" style="background:${colors[i%5]}"><h3 style="margin:0 0 8px 0; padding-bottom:4px; border-bottom: 1px solid rgba(255,255,255,0.3);">팀 ${i+1}</h3><ul style="font-size:0.85rem;list-style:none;padding-left:0; margin:0;">${team.map(p=>`<li style="margin-bottom:3px;background:rgba(255,255,255,0.2);padding:2px 5px;border-radius:4px;">${p.name.replace(' (신규)','')}</li>`).join('')}</ul></div>`;
    });
    fullHtml += `</div></div></div>`;
    
    // 2개 쿼터씩 3페이지에 걸쳐 출력
    for (let qPair = 0; qPair < 3; qPair++) {
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<div class="lineup-grid">`; // 팀1, 팀2를 묶는 그리드

        teams.forEach((team, teamIdx) => {
            fullHtml += `<div class="team-quarters-block">`; // 한 팀의 쿼터들을 묶는 블록
            fullHtml += `<h2 class="team-lineup-title">팀 ${teamIdx + 1}</h2>`;
            const lineup = lineups[`team${teamIdx + 1}`];
            
            const q1_index = qPair * 2;
            const q2_index = qPair * 2 + 1;
            
            fullHtml += createQuarterHTML(lineup, q1_index);
            fullHtml += createQuarterHTML(lineup, q2_index);
            
            fullHtml += `</div>`;
        });
        fullHtml += `</div></div>`;
    }

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
    pageElement.innerHTML = `<div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📢 모임 정보 및 공유</h2><div class="space-y-4 max-w-lg mx-auto"><div><label for="share-date" class="block text-sm font-medium">날짜</label><input type="date" id="share-date" class="mt-1 w-full p-2 border rounded-lg"></div><div><label for="share-time" class="block text-sm font-medium">시간</label><input type="time" id="share-time" class="mt-1 w-full p-2 border rounded-lg"></div><div><div class="flex justify-between items-center"><label for="share-location-select" class="block text-sm font-medium">장소 선택</label><button id="manage-locations-btn" class="text-sm text-indigo-600 hover:underline">장소 관리</button></div><select id="share-location-select" class="w-full p-2 border rounded-lg bg-white mt-1"></select></div><div class="mt-6"><button id="generate-share-btn" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 admin-control" disabled>공유 링크 생성</button></div><div id="share-link-container" class="mt-4 p-4 bg-gray-100 rounded-lg hidden"><p class="text-sm font-semibold mb-2">생성된 링크:</p><a id="share-link-anchor" href="#" target="_blank" class="text-blue-600 break-all hover:underline"></a></div></div></div>`;

    generateShareBtn = document.getElementById('generate-share-btn');
    shareLinkContainer = document.getElementById('share-link-container');
    shareLinkAnchor = document.getElementById('share-link-anchor');
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

    generateShareBtn.addEventListener('click', generateShareableLink);
}

export function updateTeamData(teams) {
    state.teams = teams;
    state.teamLineupCache = {}; // 팀이 새로 배정되면 라인업 캐시 초기화
}

export function updateLineupData(lineupData, formations) {
    state.lineupResults = lineupData;
    if (state.lineupResults) {
        state.lineupResults.formations = formations;
    }
}