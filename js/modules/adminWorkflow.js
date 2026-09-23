import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { cleanName, escapeHtml as esc } from './coachCore.js?v=1';

// Navigation and read-only preparation. Never saves a meeting or publishes automatically.
export function init({db,state}) {
    if(new URLSearchParams(location.search).has('vote')||new URLSearchParams(location.search).has('voteId')||new URLSearchParams(location.search).has('shareId'))return;
    const host=document.querySelector('#main-app > header');if(!host)return;
    const panel=document.createElement('section');panel.className='operator-workflow';
    panel.innerHTML=`<div class="operator-heading"><div><p class="coach-eyebrow">MATCH WORKSPACE</p><h2>이번 경기 준비</h2></div><button id="operator-refresh" type="button">상태 확인</button></div><p id="operator-context" role="status"></p><div class="operator-steps"><button data-open="share">1 · 참석·모임</button><button data-open="balancer">2 · 팀 배정</button><button data-open="lineup">3 · 순번·라인업</button><button data-open="share" data-publish>4 · 확인·공개</button></div><p class="coach-note">마지막 단계는 공개 화면으로 이동만 합니다. 실제 공개는 내용을 확인하고 확정 버튼을 눌러야 합니다.</p><details class="operator-cycle"><summary>8주 운영 시험 · 이전 팀 조합 이어가기</summary><p class="coach-note">팀과 필드 역할의 틀을 유지하고 결원만 조정합니다. 심판·키퍼·휴식 순번은 별도입니다. 시작일은 이 기기에만 기억하며 다른 운영자와 공유 저장하지 않습니다.</p><label>시험 시작일<input id="cycle-start" type="date"></label><p id="cycle-progress"></p><button id="cycle-load" type="button">이 기간의 지난 배정 찾기</button><select id="cycle-source" aria-label="기준으로 삼을 지난 경기"><option value="">먼저 지난 배정을 찾아주세요</option></select><button id="cycle-preview" type="button">현재 참가자와 비교</button><div id="cycle-result"></div></details>`;
    host.after(panel);
    const date=()=>document.getElementById('balancer-date')?.value||'';
    const update=()=>{
        const selected=window.voteMgmt?.getSelectedMeeting?.().info, working=date();
        const teamCount=state.teams?.length||0;
        const lineupCount=Object.values(state.teamLineupCache||{}).filter(v=>v?.lineups?.length===6).length;
        const text=`작업일 ${working||'미선택'} · 선택 투표 ${selected?.date||'없음'}${selected?.location?' · '+selected.location:''} · 팀 ${teamCount}개 / 라인업 ${lineupCount}개`;
        const mismatch=selected?.date&&selected.date!==working;
        panel.querySelector('#operator-context').textContent=text+(mismatch?' — 날짜가 다릅니다. 팀 배정에서 작업일을 맞춰 주세요.':' — 공개 여부는 확인·공개 단계에서 확인하세요.');
        panel.querySelector('#operator-context').classList.toggle('operator-warning',!!mismatch);
        panel.hidden=!state.isAdmin;
        const start=panel.querySelector('#cycle-start').value, days=(Date.parse(working)-Date.parse(start))/86400000;
        panel.querySelector('#cycle-progress').textContent=!start?'시작일을 선택해 주세요.':!Number.isFinite(days)?'작업일을 확인해 주세요.':days<0?'시험 시작 전 경기입니다.':days>=56?'8주 시험 기간이 끝났습니다. 다음 운영 방식을 검토해 주세요.':`8주 시험 · ${Math.floor(days/7)+1}주차`;
    };
    panel.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>{
        document.getElementById('tab-'+button.dataset.open)?.click();update();
        if(button.hasAttribute('data-publish'))document.getElementById('generate-share-btn')?.scrollIntoView({block:'center',behavior:'smooth'});
    });
    panel.querySelector('#operator-refresh').onclick=update;
    const start=panel.querySelector('#cycle-start');
    try{start.value=localStorage.getItem('bp_cycle_start')||'';}catch{/* optional */}
    start.onchange=()=>{try{localStorage.setItem('bp_cycle_start',start.value);}catch{/* optional */}update();};
    let records=[];
    panel.querySelector('#cycle-load').onclick=async()=>{
        if(!state.isAdmin)return;
        const target=date(), first=start.value, out=panel.querySelector('#cycle-result');
        if(!first||target<first||Date.parse(target)-Date.parse(first)>=56*86400000){out.textContent='8주 시험 기간 안의 시작일과 작업일을 선택해 주세요.';return;}
        try{
            const snap=await getDocs(collection(db,'dailyMeetings'));
            if(date()!==target||start.value!==first)return;
            records=snap.docs.map(d=>({...d.data(),date:d.id})).filter(m=>m.date>=first&&m.date<target&&Object.keys(m.teams||{}).length).sort((a,b)=>b.date.localeCompare(a.date));
            panel.querySelector('#cycle-source').innerHTML=records.length?records.map(m=>`<option value="${esc(m.date)}">${esc(m.date)}</option>`).join(''):'<option value="">기간 안에 이전 배정이 없습니다</option>';
            out.textContent='불러오기만으로 현재 팀이나 과거 기록이 변경되지는 않습니다.';
        }catch{out.textContent='지난 배정을 불러오지 못했습니다.';}
    };
    panel.querySelector('#cycle-preview').onclick=()=>{
        if(!state.isAdmin)return;
        const source=records.find(m=>m.date===panel.querySelector('#cycle-source').value), out=panel.querySelector('#cycle-result');
        if(!source)return;
        const target=date(), first=start.value;
        if(source.date<first||source.date>=target||Date.parse(target)-Date.parse(first)>=56*86400000){out.textContent='기간이 변경되었습니다. 지난 배정을 다시 찾아주세요.';return;}
        const raw=document.getElementById('attendees')?.value||'', present=[...new Set(raw.split('\n').map(cleanName).filter(Boolean))];
        if(!present.length){out.textContent='먼저 참석·모임에서 투표 명단을 팀 배정기로 가져오세요.';return;}
        const teams=Object.values(source.teams).map(team=>team.map(p=>cleanName(p.name)).filter(n=>present.includes(n)));
        const unassigned=present.filter(n=>!teams.flat().includes(n));
        out.innerHTML=`<p>기준 ${esc(source.date)} → 작업일 ${esc(target)} · 아직 저장하지 않았습니다.</p>${teams.map((ns,i)=>`<p><b>팀 ${i+1}</b> · ${ns.length}명: ${ns.map(esc).join(', ')||'없음'}</p>`).join('')}<p>새로 배정할 선수: ${unassigned.map(esc).join(', ')||'없음'}</p><button id="cycle-use" type="button">직접 팀 입력칸에 가져오기</button><p class="coach-note">새 참가자는 직접 팀 입력칸에 추가한 뒤 ‘이대로 팀 만들기’로 확정하세요. 이전 라인업과 의무 순번은 복사하지 않습니다.</p>`;
        out.querySelector('#cycle-use').onclick=()=>{
            if(!state.isAdmin||date()!==target||start.value!==first||document.getElementById('attendees').value!==raw){out.textContent='날짜 또는 명단이 변경됐습니다. 다시 비교하세요.';return;}
            const count=document.getElementById('teamCount');count.value=String(teams.length);count.dispatchEvent(new Event('change'));
            teams.forEach((ns,i)=>{const ta=document.getElementById('manual-team-ta-'+i);if(ta)ta.value=ns.join('\n');});
            const repeat=document.getElementById('avoid-repeat');if(repeat)repeat.checked=false;
            const box=document.getElementById('manual-team-box');if(box)box.open=true;
            document.getElementById('tab-balancer')?.click();box?.scrollIntoView({block:'start'});
            out.querySelector('#cycle-use').disabled=true;
        };
    };
    // Observe the app's existing rendering; this panel never triggers Firestore writes.
    const main=document.querySelector('#main-app > main');
    if(main)new MutationObserver(update).observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('change',update);document.addEventListener('barea:admin',update);update();
}
