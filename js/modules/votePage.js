import { doc, getDoc, getDocs, collection, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { cleanName, escapeHtml as esc, chooseReviewDate } from './coachCore.js?v=1';
import { lessonHtml, addCoachStyles } from './weeklyContent.js?v=1';
let dispose = () => {};
const readLang = () => { try { return localStorage.getItem('bp_lang') === 'en' ? 'en' : 'ko'; } catch { return 'ko'; } };
const dubaiToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function renderVote(db, voteId) {
    dispose(); let alive = true; const cleanups = []; dispose = () => { alive=false; cleanups.forEach(fn=>fn()); };
    let lang = readLang(), en = lang === 'en';
    const t = (ko, english) => en ? english : ko;
    addCoachStyles();
    document.documentElement.lang = lang;
    document.body.className = 'bg-gray-100';
    document.title = t('Barea 참석 투표','Barea Match RSVP');
    document.body.innerHTML = `<main class="coach-wrap"><button id="v-lang" class="coach-button">${en?'한국어':'English'}</button><h1 style="font-size:1.8rem;font-weight:800">BareaPlay ⚽</h1><div id="v-content" aria-live="polite">${t('불러오는 중…','Loading…')}</div></main>`;
    document.getElementById('v-lang').onclick = () => {
        const name = document.getElementById('v-name')?.value || '';
        try { localStorage.setItem('bp_lang', en?'ko':'en'); sessionStorage.setItem('bp_vote_draft',name); } catch { /* optional preference */ }
        renderVote(db,voteId);
    };
    const content = document.getElementById('v-content');
    try {
        const vs = voteId ? await getDoc(doc(db,'votes',voteId)) : null;
        if (!alive) return;
        if (!vs?.exists()) { content.textContent=t('진행 중인 투표가 없습니다.','No active RSVP yet.'); return; }
        let vote = vs.data();
        const players = await getDocs(collection(db,'players'));
        if (!alive) return;
        const names = players.docs.map(d=>cleanName(d.data().name)).filter(Boolean).sort((a,b)=>a.localeCompare(b));
        content.innerHTML = `<section class="coach-card"><h2>${esc(vote.title || t('이번 경기 참석','Next match RSVP'))}</h2><p>${esc([vote.date,vote.time,vote.location].filter(Boolean).join(' · '))}</p><p class="coach-note">${t('경기 시간 기준: 두바이 (UTC+4)','Match time: Dubai (UTC+4)')}</p><p id="v-deadline"></p>
          <label for="v-name">${t('참가할 사람의 이름','Participant’s name')}</label><input id="v-name" list="v-players" autocomplete="off" maxlength="100" placeholder="${t('명단에서 선택하거나 게스트 이름 입력','Select a name or enter a guest name')}"><datalist id="v-players">${names.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
          <p class="coach-note">${t('로그인 없이 신청할 수 있습니다. 지인 대신 신청할 때는 지인의 이름을 입력하세요. 기존 선수는 명단의 이름을 그대로 선택하세요.','No login needed. To register a friend, enter their name. Registered players should select their existing name.')}</p>
          <div class="coach-grid"><button data-status="attend" class="coach-primary">${t('참석','Going')}</button><button data-status="maybe">${t('미정','Maybe')}</button><button data-status="absent">${t('불참','Not going')}</button></div><p id="v-msg" class="coach-status" role="status"></p></section>
          <div id="v-review"></div><div id="v-lesson">${lessonHtml(vote.date,{},lang)}</div><div id="v-board"></div>
          <section class="coach-card"><h2>${t('참석 현황','RSVP list')}</h2><div id="v-list"></div></section>`;
        const input = document.getElementById('v-name'), message = document.getElementById('v-msg');
        try { input.value=sessionStorage.getItem('bp_vote_draft') || ''; sessionStorage.removeItem('bp_vote_draft'); } catch { /* optional */ }
        let saving=false;
        const deadline = () => {
            if (!alive) return;
            const after = vote.deadlineMs && Date.now()>vote.deadlineMs;
            document.getElementById('v-deadline').textContent = vote.closed ? t('종료된 투표입니다. 변경은 운영진에게 문의하세요.','RSVP closed. Contact the organiser for changes.') : after ? t('마감 후 신규 참석 신청은 대기자로 등록됩니다.','New registrations after the deadline join the waitlist.') : vote.deadlineMs ? t('마감: ','Deadline: ') + new Intl.DateTimeFormat(en?'en-GB':'ko-KR',{timeZone:'Asia/Dubai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(vote.deadlineMs)) : '';
            content.querySelectorAll('[data-status]').forEach(b=>b.disabled=!!vote.closed || saving);
        };
        const timer=setInterval(deadline,30000); cleanups.push(()=>clearInterval(timer)); deadline();
        cleanups.push(onSnapshot(doc(db,'votes',voteId),snap=>{ if (!alive) return; if(snap.exists()) vote=snap.data(); else vote.closed=true; deadline(); },()=>{message.textContent=t('투표 상태 갱신 실패. 새로고침해 주세요.','Could not refresh RSVP status. Reload the page.');}));
        content.querySelectorAll('[data-status]').forEach(button=>button.onclick=async()=>{
            if(saving) return;
            const name=cleanName(input.value), status=button.dataset.status;
            if(!name || name.includes('/') || name==='.' || name==='..') { message.textContent=t('올바른 이름을 입력하세요.','Enter a valid name.'); return; }
            saving=true; deadline();
            try {
                const latest=await getDoc(doc(db,'votes',voteId));
                if(!latest.exists() || latest.data().closed) throw new Error('closed');
                vote=latest.data();
                const ref=doc(db,'votes',voteId,'responses',name), old=await getDoc(ref), previous=old.exists()?old.data():null;
                const payload={name,status,guest:!names.includes(name),updatedAt:serverTimestamp()};
                if(status==='attend') {
                    if(previous?.status==='attend' && previous.attendingSince) payload.waitlist=!!previous.waitlist;
                    else { payload.attendingSince=serverTimestamp(); payload.waitlist=!!(vote.deadlineMs && Date.now()>vote.deadlineMs); }
                } else payload.waitlist=false;
                if(!previous) payload.createdAt=serverTimestamp();
                await setDoc(ref,payload,{merge:true});
                message.textContent=`${name}: `+(payload.waitlist?t('대기 신청 완료','Added to waitlist'):t('신청이 저장되었습니다. 다시 선택하면 변경됩니다.','RSVP saved. Select again to update.'));
            } catch(e) { message.textContent=e.message==='closed'?t('투표가 종료되었습니다.','RSVP has closed.'):t('저장 실패. 다시 시도하세요.','Could not save. Please try again.'); }
            finally { saving=false; deadline(); }
        });
        cleanups.push(onSnapshot(collection(db,'votes',voteId,'responses'),snap=>{
            if(!alive) return;
            const all=snap.docs.map(d=>d.data());
            const groups=[['attend',t('참석','Going')],['wait',t('대기','Waitlist')],['maybe',t('미정','Maybe')],['absent',t('불참','Not going')]];
            document.getElementById('v-list').innerHTML=groups.map(([status,label])=>{
                const list=all.filter(r=>status==='wait'?r.status==='attend'&&r.waitlist:r.status===status && (status!=='attend'||!r.waitlist)).sort((a,b)=>(a.attendingSince?.seconds ?? Infinity)-(b.attendingSince?.seconds ?? Infinity));
                return `<details ${status==='attend'?'open':''}><summary>${label} · ${list.length}</summary><p>${list.map(r=>esc(r.name)+(r.guest?' (G)':'')).join(' · ') || '—'}</p></details>`;
            }).join('');
        },()=>{ if(alive) document.getElementById('v-list').textContent=t('명단을 불러오지 못했습니다.','Could not load the list.'); }));
        // Independent enhancements must never prevent attendance submission.
        const extras = async () => {
            let weekly={};
            try { const w=await getDoc(doc(db,'coachWeeks',vote.date)); if(w.exists()) weekly=w.data(); } catch { /* use built-in lesson */ }
            if(!alive) return;
            document.getElementById('v-lesson').innerHTML=lessonHtml(vote.date,weekly,lang);
            try {
                const active=await getDoc(doc(db,'settings','activeMeeting'));
                if(active.exists() && active.data().shareId) {
                    const share=await getDoc(doc(db,'shares',active.data().shareId));
                    if(alive && share.exists() && String(share.data().meetingInfo?.time || '').slice(0,10)===vote.date) document.getElementById('v-board').innerHTML=`<a class="coach-button" href="/share.html?shareId=${encodeURIComponent(active.data().shareId)}">${t('확정 팀·라인업 보기','View match teams and lineups')}</a>`;
                }
            } catch { /* optional board */ }
            try {
                const records=await getDocs(collection(db,'dailyMeetings'));
                const meetings=records.docs.map(d=>({...d.data(),date:d.data().date || d.id}));
                const date=chooseReviewDate(meetings,vote.date,weekly.reviewDate,dubaiToday());
                if(!alive || !date) return;
                const meeting=meetings.find(m=>m.date===date);
                const roster=[...new Set(Object.values(meeting.teams || {}).flat().map(p=>cleanName(p.name)).filter(Boolean))];
                if(roster.length<4) return;
                const cleanup=mountRatings(db,document.getElementById('v-review'),date,roster,lang);
                cleanups.push(cleanup);
            } catch { if(alive) document.getElementById('v-review').innerHTML=`<p class="coach-note">${t('지난 경기 투표를 불러오지 못했습니다. 참석 신청은 가능합니다.','Previous match voting is unavailable. You can still RSVP.')}</p>`; }
        }; extras();
    } catch { if(alive) content.textContent=t('불러오지 못했습니다. 새로고침해 주세요.','Could not load. Please reload.'); }
}
export function mountRatings(db, container, date, names, lang) {
    const en=lang==='en', t=(ko,english)=>en?english:ko;
    let votes={}, picks=[], mine='', saving=false, loaded=false;
    container.innerHTML=`<section class="coach-card"><h2>${t('지난 경기 활약 투표','Previous match appreciation')} · ${esc(date)}</h2><p class="coach-note">${t('지난 경기에 참여했다면 인상 깊었던 3명을 순서대로 선택하세요. 수비·도움·동료 지원도 생각해 주세요. 이번 참석 신청과 별개이며 건너뛰어도 됩니다.','If you played that match, pick three teammates in order. Remember defending, effort and support too. This is optional and separate from your RSVP.')}</p><label>${t('지난 경기 참가자 본인 이름','Your name from that match')}<select id="review-name"><option value="">${t('선택','Select')}</option>${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><div id="review-picks"></div><button id="review-save" class="coach-primary" disabled>${t('투표 저장','Save vote')}</button><p id="review-msg" role="status"></p><div id="review-result"></div></section>`;
    const select=container.querySelector('#review-name'), save=container.querySelector('#review-save'), msg=container.querySelector('#review-msg');
    const draw=()=>{
        container.querySelector('#review-picks').innerHTML=mine?names.filter(n=>n!==mine).map(n=>`<button data-player="${esc(n)}" class="${picks.includes(n)?'coach-selected':''}" ${saving?'disabled':''}>${esc(n)} ${picks.includes(n)?`(${3-picks.indexOf(n)}${en?' pts':'점'})`:''}</button>`).join(''):'';
        save.disabled=!loaded || !mine || picks.length!==3 || saving;
        container.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{const n=b.dataset.player; if(picks.includes(n)) picks=picks.filter(p=>p!==n); else if(picks.length<3) picks.push(n); draw();});
    };
    select.onchange=()=>{mine=select.value; picks=(votes[mine]?.picks || []).filter(n=>names.includes(n)&&n!==mine).slice(0,3); msg.textContent='';draw();};
    save.onclick=async()=>{
        if(!loaded || saving || !names.includes(mine) || picks.length!==3 || new Set(picks).size!==3) return;
        saving=true; select.disabled=true;draw();
        try { await setDoc(doc(db,'ratings',date),{date,votes:{[mine]:{picks:[...picks],at:Date.now()}}},{merge:true}); msg.textContent=t('저장되었습니다. 다시 제출하면 본인 표만 수정됩니다.','Saved. Submitting again updates your own vote.'); }
        catch { msg.textContent=t('저장 실패. 다시 시도하세요.','Could not save. Please retry.'); }
        finally {saving=false;select.disabled=false;draw();}
    };
    return onSnapshot(doc(db,'ratings',date),snap=>{
        loaded=true;
        votes=snap.exists()?snap.data().votes || {}:{};
        const totals={};Object.values(votes).forEach(v=>(v.picks || []).slice(0,3).forEach((n,i)=>{if(names.includes(n))totals[n]=(totals[n]||0)+3-i;}));
        container.querySelector('#review-result').innerHTML=`<details><summary>${t('집계 보기','View tally')} (${Object.keys(votes).length})</summary><p>${Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`${esc(n)}: ${v}`).join(' · ') || '—'}</p></details>`;
        draw();
    },()=>{loaded=false;msg.textContent=t('기존 표를 불러오지 못했습니다. 새로고침하세요.','Could not load existing votes. Reload to retry.');save.disabled=true;});
}
