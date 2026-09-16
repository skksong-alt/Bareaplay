import { collection, doc, getDocs, getDoc, setDoc, serverTimestamp, addDoc } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { cleanName, escapeHtml as esc, recentHistory, ROLES, validateLineup, lineupSummary, locate } from './coachCore.js?v=1';
import { lessonFor, lessonHtml, addCoachStyles, TEAM_VIDEOS, parseGuidelines } from './weeklyContent.js?v=2';
let db, state;
const dateNow = () => document.getElementById('balancer-date')?.value || window.getLocalDate();
const requireAdmin = () => { if(!state.isAdmin) throw new Error('관리자 로그인이 필요합니다.'); };
const notify = (message,error=false) => window.showNotification(message,error?'error':undefined);
const read = async (col,id) => { const snap=await getDoc(doc(db,col,id)); return snap.exists()?snap.data():{}; };
const profileMap = (docs,date) => Object.fromEntries(docs.map(d=>[cleanName(d.id),d.data()]).filter(([,p])=>!p.guest || p.date===date));
export async function prepareCoach(date = dateNow()) {
    requireAdmin();
    const [profiles,plan,meetings] = await Promise.all([getDocs(collection(db,'coachPlayers')),read('coachPlans',date),getDocs(collection(db,'dailyMeetings'))]);
    if(date!==dateNow()) throw new Error('날짜가 바뀌었습니다. 다시 시도하세요.');
    state.coachProfiles=profileMap(profiles.docs,date);
    state.coachPlan={...plan,date};
    state.coachHistory=recentHistory(meetings.docs.map(d=>({...d.data(),date:d.data().date||d.id})),date);
    state.coachDate=date;
    return {profiles:state.coachProfiles,plan:state.coachPlan,history:state.coachHistory};
}
export function init(dependencies) {
    ({db,state}=dependencies); addCoachStyles();
    window.prepareCoach=prepareCoach;
    window.coachReason='temporary';
    const share=document.getElementById('page-share'), players=document.getElementById('page-players'), lineup=document.getElementById('page-lineup');
    const make=(parent,id,html)=>{const node=document.createElement('section');node.id=id;node.className='coach-card';node.innerHTML=html;parent?.append(node);return node;};
    const weekly=make(share,'coach-weekly',`<h2>경기 전 참고 영상 · 15분 연습</h2><p class="coach-note">핵심 지침을 누르면 영상이 열립니다. 날짜별로 4~6개를 정리해 주세요. 기본 영상은 감독 제공 모음이며 자동으로 새 영상을 선정하지 않습니다. 기존 참석 투표는 변경하지 않습니다.</p><label>대상 경기 날짜<input type="date" id="coach-week-date"></label><button id="coach-week-load">불러오기</button><div id="coach-week-editor"></div>`);
    weekly.querySelector('input').value=window.getLocalDate();
    weekly.querySelector('button').onclick=()=>guard(async()=>{
        requireAdmin(); const date=weekly.querySelector('input').value;if(!date)throw new Error('날짜를 선택하세요.');
        const custom=await read('coachWeeks',date), l=lessonFor(date,custom);
        if(!Object.keys(custom).length){
            l.segmentKo=TEAM_VIDEOS.map(v=>`[${v.ko}](${v.url})`).join('\n');
            l.segmentEn=TEAM_VIDEOS.map(v=>`[${v.en}](${v.url})`).join('\n');
        }
        const fields=[['segmentKo','영상별 핵심 지침 · 한국어'],['segmentEn','영상별 핵심 지침 · English'],['drillKo','15분 현장 연습 · 한국어'],['drillEn','15분 현장 연습 · English']];
        const legacyFields=[['ko','단일 자료 제목 · 한국어'],['en','단일 자료 제목 · English'],['actionKo','실천 행동 · 한국어'],['actionEn','실천 행동 · English'],['url','단일 자료 URL']];
        const box=weekly.querySelector('#coach-week-editor');
        box.innerHTML=`<p>편집 대상: <b>${esc(date)}</b></p><p class="coach-note">영상은 한 줄에 하나씩 [핵심 지침](영상 주소) 형식으로 입력하세요. YouTube·FIFA HTTPS 링크만 표시하며 최대 6개입니다. 기존 일반 설명도 유지됩니다.</p>${fields.map(([k,label])=>`<label>${label}<textarea data-field="${k}" rows="${k.startsWith('segment')?6:3}" maxlength="6000">${esc(l[k]||'')}</textarea></label>`).join('')}<details><summary>기존 단일 자료 설정</summary>${legacyFields.map(([k,label])=>`<label>${label}<input data-field="${k}" value="${esc(l[k]||'')}" maxlength="600"></label>`).join('')}</details><label>평가할 지난 경기 날짜<input type="date" id="coach-review-date" value="${esc(custom.reviewDate==='none'?'':custom.reviewDate||'')}"></label><label><input type="checkbox" id="coach-review-off" ${custom.reviewDate==='none'?'checked':''}> 지난 경기 투표 숨기기</label><p class="coach-note">날짜가 비어 있으면 현재 경기 이전의 가장 최근 배정일(오늘 제외)을 찾습니다. 취소된 경기라면 실제 진행된 날짜를 지정하세요.</p><button id="coach-week-preview">미리보기</button><button id="coach-week-save" class="coach-primary">이 날짜의 콘텐츠 저장</button><div id="coach-week-sample"></div>`;
        const payload=()=>Object.fromEntries([...box.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value.trim()]));
        box.querySelector('#coach-week-preview').onclick=()=>{box.querySelector('#coach-week-sample').innerHTML=lessonHtml(date,payload(),'ko')+lessonHtml(date,payload(),'en');};
        box.querySelector('#coach-week-save').onclick=()=>guard(async()=>{
            requireAdmin(); const values=payload(); const {validVideoUrl}=await import('./coachCore.js?v=1');
            if(!values.ko || !values.en || !values.actionKo || !values.actionEn)throw new Error('한국어·영어 목표와 실천 행동을 입력하세요.');
            if(values.url && !validVideoUrl(values.url))throw new Error('YouTube 또는 FIFA의 HTTPS 주소를 입력하세요.');
            for(const field of ['segmentKo','segmentEn']) {
                const lines=values[field].split('\n').filter(line=>line.trim());
                if(lines.some(line=>/https?:|\]\(/i.test(line)) && (lines.length>6 || lines.some(line=>parseGuidelines(line).length!==1 || !/^\[[^\]\n]+\]\(https:\/\/[^\s)]+\)$/.test(line.trim()))))throw new Error('영상 목록은 [핵심 지침](HTTPS 주소) 한 줄씩, 최대 6개로 입력하세요.');
            }
            const review=box.querySelector('#coach-review-date').value;
            if(review && review>=date)throw new Error('평가 날짜는 대상 경기보다 이전이어야 합니다.');
            await setDoc(doc(db,'coachWeeks',date),{...values,date,reviewDate:box.querySelector('#coach-review-off').checked?'none':review,updatedAt:serverTimestamp()},{merge:true});notify('주간 콘텐츠를 저장했습니다.');
        });
    });
    const profiles=make(players,'coach-profiles',`<h2>선수 역할·게스트 정보</h2><p class="coach-note">축구 역할만 기록하세요. 민감한 성격 평가나 개인정보는 적지 않습니다. 게스트 정보는 지정한 경기 날짜에만 배정에 사용됩니다.</p><label>이름<input id="coach-profile-name" list="balancer-player-datalist" maxlength="100"></label><button id="coach-profile-load">불러오기</button><div id="coach-profile-editor"></div>`);
    profiles.querySelector('button').onclick=()=>guard(async()=>{
        requireAdmin();const name=cleanName(profiles.querySelector('input').value);
        if(!name || name.includes('/') || ['.','..'].includes(name))throw new Error('올바른 이름을 입력하세요.');
        const p=await read('coachPlayers',name), guest=!state.playerDB[name];
        const box=profiles.querySelector('#coach-profile-editor');
        box.innerHTML=`<p><b>${esc(name)}</b> · ${guest?'게스트':'등록 선수'}</p>${Object.entries(ROLES).map(([role,labels])=>`<label><input type="checkbox" data-role="${role}" ${p.roles?.includes(role)?'checked':''}> ${labels[0]} · ${labels[1]}</label>`).join('')}<label>안내할 선수 (선택)<input id="coach-mentor" list="balancer-player-datalist" value="${esc(p.mentor||'')}"></label><p class="coach-note">안내 선수는 같은 팀 배정을 우선하며, 최근 같은 팀 반복 방지보다 우선합니다. 본인 또는 서로 안내하는 관계는 지정하지 마세요.</p>${guest?`<label>적용 경기 날짜<input id="coach-guest-date" type="date" value="${esc(p.date||dateNow())}"></label><label>임시 능력치 (0~100)<input id="coach-guest-skill" type="number" min="0" max="100" value="${p.skill??65}"></label><label>편한 포지션 (쉼표로 구분)<input id="coach-guest-pos" value="${esc((p.positions||[]).join(','))}" placeholder="CM, FW"></label>`:''}<button id="coach-profile-save" class="coach-primary">역할 정보 저장</button>`;
        box.querySelector('button').onclick=()=>guard(async()=>{
            requireAdmin();const mentor=cleanName(box.querySelector('#coach-mentor').value);
            if(mentor===name)throw new Error('본인을 안내 선수로 선택할 수 없습니다.');
            const roles=[...box.querySelectorAll('[data-role]:checked')].map(el=>el.dataset.role);
            const data={name,roles,mentor,guest,updatedAt:serverTimestamp()};
            if(guest){data.date=box.querySelector('#coach-guest-date').value;data.skill=Number(box.querySelector('#coach-guest-skill').value);data.positions=box.querySelector('#coach-guest-pos').value.toUpperCase().split(',').map(s=>s.trim()).filter(Boolean);if(!data.date||!Number.isFinite(data.skill)||data.skill<0||data.skill>100||data.positions.some(p=>!['GK','CB','LB','RB','DF','CM','MF','LW','RW','FW'].includes(p)))throw new Error('게스트 날짜·능력치·포지션을 확인하세요.');}
            await setDoc(doc(db,'coachPlayers',name),data,{merge:true});notify('역할 정보를 저장했습니다. 다음 배정부터 사용합니다.');
        });
    });
    const panel=make(lineup,'coach-planner',`<h2>감독 보드 · 최근 이력과 부분 재배정</h2><p class="coach-note">팀 배정 탭에서 선택한 날짜를 사용합니다. 최근 4회는 실제 출전 시간이 아닌 저장된 배정 기록입니다.</p><button id="coach-load">선택 날짜 불러오기</button><label>이번 수동 수정의 이유<select id="coach-reason"><option value="temporary">오늘만 팀 사정</option><option value="condition">컨디션</option><option value="wish">희망 반영</option><option value="learning">역할 학습</option><option value="roleFit">지속적으로 적합한 역할</option></select></label><div id="coach-planner-body"></div>`);
    panel.querySelector('#coach-reason').onchange=e=>window.coachReason=e.target.value;
    panel.querySelector('#coach-load').onclick=()=>guard(async()=>{await prepareCoach();renderPlanner(panel);});
    // Make the board easy to find, before the six pitches.
    const display=document.getElementById('lineup-display');if(display)display.before(panel);
}
async function guard(action) { try { await action(); } catch(e) {notify(e.message || '작업 실패. 다시 시도하세요.',true);} }
function renderPlanner(panel) {
    const date=state.coachDate, plan=state.coachPlan || {}, body=panel.querySelector('#coach-planner-body');
    const teams=state.teams || [];
    body.innerHTML=`<p>대상 경기: <b>${esc(date)}</b></p><div style="overflow:auto"><table class="coach-table"><thead><tr><th>선수</th><th>최근 참석</th><th>공격</th><th>미들</th><th>수비</th><th>GK</th><th>휴식 / 심판</th><th>희망 기회</th><th>팀 고정</th></tr></thead><tbody>${teams.map((team,i)=>team.map(p=>{
        const h=state.coachHistory[cleanName(p.name)] || {}, wish=(state.playerDB[p.name]?.wishPos || []), count=wish.reduce((n,pos)=>n+(h.positions?.[pos]||0),0);
        return `<tr><td>${esc(p.name)}<br><small>${(state.coachProfiles[cleanName(p.name)]?.roles || []).map(r=>ROLES[r]?.[0]||'').join(' · ')}</small></td><td>${h.dates?.length||0}회</td><td>${h.ATT||0}</td><td>${h.MID||0}</td><td>${h.DEF||0}</td><td>${h.GK||0}</td><td>${h.REST||0} / ${h.REF||0}</td><td>${wish.length?count:'—'}</td><td><input type="checkbox" data-team-lock="${esc(p.name)}" data-team="${i}" ${plan.teamLocks?.[p.name]===i?'checked':''} aria-label="${esc(p.name)} 팀 고정"></td></tr>`;
    }).join('')).join('')}</tbody></table></div><p class="coach-note">과거 배정이 없으면 0회입니다. 심판은 휴식에 포함됩니다. 희망 기회가 적은 선수는 다음 라인업에서 가산점을 받습니다.</p><button id="coach-save-team-locks">현재 팀 고정 조건 저장</button>
      <h3 style="font-weight:800;margin-top:16px">부분 라인업 재배정</h3><label>팀<select id="coach-partial-team">${teams.map((_,i)=>`<option value="${i}">${esc(window.teamName?.(i)||`Team ${i+1}`)}</option>`).join('')}</select></label><div id="coach-lock-grid"></div><button id="coach-save-locks">포지션 고정 조건 저장</button><button id="coach-partial-preview">고정 유지 · 나머지 재배정 미리보기</button><div id="coach-partial-result"></div>
      <h3 style="font-weight:800;margin-top:16px">쿼터별 상대 비교</h3><p class="coach-note">대진을 직접 선택하여 비교합니다. 점수는 능력치 평균이며 승률이 아닙니다.</p><div class="coach-grid"><select id="coach-compare-a">${teams.map((_,i)=>`<option value="${i}">${esc(window.teamName?.(i)||`Team ${i+1}`)}</option>`).join('')}</select><select id="coach-compare-b">${teams.map((_,i)=>`<option value="${i}" ${i===1?'selected':''}>${esc(window.teamName?.(i)||`Team ${i+1}`)}</option>`).join('')}</select><button id="coach-compare">비교</button></div><div id="coach-comparison"></div>`;
    const checkDate=()=>{requireAdmin();if(date!==dateNow())throw new Error('날짜가 변경되었습니다. 다시 불러오세요.');};
    body.querySelector('#coach-save-team-locks').onclick=()=>guard(async()=>{
        checkDate();const teamLocks=Object.fromEntries([...body.querySelectorAll('[data-team-lock]:checked')].map(el=>[el.dataset.teamLock,Number(el.dataset.team)]));
        // Explicit field replacement allows unchecking locks without touching other plan fields.
        const { updateDoc }=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');
        const ref=doc(db,'coachPlans',date), old=await getDoc(ref);
        if(old.exists())await updateDoc(ref,{teamLocks,updatedAt:serverTimestamp()});else await setDoc(ref,{date,teamLocks});
        state.coachPlan.teamLocks=teamLocks;notify('팀 고정 조건을 저장했습니다.');
    });
    const teamSelect=body.querySelector('#coach-partial-team');
    const drawLocks=()=>{
        const i=Number(teamSelect.value), result=state.teamLineupCache?.[i], grid=body.querySelector('#coach-lock-grid');
        body.querySelector('#coach-partial-result').innerHTML='';
        if(!result){grid.textContent='먼저 이 팀의 라인업을 생성하세요.';return;}
        const locks=plan.lineupLocks?.[i] || [];
        grid.innerHTML=`<p class="coach-note">선택한 칸의 현재 선수·포지션·휴식을 유지합니다. 전체 생성에서도 저장된 고정 조건이 적용됩니다.</p><div style="overflow:auto"><table class="coach-table"><tr><th>선수</th>${Array.from({length:6},(_,q)=>`<th>Q${q+1}</th>`).join('')}</tr>${(teams[i]||[]).map(p=>`<tr><td>${esc(p.name)}</td>${Array.from({length:6},(_,q)=>{const loc=locate(result,q,p.name);return `<td><label><input type="checkbox" data-lock-name="${esc(p.name)}" data-q="${q}" ${locks.some(l=>l.name===p.name&&l.q===q)?'checked':''} ${loc?'':'disabled'}> ${esc(loc?.pos||'—')}</label></td>`;}).join('')}</tr>`).join('')}</table></div>`;
    };teamSelect.onchange=drawLocks;drawLocks();
    const selectedLocks=()=>[...body.querySelectorAll('[data-lock-name]:checked')].map(el=>({name:el.dataset.lockName,q:Number(el.dataset.q)}));
    body.querySelector('#coach-save-locks').onclick=()=>guard(async()=>{
        checkDate();const i=Number(teamSelect.value), locks=selectedLocks();
        await setDoc(doc(db,'coachPlans',date),{date,lineupLocks:{[i]:locks},updatedAt:serverTimestamp()},{merge:true});
        state.coachPlan.lineupLocks={...state.coachPlan.lineupLocks,[i]:locks};notify('포지션 고정 조건을 저장했습니다.');
    });
    body.querySelector('#coach-partial-preview').onclick=()=>guard(async()=>{
        checkDate();const i=Number(teamSelect.value), original=state.teamLineupCache?.[i];
        if(!original)throw new Error('먼저 라인업을 생성하세요.');
        const roster=teams[i].map(p=>p.name), locks=selectedLocks(), fingerprint=JSON.stringify(original), rosterKey=JSON.stringify(roster);
        await prepareCoach(date);
        const candidate=await window.lineup.executeLineupGeneration(roster,original.formations,true,{locks,original});
        if(!candidate || !validateLineup(candidate,roster))throw new Error('고정 조건을 만족하는 후보가 없습니다. 조건을 줄여 주세요.');
        const changes=[];for(let q=0;q<6;q++)for(const name of roster){const a=locate(original,q,name)?.pos,b=locate(candidate,q,name)?.pos;if(a!==b)changes.push(`Q${q+1} ${name}: ${a} → ${b}`);}
        const out=body.querySelector('#coach-partial-result');
        const opportunity=(result,name)=>{const wish=state.playerDB[name]?.wishPos||[];let field=0,gk=0,wanted=0;for(let q=0;q<6;q++){const pos=locate(result,q,name)?.pos;if(pos&&pos!=='REST')field++;if(pos==='GK')gk++;if(wish.includes(pos))wanted++;}return `${field} / ${gk} / ${wanted}`;};
        out.innerHTML=`<p>${changes.length}개 배정 변경 · 아직 저장되지 않았습니다.</p><details><summary>선수별 영향: 출전 / GK / 희망 횟수</summary><div style="overflow:auto"><table class="coach-table"><tr><th>선수</th><th>현재</th><th>후보</th></tr>${roster.map(n=>`<tr><td>${esc(n)}</td><td>${opportunity(original,n)}</td><td>${opportunity(candidate,n)}</td></tr>`).join('')}</table></div></details><div style="max-height:240px;overflow:auto">${changes.map(s=>`<p>${esc(s)}</p>`).join('')||'변경 없음'}</div><button id="coach-apply" class="coach-primary">이 후보 적용·저장</button>`;
        out.querySelector('button').onclick=()=>guard(async()=>{
            checkDate();if(fingerprint!==JSON.stringify(state.teamLineupCache?.[i]) || rosterKey!==JSON.stringify(state.teams[i]?.map(p=>p.name)))throw new Error('미리보기 이후 명단·라인업이 변경되었습니다. 다시 생성하세요.');
            if(!confirm(`${date} ${window.teamName?.(i)||`Team ${i+1}`}의 ${changes.length}개 배정을 적용할까요?`))return;
            state.teamLineupCache[i]=candidate;window.lineup.renderTeamSelectTabs(state.teams);window.saveDailyMeetingData();
            await addDoc(collection(db,'coachAdjustments'),{date,team:i,reason:window.coachReason||'temporary',kind:'partial-lineup',changes,at:serverTimestamp()});
            out.textContent='후보를 적용했습니다. 기존 저장 결과 알림을 확인하세요.';
        });
    });
    body.querySelector('#coach-compare').onclick=()=>guard(async()=>{
        checkDate();const a=Number(body.querySelector('#coach-compare-a').value),b=Number(body.querySelector('#coach-compare-b').value);
        if(a===b)throw new Error('서로 다른 팀을 선택하세요.');
        const A=lineupSummary(state.teamLineupCache?.[a],state.playerDB,state.coachProfiles), B=lineupSummary(state.teamLineupCache?.[b],state.playerDB,state.coachProfiles);
        if(A.length!==6||B.length!==6)throw new Error('두 팀 모두 라인업이 필요합니다.');
        body.querySelector('#coach-comparison').innerHTML=`<div style="overflow:auto"><table class="coach-table"><tr><th>쿼터</th><th>평균 A / B</th><th>차이</th><th>역할 점검</th></tr>${A.map((x,q)=>{
            const y=B[q],notes=[];for(const [label,r] of [['A',x],['B',y]]){if(!r.roleCounts.connector)notes.push(`${label}: 연결 역할 미지정/부재`);if(r.roleCounts.learner&&!r.roleCounts.mentor)notes.push(`${label}: 학습 선수의 안내 역할 부재`);}
            return `<tr><td>Q${q+1}</td><td>${x.average.toFixed(1)} / ${y.average.toFixed(1)}</td><td>${Math.abs(x.average-y.average).toFixed(1)}</td><td>${notes.join(' · ')||'등록된 역할 기준 특이사항 없음'}</td></tr>`;
        }).join('')}</table></div><p class="coach-note">차이가 큰 쿼터는 안내·연결 선수의 휴식 순서를 바꾸는 후보를 검토하세요. 실제 대진이 다른 쿼터는 해당 대진으로 다시 비교하세요.</p>`;
    });
}
