import test from 'node:test';
import assert from 'node:assert/strict';
import {planDuties} from '../js/modules/dutyRotation.js';

const squads=(a,b=a)=>[a,b].map((n,t)=>Array.from({length:n},(_,i)=>`${t}-${i+1}`));
const nonField=(d,q,dedicated)=>d.resters[q].concat(dedicated.includes(d.gks[q])?[]:[d.gks[q]]);

test('22-player 10v10 and 24-player 11v11 never put a keeper straight into referee/rest or vice versa',()=>{
    for(const size of [10,11]){
        const teams=squads(size+1),r=planDuties(teams,teams.flat(),teams.map(()=>Array(6).fill(size)));
        for(const d of r.teams)for(let q=1;q<6;q++){
            assert.ok(!d.resters[q].includes(d.gks[q-1]));
            assert.ok(!d.resters[q-1].includes(d.gks[q]));
            assert.ok(nonField(d,q,[]).every(n=>!nonField(d,q-1,[]).includes(n)));
        }
        assert.ok(r.teams.every(d=>d.gks.length===6));
    }
});

test('unified rest is fair, follows late RSVP order, minimises consecutive exclusions and never duplicates roles',()=>{
    for(const count of [4,6])for(const size of [9,10,11])for(const extra of [0,1,2,3,5,8,12])for(const dedicated of [false,true]){
        const teams=squads(size+extra,size+extra+1),keepers=dedicated?teams.map(t=>t[0]):[];
        const capacities=teams.map((_,t)=>Array.from({length:count},(_,q)=>size-(q%3===1?1:0)));
        const before=JSON.stringify({teams,capacities,keepers});
        const r=planDuties(teams,teams.flat(),capacities,keepers,{fairMinutes:true});
        for(const [t,d] of r.teams.entries()){
            const regular=teams[t].filter(n=>!keepers.includes(n));
            const totals=regular.map(n=>Array.from({length:count},(_,q)=>nonField(d,q,keepers).includes(n)).filter(Boolean).length);
            assert.ok(Math.max(...totals)-Math.min(...totals)<=1);
            for(let q=0;q<count;q++){
                const group=nonField(d,q,keepers);
                assert.equal(d.resters[q].length,teams[t].length-capacities[t][q]);
                assert.equal(new Set(group).size,group.length);assert.ok(group.every(n=>regular.includes(n)));
                assert.ok(!d.resters[q].includes(d.gks[q]));
                assert.equal(d.referees[q],r.teams[0].referees[q]);
                if(dedicated)assert.equal(d.gks[q],keepers[t]);
                if(q){
                    const previous=nonField(d,q-1,keepers);
                    assert.equal(group.filter(n=>previous.includes(n)).length,Math.max(0,previous.length+group.length-regular.length));
                }
            }
        }
        for(let q=0;q<count;q++){
            const ref=r.teams[0].referees[q];
            const available=teams.map((_,t)=>t).filter(t=>teams[t].length>capacities[t][q]);
            if(available.length)assert.ok(r.teams.some(d=>d.resters[q].includes(ref)));
            else assert.equal(ref,null);
            if(q&&available.length===2)assert.notEqual(teams.findIndex(t=>t.includes(ref)),teams.findIndex(t=>t.includes(r.teams[0].referees[q-1])));
        }
        assert.equal(JSON.stringify({teams,capacities,keepers}),before);
        const again=planDuties(teams,teams.flat(),capacities,keepers);
        assert.deepEqual(again,r,'both event and training modes use the same combined accounting');
    }
});

test('impossible no-consecutive conditions are reported instead of failing generation; dedicated GK remains exempt',()=>{
    const teams=squads(22),r=planDuties(teams,teams.flat(),teams.map(()=>Array(6).fill(11)));
    assert.ok(r.notes.some(n=>n.includes('연속 필드 미출전이 불가피')));
    const keeperTeams=squads(12),keepers=keeperTeams.map(t=>t[0]);
    const dedicated=planDuties(keeperTeams,keeperTeams.flat(),keeperTeams.map(()=>Array(6).fill(11)),keepers);
    assert.ok(dedicated.notes.every(n=>!n.includes('연속 필드')));
    assert.ok(dedicated.teams.every((d,t)=>d.gks.every(n=>n===keepers[t])));
    const late=planDuties(squads(12),squads(12).flat(),[Array(6).fill(11),Array(6).fill(11)]);
    assert.equal(late.teams[0].referees[0],'1-12');assert.equal(late.teams[1].gks[0],'1-11');
    assert.equal(late.teams[0].gks[0],'0-12');
});
