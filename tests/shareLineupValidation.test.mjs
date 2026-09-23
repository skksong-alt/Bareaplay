import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareShareLineups } from '../js/modules/shareLineupValidation.js';
import { validateLineup } from '../js/modules/coachCore.js';

const slots={ '3-4-2': ['GK','CB','CB','CB','RW','CM','CM','LW','FW','FW'].map(pos=>({pos})) };
const make=(prefix)=>{
    const names=Array.from({length:11},(_,i)=>`${prefix}${i+1}`);
    const q={GK:[names[0]],CB:names.slice(1,4),RW:[names[4]],CM:names.slice(5,7),LW:[names[7]],FW:names.slice(8,10)};
    return {names,result:{members:names,formations:Array(6).fill('3-4-2'),lineups:Array.from({length:6},()=>structuredClone(q)),resters:Array.from({length:6},()=>[names[10]]),referees:Array(6).fill(names[10])}};
};

test('share uses the visible 10v10 positions and never modifies saved A or B lineups',()=>{
    const a=make('A'),b=make('B');
    a.result.lineups[2].MF=['old unused position'];
    assert.equal(validateLineup(a.result,a.names),false,'old raw validator rejects an invisible legacy key');
    const source=[a.result,b.result],before=JSON.stringify(source);
    const ready=prepareShareLineups(source,[a.names,b.names],slots);
    assert.equal(JSON.stringify(source),before,'saved team and lineup data remain unchanged');
    assert.equal(ready[0].lineups[2].MF,undefined);
    for(const [index,names] of [a.names,b.names].entries()) {
        assert.equal(ready[index].lineups.length,6);
        assert.ok(validateLineup(ready[index],names));
        for(let q=0;q<6;q++)assert.equal(Object.values(ready[index].lineups[q]).flat().length,10);
    }
});

test('share still blocks a truly incomplete, duplicate, or mismatched visible lineup',()=>{
    const a=make('A');
    a.result.lineups[0].FW[1]='';
    assert.throws(()=>prepareShareLineups([a.result],[a.names],slots),/팀 1 1쿼터: 필드에 빈 자리/);
    a.result.lineups[0].FW[1]=a.names[8];
    assert.throws(()=>prepareShareLineups([a.result],[a.names],slots),/팀 1 1쿼터: 화면의 출전·휴식 명단/);
    a.result.lineups[0].FW[1]=a.names[9];
    a.result.resters[0]=[a.names[0]];
    assert.throws(()=>prepareShareLineups([a.result],[a.names],slots),/팀 1 1쿼터: 화면의 출전·휴식 명단/);
});
