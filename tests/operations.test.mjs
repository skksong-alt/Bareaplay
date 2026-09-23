import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResponseTime, confirmGuest } from '../js/modules/voteOrder.js';
import { planDuties } from '../js/modules/dutyRotation.js';
import { REFEREE_LESSONS, refereeLessonIndex, refereeLessonHtml } from '../js/modules/refereeEducation.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as core from '../js/modules/coachCore.js';
import { POSITIONS,PREFERENCE_PITCH,validatePreference,preferenceSummary,surveyRoleCode } from '../js/modules/positionPreferencesCore.js';

test('position survey pitch displays 4-2-3-1 without changing stored roles',()=>{
    assert.equal(PREFERENCE_PITCH.length,11);
    const rows=Object.groupBy(PREFERENCE_PITCH,p=>p[2]);
    assert.deepEqual(Object.values(rows).map(row=>row.length),[1,3,2,4,1]);
    assert.equal(PREFERENCE_PITCH.filter(p=>p[0]==='DM').length,2);
    assert.equal(PREFERENCE_PITCH.some(p=>p[0]==='CM'),false);
    assert.equal(PREFERENCE_PITCH.filter(p=>p[0]==='CB').length,2);
    assert.deepEqual([...new Set(PREFERENCE_PITCH.map(p=>p[0]))].sort(),POSITIONS.filter(p=>p[0]!=='CM').map(p=>p[0]).sort());
    assert.equal(validatePreference({name:'A',first:'CM',second:'DM',stable:false,flexible:false,note:''},['A']),true,'older CM answers remain valid');
    assert.equal(preferenceSummary([]).rows.filter(r=>r.code==='CB').length,1);
});

