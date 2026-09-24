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
export const getDoc=async p=>{globalThis.__reads.push(p);if(globalThis.__failReads?.includes(p))throw new Error('simulated read failure');return ds(p);};export const getDocs=async p=>{globalThis.__reads.push(typeof p==='string'?p:p.path);if(globalThis.__failReads?.includes(typeof p==='string'?p:p.path))throw new Error('simulated read failure');if(typeof p==='string')return cs(p);const docs=cs(p.path).docs.filter(d=>p.filters.every(f=>f.op==='==' && f.field.split('.').reduce((v,k)=>v?.[k],d.data())===f.value));return{docs,empty:!docs.length};};
export const onSnapshot=(p,options,callback,error)=>{const cb=typeof options==='function'?options:callback,fail=typeof options==='function'?callback:error;globalThis.__reads.push(p);if(globalThis.__failReads?.includes(p)){queueMicrotask(()=>fail?.(new Error('simulated listener failure')));return()=>{};}const run=()=>cb(p.split('/').length%2===0?ds(p):cs(p));run.path=p;listeners.push(run);queueMicrotask(run);return ()=>{const i=listeners.indexOf(run);if(i>=0)listeners.splice(i,1);};};
const emit=p=>listeners.slice().filter(f=>f.path===p || (p.startsWith(f.path+'/') && p.split('/').length===f.path.split('/').length+1)).forEach(f=>f());
function merge(a,b){for(const [k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]||={};merge(a[k],v);}else a[k]=structuredClone(v);}return a;}
export const setDoc=async(p,v,o)=>{globalThis.__writes.push({path:p,value:structuredClone(v),merge:!!o?.merge});data[p]=o?.merge?merge(data[p]||{},v):structuredClone(v);emit(p);};
export const runTransaction=async(_,fn)=>{if(globalThis.__failSave)throw new Error('simulated offline');const writes=[];const value=await fn({get:getDoc,set:(p,v)=>writes.push([p,v])});for(const [p,v] of writes)await setDoc(p,v);return value;};
export const updateDoc=async(p,v)=>{globalThis.__writes.push({path:p,value:structuredClone(v),update:true});Object.assign(data[p],structuredClone(v));emit(p);};
export const addDoc=async(p,v)=>{const id='new-'+globalThis.__writes.length;await setDoc(p+'/'+id,v);return{id};};
export const deleteDoc=async()=>{throw new Error('DELETE FORBIDDEN IN TEST');};`;
let server,browser,enableSurveyForTest=false,enableRatingServiceForTest=false;
let ratingFailure='',ratingServerExists=true;const ratingRequests=[];
let blockAdminBundles=false,blockApp=false;const requested=[];
data['shares/test-share']={meetingInfo:{time:today+' 20:00',location:'Test pitch'},teams:{team1:meeting.teams.team_0,team2:meeting.teams.team_1},lineups:{team1:meeting.teamLineupCache[0],team2:meeting.teamLineupCache[1]},teamNames:['Test A','Test B']};
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
    requested.push(url);
    if(blockApp&&url.startsWith(base+'/js/app.js'))return route.abort();
    if(blockAdminBundles&&url.startsWith(base+'/js/modules/')&&/teamBalancer|accounting|playerManagement|lineupGenerator/.test(url))return route.abort();
    if(url.startsWith(base)&&url.includes('/js/modules/teamCycles.js')&&process.argv.includes('--remodel')) {
      const source=await readFile(path.join(root,'js/modules/teamCycles.js'),'utf8');
      return route.fulfill({contentType:'text/javascript',body:source.replace('TEAM_CYCLE_STORAGE_ENABLED=false','TEAM_CYCLE_STORAGE_ENABLED=true')});
    }
    if(url===base+'/api/ratings') {
      const payload=route.request().postDataJSON();ratingRequests.push(payload);
      if(ratingFailure)return route.fulfill({status:ratingFailure==='changed'?409:ratingFailure==='quota'?429:503,contentType:'application/json',body:JSON.stringify({error:ratingFailure})});
      const result=payload.action==='leaders'?{leaders:['Test 03','Test 04','Test 05']}:payload.action==='status'?{exists:ratingServerExists,version:'opaque-test-version'}:{saved:true};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
    }
    if(url.startsWith(base)&&url.includes('/js/modules/ratingService.js')) {
      const source=await readFile(path.join(root,'js/modules/ratingService.js'),'utf8');
      return route.fulfill({contentType:'text/javascript',body:source.replace(/RATING_SERVICE_ENABLED=(?:true|false)/,`RATING_SERVICE_ENABLED=${enableRatingServiceForTest}`)});
    }
    if(url.startsWith(base)&&url.includes('/js/modules/positionPreferences.js')) {
      const source=await readFile(path.join(root,'js/modules/positionPreferences.js'),'utf8');
      return route.fulfill({contentType:'text/javascript',body:source.replace(/POSITION_SURVEY_ENABLED=(?:true|false)/,`POSITION_SURVEY_ENABLED=${enableSurveyForTest}`)});
    }
    if(url.startsWith(base))return route.continue();
    if(url.includes('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:firestore});
    if(url.includes('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
    if(url.includes('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:'const auth={currentUser:{uid:"test-admin"}};const listeners=[];export const getAuth=()=>auth;export class GoogleAuthProvider{};export const onAuthStateChanged=(_,cb)=>{listeners.push(cb);queueMicrotask(()=>cb(auth.currentUser));return()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1);};};export const signInWithPopup=async()=>{auth.currentUser={uid:"test-admin"};listeners.forEach(cb=>cb(auth.currentUser));return {user:auth.currentUser};};export const signOut=async()=>{auth.currentUser=null;listeners.forEach(cb=>cb(null));};export const setPersistence=async()=>{};export const browserLocalPersistence={};'});
    // Local CSS equivalent for visibility; no CDN or Firebase request leaves this context.
    if(url.includes('tailwindcss'))return route.fulfill({contentType:'text/javascript',body:'const s=document.createElement("style");s.textContent=".hidden{display:none!important}.fixed{position:fixed}.grid{display:grid} .bg-gray-100{background:#f3f4f6}";document.head.append(s);'});
    return route.fulfill({status:200,body:''});
  });
  const page=await context.newPage(), errors=[],dialogs=[];let cancelGuest=false,cancelRating=false;
  page.on('pageerror',e=>{errors.push(e.message);console.error('Isolated browser error:',e.message);});page.on('dialog',d=>{dialogs.push(d.message());return (cancelGuest&&/Guest|guest/.test(d.message()))||cancelRating?d.dismiss():d.accept();});
  if(process.argv.includes('--loading')) {
    await context.addInitScript(()=>{__failReads=['incomes'];localStorage.setItem('playerDB','broken-cache');});
    await page.goto(base+'/');await page.waitForFunction(()=>document.getElementById('operator-save')?.textContent.includes('저장됨'));
    assert.equal(await page.evaluate(()=>document.getElementById('page-accounting').inert),true);
    assert.match(await page.locator('#ledger-load-status').textContent(),/편집을 막았습니다/);
    for(const path of ['attendance','expenses','incomes','players','locations'])assert.equal(await page.evaluate(p=>__reads.filter(x=>x===p).length,path),1,`one initial subscription for ${path}`);
    assert.equal(requested.some(u=>u.includes('chart.js')||u.includes('xlsx')),false);
    assert.equal(await page.evaluate(()=>__writes.length),0);
    blockAdminBundles=true;
    for(const url of ['/?vote=current','/share.html?shareId=test-share','/?preferences=1']){
      enableSurveyForTest=true;const start=requested.length;
      await page.goto(base+url);
      await page.waitForSelector(url.includes('preferences')?'#preference-name':url.includes('shareId')?'#bp-image-open':'#v-name');
      assert.equal(requested.slice(start).some(u=>/teamBalancer|accounting\.js|playerManagement|lineupGenerator/.test(u)),false,'public routes do not load admin modules');
      assert.equal(await page.evaluate(()=>__writes.length),0);
    }
    assert.deepEqual(errors,[]);blockApp=true;
    await page.goto(base+'/?vote=current');await page.waitForSelector('#boot-recovery',{timeout:16000});
    assert.match(await page.locator('#boot-recovery').textContent(),/연결이 지연/);
    assert.equal(await page.evaluate(()=>__writes.length),0);
    console.log('PASS: one ledger subscription, failed ledger read blocks edits, invalid cache recovery, public routes independent of admin bundles, no eager chart/XLSX, boot recovery.');
    await context.close();return;
  }
  if(process.argv.includes('--saves')) {
    await context.addInitScript(today=>__fixture['dailyMeetings/'+today].legacySentinel={keep:true},today);
    await page.goto(base+'/');await page.waitForFunction(()=>document.getElementById('operator-save')?.textContent.includes('저장됨'));
    assert.equal(await page.evaluate(()=>__writes.length),0);
    await page.locator('#attendees').fill('Test 01\nTest 02');
    assert.equal(await page.evaluate(()=>hasUnsavedMeeting()),true);
    await page.locator('#balancer-date').fill(next);await page.locator('#balancer-date').dispatchEvent('change');
    await page.waitForFunction(next=>document.getElementById('operator-context').textContent.includes(next)&&document.getElementById('operator-save').textContent.includes('저장됨'),next);
    assert.deepEqual(await page.evaluate(date=>__fixture['dailyMeetings/'+date].initialAttendeeOrder,today),['Test 01','Test 02']);
    assert.deepEqual(await page.evaluate(date=>__fixture['dailyMeetings/'+date].legacySentinel,today),{keep:true});
    assert.equal(await page.evaluate(next=>__fixture['dailyMeetings/'+next],next),undefined);
    await page.evaluate(()=>__failSave=true);await page.locator('#attendees').fill('Test 03');
    assert.equal(await page.evaluate(date=>changeMeetingDate(date),today),false);
    assert.equal(await page.locator('#balancer-date').inputValue(),next);assert.equal(await page.locator('#attendees').inputValue(),'Test 03');
    assert.match(await page.locator('#operator-save').textContent(),/저장 실패/);
    await page.evaluate(()=>__failSave=false);await page.locator('#operator-retry').click();
    await page.waitForFunction(()=>document.getElementById('operator-save').textContent.includes('저장됨'));
    await page.locator('#attendees').fill('Test 04');
    await page.evaluate(next=>__fixture['dailyMeetings/'+next].initialAttendeeOrder=['remote'],next);
    await page.evaluate(()=>flushMeetingSave().catch(()=>{}));assert.match(await page.locator('#operator-save').textContent(),/충돌/);
    assert.deepEqual(await page.evaluate(next=>__fixture['dailyMeetings/'+next].initialAttendeeOrder,next),['remote']);
    await page.locator('#operator-reload').click();await page.waitForFunction(()=>document.getElementById('attendees').value==='remote');
    await page.evaluate(today=>__failReads=['dailyMeetings/'+today],today);
    assert.equal(await page.evaluate(today=>changeMeetingDate(today),today),false);
    assert.equal(await page.locator('#balancer-date').inputValue(),next);assert.equal(await page.locator('#attendees').inputValue(),'remote');
    assert.ok((await page.evaluate(()=>__writes)).every(w=>w.path.startsWith('dailyMeetings/')));
    assert.deepEqual(errors,[]);console.log('PASS: immutable date saves, flush before switching, failed writes, retry, cross-device conflict, failed date load, no unrelated writes.');
    await context.close();return;
  }
  if(process.argv.includes('--remodel')) {
    await context.addInitScript(({names,today})=>{
      names.forEach((name,i)=>{
        __fixture[`attendance/cycle-${i}`]={name,date:today,paymentStatus:'●',paymentAmount:50};
        const role=['DM','CB','FW'][i%3];
        __fixture[`privatePositionPreferences/synthetic-${i}`]={name,first:role,second:role,note:'Never copy this private note'};
      });
    },{names,today});
    await page.goto(base+'/');await page.waitForSelector('#operator-context:visible');
    const initial=await page.evaluate(()=>structuredClone(__fixture));
    assert.equal(await page.evaluate(()=>__writes.length),0);
    assert.equal(await page.evaluate(()=>__reads.some(p=>p==='privatePositionPreferences'||p==='teamCycles')),false);
    await page.locator('#team-cycle-panel>summary').click();await page.locator('#team-cycle-start').fill(today);
    await page.locator('#team-cycle-roster').click();await page.locator('#team-cycle-build').click();
    assert.equal(await page.locator('#team-cycle-draft [data-team]').count(),24);assert.equal(await page.evaluate(()=>__writes.length),0);
    await page.locator('#team-cycle-save').click();await page.waitForFunction(()=>__writes.length===1);
    const saved=await page.evaluate(()=>__writes[0]);assert.match(saved.path,/^teamCycles\//);
    assert.ok(saved.value.members.every(p=>!('note' in p)&&!('skill' in p)));
    await page.locator('#team-cycle-training').click();
    assert.match(await page.locator('#team-cycle-training-status').textContent(),/8주 훈련 포지션 우선/);
    assert.equal(await page.evaluate(()=>__writes.length),1,'training selection is not a write');
    assert.match(await page.locator('#lineup-mode-status').textContent(),/훈련 포지션 우선/);
    const homeA=saved.value.members.filter(p=>p.team===0),homeB=saved.value.members.filter(p=>p.team===1);
    const present=[...homeA.slice(0,8),...homeB].map(p=>p.name);present.push('Synthetic Guest');
    await page.evaluate(present=>document.getElementById('attendees').value=present.join('\n'),present);await page.locator('#team-cycle-match').click();
    await page.locator('#team-cycle-use').click();assert.match(await page.locator('#team-cycle-status').textContent(),/임시 소속/);
    await page.locator('[data-temporary="0"]').selectOption('0');await page.locator('#team-cycle-use').click();
    const assigned=(await page.locator('#manual-team-ta-0').inputValue()+'\n'+await page.locator('#manual-team-ta-1').inputValue()).split('\n').filter(Boolean).sort();
    assert.deepEqual(assigned,[...present].sort());assert.equal(await page.evaluate(()=>__writes.length),1,'preview does not save daily assignments');
    for(const [key,value] of Object.entries(initial))assert.deepEqual(await page.evaluate(key=>__fixture[key],key),value,`preserve ${key}`);
    assert.deepEqual(await page.evaluate(key=>__fixture[key],saved.path),saved.value,'loans do not change original memberships');
    await page.evaluate(next=>changeMeetingDate(next),next);
    assert.match(await page.locator('#team-cycle-training-status').textContent(),/꺼짐/);
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-cycle-desktop.png'),fullPage:true});
    await page.goto(base+'/share.html?shareId=test-share');await page.locator('#bp-image-open').click();
    await page.getByRole('button',{name:'이미지 만들기',exact:true}).click();
    const png=page.locator('img[alt*="6쿼터"]');await png.waitFor();
    await page.waitForFunction(()=>document.querySelector('img[alt*="6쿼터"]')?.naturalWidth===1500);
    assert.equal(await page.evaluate(()=>__writes.length),0,'image export never writes');
    assert.equal(await page.locator('a[download$=".png"]').count(),1);
    await png.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-lineup-export.png')});
    assert.deepEqual(errors,[]);console.log('PASS: cycle draft/store (mock only), immutable original records, temporary guest, loans, no load writes, published PNG.');
    await context.close();return;
  }
  if(process.argv.includes('--survey')) {
    enableSurveyForTest=true;
    await page.goto(base+'/?preferences=1');await page.waitForSelector('#preference-name');
    assert.match(await page.locator('#preference-purpose-title').textContent(),/왜 포지션/);
    assert.match(await page.locator('.preference-plan').textContent(),/8주 동안/);
    assert.match(await page.locator('.preference-boundaries').textContent(),/자리 보장 투표는 아닙니다/);
    await page.locator('#preference-signout').click();await page.waitForSelector('#preference-login');
    assert.equal(await page.locator('#preference-purpose-title').count(),1,'purpose visible before sign-in');
    await page.locator('#preference-language').click();await page.waitForSelector('#preference-login');
    assert.match(await page.locator('#preference-purpose-title').textContent(),/Why are we asking/);
    await page.locator('#preference-login').click();await page.waitForSelector('#preference-name');
    await page.locator('#preference-name').selectOption('Test 01');
    assert.equal(await page.locator('.preference-pitch button').count(),11);
    assert.equal(await page.locator('.preference-pitch [data-position="DM"]').count(),2);
    assert.equal(await page.locator('.preference-pitch [data-position="CM"]').count(),0);
    assert.equal(await page.locator('#preference-same, #preference-stable, #preference-flexible').count(),0);
    assert.match(await page.locator('.preference-choice-guide').textContent(),/Want to try two roles/);
    assert.match(await page.locator('.preference-choice-guide').textContent(),/Prefer to focus on one role/);
    await page.locator('[data-position="CB"]').first().click();await page.locator('[data-position="CB"]').last().click();
    assert.equal(await page.locator('[data-position="CB"][data-ranks="1-2"]').count(),2);
    await page.locator('#preference-note').fill('Learn positioning');
    await page.locator('#preference-save').click();await page.waitForFunction(()=>__writes.length===1);
    assert.equal(await page.evaluate(()=>__writes[0].path),'privatePositionPreferences/test-admin');
    assert.deepEqual(await page.evaluate(()=>[__writes[0].value.name,__writes[0].value.first,__writes[0].value.second]),['Test 01','CB','CB']);
    assert.equal(await page.locator('#preference-name').isDisabled(),true);
    assert.ok(await page.evaluate(()=>__reads.filter(p=>p.startsWith('privatePositionPreferences')).every(p=>p==='privatePositionPreferences/test-admin')));
    assert.deepEqual(await page.evaluate(()=>__fixture['players/Test 01']),data['players/Test 01']);
    const savedPreference=await page.evaluate(()=>__fixture['privatePositionPreferences/test-admin']);
    assert.equal(savedPreference.stable,false);assert.equal(savedPreference.flexible,false);
    // Simulate a legacy response: hidden fields must survive a preference edit.
    savedPreference.stable=true;savedPreference.flexible=true;
    await context.addInitScript(value=>{window.__fixture['privatePositionPreferences/test-admin']=value;},savedPreference);
    await page.reload();await page.waitForSelector('#preference-name');
    assert.equal(await page.locator('#preference-name').inputValue(),'Test 01');
    assert.equal(await page.locator('#preference-name').isDisabled(),true);
    assert.match(await page.locator('[data-rank="first"]').textContent(),/Centre back/);
    await page.locator('[data-rank="second"]').click();await page.locator('[data-position="FW"]').click();
    assert.equal(await page.locator('[data-position="CB"][data-ranks="1"]').count(),2);
    assert.equal(await page.locator('[data-position="FW"][data-ranks="2"]').count(),1);
    await page.locator('#preference-save').click();await page.waitForFunction(()=>__writes.length===1);
    assert.equal(await page.evaluate(()=>__writes[0].value.second),'FW','returning respondent can change their own preference');
    assert.deepEqual(await page.evaluate(()=>[__writes[0].value.stable,__writes[0].value.flexible]),[true,true]);
    await page.setViewportSize({width:320,height:740});
    await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-position-survey-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'survey fits a narrow phone');
    assert.equal(await page.locator('.preference-pitch button').evaluateAll(buttons=>{
      const boxes=buttons.map(b=>b.getBoundingClientRect());
      return boxes.every((a,i)=>boxes.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));
    }),true,'four defenders remain separate tap targets on a narrow phone');
    await page.locator('#preference-language').click();await page.waitForSelector('#preference-name');
    assert.match(await page.locator('.preference-choice-guide').textContent(),/두 자리 모두 해보고 싶다면/);
    assert.match(await page.locator('.preference-choice-guide').textContent(),/한 자리에서 집중/);
    await page.locator('.preference-pitch').screenshot({path:path.join(process.env.TEMP||root,'bareaplay-survey-pitch-mobile.png')});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-position-survey-desktop.png'),fullPage:true});
    await context.addInitScript(()=>{window.__fixture['privatePositionPreferences/test-other']={name:'Test 02',first:'CM',second:'DM',stable:false,flexible:false,note:'Legacy answer'};});
    await page.goto(base+'/');await page.waitForSelector('#tab-players');await page.locator('#tab-players').click();
    await page.locator('#preference-admin-load').click();
    await page.locator('#preference-admin-result .coach-table').waitFor();
    assert.equal(await page.locator('#preference-admin-result .coach-table').getByText('중앙 미들',{exact:true}).count(),0);
    assert.match(await page.locator('#preference-admin-result .coach-table tr').filter({hasText:'수비형 미들'}).textContent(),/Test 02/);
    await page.locator('#preference-admin-result details').click();
    assert.match(await page.locator('#preference-admin-result details').textContent(),/Test 02 · DM \/ DM/);
    assert.equal(await page.evaluate(()=>__writes.length),0,'loading coach results must not rewrite legacy CM answers');
    await context.addInitScript(()=>{window.__fixture['privatePositionPreferences/test-admin']={name:'Test 01',first:'CM',second:'DM',stable:false,flexible:false,note:'Legacy choice'};});
    await page.goto(base+'/?preferences=1');await page.waitForSelector('#preference-name');
    assert.match(await page.locator('[data-rank="first"]').textContent(),/수비형 미들/);
    assert.equal(await page.locator('[data-position="DM"][data-ranks="1-2"]').count(),2);
    assert.equal(await page.evaluate(()=>__writes.length),0,'showing legacy CM as DM must not edit the saved response');
    assert.deepEqual(errors,[]);console.log('PASS: bilingual survey purpose, Google sign-in, registered name, same-position preference, own-response access, preserved players and narrow-screen layout.');
    await context.close();return;
  }
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
  await page.waitForFunction(()=>document.querySelector('#review-name').value==='Test 01'&&!document.querySelector('#review-picks .coach-selected'));
  assert.equal(await page.locator('#review-picks .coach-selected').count(),0,'successful submission clears choices but keeps the chosen name');
  await page.locator('#review-name').selectOption('Test 01');
  assert.equal(await page.locator('#review-picks .coach-selected').count(),0,'even a just-saved ballot is never reloaded');
  if(process.argv.includes('--ratings')) {
    await page.reload();await page.waitForSelector('#review-name');
    assert.equal(await page.locator('#review-name').inputValue(),'Test 01','name remembered across reload');
    assert.equal(await page.locator('#review-picks .coach-selected').count(),0);
    for(const name of ['Test 03','Test 04','Test 05'])await page.locator(`[data-player="${name}"]`).click();
    cancelRating=true;await page.locator('#review-save').click();
    assert.equal(await page.evaluate(()=>__writes.length),0,'cancel replacement writes nothing');
    assert.match(dialogs.at(-1),/previous submission recorded on this device/);
    assert.equal(await page.locator('#review-picks .coach-selected').count(),3,'cancel retains current draft');cancelRating=false;
    await page.locator('#review-name').selectOption('Test 02');assert.equal(await page.locator('#review-picks .coach-selected').count(),0);
    await page.locator('#review-remember').click();await page.reload();await page.waitForSelector('#review-name');
    assert.equal(await page.locator('#review-name').inputValue(),'','forget name on shared devices');
    assert.equal(await page.locator('#review-remember').textContent(),'Remember my name','shared-device opt-out survives reload');
    assert.equal(await page.locator('#review-remember[type="checkbox"]').count(),0);
    enableRatingServiceForTest=true;await page.reload();await page.waitForSelector('#review-name');
    await page.getByText('Recognised by teammates · Live TOP 3',{exact:true}).waitFor();
    assert.equal(await page.locator('#review-result strong').count(),3);
    assert.deepEqual(await page.locator('.rating-medal').allTextContents(),['🥇','🥈','🥉']);
    assert.deepEqual(await page.locator('.rating-rank').allTextContents(),['1st','2nd','3rd']);
    await page.locator('#review-name').selectOption('Test 02');
    for(const name of ['Test 03','Test 04','Test 05'])await page.locator(`[data-player="${name}"]`).click();
    cancelRating=true;await page.locator('#review-save').click();await page.waitForFunction(()=>!document.querySelector('#review-save').disabled);
    assert.match(dialogs.at(-1),/already has a saved vote/);
    assert.equal(ratingRequests.filter(r=>r.action==='submit').length,0,'server-confirmed replacement can be cancelled');
    cancelRating=false;await page.locator('#review-save').click();await page.waitForFunction(()=>document.querySelector('#review-msg').textContent.startsWith('Saved'));
    assert.equal(ratingRequests.filter(r=>r.action==='submit').length,1);
    assert.equal(ratingRequests.at(-1).expectedVersion,'opaque-test-version');
    assert.equal(await page.evaluate(()=>__writes.length),0,'server mode never directly writes Firestore');
    assert.deepEqual(await page.evaluate(()=>__reads.filter(p=>p==='ratings'||p.startsWith('ratings/'))),[]);
    // Live result updates contain only the three recognised names, never a voter's picks.
    await page.evaluate(async d=>{const f=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');await f.setDoc(f.doc({},'ratingResults',d),{leaders:['Test 06','Test 07','Test 08']});__writes=[];},past);
    await page.locator('#review-result strong').filter({hasText:'Test 06'}).waitFor();
    for(const name of ['Test 03','Test 04','Test 05'])await page.locator(`[data-player="${name}"]`).click();
    ratingFailure='changed';await page.locator('#review-save').click();await page.waitForFunction(()=>document.querySelector('#review-msg').textContent.includes('changed elsewhere'));
    assert.equal(await page.locator('#review-picks .coach-selected').count(),3);
    ratingFailure='unavailable';await page.locator('#review-save').click();await page.waitForFunction(()=>document.querySelector('#review-msg').textContent.includes('Could not save'));
    assert.equal(await page.evaluate(()=>__writes.length),0,'no insecure fallback when API fails');
    ratingFailure='quota';await page.locator('#review-save').click();await page.waitForFunction(()=>document.querySelector('#review-msg').textContent.includes('usage limit'));
    assert.equal(await page.locator('#review-picks .coach-selected').count(),3,'quota failure keeps selected players');
    ratingFailure='';const aggregateCalls=ratingRequests.filter(r=>r.action==='leaders').length;
    await page.locator('[data-review-back]').last().click();await page.locator('.match-review-link').click();
    await page.locator('#review-result strong').filter({hasText:'Test 06'}).waitFor();
    assert.equal(ratingRequests.filter(r=>r.action==='leaders').length,aggregateCalls,'public aggregate avoids another private-ballot aggregation read');
    assert.deepEqual(errors,[]);console.log('PASS: device name memory/forget, safe cancellation, cross-device confirmation, score-free live TOP 3, no raw ballot reads and fail-closed server errors.');
    await context.close();return;
  }
  await page.locator('[data-review-back]').last().click();await page.waitForSelector('#v-name');
  assert.equal(await page.locator('#v-name').inputValue(),'Guest Friend');
  if(process.argv.includes('--operations')) {
    await page.evaluate(async()=>{
      for(const [status,ns] of [['maybe',['Test 02','Test 03']],['absent',['Test 04','Test 05']]])ns.forEach((name,i)=>{__fixture['votes/test-vote/responses/'+name]={name,status,updatedAt:{seconds:2,nanoseconds:i?1:9},attendingSince:{seconds:i?90:1}};});
      const m=await import('/js/modules/votePage.js?v=11');await m.renderVote({},'test-vote');
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
    await page.locator('#tab-lineup').click();await page.waitForSelector('.quarter-block');
    assert.equal(await page.locator('.quarter-block:visible').count(),6,'all six quarters are visible without a mode switch');
    assert.equal(await page.locator('.lineup-view-bar').count(),0);
    assert.equal(await page.locator('#coach-planner').getAttribute('open'),null,'advanced coach controls start collapsed');
    assert.equal(await page.locator('.operator-steps').count(),0,'no duplicate navigation');
    await page.locator('#tab-balancer').click();await page.locator('#team-cycle-panel>summary').click();
    assert.equal(await page.locator('#team-cycle-load').isDisabled(),true,'cycle storage gated until Rules approval');
    assert.equal(await page.evaluate(()=>__writes.length),0,'cycle tools must not save on load');
    await page.locator('#tab-share').click();await page.locator('#coach-week-load').click();await page.waitForSelector('.video-editor');
    assert.equal(await page.locator('.video-editor-row').count(),12);
    assert.equal(await page.evaluate(()=>__writes.length),0);
    await page.goto(base+'/?preferences=1');await page.waitForSelector('#preference-body');
    assert.equal(await page.locator('#preference-save').count(),0,'private survey stays closed until Rules deployment approval');
    assert.equal(await page.evaluate(()=>__reads.some(p=>p.startsWith('privatePositionPreferences'))),false);
    enableSurveyForTest=true;await page.reload();await page.waitForSelector('#preference-name');
    await page.locator('#preference-signout').click();await page.locator('#preference-login').click();await page.waitForSelector('#preference-name');
    await page.locator('#preference-name').selectOption('Test 01');
    await page.locator('[data-position="CB"]').first().click();await page.locator('[data-position="CB"]').first().click();
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
  await page.evaluate(async()=>{const m=await import('/js/modules/votePage.js?v=11');await m.renderVote({},'test-vote');});await page.waitForSelector('.match-review-link');
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
