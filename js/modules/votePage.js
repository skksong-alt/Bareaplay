import { doc, getDoc, getDocs, collection, query, where, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
import { cleanName, escapeHtml as esc, chooseReviewDate } from './coachCore.js?v=1';
import { lessonHtml, addCoachStyles } from './weeklyContent.js?v=4';
import { compareResponseTime, confirmGuest } from './voteOrder.js?v=1';
import { POSITION_SURVEY_ENABLED } from './positionPreferences.js?v=1';
let dispose = () => {};
const readLang = () => { try { return localStorage.getItem('bp_lang') === 'en' ? 'en' : 'ko'; } catch { return 'ko'; } };
const dubaiToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const safeMapUrl = value => { try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const isPublished = share => {
    const teams=Object.values(share.teams || {}),lineups=Object.values(share.lineups || {});
    return teams.length>0 && teams.length===lineups.length && lineups.every(team=>{
        const quarters=Object.values(team.lineups || {});
        return quarters.length===6 && quarters.every(q=>Object.values(q || {}).some(names=>Array.isArray(names)&&names.some(Boolean)));
    });
};
export async function renderVote(db, voteId) {
    dispose(); let alive = true; const cleanups = []; dispose = () => { alive=false; cleanups.forEach(fn=>fn()); };
    let lang = readLang(), en = lang === 'en';
    const t = (ko, english) => en ? english : ko;
    addCoachStyles();
    document.documentElement.lang = lang;
    document.body.className = 'match-page';
    document.title = t('Barea 참석 투표','Barea Match RSVP');
    document.body.innerHTML = `<main class="match-shell"><header class="match-header"><div class="match-brand"><span class="match-crest" aria-hidden="true">B</span><div><strong>BareaPlay</strong><small>DUBAI · FOOTBALL CLUB</small></div></div><button id="v-lang" class="language-button" aria-label="${t('Switch to English','한국어로 전환')}">${en?'한국어':'English'}</button></header><div id="v-content">${t('불러오는 중…','Loading…')}</div><footer class="match-footer"><span>BAREA PLAY. TOGETHER.</span><span>${t('함께 뛰고, 함께 성장하는 팀','A TEAM THAT GROWS TOGETHER')}</span></footer></main>`;
    const draftKey=`bp_vote_draft:${voteId}`;
    const rememberName=()=>{try{const input=document.getElementById('v-name');if(input)sessionStorage.setItem(draftKey,input.value);}catch{/* optional */}};
    const navigate=(href)=>{rememberName();history.pushState(null,'',href);renderVote(db,voteId);window.scrollTo(0,0);};
    const back=()=>renderVote(db,voteId);window.addEventListener('popstate',back);cleanups.push(()=>window.removeEventListener('popstate',back));
    document.getElementById('v-lang').onclick = () => {
        rememberName();
        try { localStorage.setItem('bp_lang', en?'ko':'en'); } catch { /* optional preference */ }
        renderVote(db,voteId);
    };
    const content = document.getElementById('v-content');
    try {
        const vs = voteId ? await getDoc(doc(db,'votes',voteId)) : null;
        if (!alive) return;
        if (!vs?.exists()) { content.textContent=t('진행 중인 투표가 없습니다.','No active RSVP yet.'); return; }
        let vote = vs.data();
        const requestedReview=new URLSearchParams(location.search).get('review');
        if(requestedReview) {
            document.title=t('지난 경기 활약투표 · BareaPlay','Match appreciation · BareaPlay');
            const returnUrl=`/?voteId=${encodeURIComponent(voteId)}`;
            const backLink=`<a class="match-back" href="${returnUrl}" data-review-back>← ${t('참석 신청으로 돌아가기','Back to match RSVP')}</a>`;
            content.innerHTML=`<div class="match-review-screen">${backLink}<div id="v-review">${t('지난 경기를 확인하고 있습니다…','Loading the previous match…')}</div>${backLink}</div>`;
            content.querySelectorAll('[data-review-back]').forEach(a=>a.onclick=e=>{e.preventDefault();navigate(returnUrl);});
            if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedReview) || requestedReview>=vote.date || requestedReview>=dubaiToday()) {
                document.getElementById('v-review').textContent=t('평가할 수 있는 지난 경기 날짜가 아닙니다.','This is not a valid previous match date.');return;
            }
            const meeting=await getDoc(doc(db,'dailyMeetings',requestedReview));
            if(!alive)return;
            const roster=meeting.exists()?[...new Set(Object.values(meeting.data().teams||{}).flat().map(p=>cleanName(p.name)).filter(Boolean))]:[];
            if(roster.length<4){document.getElementById('v-review').textContent=t('이 경기의 참가 명단을 확인할 수 없습니다.','The roster for this match is unavailable.');return;}
            cleanups.push(mountRatings(db,document.getElementById('v-review'),requestedReview,roster,lang));return;
        }
        const players = await getDocs(collection(db,'players'));
        if (!alive) return;
        const names = players.docs.map(d=>cleanName(d.data().name)).filter(Boolean).sort((a,b)=>a.localeCompare(b));
        content.innerHTML = `<div class="match-intro"><div><p class="match-kicker">MATCH DAY / BAREA</p><h1>${esc(vote.title || t('함께 뛸 준비, 되셨나요?','Ready for the next match?'))}</h1><p>${t('참석을 알려주세요. 경기 준비는 여기서 함께합니다.','Let us know you’re coming. Everything for match day, in one place.')}</p></div><span class="match-round">${esc(vote.date || '')}</span></div>
          <div class="match-layout"><section class="coach-card match-rsvp"><div class="match-card-heading"><h2>${t('참석 신청 · 모임정보','RSVP & match details')}</h2><span class="match-section-number">01</span></div>
          <div class="match-info"><p><strong>${esc(vote.date || '')}</strong> &nbsp; ${esc(vote.time || '')}</p><p class="match-timezone">DUBAI · UTC+4</p><div class="match-location"><span>${esc(vote.location || t('장소 미정','Venue to be confirmed'))}</span><span id="v-map"></span></div><div id="v-board"><span class="lineup-link">${t('팀·라인업','Teams & lineups')}<span class="lineup-state">${t('확인 중','Checking')}</span></span></div></div>
          <div class="match-name-row"><label for="v-name">${t('참가할 사람의 이름','Participant’s name')}</label><span id="v-review-entry"></span></div><input id="v-name" list="v-players" autocomplete="off" maxlength="100" aria-describedby="v-name-help" placeholder="${t('선수 선택 또는 게스트 이름','Select a player or enter a guest name')}"><datalist id="v-players">${names.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
          <p class="coach-note" id="v-name-help">${t('로그인 없이 신청할 수 있어요. 지인 대신 신청할 때는 지인의 이름을, 기존 선수는 명단의 이름을 선택해 주세요.','No login needed. Registering a friend? Use their name. Existing players: please select your name from the list.')}</p>
          <div class="coach-grid"><button data-status="attend" class="coach-primary">${t('참석','Going')}</button><button data-status="maybe">${t('미정','Maybe')}</button><button data-status="absent">${t('불참','Not going')}</button></div><p id="v-msg" class="coach-status" role="status"></p><p id="v-deadline" class="match-deadline"></p></section>
          <section class="coach-card match-attendance"><div class="match-card-heading"><h2>${t('참석 현황','Who’s playing')}</h2><span class="match-live" id="v-live">${t('연결 중','Connecting')}</span></div><div id="v-list" aria-label="${t('참석자 명단','RSVP list')}"></div></section>
          <div id="v-lesson" class="match-resources">${lessonHtml(vote.date,{},lang)}</div></div>`;
        const input = document.getElementById('v-name'), message = document.getElementById('v-msg');
        if(POSITION_SURVEY_ENABLED)document.getElementById('v-name-help').insertAdjacentHTML('afterend',`<a class="coach-link" href="/?preferences=1">${t('내 희망 포지션 · 감독에게 비공개 제출','My position preferences · private to the coach')} ↗</a>`);
        try { input.value=sessionStorage.getItem(draftKey) || ''; } catch { /* optional */ }
        input.addEventListener('input',rememberName);
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
            if(!confirmGuest(name,names,lang)){message.textContent=t('이름을 확인해 주세요. 아직 저장하지 않았습니다.','Please check your name. Nothing has been saved.');input.focus();return;}
            saving=true; input.disabled=true; deadline();
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
            finally { saving=false; input.disabled=false; deadline(); }
        });
        cleanups.push(onSnapshot(collection(db,'votes',voteId,'responses'),snap=>{
            if(!alive) return;
            const all=snap.docs.map(d=>d.data());
            const groups=[['attend',t('참석','Going')],['wait',t('대기','Waitlist')],['maybe',t('미정','Maybe')],['absent',t('불참','Not going')]];
            const grouped=groups.map(([status,label])=>{
                const list=all.filter(r=>status==='wait'?r.status==='attend'&&r.waitlist:r.status===status && (status!=='attend'||!r.waitlist)).sort(compareResponseTime);
                return {status,label,list};
            });
            const roster=({status,label,list})=>`<section class="attendance-group ${status}"><h3>${label}<span>${list.length}</span></h3>${list.length?`<ol>${list.map(r=>`<li><span class="roster-name">${esc(r.name)}</span>${r.guest?`<small aria-label="${t('게스트','Guest')}">GUEST</small>`:''}</li>`).join('')}</ol>`:`<p class="attendance-empty">${t('아직 없어요','None yet')}</p>`}</section>`;
            document.getElementById('v-list').innerHTML=`<div class="attendance-stats">${grouped.filter(g=>g.status!=='wait').map(g=>`<div class="attendance-stat ${g.status}"><strong>${g.list.length}</strong><span>${g.label}</span>${g.status==='attend'&&grouped[1].list.length?`<small class="waitlist-count">${t('대기 '+grouped[1].list.length+'명',grouped[1].list.length+' waitlisted')}</small>`:''}</div>`).join('')}</div><div class="attendance-roster"><div>${roster(grouped[0])}${grouped[1].list.length?roster(grouped[1]):''}</div><div class="attendance-side">${roster(grouped[2])}${roster(grouped[3])}</div></div><p class="attendance-footnote">${t('심판은 전체, 키퍼·휴식은 팀별 늦은 참석 신청순으로 순환합니다. 전담 GK는 예외입니다.','Referees rotate by latest RSVP across all teams; GK/rest rotate within each team. Dedicated goalkeepers are exempt.')}</p>`;
            document.getElementById('v-live').textContent=t('실시간','Live');
        },()=>{ if(alive) { document.getElementById('v-list').textContent=t('명단을 불러오지 못했습니다.','Could not load the list.');document.getElementById('v-live').textContent=t('연결 확인 필요','Connection unavailable'); } }));
        // Independent enhancements must never prevent attendance submission.
        const extras = async () => {
            let weekly={};
            try { const w=await getDoc(doc(db,'coachWeeks',vote.date)); if(w.exists()) weekly=w.data(); } catch { /* use built-in lesson */ }
            if(!alive) return;
            document.getElementById('v-lesson').innerHTML=lessonHtml(vote.date,weekly,lang);
            let savedMap='';
            try {
                // Exact existing time + venue, not the global latest meeting from another week.
                const published=await getDocs(query(collection(db,'shares'),where('meetingInfo.time','==',`${vote.date} ${vote.time || ''}`)));
                if(!alive)return;
                const matches=published.docs.filter(d=>String(d.data().meetingInfo?.location || '')===String(vote.location || '') && isPublished(d.data())).sort((a,b)=>String(b.data().createdAt || '').localeCompare(String(a.data().createdAt || '')));
                const share=matches[0];
                document.getElementById('v-board').innerHTML=share?`<a class="lineup-link" href="/share.html?shareId=${encodeURIComponent(share.id)}">${t('팀·라인업 보기','View teams & lineups')}<span class="lineup-state">${t('배정 완료','Published')} ↗</span></a>`:`<span class="lineup-link">${t('팀·라인업','Teams & lineups')}<span class="lineup-state">${t('배정 전','Not published')}</span></span>`;
                savedMap=share?.data().meetingInfo?.locationUrl;
            } catch { if(alive)document.getElementById('v-board').innerHTML=`<span class="lineup-link">${t('팀·라인업','Teams & lineups')}<span class="lineup-state">${t('확인 불가 · 새로고침','Unavailable · reload')}</span></span>`; }
            try {
                const locations=savedMap?null:await getDocs(collection(db,'locations'));
                if(!alive)return;
                const url=safeMapUrl(savedMap || locations?.docs.find(d=>d.data().name===vote.location)?.data().url);
                if(url)document.getElementById('v-map').innerHTML=`<a class="match-map-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t('지도 보기','View map')} ↗</a>`;
            } catch { /* A missing map must not hide a valid published lineup. */ }
            try {
                const records=await getDocs(collection(db,'dailyMeetings'));
                const meetings=records.docs.map(d=>({...d.data(),date:d.data().date || d.id}));
                const date=chooseReviewDate(meetings,vote.date,weekly.reviewDate,dubaiToday());
                if(!alive || !date) return;
                const meeting=meetings.find(m=>m.date===date);
                const roster=[...new Set(Object.values(meeting.teams || {}).flat().map(p=>cleanName(p.name)).filter(Boolean))];
                if(roster.length<4) return;
                const href=`/?voteId=${encodeURIComponent(voteId)}&review=${encodeURIComponent(date)}`;
                document.getElementById('v-review-entry').innerHTML=`<a class="match-review-link" href="${href}">${t('지난 경기 활약투표','Previous match appreciation')} ↗</a>`;
                document.querySelector('.match-review-link').onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(href);};
            } catch { /* Optional review must not distract from RSVP. */ }
        }; extras();
    } catch { if(alive) content.textContent=t('불러오지 못했습니다. 새로고침해 주세요.','Could not load. Please reload.'); }
}
export function mountRatings(db, container, date, names, lang) {
    const en=lang==='en', t=(ko,english)=>en?english:ko;
    let picks=[], mine='', saving=false;
    container.innerHTML=`<section class="coach-card"><h2>${t('지난 경기 활약 투표','Previous match appreciation')} · ${esc(date)}</h2><p class="coach-note">${t('지난 경기에 참여했다면 인상 깊었던 3명을 순서대로 선택하세요. 수비·도움·동료 지원도 생각해 주세요. 이번 참석 신청과 별개이며 건너뛰어도 됩니다.','If you played that match, pick three teammates in order. Remember defending, effort and support too. This is optional and separate from your RSVP.')}</p><div class="review-video"><a id="review-match-video" href="https://www.youtube.com/@FC%EB%B0%94%EB%A0%88%EC%95%84" target="_blank" rel="noopener noreferrer">▷ ${t('지난 경기 영상','Previous match footage')} ↗</a><p>${t('팀 유튜브 채널에서 위 경기 날짜의 영상을 확인해 보세요. 새 탭에서 열립니다.','Find the match date above on our team’s YouTube channel. Opens in a new tab.')}</p></div><label>${t('지난 경기 참가자 본인 이름','Your name from that match')}<select id="review-name"><option value="">${t('선택','Select')}</option>${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><div id="review-picks"></div><button id="review-save" class="coach-primary" disabled>${t('투표 저장','Save vote')}</button><p id="review-msg" role="status"></p><div id="review-result"></div></section>`;
    const select=container.querySelector('#review-name'), save=container.querySelector('#review-save'), msg=container.querySelector('#review-msg');
    const draw=()=>{
        container.querySelector('#review-picks').innerHTML=mine?names.filter(n=>n!==mine).map(n=>`<button data-player="${esc(n)}" class="${picks.includes(n)?'coach-selected':''}" ${saving?'disabled':''}>${esc(n)} ${picks.includes(n)?`(${3-picks.indexOf(n)}${en?' pts':'점'})`:''}</button>`).join(''):'';
        save.disabled=!mine || picks.length!==3 || saving;
        container.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{const n=b.dataset.player; if(picks.includes(n)) picks=picks.filter(p=>p!==n); else if(picks.length<3) picks.push(n); draw();});
    };
    // A selected name is not proof of identity. Never retrieve an existing ballot here.
    select.onchange=()=>{mine=select.value; picks=[]; msg.textContent='';draw();};
    save.onclick=async()=>{
        if(saving || !names.includes(mine) || picks.length!==3 || new Set(picks).size!==3) return;
        saving=true; select.disabled=true;draw();
        try {
            await setDoc(doc(db,'ratings',date),{date,votes:{[mine]:{picks:[...picks],at:Date.now()}}},{merge:true});
            picks=[]; mine=''; select.value='';
            msg.textContent=t('저장되었습니다. 선택 내용은 화면에서 지웠습니다. 다시 제출하려면 본인 이름과 3명을 새로 선택해 주세요.','Saved. Your selections have been cleared from this screen. To submit again, select your own name and three teammates afresh.');
        }
        catch { msg.textContent=t('저장 실패. 다시 시도하세요.','Could not save. Please retry.'); }
        finally {saving=false;select.disabled=false;draw();}
    };
    // UI mitigation only: server Rules must also restrict raw ratings reads.
    // Even a live aggregate can reveal a ballot through before/after score differences.
    container.querySelector('#review-result').textContent=t('이 화면에서는 이전 선택과 실시간 집계를 표시하지 않습니다. 본인 이름으로만 투표해 주세요.','Previous selections and live totals are not displayed here. Please vote only under your own name.');
    draw();
    return ()=>{};
}
