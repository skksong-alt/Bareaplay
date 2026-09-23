import { doc,getDoc,getDocs,collection,setDoc,serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js';
import { escapeHtml as esc,cleanName } from './coachCore.js?v=1';
import { POSITIONS,PREFERENCE_PITCH,validatePreference,preferenceSummary,surveyRoleCode } from './positionPreferencesCore.js?v=4';

// Release gate: enable ONLY after the coach-only Rules have been approved and deployed.
// This gate is not a security boundary; the Firestore Rules are mandatory.
export const POSITION_SURVEY_ENABLED=true;
let unsubscribe=()=>{};
export function renderPositionSurvey(db,auth) {
    unsubscribe();
    const en=(()=>{try{return localStorage.getItem('bp_lang')==='en';}catch{return false;}})(),t=(ko,eng)=>en?eng:ko;
    document.body.className='match-page';document.documentElement.lang=en?'en':'ko';
    document.title=t('희망 포지션 · BareaPlay','Position preferences · BareaPlay');
    document.body.innerHTML=`<main class="match-shell preference-shell">
        <div class="preference-topbar"><a class="match-back" href="/?vote=current">← ${t('참석 신청으로','Back to RSVP')}</a><button id="preference-language" type="button" lang="${en?'ko':'en'}">${en?'한국어':'English'}</button></div>
        <section class="coach-card">
            <p class="coach-eyebrow">BAREA · 8-WEEK TEAM TRIAL</p>
            <h1>${t('희망 포지션 설문','Your preferred positions')}</h1>
            <p class="preference-lead">${t('오늘보다 나은 나, 함께 성장하는 바레아. 여러분이 배우고 싶은 역할부터 듣겠습니다.','A better player, a stronger Barea. Tell us which roles you want to learn and grow in.')}</p>
            <section class="preference-purpose" aria-labelledby="preference-purpose-title">
                <h2 id="preference-purpose-title">${t('왜 포지션을 묻나요?','Why are we asking?')}</h2>
                <p>${t('팀과 포지션이 매번 바뀌면 같은 역할의 움직임을 익히고 동료와 호흡을 맞출 시간이 부족할 수 있습니다. 원하는 자리만 번갈아 뛰는 것보다, 익숙한 역할에서 기본기와 판단력을 쌓는 방향을 8주 동안 시험해 보려 합니다.','Frequent changes of team and position can leave little time to learn a role and understand teammates. For eight weeks, we want to try more consistent roles, giving everyone time to practise the basics and make better decisions.')}</p>
                <p><strong>${t('목표는 자리를 못 박는 것이 아니라, 각자가 자신 있는 역할을 만들고 함께 더 잘 뛰는 것입니다.','The goal is not to lock anyone into a position. It is to develop a role you feel confident in and play better together.')}</strong></p>
            </section>
            <details class="preference-plan">
                <summary id="preference-plan-title">${t('8주 운영 계획 보기','See the eight-week plan')}</summary>
                <ol><li><b>${t('먼저 · 희망 파악','First · Listen')}</b><span>${t('1·2지망과 배우고 싶은 점을 모읍니다. 감독이 포지션별 수요와 팀 균형을 함께 봅니다.','Share your first and second choices and what you want to learn. The coach will review demand alongside team balance.')}</span></li>
                <li><b>${t('8주 동안 · 반복하고 조정','Over eight weeks · Practise and adjust')}</b><span>${t('주 역할과 팀 조합을 가능한 한 유지하며 연습합니다. 결원·참석 인원·역할 적합성에 따라 필요한 조정은 합니다. 시작일과 배정은 감독이 별도로 안내합니다.','Keep primary roles and team combinations as consistent as practical. Adjust for attendance, absences and role fit. The coach will announce the start date and assignments separately.')}</span></li>
                <li><b>${t('마무리 · 함께 돌아보기','At the end · Review together')}</b><span>${t('역할에 대한 이해, 기본기, 동료와의 호흡, 본인 의견을 돌아보고 다음 운영 방식을 정합니다.','Review understanding of the role, basic skills, teamwork and your feedback before deciding what comes next.')}</span></li></ol>
            </details>
            <div class="preference-boundaries"><p><strong>${t('희망 조사이지, 자리 보장 투표는 아닙니다.','This is a preference survey, not a guaranteed assignment.')}</strong> ${t('여러분의 의사를 최대한 참고하되, 지원이 몰리는 자리와 꼭 필요한 역할 사이의 균형도 맞춥니다. 기존 선수 평가나 오늘의 배정이 자동 변경되지는 않습니다.','We will respect your wishes as much as possible while balancing popular positions with roles the team needs. This does not automatically change player assessments or today’s lineup.')}</p><p>${t('심판은 전체 참석자, 키퍼·휴식은 각 팀 안에서 늦은 참석 신청순으로 순환합니다. 전담 키퍼 예외를 포함한 기존 원칙은 그대로입니다.','Referees rotate from the latest RSVPs across all attendees; goalkeeper and rest duties rotate from the latest RSVPs within each team. The dedicated-goalkeeper exception stays in place.')}</p><p>${t('응답은 본인과 지정 감독만 볼 수 있습니다. 팀원에게 공개되지 않으며, 같은 Google 계정으로 다시 와서 희망을 수정할 수 있습니다.','Only you and the designated coach can view your response. It is not shared with teammates. You can return with the same Google account to update your preferences.')}</p></div>
            <div id="preference-body"></div>
        </section></main>`;
    document.getElementById('preference-language').onclick=()=>{try{localStorage.setItem('bp_lang',en?'ko':'en');}catch{}renderPositionSurvey(db,auth);};
    const body=document.getElementById('preference-body');
    if(!POSITION_SURVEY_ENABLED){body.textContent=t('비공개 접근 권한을 준비 중입니다. 설문은 아직 열리지 않았습니다.','Private access is being prepared. This survey is not open yet.');return;}
    let generation=0;
    unsubscribe=onAuthStateChanged(auth,async user=>{
        const run=++generation;
        if(!user){
            body.innerHTML=`<p>${t('Google 로그인은 본인 응답을 보호하기 위한 용도입니다. 본명은 로그인 후 선수 명단에서 직접 선택합니다.','Google sign-in protects your response. Afterwards, choose your real name from the team roster.')}</p><button id="preference-login">${t('Google로 로그인','Sign in with Google')}</button><p id="preference-login-message" role="status"></p>`;
            body.querySelector('button').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch{body.querySelector('#preference-login-message').textContent=t('로그인하지 못했습니다. 팝업 허용 여부를 확인해 주세요.','Could not sign in. Please check that pop-ups are allowed.');}};
            return;
        }
        body.textContent=t('본인 응답을 확인하고 있습니다…','Loading your own response…');
        try{
            // Never query another account's response from the public form.
            const [players,own]=await Promise.all([getDocs(collection(db,'players')),getDoc(doc(db,'privatePositionPreferences',user.uid))]);
            if(run!==generation)return;
            const names=players.docs.map(d=>cleanName(d.data().name||d.id)).filter(Boolean).sort((a,b)=>a.localeCompare(b));
            const existing=own.exists()?own.data():null;
            let savedName=existing?.name||'';
            let first=existing?.first||'',second=existing?.second||'',slot=first?'second':'first',saving=false;
            body.innerHTML=`<p class="coach-note">${t('본인과 감독만 응답을 볼 수 있습니다. Google 계정 이름은 팀의 본명을 자동 보증하지 않습니다.','Only you and the coach can read your response. A Google profile name does not verify your team identity.')}</p><button id="preference-signout">${t('다른 Google 계정 사용','Use a different Google account')}</button><label>${t('팀에 등록된 본명','Your registered team name')}<select id="preference-name" ${existing?'disabled':''}><option value="">${t('본명을 선택하세요','Choose your name')}</option>${names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label><p class="coach-note">${t('명단에 없거나 이름을 잘못 등록했다면 감독에게 문의하세요. 다른 사람 이름으로 제출하지 마세요.','Contact the coach if your name is missing or incorrect. Do not submit under someone else’s name.')}</p><div class="preference-ranks"><button data-rank="first"></button><button data-rank="second"></button></div><div class="preference-choice-guide"><p><strong>${t('두 자리 모두 해보고 싶다면','Want to try two roles?')}</strong><span>${t('1·2지망을 서로 다른 포지션으로 선택하세요.','Choose different positions for your first and second preferences.')}</span></p><p><strong>${t('가능하면 한 자리에서 집중해서 뛰고 싶다면','Prefer to focus on one role?')}</strong><span>${t('1·2지망을 같은 포지션으로 선택하세요.','Choose the same position for both preferences.')}</span></p></div><p class="coach-note">${t('1지망을 고르면 2지망 선택으로 넘어갑니다. 같은 곳을 한 번 더 눌러도 됩니다. 변경할 때는 위의 1지망 또는 2지망을 먼저 누르세요.','After your first choice, select your second — you can tap the same spot again. To change a choice, select First or Second above.')}</p><p class="preference-formation">4–2–3–1</p><div class="preference-pitch" aria-label="${t('공격 방향은 위쪽','Attack towards the top')}"><span class="preference-direction">↑ ${t('공격 방향','ATTACK')}</span>${PREFERENCE_PITCH.map(([code,x,y],index)=>{const [,ko,eng]=POSITIONS.find(p=>p[0]===code);return `<button type="button" data-position="${code}" data-slot="${index}" style="left:${x}%;top:${y}%" aria-label="${esc(en?eng:ko)}"><b>${code}</b><span>${esc(en?eng:ko)}</span><small class="preference-pick-badge"></small></button>`;}).join('')}</div><p class="coach-note">${t('CB 두 자리는 같은 중앙 수비 선호로 기록됩니다. 같은 포지션의 1·2지망은 강한 선호를 뜻하며, 두 표나 배정 보장은 아닙니다.','Both CB spots record the same centre-back preference. Matching choices express a strong preference, not two votes or a guaranteed assignment.')}</p><label>${t('감독에게 전할 말 · 없으면 생략 가능','Note to the coach · optional')}<textarea id="preference-note" maxlength="500" rows="3">${esc(existing?.note||'')}</textarea></label><button class="coach-primary" id="preference-save">${t('내 희망 저장','Save my preferences')}</button><p id="preference-message" role="status"></p>`;
            const nameInput=body.querySelector('#preference-name');if(existing)nameInput.value=existing.name;
            const message=body.querySelector('#preference-message');
            const draw=()=>{
                for(const rank of ['first','second']){const code=surveyRoleCode(rank==='first'?first:second),p=POSITIONS.find(p=>p[0]===code),button=body.querySelector(`[data-rank="${rank}"]`);button.textContent=`${rank==='first'?t('1지망','First'):t('2지망','Second')}: ${p?(en?p[2]:p[1]):t('선택','Select')}`;button.setAttribute('aria-pressed',String(rank===slot));}
                body.querySelectorAll('[data-position]').forEach(button=>{
                    const ranks=[surveyRoleCode(first)===button.dataset.position?'1':'',surveyRoleCode(second)===button.dataset.position?'2':''].filter(Boolean);
                    button.setAttribute('aria-pressed',String(ranks.length>0));
                    button.dataset.ranks=ranks.join('-');
                    button.querySelector('.preference-pick-badge').textContent=ranks.length?(en?ranks.map(rank=>rank==='1'?'1st':'2nd').join(' · '):ranks.join('·')+'지망'):'';
                });
                body.querySelector('#preference-save').disabled=saving||!nameInput.value||!first||!second;
            };
            body.querySelectorAll('[data-rank]').forEach(button=>button.onclick=()=>{slot=button.dataset.rank;draw();});
            body.querySelectorAll('[data-position]').forEach(button=>button.onclick=()=>{if(slot==='first'){first=button.dataset.position;if(!second)slot='second';}else second=button.dataset.position;draw();});
            nameInput.onchange=draw;
            body.querySelector('#preference-signout').onclick=()=>signOut(auth).catch(()=>{message.textContent=t('로그아웃하지 못했습니다. 다시 시도해 주세요.','Could not sign out. Please retry.');});
            body.querySelector('#preference-save').onclick=async()=>{
                // Legacy booleans are required by deployed Rules. Preserve existing values;
                // new responses use false only for compatibility, never as a stated preference.
                const value={name:nameInput.value,first,second,stable:existing?.stable??false,flexible:existing?.flexible??false,note:body.querySelector('#preference-note').value.trim()};
                if(saving||!validatePreference(value,names)||auth.currentUser?.uid!==user.uid)return;
                if(savedName&&value.name!==savedName)return;
                if(!existing&&!confirm(t(`${value.name}님 본인의 응답이 맞나요?` ,`Is this your own response as ${value.name}?`)))return;
                saving=true;body.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
                try{
                    await setDoc(doc(db,'privatePositionPreferences',user.uid),{...value,updatedAt:serverTimestamp()},{merge:true});
                    if(run!==generation)return;
                    savedName=value.name;
                    message.textContent=t('희망을 저장했습니다. 기존 선수 정보와 배정은 변경하지 않았습니다.','Saved. Existing player profiles and assignments were not changed.');
                    nameInput.disabled=true;
                }catch{if(run===generation)message.textContent=t('저장하지 못했습니다. 접근 권한 또는 연결을 확인해 주세요.','Could not save. Check access permissions or your connection.');}
                finally{if(run===generation){saving=false;body.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);nameInput.disabled=!!savedName;draw();}}
            };draw();
        }catch{if(run===generation)body.textContent=t('본인 응답을 확인할 수 없습니다. 접근 권한이 준비됐는지 감독에게 문의하세요.','Your response is unavailable. Ask the coach whether private access is ready.');}
    });
}

