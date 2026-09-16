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
const data={...players,'admins/test-admin':{},'settings/activeVote':{voteId:'test-vote'},'votes/test-vote':{date:next,time:'20:00',location:'Test pitch',closed:false,deadlineMs:4070900000000},[`dailyMeetings/${today}`]:meeting,[`dailyMeetings/${past}`]:{...meeting,date:past},[`ratings/${past}`]:{date:past,votes:{'Test 02':{picks:['Test 01','Test 03','Test 04'],at:1}}},'votes/test-vote/responses/Test 01':{name:'Test 01',status:'attend',guest:false,waitlist:false,attendingSince:{seconds:10},paymentSentinel:'unchanged'},'attendance/legacy':{date:past,name:'Test 01',paymentAmount:50,paymentStatus:'●'},'expenses/legacy':{date:past,amount:120,item:'pitch'},'incomes/legacy':{date:past,amount:10,item:'donation'}};
const firestore=`const data=globalThis.__fixture; const listeners=[];
export const getFirestore=()=>({}); export const doc=(_,...p)=>p.join('/'); export const collection=doc;
export const serverTimestamp=()=>({seconds:Date.now()/1000});
const ds=(p)=>({id:p.split('/').at(-1),exists:()=>p in data,data:()=>structuredClone(data[p]),metadata:{hasPendingWrites:false}});
const cs=p=>{const docs=Object.keys(data).filter(k=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1).map(ds);return {docs,forEach:fn=>docs.forEach(fn),empty:!docs.length,size:docs.length};};
export const getDoc=async p=>ds(p);export const getDocs=async p=>cs(p);
export const onSnapshot=(p,cb)=>{const run=()=>cb(p.split('/').length%2===0?ds(p):cs(p));run.path=p;listeners.push(run);queueMicrotask(run);return ()=>{const i=listeners.indexOf(run);if(i>=0)listeners.splice(i,1);};};
const emit=p=>listeners.slice().filter(f=>f.path===p || (p.startsWith(f.path+'/') && p.split('/').length===f.path.split('/').length+1)).forEach(f=>f());
function merge(a,b){for(const [k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]||={};merge(a[k],v);}else a[k]=structuredClone(v);}return a;}
export const setDoc=async(p,v,o)=>{globalThis.__writes.push({path:p,value:structuredClone(v),merge:!!o?.merge});data[p]=o?.merge?merge(data[p]||{},v):structuredClone(v);emit(p);};
export const updateDoc=async(p,v)=>{globalThis.__writes.push({path:p,value:structuredClone(v),update:true});Object.assign(data[p],structuredClone(v));emit(p);};
export const addDoc=async(p,v)=>{const id='new-'+globalThis.__writes.length;await setDoc(p+'/'+id,v);return{id};};
export const deleteDoc=async()=>{throw new Error('DELETE FORBIDDEN IN TEST');};`;
let server,browser;
data['shares/test-share']={meetingInfo:{time:today+' 20:00',location:'Test pitch'},teams:meeting.teams,lineups:meeting.teamLineupCache,teamNames:['Test A','Test B']};
(async()=>{
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    try{const body=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.addInitScript(f=>{window.__fixture=f;window.__writes=[];window.Chart=class{destroy(){}update(){}};},data);
  await context.route('**/*',async route=>{
    const url=route.request().url();if(url.startsWith(base))return route.continue();
    if(url.includes('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:firestore});
    if(url.includes('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
    if(url.includes('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:'export const getAuth=()=>({});export class GoogleAuthProvider{};export const onAuthStateChanged=(_,cb)=>queueMicrotask(()=>cb({uid:"test-admin"}));export const signInWithPopup=async()=>({user:{uid:"test-admin"}});export const setPersistence=async()=>{};export const browserLocalPersistence={};'});
    // Local CSS equivalent for visibility; no CDN or Firebase request leaves this context.
    if(url.includes('tailwindcss'))return route.fulfill({contentType:'text/javascript',body:'const s=document.createElement("style");s.textContent=".hidden{display:none!important}.fixed{position:fixed}.grid{display:grid} .bg-gray-100{background:#f3f4f6}";document.head.append(s);'});
    return route.fulfill({status:200,body:''});
  });
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base+'/?vote=current');await page.waitForSelector('#review-name');
  assert.equal(await page.evaluate(()=>__writes.length),0,'page loads must not write');
  await page.locator('#v-name').fill('Guest Friend');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__writes.length===1);
  await page.locator('#v-lang').click();await page.getByText('Previous match appreciation',{exact:false}).waitFor();
  assert.equal(await page.locator('#v-name').inputValue(),'Guest Friend');
  await page.locator('#review-name').selectOption('Test 01');for(const name of ['Test 03','Test 04','Test 05'])await page.locator(`[data-player="${name}"]`).click();await page.locator('#review-save').click();await page.waitForFunction(()=>__writes.length===2);
  const publicWrites=await page.evaluate(()=>__writes);assert.deepEqual(publicWrites.map(w=>w.path),['votes/test-vote/responses/Guest Friend',`ratings/${past}`]);
  assert.ok(await page.evaluate(p=>__fixture['ratings/'+p].votes['Test 02'],past));
  // A past deadline must retain an existing attendee's place but waitlist a new guest.
  await page.evaluate(async()=>{const f=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');await f.setDoc(f.doc({},'votes','test-vote'),{deadlineMs:1},{merge:true});});
  await page.locator('#v-name').fill('Test 01');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__writes.some(w=>w.path==='votes/test-vote/responses/Test 01'));
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].waitlist),false);
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].attendingSince.seconds),10);
  assert.equal(await page.evaluate(()=>__fixture['votes/test-vote/responses/Test 01'].paymentSentinel),'unchanged');
  await page.locator('#v-name').fill('Late Guest');await page.locator('[data-status="attend"]').click();await page.waitForFunction(()=>__fixture['votes/test-vote/responses/Late Guest']?.waitlist===true);
  await page.evaluate(async()=>{const f=await import('https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js');await f.setDoc(f.doc({},'votes','test-vote'),{closed:true},{merge:true});});
  assert.equal(await page.locator('[data-status="attend"]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal overflow');
  await page.screenshot({path:path.join(process.env.TEMP||root,'bareaplay-vote-smoke.png'),fullPage:true});
  await page.goto(base+'/');await page.waitForFunction(()=>window.lineup && document.getElementById('coach-load'));
  await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>__writes.length),0,'admin load must not write');
  await page.locator('#tab-lineup').click();await page.locator('#coach-load').click();await page.waitForSelector('#coach-compare');
  await page.locator('#coach-compare').click();await page.locator('#coach-comparison table').waitFor();
  await page.locator('[data-lock-name="Test 01"][data-q="0"]').check();await page.locator('#coach-save-locks').click();
  await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachPlans/')));
  await page.locator('#coach-partial-preview').click();await page.locator('#coach-apply').waitFor();
  assert.equal(await page.evaluate(()=>__writes.filter(w=>w.path.startsWith('dailyMeetings/')).length),0,'preview must not save lineups');
  await page.locator('#coach-apply').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('dailyMeetings/')));
  await page.locator('#tab-share').click();await page.locator('#coach-week-date').fill(next);await page.locator('#coach-week-load').click();await page.locator('#coach-week-save').waitFor();
  await page.locator('#coach-week-save').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachWeeks/')));
  await page.locator('#tab-players').click();await page.locator('#coach-profile-name').fill('Guest X');await page.locator('#coach-profile-load').click();await page.locator('#coach-profile-save').waitFor();await page.locator('[data-role="mentor"]').check();await page.locator('#coach-profile-save').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('coachPlayers/')));
  await page.locator('#tab-lineup').click();await page.locator('#coach-load').click();await page.locator('[data-lock-name="Test 01"][data-q="0"]').uncheck();await page.locator('#coach-save-locks').click();
  await page.locator('[data-team-lock="Test 01"]').check();await page.locator('#coach-save-team-locks').click();
  await page.waitForFunction(d=>__fixture['coachPlans/'+d].teamLocks?.['Test 01']===0,today);
  await page.locator('#tab-balancer').click();await page.locator('#attendees').fill(names.join('\n')+'\nGuest X');await page.locator('#generateButton').click();
  await page.waitForFunction(async()=>{const {state}=await import('/js/store.js?v=2');return state.teams.flat().some(p=>p.name==='Guest X');});
  await page.waitForTimeout(1500);
  const generated=await page.evaluate(async()=>{const {state}=await import('/js/store.js?v=2');return state.teams;});
  assert.equal(generated.flat().length,25,JSON.stringify(generated.map(t=>t.map(p=>p.name))));assert.equal(new Set(generated.flat().map(p=>p.name)).size,25);assert.ok(generated[0].some(p=>p.name==='Test 01'));
  await page.waitForTimeout(1300);
  await page.locator('#tab-share').click();await page.locator('#generate-share-btn').click();await page.waitForFunction(()=>__writes.some(w=>w.path.startsWith('shares/')));
  const writes=await page.evaluate(()=>__writes);assert.ok(writes.every(w=>/^(coachPlans|coachWeeks|coachPlayers|coachAdjustments|dailyMeetings|shares|settings)\//.test(w.path)),JSON.stringify(writes.map(w=>w.path)));
  const newShare=writes.find(w=>w.path.startsWith('shares/'));assert.equal(Object.keys(newShare.value.lineups).length,2);
  for(const p of ['attendance/legacy','expenses/legacy','incomes/legacy'])assert.deepEqual(await page.evaluate(p=>__fixture[p],p),data[p]);
  assert.deepEqual(await page.evaluate(()=>__fixture['votes/test-vote']),data['votes/test-vote']);
  await page.goto(base+'/share.html?shareId=test-share');await page.getByText('My role this quarter',{exact:true}).first().waitFor();
  assert.equal(await page.locator('#bp-rate-card').count(),0);assert.equal(await page.evaluate(()=>__writes.length),0);
  assert.deepEqual(errors,[]);console.log('PASS: mobile KO/EN, guest RSVP, prior ratings preserved, admin zero-write load, locks, preview/apply, weekly editor, guest roles, protected records unchanged.');
  await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());});
