// Explicit localhost + demo project only. Never use production credentials/data.
// Run with the Firestore emulator on 127.0.0.1:8087 and test SDK on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails} = require('@firebase/rules-unit-testing');
const {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,serverTimestamp,setLogLevel} = require('firebase/firestore');
setLogLevel('silent');
const host='127.0.0.1', port=8087, projectId='demo-bareaplay-rules';
if(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST!==`${host}:${port}`)throw new Error('Unexpected emulator host');
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/firestore-before-cycles.rules'),'utf8');
const fragmentText=fs.readFileSync(path.join(__dirname,'../docs/TEAM_CYCLE_RULES_DRAFT.txt'),'utf8');
const fragment=fragmentText.match(/match \/teamCycles\/\{cycleId\} \{[\s\S]*?\n\}/)?.[0];
assert.ok(fragment,'Exact reviewed cycle fragment required');
assert.equal((baseline.match(/&& collectionName != 'privatePositionPreferences'/g)||[]).length,2);
const integrated=baseline.replace(/&& collectionName != 'privatePositionPreferences'/g,"&& collectionName != 'privatePositionPreferences'\n        && collectionName != 'teamCycles'")
  .replace('    match /{collectionName}/{docId}',fragment+'\n    match /{collectionName}/{docId}');
