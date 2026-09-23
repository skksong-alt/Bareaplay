import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberedRatingName,rememberRatingName,ratingRememberEnabled,setRatingRememberEnabled,wasRatingSubmittedHere,markRatingSubmittedHere,ratingConfirmation } from '../js/modules/ratingIdentity.js';
import ratings from '../server/ratings.cjs';
const {createHandler,topThree,productionServices}=ratings;
const date='2026-09-20',names=['A','B','C','D','E'];
function fixture() {
    const records=new Map([
        [`dailyMeetings/${date}`,{teams:{team_0:names.map(name=>({name}))}}],
        [`ratings/${date}`,{date,legacy:'keep',votes:{A:{picks:['B','C','D'],at:10},B:{picks:['C','D','E'],at:20,legacy:'keep'}}}],
        ['attendance/legacy',{amount:123}],['players/A',{name:'A'}]
    ]);
    const writes=[];
    const merge=(a,b)=>{for(const [k,v] of Object.entries(b))if(v&&typeof v==='object'&&!Array.isArray(v))a[k]=merge(a[k]||{},v);else a[k]=structuredClone(v);return a;};
    const db={doc:p=>p,runTransaction:async callback=>{
        const pending=[];
        const result=await callback({getAll:async(...paths)=>paths.map(path=>({exists:records.has(path),data:()=>structuredClone(records.get(path))})),set:(...args)=>pending.push(args)});
        for(const [path,value,options]of pending){records.set(path,options?.merge?merge(records.get(path)||{},value):structuredClone(value));writes.push(path);}
        return result;
    }};
    const env={BAREA_RATINGS_ENABLED:'true',BAREA_PUBLIC_ORIGIN:'https://example.test'};
    const handler=createHandler({env,services:()=>({db,timestamp:()=>'<server timestamp>',secret:'test-only-not-a-production-secret'}),now:()=>Date.parse('2026-09-23T12:00:00Z'),nonce:()=>String(writes.length)});
    const call=async(body,headers={origin:'https://example.test','content-type':'application/json'})=>{
        const result={headers:{}};await handler({method:'POST',headers,body},{setHeader:(k,v)=>result.headers[k]=v,status:n=>{result.status=n;return{json:value=>{result.body=value;}};}});return result;
    };
    return {call,records,writes,env};
}
test('device remembers only a name and submission marker, never picks; blocked storage is safe',()=>{
    const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
    assert.equal(rememberRatingName('A',storage),true);assert.equal(rememberedRatingName(storage),'A');
    markRatingSubmittedHere(date,'A',storage);assert.equal(wasRatingSubmittedHere(date,'A',storage),true);
    assert.equal(wasRatingSubmittedHere('2026-09-21','A',storage),false);
    assert.deepEqual([...data.values()],['A','1']);rememberRatingName('',storage);assert.equal(rememberedRatingName(storage),'');
    setRatingRememberEnabled(false,storage);assert.equal(ratingRememberEnabled(storage),false);assert.equal(rememberedRatingName(storage),'');
    setRatingRememberEnabled(true,storage);assert.equal(ratingRememberEnabled(storage),true);
    const blocked={getItem:()=>{throw Error();},setItem:()=>{throw Error();}};
    assert.equal(rememberedRatingName(blocked),'');assert.equal(rememberRatingName('A',blocked),false);assert.doesNotThrow(()=>markRatingSubmittedHere(date,'A',blocked));
    assert.match(ratingConfirmation('A',false),/다른 기기/);assert.match(ratingConfirmation('A',true),/교체|바꿀까요/);
});
test('legacy submission status and initial leaders do not expose or rewrite any ballot',async()=>{
    const f=fixture(),before=structuredClone([...f.records]);
    const status=await f.call({action:'status',date,name:'A'});
    assert.equal(status.status,200);assert.equal(status.body.exists,true);assert.deepEqual(Object.keys(status.body).sort(),['exists','version']);
    const newName=await f.call({action:'status',date,name:'E'});assert.equal(newName.body.exists,false);
    const leaders=await f.call({action:'leaders',date});assert.deepEqual(leaders.body,{leaders:['C','B','D']});
    assert.deepEqual([...f.records],before);assert.deepEqual(f.writes,[]);assert.match(status.headers['Cache-Control'],/no-store/);
});
test('replacement, receipt and score-free leaders are atomic and preserve all other records',async()=>{
    const f=fixture(),other=structuredClone(f.records.get(`ratings/${date}`).votes.B);
    const status=await f.call({action:'status',date,name:'A'});
    const saved=await f.call({action:'submit',date,name:'A',picks:['E','D','C'],expectedVersion:status.body.version});
    assert.deepEqual(saved.body,{saved:true});assert.equal(saved.status,200);
    assert.deepEqual(f.records.get(`ratings/${date}`).votes.B,other);assert.equal(f.records.get(`ratings/${date}`).legacy,'keep');
    assert.deepEqual(f.records.get(`ratings/${date}`).votes.A.picks,['E','D','C']);
    assert.deepEqual(f.records.get('attendance/legacy'),{amount:123});assert.deepEqual(f.records.get('players/A'),{name:'A'});
    assert.deepEqual(f.writes,[`ratings/${date}`,`ratingParticipation/${date}/voters/A`,`ratingResults/${date}`]);
    assert.deepEqual(Object.keys(f.records.get(`ratingResults/${date}`)).sort(),['date','leaders','updatedAt']);
    assert.deepEqual(Object.keys(f.records.get(`ratingParticipation/${date}/voters/A`)).sort(),['revision','submitted','updatedAt']);
    const again=await f.call({action:'status',date,name:'A'});assert.notEqual(again.body.version,status.body.version);
});
test('a stale confirmation cannot overwrite a ballot changed on another device',async()=>{
    const f=fixture(),status=await f.call({action:'status',date,name:'A'});
    f.records.get(`ratings/${date}`).votes.A={picks:['D','C','B'],at:99};
    const saved=await f.call({action:'submit',date,name:'A',picks:['E','D','C'],expectedVersion:status.body.version});
    assert.equal(saved.status,409);assert.deepEqual(saved.body,{error:'changed'});assert.deepEqual(f.writes,[]);
    assert.deepEqual(f.records.get(`ratings/${date}`).votes.A.picks,['D','C','B']);
});
test('invalid/self/duplicate picks and unknown names are rejected with zero writes',async()=>{
    const f=fixture(),status=await f.call({action:'status',date,name:'A'});
    for(const picks of [['A','B','C'],['B','B','C'],['B','C','outsider'],['B']])assert.equal((await f.call({action:'submit',date,name:'A',picks,expectedVersion:status.body.version})).status,400);
    for(const name of ['outsider','__proto__','a/b'])assert.equal((await f.call({action:'status',date,name})).status,400);
    assert.equal((await f.call({action:'status',date:'2026-09-30',name:'A'})).status,400);
    assert.deepEqual(f.writes,[]);
});
test('release gate and cross-origin requests fail closed; no Google login is required',async()=>{
    const f=fixture();f.env.BAREA_RATINGS_ENABLED='false';
    assert.equal((await f.call({action:'status',date,name:'A'})).status,503);
    f.env.BAREA_RATINGS_ENABLED='true';assert.equal((await f.call({action:'status',date,name:'A'},{origin:'https://other.test','content-type':'application/json'})).status,403);
    assert.equal((await f.call({action:'status',date,name:'A'})).status,200);assert.deepEqual(f.writes,[]);
});
test('ranking returns at most three names, breaks ties deterministically and ignores invalid legacy ballots',()=>{
    assert.deepEqual(topThree({A:{picks:['B','C','D']},E:{picks:['D','C','B']},B:{picks:['B','C','D']}},names),['B','C','D']);
});
test('read-only bootstrap permits status and leaders but cannot write',async()=>{
    const f=fixture();f.env.BAREA_RATINGS_ENABLED='read-only';
    const status=await f.call({action:'status',date,name:'A'});
    assert.equal(status.status,200);
    assert.equal((await f.call({action:'leaders',date})).status,200);
    assert.equal((await f.call({action:'submit',date,name:'A',picks:['B','C','D'],expectedVersion:status.body.version})).status,503);
    assert.deepEqual(f.writes,[]);
});
test('keyless service requires a Vercel token and can initialize without a private key',async()=>{
    const env={GCP_PROJECT_ID:'example-project',GCP_PROJECT_NUMBER:'123456789',GCP_SERVICE_ACCOUNT_EMAIL:'rating@example-project.iam.gserviceaccount.com',GCP_WORKLOAD_IDENTITY_POOL_ID:'vercel',GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:'vercel',BAREA_RATING_VERSION_SECRET:'x'.repeat(32)};
    assert.throws(()=>productionServices(env,{headers:{}}),{code:'unavailable'});
    const service=productionServices(env,{headers:{'x-vercel-oidc-token':'synthetic-test-token'}});
    assert.equal(typeof service.db.runTransaction,'function');
    await service.close();
});
