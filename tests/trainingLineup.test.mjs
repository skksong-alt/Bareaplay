import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTrainingRoles,trainingForDate,trainingRole,trainingReport} from '../js/modules/trainingLineup.js';
import {approvedCycle} from '../js/modules/approvedCycle.js';
const map={'4-2-3-1':[{pos:'GK',y:92},{pos:'RB',y:78},{pos:'CB',y:82},{pos:'CB',y:82},{pos:'LB',y:78},{pos:'MF',y:65},{pos:'MF',y:65},{pos:'RW',y:40},{pos:'MF',y:45},{pos:'LW',y:40},{pos:'FW',y:18}]};
const original=()=>({members:['keeper','rb','cb1','cb2','lb','attack','deep1','rw','deep2','lw','fw','rest'],formations:Array(6).fill('4-2-3-1'),lineups:Array.from({length:6},()=>({GK:['keeper'],RB:['rb'],CB:['cb1','cb2'],LB:['lb'],MF:['attack','deep1','deep2'],RW:['rw'],LW:['lw'],FW:['fw']})),resters:Array.from({length:6},()=>['rest']),referees:Array(6).fill('rest'),manualReferees:Array(6).fill(null),score:0});
const members=[{name:'attack',role:'AM',second:'AM'},{name:'deep1',role:'DM',second:'DM'},{name:'deep2',role:'DM',second:'DM'}];

test('approved AM priority overrides assessed FW on a published-shaped October 7 lineup without modifying the snapshot',()=>{
    const field={GK:['Zhang Ming'],RB:['박정진'],CB:['김건효','이찬희'],LB:['김경윤'],MF:['Eric','정명일','박경용'],RW:['김대근'],LW:['Kei'],FW:['김해식']};
    const input={members:Object.values(field).flat(),formations:Array(6).fill('4-2-3-1'),lineups:Array.from({length:6},()=>structuredClone(field)),resters:Array.from({length:6},()=>[]),referees:Array(6).fill(null)};
    const before=JSON.stringify(input),plan=approvedCycle('2026-10-07');
    const result=applyTrainingRoles(input,plan.members,map,{'김해식':{pos1:['FW'],pos2:['CM']}});
    assert.equal(JSON.stringify(input),before,'inspection never overwrites the existing lineup');
    for(const quarter of result.lineups)assert.equal(quarter.MF[2],'김해식');
    assert.equal(result.lineups.filter(q=>q.RB[0]==='김대근').length,6);
    assert.equal(result.lineups.filter(q=>q.CB.includes('이찬희')).length,6);
    assert.deepEqual(result.resters,input.resters);assert.deepEqual(result.referees,input.referees);
});
test('coach fills the remaining field gap after trainees, without a CB/RW preference or duty changes',()=>{
    const field={GK:['Keeper'],RB:['김대근'],CB:['송진호','김건효'],LB:['김경윤'],MF:['정명일','지승현','김해식'],RW:['윤중부'],LW:['Kei'],FW:['이찬희']};
    const input={members:Object.values(field).flat(),formations:Array(6).fill('4-2-3-1'),lineups:Array.from({length:6},()=>structuredClone(field)),resters:Array.from({length:6},()=>[]),referees:Array(6).fill(null)};
    const before=JSON.stringify(input),plan=approvedCycle('2026-10-07');
    const result=applyTrainingRoles(input,plan.members,map,{'송진호':{pos1:['CB'],pos2:['RW']}});
    for(const quarter of result.lineups){
        assert.ok(quarter.CB.includes('이찬희'));assert.ok(quarter.CB.includes('김건효'));
        assert.equal(quarter.FW[0],'송진호','remaining FW vacancy, not his previously assessed CB');
        assert.equal(new Set(Object.values(quarter).flat()).size,11);
    }
    assert.ok(trainingReport(result,plan.members,map).every(p=>p.name!=='송진호'));
    assert.equal(JSON.stringify(input),before);assert.deepEqual(result.resters,input.resters);assert.deepEqual(result.referees,input.referees);
});
test('training assignment distinguishes double pivot and attacking midfielder without changing duties or originals',()=>{
    const input=original(),before=JSON.stringify(input),planBefore=JSON.stringify(members);
    const output=applyTrainingRoles(input,members,map);
    assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(members),planBefore);
    for(let q=0;q<6;q++){
        assert.equal(output.lineups[q].MF[2],'attack');assert.deepEqual(output.lineups[q].MF.slice(0,2).sort(),['deep1','deep2']);
        assert.deepEqual(output.lineups[q].GK,input.lineups[q].GK);
        assert.deepEqual(Object.values(output.lineups[q]).flat().sort(),Object.values(input.lineups[q]).flat().sort());
    }
    for(const key of ['resters','referees','manualReferees','formations','members','score'])assert.deepEqual(output[key],input[key]);
});
test('training preserves explicit field locks and is completely opt-in and date scoped',()=>{
    const input=original(),output=applyTrainingRoles(input,members,map,{},[{name:'attack',q:0}]);
    assert.equal(output.lineups[0].MF[0],'attack');assert.equal(output.lineups[1].MF[2],'attack');
    assert.equal(applyTrainingRoles(input,[],map),input);
    const context={date:'2026-09-30',startDate:'2026-09-23',endDateExclusive:'2026-11-18',members};
    assert.equal(trainingForDate(context,'2026-09-30'),members);
    assert.deepEqual(trainingForDate(context,'2026-10-07'),[]);
    assert.deepEqual(trainingForDate({...context,date:'2026-11-18'},'2026-11-18'),[]);
    assert.equal(trainingRole({pos:'CM',y:60}),'DM');
});
test('oversubscribed role rotates at three-quarter boundaries, not every quarter',()=>{
    const plan=members.map(p=>({...p,role:'DM',second:'DM'}));
    const result=applyTrainingRoles(original(),plan,map);
    assert.deepEqual(plan.map(p=>result.lineups.filter(q=>q.MF.slice(0,2).includes(p.name)).length).sort(),[3,3,6]);
    for(const start of [0,3])for(let q=start+1;q<start+3;q++)assert.deepEqual(result.lineups[q],result.lineups[start]);
});
test('secondary is a fallback, fewer-sided formations and unknown players retain valid unique slots',()=>{
    for(const size of [9,10,11]){
        const cells=[{pos:'GK',y:92},...Array.from({length:size-1},(_,i)=>({pos:i===0?'LB':i===1?'LW':'CB',y:70}))];
        const lineup={GK:['K'],LB:['wing'],LW:['back'],CB:Array.from({length:size-3},(_,i)=>'C'+i)};
        const input={members:Object.values(lineup).flat(),formations:Array(6).fill('f'),lineups:Array.from({length:6},()=>structuredClone(lineup)),resters:Array.from({length:6},()=>[]),referees:Array(6).fill(null)};
        const result=applyTrainingRoles(input,[{name:'wing',role:'FW',second:'LW'},{name:'back',role:'LB',second:'CB'}],{f:cells});
        assert.equal(result.lineups[0].LW[0],'wing');assert.equal(result.lineups[0].LB[0],'back');
        assert.equal(new Set(Object.values(result.lineups[0]).flat()).size,size);
    }
});

