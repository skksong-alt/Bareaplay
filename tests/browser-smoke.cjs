// Completely isolated browser checks: every remote request is mocked or blocked.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const players=Object.fromEntries(Array.from({length:24},(_,i)=>{const name=`Test ${String(i+1).padStart(2,'0')}`;return [`players/${name}`,{name,pos1:[['GK','CB','CM','FW'][i%4]],s1:60+i%10,pos2:['CB','CM'],s2:55,wishPos:['FW'],wishQuota:1}];}));
const today=new Date().toISOString().slice(0,10), next='2099-01-01', past='2026-08-01';
const names=Object.values(players).map(p=>p.name);
const mkLineup=ns=>({members:ns,formations:Array(6).fill('4-4-2'),lineups:Array.from({length:6},()=>({GK:[ns[0]],RB:[ns[1]],CB:[ns[2],ns[3]],LB:[ns[4]],RW:[ns[5]],CM:[ns[6],ns[7]],LW:[ns[8]],FW:[ns[9],ns[10]]})),resters:Object.fromEntries(Array.from({length:6},(_,q)=>[`q_${q}`,[ns[11]]])),referees:Object.fromEntries(Array.from({length:6},(_,q)=>[`q_${q}`,ns[11]]))});
const meeting={date:today,teams:{team_0:names.slice(0,12).map(name=>players[`players/${name}`]),team_1:names.slice(12).map(name=>players[`players/${name}`])},teamLineupCache:{0:mkLineup(names.slice(0,12)),1:mkLineup(names.slice(12))},initialAttendeeOrder:names};
const data={...players,'admins/test-admin':{},'settings/activeVote':{voteId:'test-vote'},'votes/test-vote':{date:today,time:'20:00',location:'Test pitch',closed:false,deadlineMs:4070900000000},[`dailyMeetings/${today}`]:meeting,[`dailyMeetings/${past}`]:{...meeting,date:past},[`ratings/${past}`]:{date:past,votes:{'Test 02':{picks:['Test 01','Test 03','Test 04'],at:1}}},'votes/test-vote/responses/Test 01':{name:'Test 01',status:'attend',guest:false,waitlist:false,attendingSince:{seconds:10},paymentSentinel:'unchanged'},'attendance/legacy':{date:past,name:'Test 01',paymentAmount:50,paymentStatus:'●'},'expenses/legacy':{date:past,amount:120,item:'pitch'},'incomes/legacy':{date:past,amount:10,item:'donation'},'locations/test-ground':{name:'Test pitch',url:'https://maps.google.com/?q=test'}};
const firestore=`const data=globalThis.__fixture; const listeners=[];
export const getFirestore=()=>({}); export const doc=(_,...p)=>p.join('/'); export const collection=doc;
export const serverTimestamp=()=>({seconds:Date.now()/1000});
const ds=(p)=>({id:p.split('/').at(-1),exists:()=>p in data,data:()=>structuredClone(data[p]),metadata:{hasPendingWrites:false}});
const cs=p=>{const docs=Object.keys(data).filter(k=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1).map(ds);return {docs,forEach:fn=>docs.forEach(fn),empty:!docs.length,size:docs.length};};
export const where=(field,op,value)=>({field,op,value});export const query=(path,...filters)=>({path,filters});
export const getDoc=async p=>{globalThis.__reads.push(p);return ds(p);};export const getDocs=async p=>{globalThis.__reads.push(typeof p==='string'?p:p.path);if(globalThis.__failReads?.includes(typeof p==='string'?p:p.path))throw new Error('simulated read failure');if(typeof p==='string')return cs(p);const docs=cs(p.path).docs.filter(d=>p.filters.every(f=>f.op==='==' && f.field.split('.').reduce((v,k)=>v?.[k],d.data())===f.value));return{docs,empty:!docs.length};};
export const onSnapshot=(p,cb)=>{globalThis.__reads.push(p);const run=()=>cb(p.split('/').length%2===0?ds(p):cs(p));run.path=p;listeners.push(run);queueMicrotask(run);return ()=>{const i=listeners.indexOf(run);if(i>=0)listeners.splice(i,1);};};
const emit=p=>listeners.slice().filter(f=>f.path===p || (p.startsWith(f.path+'/') && p.split('/').length===f.path.split('/').length+1)).forEach(f=>f());
function merge(a,b){for(const [k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]||={};merge(a[k],v);}else a[k]=structuredClone(v);}return a;}
export const setDoc=async(p,v,o)=>{globalThis.__writes.push({path:p,value:structuredClone(v),merge:!!o?.merge});data[p]=o?.merge?merge(data[p]||{},v):structuredClone(v);emit(p);};
export const updateDoc=async(p,v)=>{globalThis.__writes.push({path:p,value:structuredClone(v),update:true});Object.assign(data[p],structuredClone(v));emit(p);};
export const addDoc=async(p,v)=>{const id='new-'+globalThis.__writes.length;await setDoc(p+'/'+id,v);return{id};};
export const deleteDoc=async()=>{throw new Error('DELETE FORBIDDEN IN TEST');};`;
let server,browser,enableSurveyForTest=false;
data['shares/test-share']={meetingInfo:{time:today+' 20:00',location:'Test pitch'},teams:meeting.teams,lineups:meeting.teamLineupCache,teamNames:['Test A','Test B']};
(async()=>{
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    try{const body=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.addInitScript(f=>{window.__fixture=f;window.__writes=[];window.__reads=[];window.Chart=class{destroy(){}update(){}};},data);
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(base)&&url.includes('/js/modules/positionPreferences.js')&&enableSurveyForTest) {
      const source=await readFile(path.join(root,'js/modules/positionPreferences.js'),'utf8');
      return route.fulfill({contentType:'text/javascript',body:source.replace('POSITION_SURVEY_ENABLED=false','POSITION_SURVEY_ENABLED=true')});
    }
    if(url.startsWith(base))return route.continue();
    if(url.includes('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:firestore});
    if(url.includes('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
    if(url.includes('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:'const auth={currentUser:{uid:"test-admin"}};const listeners=[];export const getAuth=()=>auth;export class GoogleAuthProvider{};export const onAuthStateChanged=(_,cb)=>{listeners.push(cb);queueMicrotask(()=>cb(auth.currentUser));return()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1);};};export const signInWithPopup=async()=>{auth.currentUser={uid:"test-admin"};listeners.forEach(cb=>cb(auth.currentUser));return {user:auth.currentUser};};export const signOut=async()=>{auth.currentUser=null;listeners.forEach(cb=>cb(null));};export const setPersistence=async()=>{};export const browserLocalPersistence={};'});
    // Local CSS equivalent for visibility; no CDN or Firebase request leaves this context.
    if(url.includes('tailwindcss'))return route.fulfill({contentType:'text/javascript',body:'const s=document.createElement("style");s.textContent=".hidden{display:none!important}.fixed{position:fixed}.grid{display:grid} .bg-gray-100{background:#f3f4f6}";document.head.append(s);'});
    return route.fulfill({status:200,body:''});
  });
  const page=await context.newPage(), errors=[];let cancelGuest=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>cancelGuest&&/Guest|guest/.test(d.message())?d.dismiss():d.accept());
  await page.goto(base+'/?vote=current');await page.waitForSelector('.match-review-link');
  assert.equal(await page.locator('#review-name').count(),0,'ratings must have a separate screen');
  assert.equal(await page.locator('.preparation-card').getAttribute('open'),null,'resources start collapsed');
  assert.equal(await page.locator('.video-guideline a').count(),6);
  assert.equal(await page.locator('.attendance-stat').count(),3,'only going/maybe/absent summary cards');
  assert.equal(await page.locator('.attendance-stat.wait').count(),0);
  assert.equal(await page.locator('.waitlist-count').count(),0,'hide waiting badge when empty');
  assert.match(await page.locator('.attendance-footnote').textContent(),/심판은 전체, 키퍼·휴식은 팀별/);
  assert.doesNotMatch(await page.locator('.attendance-footnote').textContent(),/GUEST/);
  assert.equal(await page.locator('#v-board a').getAttribute('href'),'/share.html?shareId=test-share');
  await page.locator('#v-map a').waitFor();
  // Reads failing or a different venue must never look like a confirmed assignment.
  await page.evaluate(()=>{__failReads=['shares'];});await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  assert.match(await page.locator('#v-board').textContent(),/Unavailable/);
  await page.evaluate(()=>{__failReads=['locations'];});await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  assert.equal(await page.locator('#v-board a').count(),1,'map failure must not hide published lineup');
  await page.evaluate(()=>{__failReads=[];__fixture['shares/test-share'].meetingInfo.location='Different pitch';});
  await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  assert.match(await page.locator('#v-board').textContent(),/Not published/);
  await page.evaluate(()=>{__fixture['shares/test-share'].meetingInfo.location='Test pitch';});
  await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  assert.equal(await page.evaluate(()=>__writes.length),0,'page loads must not write');
  cancelGuest=true;await page.locator('#v-name').fill('Test typo');await page.locator('[data-status="attend"]').click();
  assert.equal(await page.evaluate(()=>__writes.length),0,'cancelled guest confirmation must not save a typo');cancelGuest=false;
  await page.locator('#v-name').fill('Guest Friend');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__writes.length===1);
  await page.locator('#v-lang').click();await page.getByText('Previous match appreciation',{exact:false}).waitFor();
  assert.equal(await page.locator('#v-name').inputValue(),'Guest Friend');
  await page.locator('.match-review-link').click();await page.waitForSelector('#review-name');
  assert.equal(await page.locator('#review-match-video').getAttribute('href'),'https://www.youtube.com/@FC%EB%B0%94%EB%A0%88%EC%95%84');
  assert.equal(await page.locator('#review-match-video').getAttribute('target'),'_blank');
  assert.equal(await page.locator('#review-match-video').getAttribute('rel'),'noopener noreferrer');
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-review.png'),fullPage:true});
  assert.equal(await page.locator('#v-name').count(),0);
  assert.ok(page.url().includes('voteId=test-vote&review='+past));
  // Selecting an existing voter must not disclose their saved choices or load raw ballots.
  await page.locator('#review-name').selectOption('Test 02');
  assert.equal(await page.locator('#review-picks .coach-selected').count(),0);
  assert.equal(await page.locator('#review-save').isDisabled(),true);
  await page.locator('[data-player="Test 03"]').click();
  await page.locator('#review-name').selectOption('Test 04');
  assert.equal(await page.locator('#review-picks .coach-selected').count(),0,'name changes clear the in-memory draft');
  assert.equal(await page.locator('#review-result details').count(),0,'no live score differences that reveal a ballot');
  assert.deepEqual(await page.evaluate(()=>__reads.filter(p=>p==='ratings'||p.startsWith('ratings/'))),[],'public RSVP/review must not read raw ballots');
  await page.locator('#review-name').selectOption('Test 01');for(const name of ['Test 03','Test 04','Test 05'])await page.locator(`[data-player="${name}"]`).click();await page.locator('#review-save').click();await page.waitForFunction(()=>__writes.length===2);
  const publicWrites=await page.evaluate(()=>__writes);assert.deepEqual(publicWrites.map(w=>w.path),['votes/test-vote/responses/Guest Friend',`ratings/${past}`]);
  assert.deepEqual(await page.evaluate(p=>__fixture['ratings/'+p].votes['Test 02'],past),{picks:['Test 01','Test 03','Test 04'],at:1},'other ballots remain exactly unchanged');
  assert.deepEqual(await page.evaluate(p=>__fixture['ratings/'+p].votes['Test 01'].picks,past),['Test 03','Test 04','Test 05']);
  await page.waitForFunction(()=>document.querySelector('#review-name').value==='');
  assert.equal(await page.locator('#review-picks [data-player]').count(),0,'successful submission clears choices');
  await page.locator('#review-name').selectOption('Test 01');
  assert.equal(await page.locator('#review-picks .coach-selected').count(),0,'even a just-saved ballot is never reloaded');
  await page.locator('[data-review-back]').last().click();await page.waitForSelector('#v-name');
  assert.equal(await page.locator('#v-name').inputValue(),'Guest Friend');
  if(process.argv.includes('--operations')) {
    await page.evaluate(async()=>{
      for(const [status,ns] of [['maybe',['Test 02','Test 03']],['absent',['Test 04','Test 05']]])ns.forEach((name,i)=>{__fixture['votes/test-vote/responses/'+name]={name,status,updatedAt:{seconds:2,nanoseconds:i?1:9},attendingSince:{seconds:i?90:1}};});
      const m=await import('/js/modules/votePage.js?v=5');await m.renderVote({},'test-vote');
    });
    await page.waitForSelector('.attendance-group.maybe li');
    assert.deepEqual(await page.locator('.attendance-group.maybe .roster-name').allTextContents(),['Test 03','Test 02']);
    assert.deepEqual(await page.locator('.attendance-group.absent .roster-name').allTextContents(),['Test 05','Test 04']);
    for(const [name,status] of [['Test 08','maybe'],['Test 09','absent']]) {
      await page.locator('#v-name').fill(name);await page.locator(`[data-status="${status}"]`).click();
      await page.waitForFunction(n=>__writes.some(w=>w.path==='votes/test-vote/responses/'+n),name);
      assert.equal(await page.evaluate(n=>typeof __fixture['votes/test-vote/responses/'+n].updatedAt.seconds,name),'number');
    }
    await page.locator('.preparation-card>summary').click();assert.equal(await page.locator('.referee-lesson').count(),1);
    await page.goto(base+'/');await page.waitForSelector('#operator-context:visible');
    assert.equal(await page.evaluate(()=>__writes.length),0,'operator dashboard must not auto-save');
    assert.equal(await page.locator('#avoid-repeat').isChecked(),false);
    await page.locator('#tab-lineup').click();await page.waitForSelector('.lineup-view-bar');
    assert.equal(await page.locator('.quarter-block:visible').count(),1,'one quarter at a time by default');
    await page.locator('[data-view="all"]').click();assert.equal(await page.locator('.quarter-block:visible').count(),6);
    assert.equal(await page.locator('#coach-planner').getAttribute('open'),null,'advanced coach controls start collapsed');
    await page.locator('.operator-cycle>summary').click();
    await page.locator('#cycle-start').fill(past);await page.locator('#cycle-load').click();
    await page.waitForFunction(()=>document.querySelector('#cycle-source').options[0].value!=='');
    await page.locator('#cycle-preview').click();await page.locator('#cycle-use').click();
    assert.equal(await page.evaluate(()=>__writes.length),0,'copying a previous team into inputs must not save');
    await page.locator('#tab-share').click();await page.locator('#coach-week-load').click();await page.waitForSelector('.video-editor');
    assert.equal(await page.locator('.video-editor-row').count(),12);
    assert.equal(await page.evaluate(()=>__writes.length),0);
    await page.goto(base+'/?preferences=1');await page.waitForSelector('#preference-body');
    assert.equal(await page.locator('#preference-save').count(),0,'private survey stays closed until Rules deployment approval');
    assert.equal(await page.evaluate(()=>__reads.some(p=>p.startsWith('privatePositionPreferences'))),false);
    enableSurveyForTest=true;await page.reload();await page.waitForSelector('#preference-name');
    await page.locator('#preference-signout').click();await page.locator('#preference-login').click();await page.waitForSelector('#preference-name');
    await page.locator('#preference-name').selectOption('Test 01');
    await page.locator('[data-position="CB"]').click();await page.locator('#preference-same').click();
    await page.locator('#preference-save').click();await page.waitForFunction(()=>__writes.length===1);
    assert.equal(await page.evaluate(()=>__writes[0].path),'privatePositionPreferences/test-admin');
    assert.deepEqual(await page.evaluate(()=>[__writes[0].value.name,__writes[0].value.first,__writes[0].value.second]),['Test 01','CB','CB']);
    assert.equal(await page.locator('#preference-name').isDisabled(),true);
    assert.ok(await page.evaluate(()=>__reads.filter(p=>p.startsWith('privatePositionPreferences')).every(p=>p==='privatePositionPreferences/test-admin')),'public survey reads only the signed-in account');
    assert.deepEqual(await page.evaluate(()=>__fixture['players/Test 01']),data['players/Test 01'],'survey never overwrites a player profile');
    assert.deepEqual(errors,[]);console.log('PASS: targeted operations checks — guest cancel/confirm, RSVP timestamps/order, ballot UI privacy, referee lesson, read-only operator workflow and video editor.');
    await context.close();return;
  }
  // A past deadline must retain an existing attendee's place but waitlist a new guest.
  await page.evaluate(async()=>{const f=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');await f.setDoc(f.doc({},'votes','test-vote'),{deadlineMs:1},{merge:true});});
  await page.locator('#v-name').fill('Test 01');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__writes.some(w=>w.path==='votes/test-vote/responses/Test 01'));
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].waitlist),false);
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].attendingSince.seconds),10);
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].paymentSentinel),'unchanged');
  await page.locator('#v-name').fill('Late Guest');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__fixture['votes/test-vote/responses/Late Guest']?.waitlist===true);
  assert.equal(await page.locator('.attendance-stat').count(),3);
  assert.match(await page.locator('.attendance-stat.attend .waitlist-count').textContent(),/1 waitlisted/);
  assert.equal(await page.locator('.attendance-stat.attend strong').textContent(),'2','waitlisted player is not counted as confirmed');
  assert.equal(await page.locator('.attendance-group.wait li').count(),1,'waiting roster preserved');
  await page.evaluate(async()=>{const f=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');await f.setDoc(f.doc({},'votes','test-vote'),{closed:true},{merge:true});});
  assert.equal(await page.locator('[data-status="attend"]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal overflow');
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-smoke.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  const positions=await page.evaluate(()=>{const a=document.querySelector('.match-rsvp').getBoundingClientRect(),b=document.querySelector('.match-attendance').getBoundingClientRect();return {sameRow:Math.abs(a.y-b.y)<2,separate:b.x>a.right};});
  assert.deepEqual(positions,{sameRow:true,separate:true});
  await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-desktop.png'),fullPage:true});
  await page.locator('.preparation-card>summary').click();
  assert.equal(await page.locator('.practice-instructions p').count(),5);
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-resources.png'),fullPage:true});
  await page.setViewportSize({width:320,height:740});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'320px expanded overflow');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#v-lang').click();await page.waitForSelector('.match-review-link');
  await page.goto(base+'/');await page.waitForFunction(()=>window.lineup && document.getElementById('coach-load'));
  // The generator now requires real RSVP order rather than editable roster order.
  // Populate only this isolated admin fixture; the earlier RSVP count checks stay unchanged.
  await page.evaluate(ns=>ns.forEach((name,i)=>{__fixture['votes/test-vote/responses/'+name]={name,status:'attend',attendingSince:{seconds:10+i},waitlist:false};}),names);
  await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>__writes.length),0,'admin load must not write');
  assert.match(await page.locator('#coach-planner .coach-help').textContent(),/미리보기만으로 기존 라인업은 바뀌지 않습니다/);
  await page.locator('#tab-share').click();await page.locator('#vote-location-saved').selectOption('Test pitch');
  assert.equal(await page.locator('#vote-location').inputValue(),'Test pitch');
  assert.equal(await page.locator('#meeting-publication-slot #generate-share-btn').count(),1);
  assert.equal(await page.evaluate(()=>__writes.length),0,'selecting a venue is not a database write');
  await page.locator('#tab-lineup').click();await page.locator('#coach-planner>summary').click();await page.locator('#coach-load').click();await page.waitForSelector('#coach-compare');
  await page.locator('#coach-compare').click();await page.locator('#coach-comparison table').waitFor();
  assert.equal(await page.locator('[data-lock-name="Test 01"][data-q="0"]').isDisabled(),true,'GK duty cannot be field-locked');
  await page.locator('[data-lock-name="Test 02"][data-q="0"]').check();await page.locator('#coach-save-locks').click();
  await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachPlans/')));
  await page.locator('#coach-partial-preview').click();await page.locator('#coach-apply').waitFor();
  assert.equal(await page.evaluate(()=>__writes.filter(w=>w.path.startsWith('dailyMeetings/')).length),0,'preview must not save lineups');
  await page.locator('#coach-apply').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('dailyMeetings/')));
  await page.locator('#tab-share').click();await page.locator('#coach-week-date').fill(next);await page.locator('#coach-week-load').click();await page.locator('#coach-week-save').waitFor();
  await page.locator('#coach-week-save').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachWeeks/')));
  await page.locator('#tab-players').click();await page.locator('#coach-profile-name').fill('Guest X');await page.locator('#coach-profile-load').click();await page.locator('#coach-profile-save').waitFor();await page.locator('[data-role="mentor"]').check();await page.locator('#coach-profile-save').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachPlayers/')));
  await page.locator('#tab-lineup').click();await page.locator('#coach-load').click();await page.locator('[data-lock-name="Test 02"][data-q="0"]').uncheck();await page.locator('#coach-save-locks').click();
  await page.locator('[data-team-lock="Test 01"]').check();await page.locator('#coach-save-team-locks').click();
  await page.waitForFunction(d=>__fixture['coachPlans/'+d].teamLocks?.['Test 01']===0,today);
  await page.locator('#tab-balancer').click();await page.locator('#attendees').fill(names.join('\n')+'\nGuest X');await page.locator('#generateButton').click();
  await page.waitForFunction(async()=>{const {state}=await import('/js/store.js?v=2');return state.teams.flat().some(p=>p.name==='Guest X');});
  await page.waitForTimeout(1500);
  const generated=await page.evaluate(async()=>{const {state}=await import('/js/store.js?v=2');return state.teams;});
  assert.equal(generated.flat().length,25,JSON.stringify(generated.map(t=>t.map(p=>p.name))));assert.equal(new Set(generated.flat().map(p=>p.name)).size,25);assert.ok(generated[0].some(p=>p.name==='Test 01'));
  await page.waitForTimeout(1300);
  // A changed roster must have fresh, timestamp-aligned duties before publication.
  await page.evaluate(async()=>{
    __fixture['votes/test-vote/responses/Guest X']={name:'Guest X',status:'attend',guest:true,attendingSince:{seconds:99},waitlist:false};
    const {state}=await import('/js/store.js?v=2');
    for(let i=0;i<state.teams.length;i++){
      const result=await window.lineup.executeLineupGeneration(state.teams[i].map(p=>p.name),Array(6).fill('4-4-2'),true);
      if(!result)throw new Error('Synthetic lineup generation failed');
      state.teamLineupCache[i]=result;
    }
  });
  await page.locator('#tab-share').click();
  const beforeBlocked=await page.evaluate(()=>__writes.length);
  await page.evaluate(d=>{document.getElementById('balancer-date').value=d;},next);await page.locator('#generate-share-btn').click();
  assert.equal(await page.evaluate(()=>__writes.length),beforeBlocked,'different match date must block publication');
  await page.evaluate(d=>{document.getElementById('balancer-date').value=d;},today);
  await page.locator('#generate-share-btn').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('shares/')));
  const writes=await page.evaluate(()=>__writes);assert.ok(writes.every(w=>/^(coachPlans|coachWeeks|coachPlayers|coachAdjustments|dailyMeetings|shares|settings)\//.test(w.path)),JSON.stringify(writes.map(w=>w.path)));
  const newShare=writes.find(w=>w.path.startsWith('shares/'));assert.equal(Object.keys(newShare.value.lineups).length,2);
  assert.equal(newShare.value.meetingInfo.time,today+' 20:00');assert.equal(newShare.value.meetingInfo.location,'Test pitch');assert.equal(newShare.value.meetingInfo.locationUrl,'https://maps.google.com/?q=test');
  for(const p of ['attendance/legacy','expenses/legacy','incomes/legacy'])assert.deepEqual(await page.evaluate(p=>__fixture[p],p),data[p]);
  assert.deepEqual(await page.evaluate(()=>__fixture['votes/test-vote']),data['votes/test-vote']);
  await page.goto(base+'/share.html?shareId=test-share');await page.getByText('My role this quarter',{exact:true}).first().waitFor();
  assert.equal(await page.locator('#bp-rate-card').count(),0);assert.equal(await page.evaluate(()=>__writes.length),0);
  // Dense, synthetic roster previews. No external services or real member names.
  await page.evaluate(()=>localStorage.setItem('bp_lang','ko'));
  await page.goto(base+'/?vote=current');await page.waitForSelector('.match-review-link');
  await page.evaluate(ns=>{ns.slice(1,18).forEach((name,i)=>{__fixture['votes/test-vote/responses/'+name]={name,status:i<13?'attend':i<15?'maybe':'absent',guest:false,waitlist:false,attendingSince:{seconds:11+i}};});},names);
  await page.evaluate(async()=>{const m=await import('/js/modules/votePage.js?v=5');await m.renderVote({},'test-vote');});await page.waitForSelector('.match-review-link');
  assert.equal(await page.locator('.attendance-group.attend li').count(),14);
  assert.equal(await page.evaluate(()=>__writes.length),0);
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-mobile-preview.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-desktop.png'),fullPage:true});
  await page.locator('.preparation-card>summary').click();
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-resources.png'),fullPage:true});
  await page.locator('.match-review-link').click();await page.waitForSelector('#review-match-video');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#review-name').selectOption('Test 01');
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-review.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: mobile KO/EN, guest RSVP, prior ratings preserved, admin zero-write load, locks, preview/apply, weekly editor, guest roles, protected records unchanged.');
  await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());});
