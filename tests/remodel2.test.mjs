import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveQueue} from '../js/modules/saveQueue.js';
import {quarterCount,activeQuarters,preserveInactiveQuarters} from '../js/modules/quarters.js';
import {planDuties} from '../js/modules/dutyRotation.js';
import {prepareShareLineups} from '../js/modules/shareLineupValidation.js';
import {lineupImageModel} from '../js/modules/lineupImage.js';
import {readFileSync} from 'node:fs';

test('ledger coalesces fields per row, never drops rapid taps on different rows',async()=>{
 const writes=[];const q=createSaveQueue(async(key,patch)=>writes.push({key,patch}),()=>{},5000);
 q.enqueue('A',{paymentStatus:'●',paymentAmount:50});q.enqueue('B',{paymentStatus:'△',paymentAmount:25});q.enqueue('A',{payMethod:'cash'});
 assert.equal(q.dirty(),true);await q.flush();assert.equal(q.dirty(),false);
 assert.deepEqual(writes,[{key:'A',patch:{paymentStatus:'●',paymentAmount:50,payMethod:'cash'}},{key:'B',patch:{paymentStatus:'△',paymentAmount:25}}]);
});
test('failed ledger patch retains newer edits, retry is explicit',async()=>{
 let fail=true;const writes=[];const q=createSaveQueue(async(key,patch)=>{if(fail)throw new Error('offline');writes.push(patch);},()=>{},5000);
 q.enqueue('A',{paymentAmount:50,note:'keep'});await assert.rejects(q.flush());
 q.enqueue('A',{paymentAmount:25});assert.deepEqual(q.pending('A'),{paymentAmount:25,note:'keep'});
 fail=false;await q.flush();assert.deepEqual(writes,[{paymentAmount:25,note:'keep'}]);assert.equal(q.dirty(),false);
});
test('editing while a row saves is serialized and flush waits for both',async()=>{
 let release;const gate=new Promise(r=>release=r),writes=[];
 const q=createSaveQueue(async(key,patch)=>{writes.push(patch);if(writes.length===1)await gate;},()=>{},5000);
 q.enqueue('A',{note:'first'});const flush=q.flush();await Promise.resolve();
 q.enqueue('A',{note:'second'});assert.deepEqual(q.pending('A'),{note:'second'});release();await flush;
 assert.deepEqual(writes,[{note:'first'},{note:'second'}]);assert.equal(q.dirty(),false);
});
test('four-quarter view/regeneration preserves original fifth and sixth arrays',()=>{
 assert.equal(quarterCount({}),6);assert.equal(quarterCount({quarterCount:4}),4);
 const old={lineups:Array.from({length:6},(_,i)=>({FW:[`old${i}`]})),resters:Array.from({length:6},()=>['rest']),formations:Array(6).fill('F'),referees:Array(6).fill('ref')};
 const before=JSON.stringify(old),candidate=activeQuarters(old,4);candidate.lineups=candidate.lineups.map(()=>({FW:['new']}));
 const merged=preserveInactiveQuarters(candidate,old,4);
 assert.deepEqual(merged.lineups.slice(4),old.lineups.slice(4));assert.deepEqual(merged.lineups.slice(0,4),candidate.lineups);
 assert.equal(activeQuarters(merged,4).lineups.length,4);assert.equal(activeQuarters(merged,6).lineups.length,6);assert.equal(JSON.stringify(old),before);
});
test('four-quarter duties, publication and image agree; stale inactive source is not changed',()=>{
 const teams=[['A','B','C'],['D','E','F']],order=teams.flat();
 const duty=planDuties(teams,order,[Array(4).fill(2),Array(4).fill(2)]);
 assert.equal(duty.teams[0].gks.length,4);assert.deepEqual(duty.teams[0].referees.map(n=>teams[0].includes(n)),[false,true,false,true]);
 const source=teams.map(team=>({lineups:[...Array.from({length:4},()=>({GK:[team[0]],FW:[team[1]]})),{FW:['stale5']},{FW:['stale6']}],resters:Array.from({length:6},()=>[team[2]]),formations:Array(6).fill('F')}));
 const before=JSON.stringify(source),positions={F:[{pos:'GK',x:50,y:90},{pos:'FW',x:50,y:20}]};
 const result=prepareShareLineups(source,teams,positions,4);assert.equal(result[0].lineups.length,4);
 const image=lineupImageModel({quarterCount:4,teams:{team1:teams[0]},lineups:{team1:result[0]}},'team1',positions);
 assert.equal(image.quarters.length,4);assert.equal(JSON.stringify(source),before);
 assert.throws(()=>prepareShareLineups(source,teams,positions,6));
});
test('score module no longer has a players write or apply-Elo path',()=>{
 const source=readFileSync(new URL('../js/modules/matchRecord.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/applyElo|elo-apply-btn|doc\(db,\s*["']players["']/);
});
