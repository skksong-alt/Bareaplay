import { doc,getDoc,getDocs,collection,setDoc,serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js';
import { escapeHtml as esc,cleanName } from './coachCore.js?v=1';
import { POSITIONS,validatePreference,preferenceSummary } from './positionPreferencesCore.js?v=1';

// Release gate: enable ONLY after the coach-only Rules have been approved and deployed.
// This gate is not a security boundary; the Firestore Rules are mandatory.
export const POSITION_SURVEY_ENABLED=false;
let unsubscribe=()=>{};
export function renderPositionSurvey(db,auth) {
    unsubscribe();
    const en=(()=>{try{return localStorage.getItem('bp_lang')==='en';}catch{return false;}})(),t=(ko,eng)=>en?eng:ko;
    document.body.className='match-page';document.documentElement.lang=en?'en':'ko';
    document.title=t('희망 포지션 · BareaPlay','Position preferences · BareaPlay');
    document.body.innerHTML=`<main class="match-shell preference-shell"><a class="match-back" href="/?vote=current">← ${t('참석 신청으로','Back to RSVP')}</a><section class="coach-card"><p class="coach-eyebrow">MY FOOTBALL ROLE</p><h1>${t('내가 뛰고 싶은 자리','Where I want to play')}</h1><p>${t('희망은 배정 보장이 아닙니다. 키퍼·심판·휴식 순번은 별도로 적용됩니다.','Preferences are not a guarantee. GK, referee and rest duties are assigned separately.')}</p><div id="preference-body"></div></section></main>`;
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
            body.innerHTML=`<p class="coach-note">${t('본인과 감독만 응답을 볼 수 있습니다. Google 계정 이름은 팀의 본명을 자동 보증하지 않습니다.','Only you and the coach can read your response. A Google profile name does not verify your team identity.')}</p><button id="preference-signout">${t('다른 Google 계정 사용','Use a different Google account')}</button><label>${t('팀에 등록된 본명','Your registered team name')}<select id="preference-name" ${existing?'disabled':''}><option value="">${t('본명을 선택하세요','Choose your name')}</option>${names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label><p class="coach-note">${t('명단에 없거나 이름을 잘못 등록했다면 감독에게 문의하세요. 다른 사람 이름으로 제출하지 마세요.','Contact the coach if your name is missing or incorrect. Do not submit under someone else’s name.')}</p><div class="preference-ranks"><button data-rank="first"></button><button data-rank="second"></button><button id="preference-same">${t('2지망도 같은 자리','Same second choice')}</button></div><p class="coach-note">${t('선택할 지망을 누른 뒤 경기장 위치를 누르세요. 같은 자리 두 번 선택은 강한 선호이며 두 표로 계산하지 않습니다.','Choose first or second preference, then tap the pitch. Identical choices express a strong preference, not two votes.')}</p><div class="preference-pitch" aria-label="${t('공격 방향은 위쪽','Attack towards the top')}"><span class="preference-direction">↑ ${t('공격 방향','ATTACK')}</span>${POSITIONS.map(([code,ko,eng,x,y])=>`<button type="button" data-position="${code}" style="left:${x}%;top:${y}%" aria-label="${esc(en?eng:ko)}"><b>${code}</b><span>${esc(en?eng:ko)}</span></button>`).join('')}</div><label class="preference-check"><input type="checkbox" id="preference-stable" ${existing?.stable?'checked':''}>${t('8주 동안 같은 필드 역할을 꾸준히 배우고 싶어요','I would like a stable field role during the eight-week trial')}</label><label class="preference-check"><input type="checkbox" id="preference-flexible" ${existing?.flexible?'checked':''}>${t('팀 상황에 맞춰 다른 역할도 배워볼 수 있어요','I am willing to learn other roles when the team needs it')}</label><label>${t('감독에게 전할 말 · 선택','Optional note to the coach')}<textarea id="preference-note" maxlength="500" rows="3">${esc(existing?.note||'')}</textarea></label><button class="coach-primary" id="preference-save">${t('내 희망 저장','Save my preferences')}</button><p id="preference-message" role="status"></p>`;
            const nameInput=body.querySelector('#preference-name');if(existing)nameInput.value=existing.name;
            const message=body.querySelector('#preference-message');
            const draw=()=>{
                for(const rank of ['first','second']){const code=rank==='first'?first:second,p=POSITIONS.find(p=>p[0]===code),button=body.querySelector(`[data-rank="${rank}"]`);button.textContent=`${rank==='first'?t('1지망','First'):t('2지망','Second')}: ${p?(en?p[2]:p[1]):t('선택','Select')}`;button.setAttribute('aria-pressed',String(rank===slot));}
                body.querySelectorAll('[data-position]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.position===(slot==='first'?first:second))));
                body.querySelector('#preference-save').disabled=saving||!nameInput.value||!first||!second;
            };
            body.querySelectorAll('[data-rank]').forEach(button=>button.onclick=()=>{slot=button.dataset.rank;draw();});
            body.querySelectorAll('[data-position]').forEach(button=>button.onclick=()=>{if(slot==='first'){first=button.dataset.position;if(!second)slot='second';}else second=button.dataset.position;draw();});
            body.querySelector('#preference-same').onclick=()=>{if(first)second=first;draw();};nameInput.onchange=draw;
            body.querySelector('#preference-signout').onclick=()=>signOut(auth).catch(()=>{message.textContent=t('로그아웃하지 못했습니다. 다시 시도해 주세요.','Could not sign out. Please retry.');});
            body.querySelector('#preference-save').onclick=async()=>{
                const value={name:nameInput.value,first,second,stable:body.querySelector('#preference-stable').checked,flexible:body.querySelector('#preference-flexible').checked,note:body.querySelector('#preference-note').value.trim()};
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
    const panel=document.createElement('section');panel.className='coach-card';panel.innerHTML='<h2>비공개 희망 포지션</h2><p class="coach-note">본인 희망과 감독의 기존 평가를 분리합니다. 아래 내용으로 선수 정보나 배정을 자동 변경하지 않습니다.</p><button id="preference-admin-load">응답·수요 보기</button><label><input id="preference-attending" type="checkbox">현재 팀 배정 참가자만 집계</label><div id="preference-admin-result"></div>';host.append(panel);
    let responses=[];
    const draw=()=>{
        const only=panel.querySelector('#preference-attending').checked;
        const attendees=only?(document.getElementById('attendees')?.value||'').split('\n').map(cleanName).filter(Boolean):null;
        const {rows,duplicates}=preferenceSummary(responses,attendees),out=panel.querySelector('#preference-admin-result');
        out.innerHTML=`<p>${responses.length}개 계정 응답${only?' · 현재 참가자만 집계':''}</p>${duplicates.length?`<p class="coach-error">같은 이름의 여러 계정 응답: ${duplicates.map(esc).join(', ')}. 확인 전 수요 집계에서 제외했습니다.</p>`:''}<div style="overflow:auto"><table class="coach-table"><tr><th>포지션</th><th>1지망</th><th>2지망만</th><th>두 지망 동일</th></tr>${rows.map(r=>`<tr><td>${r.ko}</td><td>${r.first.length} · ${r.first.map(esc).join(', ')}</td><td>${r.second.length} · ${r.second.map(esc).join(', ')}</td><td>${r.same.length}</td></tr>`).join('')}</table></div><details><summary>개별 응답</summary>${responses.filter(r=>!attendees||attendees.includes(r.name)).map(r=>`<p><b>${esc(r.name)}</b> · ${esc(r.first)} / ${esc(r.second)} · 8주 역할 유지 ${r.stable?'희망':'미선택'} · 다른 역할 학습 ${r.flexible?'가능':'미선택'}<br>${esc(r.note)}</p>`).join('')}</details>`;
    };
    panel.querySelector('#preference-admin-load').onclick=async()=>{
        const out=panel.querySelector('#preference-admin-result');
        if(!state.isAdmin)return;
        if(!POSITION_SURVEY_ENABLED){out.textContent='감독 전용 접근 권한 배포 전입니다. 설문은 아직 열리지 않았습니다.';return;}
        try{const snap=await getDocs(collection(db,'privatePositionPreferences'));responses=snap.docs.map(d=>d.data());draw();}catch{out.textContent='전체 응답은 지정된 감독 계정만 조회할 수 있습니다. 접근 권한을 확인해 주세요.';}
    };
    panel.querySelector('#preference-attending').onchange=()=>{if(responses.length)draw();};
}
