// js/modules/shareManagement.js
import { doc, setDoc, collection, onSnapshot, addDoc, getDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getPosCellMap } from './lineupGenerator.js?v=10'; // [정리] 포메이션 좌표 단일화
import { compareResponseTime } from './voteOrder.js?v=1';
import { sharedRefereesFromLineups } from './dutyRotation.js?v=2';
import { validateLineup } from './coachCore.js?v=1';

let db, state;
let addLocationBtn, shareDate, shareTime, shareLocationSelect;
let generateShareBtn, shareLinkContainer, shareLinkAnchor;
let locationModal, closeLocationModalBtn, addNewLocationBtn, locationListDiv, newLocationNameInput, newLocationUrlInput;

// [정리] 포메이션 좌표는 lineupGenerator의 단일 원본을 공유 (이중 정의 제거 → 포메이션 수정 시 한 곳만 고치면 됨)
const posCellMap = getPosCellMap();

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
    document.dispatchEvent(new Event('barea:locations'));
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
    if(generateShareBtn?.disabled)return;
    if (!state.isAdmin) {
        window.promptForAdminPassword();
        return;
    }
    if (!state.teams || state.teams.length === 0) {
        window.showNotification("팀 배정 결과가 없습니다. 먼저 팀을 생성해주세요.", "error");
        return;
    }

    // Publication belongs to the selected RSVP, never to unsaved new-vote inputs.
    const selected=window.voteMgmt?.getSelectedMeeting?.();
    if(!selected?.info) { window.showNotification('먼저 참석 투표를 만들거나 불러오세요.', 'error'); return; }
    if(document.getElementById('balancer-date')?.value!==selected.info.date) {
        window.showNotification('참석 투표 날짜와 팀 배정 날짜가 다릅니다. 같은 경기의 배정을 먼저 불러오세요.', 'error');return;
    }
    try {
        const latest=await getDoc(doc(db,'votes',selected.id));
        if(!latest.exists() || ['date','time','location'].some(k=>String(latest.data()[k]||'')!==String(selected.info[k]||''))) {
            window.showNotification('모임정보가 변경되었습니다. 새로고침 후 다시 확인하세요.', 'error');return;
        }
    } catch { window.showNotification('모임정보를 확인할 수 없어 공개하지 않았습니다.', 'error');return; }
    if(generateShareBtn.disabled)return;
    if(window.voteMgmt?.getSelectedMeeting?.().id!==selected.id || document.getElementById('balancer-date')?.value!==selected.info.date) {
        window.showNotification('선택한 경기가 변경되었습니다. 다시 확인해 주세요.', 'error');return;
    }
    if(!confirm(`${selected.info.date} ${selected.info.time || ''}\n현재 팀·라인업을 확정하여 공개할까요? 기존 공유 링크는 유지됩니다.`))return;
    generateShareBtn.disabled=true;
    syncMeetingInfo(selected.info);

    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.opacity = 1;

    try {
        if (window.prepareCoach) await window.prepareCoach();
        const allTeamLineups = {};
        const lineupPromises = state.teams.map((team, i) => {
            if (state.teamLineupCache && state.teamLineupCache[i]) {
                return Promise.resolve(state.teamLineupCache[i]);
            }
            const teamMembers = team.map(p => p.name.replace(' (신규)', ''));
            const formations = Array.from(document.querySelectorAll('#page-lineup select[id^="formation-q"]')).map(s => s.value);
            return window.lineup.executeLineupGeneration(teamMembers, formations, true);
        });

        const lineups = await Promise.all(lineupPromises);
        if (lineups.some(l => !l)) throw new Error('모든 팀의 라인업을 먼저 생성하세요. 기존 공유 결과는 유지됩니다.');
        const order=await window.voteMgmt.getDutyOrder(selected.info.date);
        const squads=state.teams.map(team=>team.map(p=>normalizeName(String(p.name).replace(' (신규)',''))));
        if(lineups.some((l,t)=>!validateLineup(l,squads[t]) || l.lineups.some((q,i)=>Object.values(q).flat().length!==(posCellMap[l.formations?.[i]]||[]).length))) {
            throw new Error('라인업 인원·포메이션이 맞지 않습니다. 기존 공개 결과는 유지됩니다.');
        }
        // A previously saved lineup may use the old same-team referee rotation.
        // Keep every field position and off-field player; only reconcile who referees.
        const sharedReferees=selected.info.date >= window.getLocalDate()
            ? sharedRefereesFromLineups(lineups,order) : null;
        
        lineups.forEach((originalLineup, i) => {
            if (originalLineup) {
                const lineup = JSON.parse(JSON.stringify(originalLineup));
                if(sharedReferees)lineup.referees=sharedReferees.map(ref=>ref?.name||null);

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

        // [추가] 활성 투표의 참석현황을 스냅샷으로 함께 저장 (보드에 참석/미정/불참 표시)
        let attendanceSnapshot = null;
        try {
            if (selected.id) {
                const rs = await getDocs(collection(db, "votes", selected.id, "responses"));
                const all = rs.docs.map(d => d.data());
                const since = (a, b) => ((a.attendingSince && a.attendingSince.seconds ? a.attendingSince.seconds : 1e15) - (b.attendingSince && b.attendingSince.seconds ? b.attendingSince.seconds : 1e15));
                const pick = r => ({ name: r.name, guest: !!r.guest });
                attendanceSnapshot = {
                    attend: all.filter(r => r.status === 'attend').sort(compareResponseTime).map(pick),
                    maybe: all.filter(r => r.status === 'maybe').sort(compareResponseTime).map(pick),
                    absent: all.filter(r => r.status === 'absent').sort(compareResponseTime).map(pick)
                };
            }
        } catch (e) { console.error('attendance snapshot fail', e); }

        const shareData = {
            meetingInfo: {
                time: `${shareDate.value} ${shareTime.value}`,
                location: shareLocationSelect.value,
                locationUrl: shareLocationSelect.options[shareLocationSelect.selectedIndex]?.dataset.url || ''
            },
            teams: teamsObject,
            teamNames: (state.teamNames || []).slice(0, state.teams.length), // [v58] 팀 이름(Team A/B 또는 커스텀)도 공유 보드에 전달
            lineups: allTeamLineups,
            attendance: attendanceSnapshot,
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

        const shareUrl = `${window.location.origin}/share.html?shareId=${shareDocRef.id}`;
        
        const shareLinkContainer = document.getElementById('share-link-container');
        const shareLinkAnchor = document.getElementById('share-link-anchor');
        shareLinkContainer.classList.remove('hidden');
        shareLinkAnchor.href = shareUrl;
        shareLinkAnchor.textContent = '공개된 팀·라인업 보기 ↗';

        navigator.clipboard.writeText(shareUrl).then(() => {
            window.showNotification("공유 링크가 생성되어 클립보드에 복사되었습니다!");
        }).catch(() => {
            window.showNotification("공유 링크가 생성되었습니다.");
        });

    } catch (error) {
        console.error("Share link generation failed: ", error);
        window.showNotification(error.message || "공유 링크 생성에 실패했습니다.", "error");
    } finally {
        generateShareBtn.disabled=false;
        loadingOverlay.style.opacity = 0;
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
    }
}

export function generatePrintView(shareData) {
    // [수정] 명단과 라인업을 '같은 키(teamN)'로 짝지어 출력 → 팀1↔팀2 뒤바뀜 방지
    const __teamsObj = shareData.teams || {};
    const __teamKeys = Object.keys(__teamsObj).sort((a, b) => {
        const na = parseInt(String(a).replace(/[^0-9]/g, ''), 10) || 0;
        const nb = parseInt(String(b).replace(/[^0-9]/g, ''), 10) || 0;
        return na - nb;
    });
    const teams = __teamKeys.map(k => __teamsObj[k]);
    const { meetingInfo, lineups } = shareData;
    // [v58] 팀 이름: 공유 데이터에 저장된 이름 → 없으면 '팀 N'
    const __tn = (i) => (Array.isArray(shareData.teamNames) && shareData.teamNames[i]) ? shareData.teamNames[i] : `팀 ${i + 1}`;
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
            <div class="quarter-title-integrated">${__tn(teamIdx)} - ${qIndex + 1}쿼터 (${formation})</div>`;
        
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
        fullHtml += `<div class="team-box" style="background:${colors[i%5]}"><h3>${__tn(i)}</h3><ul>${[...team].sort((a,b)=>a.name.localeCompare(b.name,'ko-KR')).map(p=>`<li>${p.name.replace(' (신규)','')}</li>`).join('')}</ul></div>`;
    });
    fullHtml += `</div></div><div class="print-footer">© 2025 BareaPlay. Created by 송감독.</div></div>`;
    
    teams.forEach((team, teamIdx) => {
        const lineup = lineups[__teamKeys[teamIdx]] || lineups[`team${teamIdx + 1}`];
        const teamColor = colors[teamIdx % 5];
        
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<h2 class="single-team-title" style="border-bottom: 3px solid ${teamColor};">${__tn(teamIdx)} 라인업 (1-3쿼터)</h2>`;
        fullHtml += `<div class="lineup-grid-final">`;
        for (let i = 0; i < 3; i++) { fullHtml += createQuarterHTML(lineup, teamIdx, i); }
        fullHtml += `</div><div class="print-footer">© 2025 BareaPlay. Created by 송감독.</div></div>`;
        
        fullHtml += `<div class="page-break"></div><div class="print-container">`;
        fullHtml += `<h2 class="single-team-title" style="border-bottom: 3px solid ${teamColor};">${__tn(teamIdx)} 라인업 (4-6쿼터)</h2>`;
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

export function syncMeetingInfo(info) {
    if(!shareDate || !info)return;
    shareDate.value=info.date || '';shareTime.value=info.time || '';
    const name=info.location || '';
    if(![...shareLocationSelect.options].some(o=>o.value===name)) {
        const option=document.createElement('option');option.value=name;option.textContent=name;shareLocationSelect.append(option);
    }
    shareLocationSelect.value=name;
    const label=document.getElementById('share-target-label');
    if(label)label.textContent=[info.date,info.time,info.location].filter(Boolean).join(' · ');
    document.getElementById('share-link-container')?.classList.add('hidden');
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;
    
    const pageElement = document.getElementById('page-share');
    pageElement.innerHTML = `<section id="meeting-publication" class="match-admin-publication">
        <h3>팀·라인업 확정 및 공개</h3><p id="share-target-label">참석 투표를 먼저 불러오세요.</p>
        <p class="coach-note">불러온 참석 투표의 모임정보를 사용합니다. 새 모임 입력 중인 내용은 공개되지 않습니다.</p>
        <div class="hidden" aria-hidden="true">
            <div><label for="share-date" class="block text-sm font-medium">날짜</label><input type="date" id="share-date" class="mt-1 w-full p-2 border rounded-lg"></div>
            <div><label for="share-time" class="block text-sm font-medium">시간</label><input type="time" id="share-time" class="mt-1 w-full p-2 border rounded-lg"></div>
            <div>
                <div class="flex justify-between items-center"><label for="share-location-select" class="block text-sm font-medium">장소 선택</label><button id="manage-locations-btn" class="text-sm text-indigo-600 hover:underline">장소 관리</button></div>
                <select id="share-location-select" class="w-full p-2 border rounded-lg bg-white mt-1"></select>
            </div>
        </div>
        <button id="generate-share-btn" class="coach-button coach-primary">배정 확정·공개</button>
        <div id="share-link-container" class="mt-4 hidden"><a id="share-link-anchor" href="#" target="_blank" rel="noopener noreferrer" class="coach-link"></a></div>
    </section>`;
    
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
