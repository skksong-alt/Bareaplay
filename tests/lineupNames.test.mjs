import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../js/modules/coachCore.js';
import {planDuties,sharedRefereesFromLineups,rosterDutyOrder} from '../js/modules/dutyRotation.js';
import {quarterCount,preserveInactiveQuarters} from '../js/modules/quarters.js';
import {applyTrainingRoles,trainingForDate} from '../js/modules/trainingLineup.js';
import {confirmGuest,registeredVoteName,responseIdentity} from '../js/modules/voteOrder.js';

function fixture(confirm=true) {
    const names=Array.from({length:24},(_,i)=>`Player ${i+1}`);
    names[13]='Correct Name';names[22]='Kei';
    const order=names.map(n=>n==='Correct Name'?'Misspelled Name':n==='Kei'?'kei':n);
    const playerDB=Object.fromEntries(names.map(name=>[name,{name,pos1:['CM'],pos2:['CB'],s1:65}]));
    const state={meetingDate:'2026-09-30',playerDB,teams:[names.slice(0,12),names.slice(12)].map(ns=>ns.map(n=>playerDB[n])),initialAttendeeOrder:order,teamLineupCache:{}};
    const messages=[],questions=[];
    const context=vm.createContext({...core,quarterCount,preserveInactiveQuarters,applyTrainingRoles,trainingForDate,planDuties,sharedRefereesFromLineups,rosterDutyOrder,console,
        window:{voteMgmt:{getDutyOrder:async()=>{throw new Error('Live vote lookup must not run');}},showNotification:m=>messages.push(m),confirm:m=>{questions.push(m);return confirm;},prompt:m=>{questions.push(m);return confirm?'1':null;}},document:{getElementById:()=>({value:state.meetingDate})}});
    const source=readFileSync(new URL('../js/modules/lineupGenerator.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'').replace(/^\{ executeLineupGeneration \};\r?\n/gm,'');
    vm.runInContext(source+'\nglobalThis.generate=executeLineupGeneration;globalThis.assignState=s=>state=s;',context);context.assignState(state);
    return {names,order,state,context,messages,questions};
}

test('8-week actual generator: both squads include late guests with equal playing policy, no vote requirement',async()=>{
    const f=fixture();f.state.meetingDate='2026-10-07';
    const guests=['Unknown guest A','Unknown guest B'];
    f.state.teams[0].push({name:guests[0],pos1:[],s1:65});
    f.state.teams[1].push({name:guests[1],pos1:[],s1:65});
    f.state.initialAttendeeOrder=[];
    f.state.trainingCycle={date:'2026-10-07',startDate:'2026-10-07',endDateExclusive:'2026-12-02',members:f.names.map(name=>({name,role:'DM',second:'CB'}))};
    const before=JSON.stringify(f.state.teams),original={sentinel:'existing B lineup'};f.state.teamLineupCache[1]=original;
    for(let t=0;t<2;t++){
        const names=f.state.teams[t].map(p=>p.name),result=await f.context.generate(names,Array(6).fill('4-2-3-1'));
        assert.ok(result);assert.ok(core.validateLineup(result,names));
        const counts=names.map(n=>result.lineups.filter(q=>Object.values(q).flat().includes(n)).length);
        assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
        assert.ok(counts[names.indexOf(guests[t])]>=Math.min(...counts));
        assert.equal(f.state.teamLineupCache[1],original);
    }
    assert.equal(JSON.stringify(f.state.teams),before);assert.equal(f.questions.length,0);
});

test('24-player 11v11: final roster wins over spelling differences without prompts or vote reads',async()=>{
    const f=fixture(),before=JSON.stringify(f.state),orderBefore=JSON.stringify(f.order);
    for(let t=0;t<2;t++) {
        const result=await f.context.generate(f.state.teams[t].map(p=>p.name),Array(6).fill('4-2-3-1'));
        assert.ok(result,'name mismatch must not block confirmed lineup');
        assert.ok(core.validateLineup(result,f.state.teams[t].map(p=>p.name)));
        const expected=planDuties(f.state.teams.map(ns=>ns.map(p=>p.name)),f.order,[Array(6).fill(11),Array(6).fill(11)]).teams[t];
        assert.equal(JSON.stringify(result.resters),JSON.stringify(expected.resters));
        assert.equal(JSON.stringify(result.lineups.map(l=>l.GK[0])),JSON.stringify(expected.gks));
    }
    assert.equal(JSON.stringify(f.order),orderBefore);
    assert.equal(JSON.stringify({...f.state,dutyNotes:undefined}),before);
    assert.equal(f.questions.length,0,'no vote identity confirmation is needed');
});

test('late arrival added directly to a team generates all quarters and leaves other saved lineup untouched',async()=>{
    const f=fixture(false),late={name:'No vote late arrival',pos1:['CB'],s1:60};
    f.state.teams[0].push(late);f.state.teamLineupCache={1:{sentinel:'keep original'}};
    const before=JSON.stringify(f.state),errors=[];
    const members=f.state.teams[0].map(p=>p.name);
    const result=await f.context.generate(members,Array(6).fill('4-2-3-1'),false,{onError:m=>errors.push(m)});
    assert.ok(result);assert.ok(core.validateLineup(result,members));assert.equal(result.lineups.length,6);
    assert.equal(JSON.stringify({...f.state,dutyNotes:undefined}),before);
    assert.equal(f.questions.length,0);assert.deepEqual(errors,[]);
});

test('missing, duplicate and empty vote references cannot prevent final roster generation',async()=>{
    const f=fixture();f.order.splice(13,1);
    f.order.push('Kei','kei','Someone not in teams');
    const before=JSON.stringify(f.order);
    assert.ok(await f.context.generate(f.names.slice(0,12),Array(6).fill('4-2-3-1')));
    assert.equal(JSON.stringify(f.order),before);
    assert.equal(f.questions.length,0);
    f.state.initialAttendeeOrder=[];
    assert.ok(await f.context.generate(f.names.slice(12),Array(6).fill('4-2-3-1')));
    f.state.teams[1].push(f.state.teams[0][0]);
    const errors=[];
    assert.equal(await f.context.generate(f.names.slice(0,12),Array(6).fill('4-2-3-1'),false,{onError:m=>errors.push(m)}),null);
    assert.match(errors[0],/중복/,'actual duplicate team members remain invalid');
});

test('English capitalization recognises registered players and reuses legacy response IDs',()=>{
    let prompts=0;
    assert.equal(confirmGuest('kEi',['Kei'],'en',()=>{prompts++;return false;}),true);
    assert.equal(prompts,0);
    assert.equal(registeredVoteName(' guest ',['Kei']),null);
    assert.equal(registeredVoteName('kEi',['Kei','KEI']),null,'ambiguous registry is not guessed');
    const rows=[{id:'kei',name:'kei',status:'attend',attendingSince:{seconds:123},guest:true}];
    const before=JSON.stringify(rows);
    assert.deepEqual(responseIdentity('KEI',['Kei'],rows),{id:'kei',name:'kei',guest:false});
    assert.deepEqual(responseIdentity('kei',['Kei'],[]),{id:'Kei',name:'Kei',guest:false});
    assert.equal(JSON.stringify(rows),before);
    assert.throws(()=>responseIdentity('Kei',['Kei'],[...rows,{id:'Kei',name:'Kei'}]),/ambiguous-name/);
});

test('roster moves preserve loaded order; additions append and removed names do not return',()=>{
    const reference=['A','Kei','B','Removed','A','kei'],before=JSON.stringify(reference);
    const order=rosterDutyOrder([['B','Late A'],['A','Kei','Late B']],reference);
    assert.deepEqual(order,['A','Kei','B','Late A','Late B']);
    assert.equal(JSON.stringify(reference),before);
    assert.deepEqual(rosterDutyOrder([['Late B','A'],['Kei','B','Late A']],order),order);
    assert.deepEqual(rosterDutyOrder([['A','Kei']],undefined),['A','Kei']);
});

test('generation and publishing do not depend on live vote order',()=>{
    for(const file of ['lineupGenerator.js','shareManagement.js']) {
        const code=readFileSync(new URL('../js/modules/'+file,import.meta.url),'utf8');
        assert.equal(code.includes('getDutyOrder'),false,file+' must not revalidate votes');
    }
});