export function mountPreferenceAdmin(db,state) {
    const host=document.getElementById('page-players');if(!host)return;
    const panel=document.createElement('section');panel.className='coach-card';panel.innerHTML='<h2>비공개 희망 포지션</h2><p class="coach-note">본인 희망과 감독의 기존 평가를 분리합니다. 아래 내용으로 선수 정보나 배정을 자동 변경하지 않습니다.</p><p><a class="coach-link" href="/?preferences=1" target="_blank" rel="noopener noreferrer">팀원에게 공유할 설문 열기 ↗</a></p><button id="preference-admin-load">응답·수요 보기</button><label><input id="preference-attending" type="checkbox">현재 팀 배정 참가자만 집계</label><div id="preference-admin-result"></div>';host.append(panel);
    let responses=[];
    const draw=()=>{
        const only=panel.querySelector('#preference-attending').checked;
        const attendees=only?(document.getElementById('attendees')?.value||'').split('\n').map(cleanName).filter(Boolean):null;
        const {rows,duplicates}=preferenceSummary(responses,attendees),out=panel.querySelector('#preference-admin-result');
        out.innerHTML=`<p>${responses.length}개 계정 응답${only?' · 현재 참가자만 집계':''}</p>${duplicates.length?`<p class="coach-error">같은 이름의 여러 계정 응답: ${duplicates.map(esc).join(', ')}. 확인 전 수요 집계에서 제외했습니다.</p>`:''}<div style="overflow:auto"><table class="coach-table"><tr><th>포지션</th><th>1지망</th><th>2지망만</th><th>두 지망 동일</th></tr>${rows.map(r=>`<tr><td>${r.ko}</td><td>${r.first.length} · ${r.first.map(esc).join(', ')}</td><td>${r.second.length} · ${r.second.map(esc).join(', ')}</td><td>${r.same.length}</td></tr>`).join('')}</table></div><details><summary>개별 응답</summary>${responses.filter(r=>!attendees||attendees.includes(r.name)).map(r=>`<p><b>${esc(r.name)}</b> · ${esc(surveyRoleCode(r.first))} / ${esc(surveyRoleCode(r.second))}<br>${esc(r.note)}</p>`).join('')}</details>`;
    };
    panel.querySelector('#preference-admin-load').onclick=async()=>{
        const out=panel.querySelector('#preference-admin-result');
        if(!state.isAdmin)return;
        if(!POSITION_SURVEY_ENABLED){out.textContent='감독 전용 접근 권한 배포 전입니다. 설문은 아직 열리지 않았습니다.';return;}
        try{const snap=await getDocs(collection(db,'privatePositionPreferences'));responses=snap.docs.map(d=>d.data());draw();}catch{out.textContent='전체 응답은 지정된 감독 계정만 조회할 수 있습니다. 접근 권한을 확인해 주세요.';}
    };
    panel.querySelector('#preference-attending').onchange=()=>{if(responses.length)draw();};
}
