import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTrainingRoles,trainingForDate,trainingRole} from '../js/modules/trainingLineup.js';
const map={'4-2-3-1':[{pos:'GK',y:92},{pos:'RB',y:78},{pos:'CB',y:82},{pos:'CB',y:82},{pos:'LB',y:78},{pos:'MF',y:65},{pos:'MF',y:65},{pos:'RW',y:40},{pos:'MF',y:45},{pos:'LW',y:40},{pos:'FW',y:18}]};
const original=()=>({members:['keeper','rb','cb1','cb2','lb','attack','deep1','rw','deep2','lw','fw','rest'],formations:Array(6).fill('4-2-3-1'),lineups:Array.from({length:6},()=>({GK:['keeper'],RB:['rb'],CB:['cb1','cb2'],LB:['lb'],MF:['attack','deep1','deep2'],RW:['rw'],LW:['lw'],FW:['fw']})),resters:Array.from({length:6},()=>['rest']),referees:Array(6).fill('rest'),manualReferees:Array(6).fill(null),score:0});
const members=[{name:'attack',role:'AM',second:'AM'},{name:'deep1',role:'DM',second:'DM'},{name:'deep2',role:'DM',second:'DM'}];
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
test('oversubscribed training role distributes available field opportunities across quarters',()=>{
    const plan=members.map(p=>({...p,role:'DM',second:'DM'}));
    const result=applyTrainingRoles(original(),plan,map);
    for(const p of plan)assert.equal(result.lineups.filter(q=>q.MF.slice(0,2).includes(p.name)).length,4);
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
