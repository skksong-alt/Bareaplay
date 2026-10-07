import { collection, getDocs, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { escapeHtml as esc } from './coachCore.js?v=2';
import { CYCLE_ROLES, recentParticipants, cycleCandidates, draftCycle, validateCycle, matchFromCycle, cycleContains } from './teamCycleCore.js?v=2';
import { approvedCycle } from './approvedCycle.js?v=1';

// Admin-only create/read Rules verified against the approved version, 2026-09-24.
export const TEAM_CYCLE_STORAGE_ENABLED=true;
const roleOptions=value=>CYCLE_ROLES.map(role=>`<option ${value===role?'selected':''}>${role}</option>`).join('');
export function init({db,state,auth}) {
    const host=document.getElementById('page-balancer');if(!host)return;
    const panel=document.createElement('section');panel.id='team-cycle-panel';panel.className='cycle-panel';
    panel.innerHTML=`<div class="cycle-heading"><h2>오늘의 배정 방식</h2><a href="/team-guide.html" target="_blank" rel="noopener">고정팀 명단·운영 안내 ↗</a></div>
      <div class="cycle-mode" role="group" aria-label="배정 방식"><button id="team-cycle-training" type="button">8주 고정팀</button><button id="team-cycle-standard" type="button">자유 배정 · 이벤트</button></div><p id="team-cycle-training-status" role="status"></p>
      <p class="coach-note">참석자 확인 → 아래에서 팀 만들기 → 라인업·공개. 방식을 바꿔도 지금 팀과 라인업은 그대로이며, 다음 생성에만 적용됩니다.</p>
      <details id="team-cycle-settings"><summary>계획 관리·당일 미리보기 <small>새 8주를 시작하거나 다른 계획을 쓸 때</small></summary>
      <details><summary>처음 맡은 감독님을 위한 사용 순서</summary><ol><li>최근 3개월 실제 출석 명단과 비공개 설문을 확인합니다.</li><li>미응답·중복 응답은 당사자에게 확인하고 훈련 포지션을 정합니다. 두 지망이 같으면 한 자리 집중 희망입니다.</li><li>실력과 포지션을 고려한 A/B 초안을 확인·수정한 뒤 8주 계획으로 저장합니다.</li><li>매주 참석자 명단을 가져온 뒤 아래 당일 미리보기를 엽니다. 차출은 원소속 변경이 아닙니다.</li><li>당일 명단을 직접 팀 입력칸으로 옮겨 확인 후 적용합니다. 이미 짠 라인업을 다시 만들지 마세요.</li></ol></details>
      <div class="cycle-controls"><label>8주 시작일<input id="team-cycle-start" type="date"></label><button id="team-cycle-roster" type="button">최근 3개월 명단·선호 확인</button><button id="team-cycle-load" type="button" ${TEAM_CYCLE_STORAGE_ENABLED?'':'disabled'}>저장된 고정팀 불러오기</button></div>
      <div id="team-cycle-candidates"></div><div id="team-cycle-draft"></div>
      <label>당일 배정에 사용할 계획<select id="team-cycle-source"><option value="">초안을 만들거나 저장된 계획을 불러오세요</option></select></label>
      <p class="coach-note">조회·초안 편집은 현재 배정 방식을 바꾸지 않습니다. 다른 계획을 선택했다면 위 ‘8주 고정팀’을 눌러 적용하세요. 새 계획 저장은 관리자끼리 공유됩니다.</p>
      <button id="team-cycle-match" type="button">현재 참석자 기준 · 당일 팀 미리보기</button>
      <div id="team-cycle-match-result"></div></details><p id="team-cycle-status" role="status" aria-live="polite"></p>`;
    host.prepend(panel);
    let candidates=[],draft=null,plans=[approvedCycle('2026-10-07')],preview=null,busy=false;
    const status=panel.querySelector('#team-cycle-status'),source=panel.querySelector('#team-cycle-source');
    const date=()=>document.getElementById('balancer-date')?.value||'';
    const attendees=()=>document.getElementById('attendees')?.value||'';
    const message=s=>{status.textContent=s;};
    const setVisibility=()=>{
        panel.hidden=!state.isAdmin;
        if(!state.isAdmin){
            state.trainingCycle=null;
            candidates=[];draft=null;plans=[];preview=null;
            for(const id of ['team-cycle-candidates','team-cycle-draft','team-cycle-match-result'])panel.querySelector('#'+id).replaceChildren();
            source.innerHTML='<option value="">관리자 로그인 후 계획을 불러오세요</option>';status.textContent='';
        }
    };document.addEventListener('barea:admin',setVisibility);setVisibility();
    const guard=()=>{if(!state.isAdmin)throw new Error('관리자 로그인이 필요합니다.');};
    const run=fn=>async()=>{if(busy)return;busy=true;try{guard();await fn();}catch(error){message(error.message||'요청을 완료하지 못했습니다.');}finally{busy=false;}};
    const refreshSources=()=>{
        source.innerHTML=`<option value="">계획 선택</option>${draft?'<option value="draft">방금 만든 초안 · 미저장</option>':''}`+plans.map((p,i)=>`<option value="${i}">${esc(p.startDate)}부터 8주 · ${p.members.length}명${JSON.stringify(p)===JSON.stringify(approvedCycle('2026-10-07'))?' · 감독 승인안 (앱 내장)':''}</option>`).join('');
        if(draft)source.value='draft';else if(plans.length)source.value='0';
    };
    const chosen=()=>source.value==='draft'?draft:source.value!==''?plans[Number(source.value)]:null;
    const trainingStatus=panel.querySelector('#team-cycle-training-status');
    const showTraining=()=>{
        const active=state.trainingCycle?.date===date() && state.isAdmin;
        trainingStatus.textContent=active?`8주 훈련 포지션 우선 · ${state.trainingCycle.startDate} 시작 계획. 1지망 → 2지망 → 빈자리 / 필드 역할 유지 우선 / 출전 기회 균등.`:'자유 배정 · 기존 선수 정보 기준 (고정팀 훈련 우선 꺼짐)';
        panel.querySelector('#team-cycle-training').setAttribute('aria-pressed',String(!!active));
        panel.querySelector('#team-cycle-standard').setAttribute('aria-pressed',String(!active));
        document.dispatchEvent(new CustomEvent('barea:training'));
    };
    const clearTraining=()=>{state.trainingCycle=null;showTraining();};
    source.addEventListener('change',()=>{preview=null;message('계획을 선택했습니다. 적용하려면 ‘8주 고정팀’을 누르세요. 현재 배정 방식은 유지됩니다.');});
    panel.querySelector('#team-cycle-training').onclick=run(async()=>{
        const cycle=chosen();validateCycle(cycle);
        if(!cycleContains(cycle,date()))throw new Error('현재 경기일을 포함하는 8주 계획을 선택하세요.');
        state.trainingCycle={...structuredClone(cycle),date:date()};showTraining();
        try{localStorage.removeItem('barea:free-teams:'+date());}catch{}
        message('다음 라인업 생성부터 훈련 포지션을 우선합니다. 지금 라인업과 기존 선수 정보는 변경하지 않았습니다.');
    });
    panel.querySelector('#team-cycle-standard').onclick=()=>{try{localStorage.setItem('barea:free-teams:'+date(),'1');}catch{}clearTraining();};
    const activateApproved=()=>{
        let free=false;try{free=localStorage.getItem('barea:free-teams:'+date())==='1';}catch{}
        const plan=approvedCycle(date());
        state.trainingCycle=state.isAdmin&&plan&&!free?{...plan,date:date()}:null;
        if(plan&&source.value==='') {plans=[plan,...plans.filter(p=>JSON.stringify(p)!==JSON.stringify(plan))];refreshSources();}
        showTraining();
    };
    document.addEventListener('barea:meeting',activateApproved);
    document.addEventListener('barea:admin',activateApproved);refreshSources();activateApproved();
    const drawDraft=()=>{
        const out=panel.querySelector('#team-cycle-draft');if(!draft){out.innerHTML='';return;}
        out.innerHTML=`<h3>고정팀 초안 · ${esc(draft.startDate)}부터 8주</h3><p>선수의 원래 능력치·희망 응답은 그대로입니다. 변경한 훈련 역할은 이 계획에만 적용됩니다. 새 초안은 자동으로 경기 라인업에 반영되지 않습니다.</p><div class="cycle-table-wrap"><table><thead><tr><th>선수</th><th>소속</th><th>주 훈련 역할</th><th>함께 희망한 역할</th></tr></thead><tbody>${draft.members.map((p,i)=>`<tr><td>${esc(p.name)}</td><td><select data-team="${i}" aria-label="${esc(p.name)} 소속"><option value="0" ${p.team===0?'selected':''}>A팀</option><option value="1" ${p.team===1?'selected':''}>B팀</option></select></td><td><select data-role="${i}" aria-label="${esc(p.name)} 훈련 역할">${roleOptions(p.role)}</select></td><td>${esc(p.second)}${p.role===p.second?' · 한 자리 집중':''}</td></tr>`).join('')}</tbody></table></div><p id="team-cycle-balance"></p><button id="team-cycle-save" type="button" ${TEAM_CYCLE_STORAGE_ENABLED?'':'disabled'}>이 계획을 새 8주 고정팀으로 저장</button>`;
        const balance=()=>{out.querySelector('#team-cycle-balance').textContent=[0,1].map(t=>{
            const members=draft.members.filter(p=>p.team===t);
            return `${t===0?'A':'B'}팀 ${members.length}명 · ${CYCLE_ROLES.map(r=>`${r} ${members.filter(p=>p.role===r).length}`).join(' / ')}`;
        }).join(' | ');};
        out.querySelectorAll('[data-team]').forEach(el=>el.onchange=()=>{draft.members[Number(el.dataset.team)].team=Number(el.value);preview=null;balance();});
        out.querySelectorAll('[data-role]').forEach(el=>el.onchange=()=>{draft.members[Number(el.dataset.role)].role=el.value;preview=null;balance();});balance();
        out.querySelector('#team-cycle-save').onclick=run(async()=>{
            if(!TEAM_CYCLE_STORAGE_ENABLED)throw new Error('권한 적용 전에는 저장하지 않습니다.');
            validateCycle(draft);if(!auth?.currentUser?.uid)throw new Error('다시 로그인해 주세요.');
            if(!confirm(`${draft.startDate}부터 8주 고정팀을 새로 저장할까요? 기존 경기와 설문은 바뀌지 않습니다.`))return;
            const copy=structuredClone(draft);
            await addDoc(collection(db,'teamCycles'),{...copy,createdBy:auth.currentUser.uid,createdAt:serverTimestamp()});
            if(!state.isAdmin)return;
            plans.unshift(copy);
            if(JSON.stringify(draft)===JSON.stringify(copy))draft=null;
            drawDraft();refreshSources();message('새 계획만 저장했습니다. 현재 배정 방식은 유지됩니다. 새 계획을 쓰려면 ‘8주 고정팀’을 누르세요.');
        });
    };
    panel.querySelector('#team-cycle-roster').onclick=run(async()=>{
        const start=panel.querySelector('#team-cycle-start').value;
        if(!start)throw new Error('8주 시작일을 선택해 주세요.');
        if(state.attendanceReady===false || state.playersReady===false)throw new Error('출석·선수 자료를 모두 받은 후 명단을 확인해 주세요.');
        // Only this explicit action reads private responses; never on page load.
        const names=recentParticipants(state.attendanceLog||[],start);
        if(!names.length)throw new Error('최근 3개월 실제 출석 명단이 없습니다. 출석 자료가 불러와졌는지 확인해 주세요.');
        let snap;try{snap=await getDocs(collection(db,'privatePositionPreferences'));}catch{throw new Error('비공개 설문은 지정된 감독 계정만 조회할 수 있습니다. 권한을 확인해 주세요.');}
        guard();if(panel.querySelector('#team-cycle-start').value!==start)throw new Error('시작일이 바뀌었습니다. 다시 불러오세요.');
        candidates=cycleCandidates(names,snap.docs.map(d=>d.data()),state.playerDB);
        draft=null;preview=null;drawDraft();refreshSources();
        const box=panel.querySelector('#team-cycle-candidates');
        box.innerHTML=`<h3>최근 3개월 실제 출석 ${names.length}명</h3><p>미응답·중복 응답·미등록 선수는 임의로 추정하지 않습니다. 해당 선수는 이번 초안에서 제외하고 확인 후 추가해 주세요. 2지망이 같으면 한 포지션에 집중하려는 의사입니다.</p><div class="cycle-table-wrap"><table><thead><tr><th>포함</th><th>선수</th><th>1·2지망 / 확인사항</th></tr></thead><tbody>${candidates.map((p,i)=>`<tr><td><input type="checkbox" data-include="${i}" aria-label="${esc(p.name)} 포함" ${p.issue||p.skill===null?'disabled':'checked'}></td><td>${esc(p.name)}</td><td>${esc(p.issue||`${p.role} / ${p.second}${p.role===p.second?' · 한 자리 집중':''}`)}</td></tr>`).join('')}</tbody></table></div><button id="team-cycle-build" type="button">선택한 인원으로 고정팀 초안 만들기</button>`;
        box.querySelector('#team-cycle-build').onclick=run(async()=>{
            if(panel.querySelector('#team-cycle-start').value!==start)throw new Error('시작일이 바뀌었습니다. 명단부터 다시 확인하세요.');
            const selected=[...box.querySelectorAll('[data-include]:checked')].map(el=>candidates[Number(el.dataset.include)]);
            const previous=plans.filter(p=>p.endDateExclusive<=start).sort((a,b)=>b.startDate.localeCompare(a.startDate))[0];
            draft=draftCycle(selected,start,previous?.members||[]);preview=null;drawDraft();refreshSources();
            message('초안만 만들었습니다. 팀과 역할을 확인하세요. 미응답자는 포함하지 않았습니다.');
        });message('원본 설문을 변경하지 않고 불러왔습니다.');
    });
    panel.querySelector('#team-cycle-load').onclick=run(async()=>{
        if(!TEAM_CYCLE_STORAGE_ENABLED)throw new Error('권한 적용 전입니다.');
        const snap=await getDocs(collection(db,'teamCycles'));guard();
        const selected=chosen();
        plans=[approvedCycle('2026-10-07'),...snap.docs.map(d=>d.data()).filter(p=>{try{return validateCycle(p);}catch{return false;}}).sort((a,b)=>b.startDate.localeCompare(a.startDate))];
        preview=null;refreshSources();
        if(selected===draft&&draft)source.value='draft';
        else {const i=plans.findIndex(p=>JSON.stringify(p)===JSON.stringify(selected));if(i>=0)source.value=String(i);}
        message(`저장 계획 ${plans.length-1}개를 확인했습니다. 현재 배정 방식과 기존 라인업은 유지됩니다.`);
    });
    panel.querySelector('#team-cycle-match').onclick=run(async()=>{
        const cycle=chosen(),target=date(),raw=attendees();
        if(state.playersReady===false)throw new Error('선수 포지션 정보를 모두 받은 뒤 미리보기를 만드세요.');
        if(!cycle)throw new Error('초안 또는 저장된 계획을 선택해 주세요.');
        if(!raw.trim())throw new Error('참석·모임정보에서 참석자를 팀 배정기로 가져오세요.');
        const result=matchFromCycle(cycle,raw.split('\n'),target,state.playerDB,{fillExtras:true});
        preview={cycle:JSON.stringify(cycle),date:target,raw,result};
        const out=panel.querySelector('#team-cycle-match-result');
        out.innerHTML=`<h3>${esc(target)} · 당일 팀 미리보기</h3>${result.teams.map((team,i)=>`<p><b>${i===0?'A':'B'}팀 ${team.length}명</b> · ${team.map(p=>esc(p.name)).join(', ')}</p>`).join('')}<p>당일 차출 ${result.loans.length}명 · 원소속은 유지합니다.</p><ul>${result.loans.map(p=>`<li>${esc(p.name)}: ${p.from===0?'A':'B'} → ${p.to===0?'A':'B'} · ${esc(p.reason)}</li>`).join('')}</ul>${result.unassigned.length?`<p class="cycle-notice">고정팀에 없는 참석자: ${result.unassigned.map(esc).join(', ')}. 아래 입력칸으로 보낸 후 이 선수들도 빠짐없이 팀에 추가하세요.</p>`:''}<button id="team-cycle-use" type="button">직접 팀 입력칸으로 보내기 · 아직 적용 안 함</button><p>6쿼터 라인업과 공개본은 바꾸지 않습니다. 위 차출은 제안이며 입력칸에서 조정할 수 있습니다.</p>`;
        if(result.unassigned.length){
            const extra=document.createElement('div');
            extra.innerHTML=result.unassigned.map((name,i)=>`<label>${esc(name)} · 오늘만 임시 배정<select data-temporary="${i}"><option value="">팀 선택</option><option value="0">A팀</option><option value="1">B팀</option></select></label>`).join('');
            out.querySelector('#team-cycle-use').before(extra);
        }
        if(result.temporary.length)out.querySelector('#team-cycle-use').insertAdjacentHTML('beforebegin',`<p>당일 추가 배정: ${result.temporary.map(p=>`${esc(p.name)} → ${p.team===0?'A':'B'} · ${esc(p.role)} (${p.knownRole?'등록 포지션 참고':'빈자리 제안 · 감독 확인'})`).join(' / ')}. 고정 소속을 새로 저장하지 않으며 출전 기회는 동일한 기준입니다.</p>`);
        out.querySelector('#team-cycle-use').onclick=run(async()=>{
            if(!preview||date()!==preview.date||attendees()!==preview.raw||JSON.stringify(chosen())!==preview.cycle)throw new Error('계획·날짜·참석자가 바뀌었습니다. 다시 미리보기 하세요.');
            const prepared=preview.result.teams.map(team=>team.map(p=>p.name));
            for(const el of out.querySelectorAll('[data-temporary]')){
                if(!['0','1'].includes(el.value))throw new Error('고정팀에 없는 참석자도 임시 소속을 모두 선택해 주세요.');
                prepared[Number(el.value)].push(result.unassigned[Number(el.dataset.temporary)]);
            }
            if(Math.abs(prepared[0].length-prepared[1].length)>1)throw new Error('임시 배정 후 양 팀 인원 차이가 2명 이상입니다. 임시 소속을 조정하거나 직접 팀 입력을 사용해 주세요.');
            const count=document.getElementById('teamCount');count.value='2';count.dispatchEvent(new Event('change'));
            prepared.forEach((team,i)=>{document.getElementById(`manual-team-ta-${i}`).value=team.join('\n');});
            const repeat=document.getElementById('avoid-repeat');if(repeat)repeat.checked=false;
            state.trainingCycle={...structuredClone(cycle),date:target};showTraining();
            try{localStorage.removeItem('barea:free-teams:'+target);}catch{}
            const manual=document.getElementById('manual-team-box');manual.open=true;manual.scrollIntoView({block:'start'});
            message('모든 참석자를 입력칸에 옮겼습니다. 확인 후 ‘이대로 팀 만들기’를 누르세요. 아직 저장하지 않았습니다.');
        });
    });
}
