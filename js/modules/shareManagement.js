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


// [수정] 함수 시작 시 관리자 권한 확인 로직 추가
/ [수정] 링크 생성 시 'activeMeeting'에 ID 저장
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
        const allTeamLineups = { /* ... 이전과 동일한 라인업 생성 로직 ... */ };
        const teamsObject = { /* ... 이전과 동일한 팀 객체 변환 로직 ... */ };

        const shareData = {
            meetingInfo: { /* ... */ },
            teams: teamsObject,
            lineups: allTeamLineups,
            createdAt: new Date().toISOString()
        };

        const shareDocRef = await addDoc(collection(db, "shares"), shareData);
        
        // [신규] 생성된 링크 ID를 실시간 공유용으로 Firestore에 저장
        await setDoc(doc(db, "settings", "activeMeeting"), { shareId: shareDocRef.id });

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

// [수정] 인쇄 레이아웃을 '팀별 페이지'로 전면 수정
export function generatePrintView(shareData) {
    const teams = Object.values(shareData.teams || {});
    const { meetingInfo, lineups } = shareData;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        window.showNotification('팝업이 차단되었습니다. 팝업을 허용해주세요.', 'error');
        return;
    }
    const createQuarterHTML = (teamLineup, qIndex) => { /* ... 이전과 동일 ... */ };
    
    let locationHtml = /* ... 이전과 동일 ... */ ;

    let fullHtml = `
    <html><head><title>BareaPlay 출력</title>
    <style>
        * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; box-sizing: border-box; }
        body { font-family:'Noto Sans KR', sans-serif; margin: 0; }
        .page-break { page-break-after: always; }
        .print-container { padding: 1cm; }
        
        .info-box { background:#f8f9fa; padding:0.8rem; border:1px solid #dee2e6; border-radius:.5rem; margin-bottom:1rem; }
        .section-title { font-size:18px; margin:0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #ccc; }
        .team-grid-print { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; }
        .team-box { border-radius:0.5rem; padding:0.5rem; color:white; font-weight:bold; }
        .team-box h3 { font-size: 0.9rem; margin:0 0 6px 0; padding-bottom:3px; border-bottom: 1px solid rgba(255,255,255,0.3); }
        .team-box ul { font-size:0.65rem; list-style:none; padding-left:0; margin:0; }
        .team-box li { margin-bottom:2px; background:rgba(255,255,255,0.2); padding:2px 4px; border-radius:4px; }

        /* 팀별 라인업 페이지 스타일 */
        .single-team-title { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 0.5cm; }
        .lineup-grid-single-team { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: 0.8cm; height: calc(100vh - 4cm); }

        .pitch-print { /* ... 이전과 동일한 스타일 ... */ }
        /* ... 나머지 인쇄 스타일 이전과 동일 ... */

        @page { size: A4 portrait; margin: 0; }
    </style>
    </head><body>
    <div class="print-container">
        </div>`;
    
    // [수정] 팀별로 페이지를 생성하는 루프
    teams.forEach((team, teamIdx) => {
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<h2 class="single-team-title">팀 ${teamIdx + 1} 라인업</h2>`;
        fullHtml += `<div class="lineup-grid-single-team">`;
        const lineup = lineups[`team${teamIdx + 1}`];
        for (let i = 0; i < 6; i++) {
            fullHtml += createQuarterHTML(lineup, i);
        }
        fullHtml += `</div></div>`;
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
        <div id="active-meeting-link-container" class="mb-8 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-center hidden">
            <p class="font-semibold text-green-800 mb-2">⚽ 오늘 모임 결과 바로가기</p>
            <a id="active-meeting-link" href="#" target="_blank" class="text-blue-600 font-bold hover:underline">여기를 클릭하여 확인하세요!</a>
        </div>
        
        <h2 class="text-2xl font-bold mb-4">📢 모임 정보 및 공유 (관리자용)</h2>
        <div class="space-y-4 max-w-lg mx-auto">
            <div><label for="share-date" class="block text-sm font-medium">날짜</label><input type="date" id="share-date" class="mt-1 w-full p-2 border rounded-lg"></div>
            <div><label for="share-time" class="block text-sm font-medium">시간</label><input type="time" id="share-time" class="mt-1 w-full p-2 border rounded-lg"></div>
            <div>
                <div class="flex justify-between items-center"><label for="share-location-select" class="block text-sm font-medium">장소 선택</label><button id="manage-locations-btn" class="text-sm text-indigo-600 hover:underline">장소 관리</button></div>
                <select id="share-location-select" class="w-full p-2 border rounded-lg bg-white mt-1"></select>
            </div>
            <div class="mt-6"><button id="generate-share-btn" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700">공유 링크 생성</button></div>
            <div id="share-link-container" class="mt-4 p-4 bg-gray-100 rounded-lg hidden"><p class="text-sm font-semibold mb-2">생성된 링크:</p><a id="share-link-anchor" href="#" target="_blank" class="text-blue-600 break-all hover:underline"></a></div>
        </div>
    </div>`;
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
    state.teamLineupCache = {};
}

export function updateLineupData(lineupData, formations) {
    state.lineupResults = lineupData;
    if (state.lineupResults) {
        state.lineupResults.formations = formations;
    }
}