import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedCycle} from '../js/modules/approvedCycle.js';
import {validateCycle,matchFromCycle} from '../js/modules/teamCycleCore.js';
import {planDuties} from '../js/modules/dutyRotation.js';

test('approved roster preserves coach overrides, exclusions and fullback partnership; no skills/private fields',()=>{
    const c=approvedCycle('2026-10-07');validateCycle(c);
    assert.deepEqual([0,1].map(t=>c.members.filter(p=>p.team===t).length),[18,17]);
    const member=n=>c.members.find(p=>p.name===n);
    assert.equal(member('전성우').team,member('최준경').team);assert.equal(member('전성우').role,'LB');
    assert.equal(member('송진호').role,'CB');assert.equal(member('송진호').second,'RW');
    assert.equal(member('김건효').role,'CB');assert.equal(member('김건효').second,'CB');
    for(const n of ['고태호','정우영','차민수'])assert.equal(member(n),undefined);
    assert.ok(c.members.every(p=>Object.keys(p).sort().join(',')==='name,role,second,team'));
    assert.equal(approvedCycle('2026-10-06'),null);assert.equal(approvedCycle('2026-12-02'),null);
});
test('known extras fill role gaps before unknown guests without changing any permanent source',()=>{
    const cycle=approvedCycle('2026-10-07'),names=['김해식','김대근','김규남','정명일','윤중부','이찬희','Casey','박정진','황영조','김세웅','김건효','김경윤','나원건','김겸일','전의용','박경용','전성우','Kei','Woody','Zhang Ming','Eric','Maxi','Cai'];
    const players={Woody:{name:'Woody',pos1:['LB','RB']},Eric:{name:'Eric',pos1:['MF']},Cai:{name:'Cai',pos1:['LB','RB']}};
    const before=JSON.stringify({cycle,names,players}),r=matchFromCycle(cycle,names,'2026-10-07',players,{fillExtras:true});
    assert.equal(r.unassigned.length,0);assert.equal(r.temporary.length,5);assert.equal(r.teams.flat().length,23);
    assert.ok(Math.abs(r.teams[0].length-r.teams[1].length)<=1);assert.equal(new Set(r.teams.flat().map(p=>p.name)).size,23);
    assert.ok(r.temporary.slice(0,3).every(p=>p.knownRole));assert.ok(r.temporary.slice(3).every(p=>!p.knownRole));
    assert.ok(r.temporary.filter(p=>!p.knownRole).every(p=>p.role!=='GK'),'unknown guests are not assigned dedicated GK training roles');
    assert.equal(r.teams[1].some(p=>p.name==='전성우'),true);
    assert.equal(JSON.stringify({cycle,names,players}),before);
    const lower=matchFromCycle(cycle,['kei','Casey'],'2026-10-07',{}, {fillExtras:true});
    assert.equal(lower.temporary.length,0);assert.ok(lower.teams.flat().some(p=>p.name==='kei'));
});
test('fair cycle duty allocation includes all guests, preserves GK/ref constraints and has at most one-quarter gap',()=>{
    for(const count of [4,6])for(const n of [11,12,13,14,16,18])for(const dedicated of [false,true]){
        const teams=[0,1].map(t=>Array.from({length:n},(_,i)=>`${t}-Guest${i}`)),keepers=dedicated?teams.map(t=>t[0]):[];
        const input=JSON.stringify(teams),r=planDuties(teams,teams.flat(),teams.map(()=>Array(count).fill(11)),keepers,{fairMinutes:true});
        for(const [t,d]of r.teams.entries()){
            const rests=teams[t].filter(n=>!keepers.includes(n)).map(n=>d.resters.filter(row=>row.includes(n)).length);
            assert.ok(Math.max(...rests)-Math.min(...rests)<=1,`${n} players ${count} quarters dedicated=${dedicated}`);
            for(let q=0;q<count;q++){
                assert.equal(d.resters[q].length,n-11);assert.equal(new Set(d.resters[q]).size,n-11);
                assert.ok(!d.resters[q].includes(d.gks[q]));assert.ok(teams[t].includes(d.gks[q]));
                assert.equal(r.teams[0].referees[q],r.teams[1].referees[q]);
                if(n>11)assert.ok(r.teams.some(d=>d.resters[q].includes(d.referees[q])));
            }
        }
        assert.equal(JSON.stringify(teams),input);
    }
});
