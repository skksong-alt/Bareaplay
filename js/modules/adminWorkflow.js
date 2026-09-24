import { quarterCount } from './quarters.js?v=1';
// Read-only context strip. Navigation lives in the main menu, not a second set of buttons.
export function init({state}) {
    const host=document.querySelector('#main-app > header');if(!host)return;
    const panel=document.createElement('section');panel.className='operator-workflow';
    panel.innerHTML='<p class="coach-eyebrow">현재 작업 중인 경기</p><p id="operator-context" role="status"></p><p id="operator-save" role="status" aria-live="polite"></p><div id="operator-recovery" hidden><button id="operator-retry" type="button">저장 다시 시도</button> <button id="operator-reload" type="button">서버 내용 다시 불러오기</button></div>';
    host.after(panel);
    const update=()=>{
        panel.hidden=!state.isAdmin;
        const date=document.getElementById('balancer-date')?.value||'';
        const selected=window.voteMgmt?.getSelectedMeeting?.().info;
        const count=Object.values(state.teamLineupCache||{}).filter(l=>l?.lineups?.length>=quarterCount(state)).length;
        const mismatch=selected?.date&&selected.date!==date;
        panel.querySelector('#operator-context').textContent=`${date||'경기 날짜 미선택'} · 팀 ${state.teams?.length||0}개 · ${quarterCount(state)}쿼터 라인업 ${count}팀`+
            (mismatch?` — 선택한 참석 투표는 ${selected.date}입니다. 공개 전 같은 경기인지 확인하세요.`:' · 편집 내용의 저장과 팀원 공개는 별개입니다.');
        panel.classList.toggle('operator-warning',!!mismatch);
        const status=state.meetingSave?.status||'idle';
        const labels={idle:'경기를 불러와 주세요.',pending:'편집 내용 저장 대기 중…',saving:'저장 중… 이 화면을 닫지 마세요.',saved:'경기 편집 저장됨 · 팀원 공개는 별도입니다.',error:'저장 실패 · 현재 편집은 이 화면에 남아 있습니다. 닫지 말고 다시 시도하세요.',conflict:'다른 기기와 수정 충돌 · 덮어쓰지 않았습니다. 현재 편집을 따로 확인한 후 서버 내용을 불러오세요.'};
        panel.querySelector('#operator-save').textContent=state.meetingLoading?'경기 불러오는 중…':labels[status];
        if(state.lastPublished && state.meetingDate && state.lastPublished.date===state.meetingDate){
            const signature=JSON.stringify({date:state.meetingDate,quarterCount:quarterCount(state),teams:state.teams,lineups:state.teamLineupCache,names:state.teamNames});
            panel.querySelector('#operator-save').textContent+=signature===state.lastPublished.signature?' · 이 화면에서 확인한 내용 공개 완료':' · 공개 후 편집됨: 팀원이 보는 공개본은 아직 이전 내용입니다.';
        }
        panel.querySelector('#operator-recovery').hidden=!['idle','error','conflict'].includes(status);
        panel.querySelector('#operator-retry').hidden=status==='idle'||status==='conflict';
        panel.classList.toggle('operator-save-error',['error','conflict'].includes(status));
    };
    panel.querySelector('#operator-retry').onclick=async()=>{try{await window.flushMeetingSave?.();}catch{window.showNotification('아직 저장하지 못했습니다. 화면을 유지하고 연결 상태를 확인하세요.','error');}};
    panel.querySelector('#operator-reload').onclick=()=>window.reloadMeeting?.();
    const main=document.querySelector('#main-app > main');
    if(main)new MutationObserver(update).observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('change',update);document.addEventListener('barea:admin',update);document.addEventListener('barea:save',update);update();
}