const normalized=integrated.replace(/^\/\/.*$/gm,'').replace(/\s/g,'');
let checksum=2166136261;for(const c of normalized)checksum=Math.imul(checksum^c.charCodeAt(0),16777619);
console.log('Test rules comparison:',{normalizedLength:normalized.length,checksum:checksum>>>0});
const google={firebase:{sign_in_provider:'google.com'}};
let checks=0;
async function check(expected,operation,label){
  try{await (expected?assertSucceeds(operation):assertFails(operation));checks++;}
  catch(e){throw new Error(label,{cause:e});}
}
function cycle(uid){return{schemaVersion:1,startDate:'2026-09-30',endDateExclusive:'2026-11-25',members:[{name:'Fixture One',team:0,role:'DM',second:'DM'},{name:'Fixture Two',team:1,role:'FW',second:'FW'}],createdBy:uid,createdAt:serverTimestamp()};}
const survey=()=>({name:'Fixture One',first:'DM',second:'DM',stable:true,flexible:false,note:'',updatedAt:serverTimestamp()});
async function run(rules,withCycles){
  const env=await initializeTestEnvironment({projectId,firestore:{host,port,rules}});
  try{
    await env.clearFirestore(); // demo emulator only; no production ID/config is accepted.
    await env.withSecurityRulesDisabled(async ctx=>{
      const db=ctx.firestore();
      await setDoc(doc(db,'admins/test-admin'),{});
      await setDoc(doc(db,'admins/test-coach'),{});
      await setDoc(doc(db,'players/Fixture One'),{name:'Fixture One'});
      await setDoc(doc(db,'teamCycles/existing'),cycle('test-admin'));
      await setDoc(doc(db,'privatePositionPreferences/test-member'),survey());
    });
    const contexts=[['anon',env.unauthenticatedContext()],['test-member',env.authenticatedContext('test-member',google)],['test-admin',env.authenticatedContext('test-admin',google)],['test-coach',env.authenticatedContext('test-coach',google)]];
    for(const [uid,ctx] of contexts){
      const db=ctx.firestore(),admin=uid==='test-admin'||uid==='test-coach';
      for(const col of ['players','attendance','expenses','incomes','dailyMeetings','matchRecords','shares','settings','coachPlans']){
        const ref=doc(db,col,`fixture-${uid}`);
        await check(true,getDoc(ref),`${col} get ${uid}`);
        await check(true,getDocs(collection(db,col)),`${col} list ${uid}`);
        await check(admin,setDoc(ref,{fixture:true}),`${col} create ${uid}`);
        if(admin)await check(true,updateDoc(ref,{fixture:false}),`${col} update ${uid}`);
        await check(admin,deleteDoc(ref),`${col} delete ${uid}`);
      }
      await check(admin,setDoc(doc(db,'votes',uid),{fixture:true}),`votes write ${uid}`);
      await check(true,setDoc(doc(db,'votes/fixture/responses',uid),{status:'attend'}),`anonymous RSVP ${uid}`);
      await check(true,updateDoc(doc(db,'votes/fixture/responses',uid),{status:'maybe'}),`RSVP update ${uid}`);
      await check(admin,deleteDoc(doc(db,'votes/fixture/responses',uid)),`RSVP delete ${uid}`);
      for(const p of ['ratings/fixture','ratings/fixture/votes/voter']){
        await check(admin,getDoc(doc(db,p)),`private ratings get ${uid}`);
        await check(false,setDoc(doc(db,p),{fixture:true}),`ratings client write ${uid}`);
      }
      await check(true,getDoc(doc(db,'ratingResults/fixture')),`results get ${uid}`);
      await check(false,getDocs(collection(db,'ratingResults')),`results list ${uid}`);
      await check(false,setDoc(doc(db,'ratingResults/fixture'),{}),`results write ${uid}`);
      await check(false,getDoc(doc(db,'ratingParticipation/fixture/voters/name')),`participation ${uid}`);
      await check(uid==='test-member'||uid==='test-coach',getDoc(doc(db,'privatePositionPreferences/test-member')),`survey private ${uid}`);
      await check(uid==='test-coach',getDocs(collection(db,'privatePositionPreferences')),`survey list ${uid}`);
      await check(uid==='test-member',setDoc(doc(db,'privatePositionPreferences/test-member'),survey()),`survey self update ${uid}`);
      await check(false,deleteDoc(doc(db,'privatePositionPreferences/test-member')),`survey deletion ${uid}`);
      const cycleRef=doc(db,'teamCycles',`new-${uid}`);
      await check(withCycles?admin:true,getDoc(doc(db,'teamCycles/existing')),`cycle get ${uid}`);
      await check(withCycles?admin:true,getDocs(collection(db,'teamCycles')),`cycle list ${uid}`);
      await check(admin,setDoc(cycleRef,cycle(uid)),`cycle create ${uid}`);
      await check(withCycles?false:admin,updateDoc(doc(db,'teamCycles/existing'),{startDate:'2026-10-01'}),`cycle update ${uid}`);
      // Use a separate existing doc per identity to actually test deletion, not missing-data behavior.
      await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'teamCycles',`delete-${uid}`),cycle('test-admin')));
      await check(withCycles?false:admin,deleteDoc(doc(db,'teamCycles',`delete-${uid}`)),`cycle delete ${uid}`);
    }
    if(withCycles){
      const db=env.authenticatedContext('test-admin',google).firestore();
      for(const [label,value] of [['foreign-author',{...cycle('someone-else')}],['extra-field',{...cycle('test-admin'),secret:'no'}],['empty-members',{...cycle('test-admin'),members:[]}],['wrong-version',{...cycle('test-admin'),schemaVersion:2}],['client-time',{...cycle('test-admin'),createdAt:new Date()}]])
        await check(false,setDoc(doc(db,'teamCycles',label),value),label);
      const dbMember=env.authenticatedContext('new-member',google).firestore();
      await check(true,setDoc(doc(dbMember,'privatePositionPreferences/new-member'),survey()),'new survey self create');
      await check(false,updateDoc(doc(dbMember,'privatePositionPreferences/new-member'),{name:'Fixture Two',updatedAt:serverTimestamp()}),'survey identity locked');
    }
  }finally{await env.cleanup();}
}
(async()=>{await run(baseline,false);await run(integrated,true);console.log(`PASS: ${checks} actual emulator Rules checks; legacy access preserved, cycles admin create/read only.`);})().catch(e=>{console.error(e);process.exitCode=1;});