test('three RB-only preferences all get a turn even when two blocks cannot fit three players',()=>{
    const input=original(),plan=['rb','cb1','cb2'].map(name=>({name,role:'RB',second:'RB'}));
    const result=applyTrainingRoles(input,plan,map);
    const report=trainingReport(result,plan,map);
    assert.ok(report.every(p=>p.first>=1));
    assert.equal(report.reduce((n,p)=>n+p.first,0),6);
    assert.deepEqual(result.resters,input.resters);assert.deepEqual(result.lineups.map(q=>q.GK),input.lineups.map(q=>q.GK));
});

test('whole-match planning reserves a scarce appearance; no early greedy starvation',()=>{
    const input=original();
    // rb is available only in Q1; cb1 can take RB in the remaining five quarters.
    for(let q=1;q<6;q++){input.lineups[q].RB=['rest'];input.resters[q]=['rb'];}
    const plan=[{name:'cb1',role:'RB',second:'RB'},{name:'rb',role:'RB',second:'RB'}];
    const result=applyTrainingRoles(input,plan,map);
    assert.equal(result.lineups[0].RB[0],'rb');
    assert.equal(result.lineups.slice(1).every(q=>q.RB[0]==='cb1'),true);
});

test('10-a-side 4-1-3-1 supports fullbacks and AM; legacy 3-4-2 explains missing slots',()=>{
    const cells=map['4-2-3-1'].filter((s,i)=>i!==6),small={'4-1-3-1':cells};
    for(const count of [4,6]){
        const input=original();input.members=input.members.filter(n=>n!=='deep1');input.lineups=input.lineups.slice(0,count);input.formations=Array(count).fill('4-1-3-1');
        input.lineups.forEach(q=>{q.MF=['attack','deep2'];});
        const plan=[{name:'attack',role:'AM',second:'AM'},{name:'rb',role:'RB',second:'RB'}];
        const result=applyTrainingRoles(input,plan,small);
        assert.ok(result.lineups.every(q=>q.MF[1]==='attack'&&q.RB[0]==='rb'));
        assert.ok(result.lineups.every(q=>new Set(Object.values(q).flat()).size===10));
        assert.ok(trainingReport(result,plan,small).every(p=>p.first===count));
    }
    const legacy={members:['K','B','C','D'],formations:Array(6).fill('3-4-2'),lineups:Array.from({length:6},()=>({GK:['K'],CB:['B','C'],RW:['D']}))};
    const legacyMap={'3-4-2':[{pos:'GK',y:92},{pos:'CB',y:80},{pos:'CB',y:80},{pos:'RW',y:50}]};
    assert.match(trainingReport(legacy,[{name:'D',role:'RB',second:'RB'}],legacyMap)[0].reason,/자리가 없습니다.*4-1-3-1/);
});

test('fixed seats remain untouched and zero-primary warnings explain locks',()=>{
    const input=original(),plan=[{name:'cb1',role:'RB',second:'RB'}],locks=Array.from({length:6},(_,q)=>({name:'rb',q}));
    const result=applyTrainingRoles(input,plan,map,{},locks);
    assert.ok(result.lineups.every(q=>q.RB[0]==='rb'));
    assert.match(trainingReport(result,plan,map,locks)[0].reason,/고정/);
});