test('RSVP categories sort by their own server timestamps, including subsecond precision',()=>{
    for(const status of ['attend','maybe','absent']) {
        const rows=[{name:'A',status,attendingSince:{seconds:20},updatedAt:{seconds:2,nanoseconds:9}},{name:'Z',status,attendingSince:{seconds:10,nanoseconds:9},updatedAt:{seconds:2,nanoseconds:3}},{name:'B',status,attendingSince:{seconds:10,nanoseconds:3},updatedAt:{seconds:1}}];
        assert.deepEqual(rows.slice().sort(compareResponseTime).map(r=>r.name),status==='attend'?['B','Z','A']:['B','Z','A']);
    }
    const rows=[{name:'A',status:'maybe',attendingSince:{seconds:1},updatedAt:{seconds:8}},{name:'B',status:'maybe',attendingSince:{seconds:99},updatedAt:{seconds:2}},{name:'C',status:'maybe'}];
    assert.deepEqual(rows.sort(compareResponseTime).map(r=>r.name),['B','A','C']);
});
test('unregistered names require confirmation; known names do not prompt',()=>{
    let calls=0;const ask=()=>{calls++;return false;};
    assert.equal(confirmGuest('Known',['Known'],'ko',ask),true);assert.equal(calls,0);
    assert.equal(confirmGuest('Knonw',['Known'],'ko',ask),false);assert.equal(calls,1);
    assert.equal(confirmGuest('Visitor',['Known'],'en',()=>true),true);
});
test('private preference choices allow matching ranks without double-counting; duplicate names are flagged',()=>{
    const answer={name:'A',first:'CB',second:'CB',stable:true,flexible:false,note:''};
    assert.equal(validatePreference(answer,['A']),true);assert.equal(validatePreference(answer,['B']),false);
    const before=JSON.stringify(answer),sum=preferenceSummary([answer]);
    const cb=sum.rows.find(r=>r.code==='CB');assert.deepEqual([cb.first.length,cb.second.length,cb.same.length],[1,0,1]);
    assert.deepEqual(preferenceSummary([answer,{...answer,first:'CM'}]).duplicates,['A']);
    assert.equal(preferenceSummary([answer],['B']).rows.find(r=>r.code==='CB').first.length,0);
    assert.equal(JSON.stringify(answer),before);
});
test('coach summary combines legacy CM with DM without editing saved answers',()=>{
    const responses=[
        {name:'A',first:'CM',second:'DM'},
        {name:'B',first:'FW',second:'CM'},
        {name:'C',first:'DM',second:'DM'}
    ],before=JSON.stringify(responses);
    const {rows}=preferenceSummary(responses),dm=rows.find(r=>r.code==='DM');
    assert.equal(rows.some(r=>r.code==='CM'),false);
    assert.deepEqual(dm.first,['A','C']);
    assert.deepEqual(dm.second,['B']);
    assert.deepEqual(dm.same,['A','C']);
    assert.equal(surveyRoleCode('CM'),'DM');
    assert.equal(JSON.stringify(responses),before);
});
test('referees follow global order; GK/rest follow team queues, with no same-quarter overlap',()=>{
    const A=Array.from({length:12},(_,i)=>`A${i+1}`),B=Array.from({length:12},(_,i)=>`B${i+1}`),teams=[A,B],order=[...A,...B];
    const p=planDuties(teams,order,[Array(6).fill(11),Array(6).fill(11)]);
    assert.equal(p.teams[0].referees[0],'B12');assert.equal(p.teams[1].gks[0],'B11');assert.deepEqual(p.teams[1].resters[0],['B12']);
    assert.equal(p.teams[0].gks[0],'A12');assert.deepEqual(p.teams[0].resters[0],['A11']);
    assert.equal(p.teams[0].referees[1],'B11');assert.equal(p.teams[0].gks[1],'A10');
    for(let q=0;q<6;q++)for(let t=0;t<2;t++){assert.equal(p.teams[t].resters[q].length,1);assert.ok(!p.teams[t].resters[q].includes(p.teams[t].gks[q]));assert.equal(p.teams[t].referees[q],p.teams[0].referees[q]);}
    const dedicated=planDuties(teams,order,[Array(6).fill(11),Array(6).fill(11)],['A12','B12']);
    assert.ok(dedicated.teams[0].gks.every(n=>n==='A12'));assert.ok(dedicated.teams[1].gks.every(n=>n==='B12'));
    assert.ok(dedicated.teams[0].referees.every(n=>n!=='A12'&&n!=='B12'));
    assert.throws(()=>planDuties(teams,order.slice(1),[Array(6).fill(11),Array(6).fill(11)]),/투표 시각/);
});
test('no spare player means no invented referee; education has eight topics including two throw-ins',()=>{
    const names=Array.from({length:11},(_,i)=>String(i));
    const p=planDuties([names],names,[Array(6).fill(11)]);
    assert.ok(p.teams[0].referees.every(n=>n===null));assert.equal(p.notes.length,6);
    assert.equal(REFEREE_LESSONS.length,8);assert.equal(REFEREE_LESSONS.filter(l=>l.url.endsWith('/the-throw-in/')).length,2);
    assert.equal(refereeLessonIndex('2026-09-23'),0);assert.equal(refereeLessonIndex('2026-11-18'),0);
    assert.match(refereeLessonHtml('2026-10-07'),/스로인 ①/);
    assert.match(refereeLessonHtml('2026-11-04','en'),/Throw-in 2/);
});
test('actual generator uses timestamp-derived order even when the editable roster is reversed',async()=>{
    const names=Array.from({length:24},(_,i)=>`P${i+1}`),teams=[names.slice(0,12),names.slice(12)];
    const playerDB=Object.fromEntries(names.map(name=>[name,{name,pos1:['CM'],pos2:['CB'],s1:60}]));
    const state={playerDB,teams:teams.map(ns=>ns.map(n=>playerDB[n])),initialAttendeeOrder:[...names].reverse(),teamLineupCache:{}};
    const notifications=[];
    const context=vm.createContext({...core,planDuties,Math,Set,Promise,window:{voteMgmt:{getDutyOrder:async()=>names},showNotification:(text)=>notifications.push(text)},document:{getElementById:()=>({value:'2026-09-23'})},console});
    const source=readFileSync(new URL('../js/modules/lineupGenerator.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'').replace(/^\{ executeLineupGeneration \};\r?\n/gm,'');
    vm.runInContext(source+'\nglobalThis.generate=executeLineupGeneration;globalThis.assignState=s=>state=s;globalThis.shared=applySharedReferees;',context);context.assignState(state);
    for(let i=0;i<2;i++)state.teamLineupCache[i]=await context.generate(teams[i],Array(6).fill('4-4-2'),true);
    assert.deepEqual(notifications,[]);
    assert.equal(state.teamLineupCache[0].lineups[0].GK[0],'P12');
    assert.equal(state.teamLineupCache[1].lineups[0].GK[0],'P23');
    assert.equal(state.teamLineupCache[0].referees[0],'P24');
    const before=JSON.stringify(state.teamLineupCache);assert.equal(context.shared()[0].name,'P24');assert.equal(JSON.stringify(state.teamLineupCache),before,'rendering does not rewrite saved duty choices');
    for(let i=0;i<2;i++)assert.ok(core.validateLineup(state.teamLineupCache[i],teams[i]));
});
