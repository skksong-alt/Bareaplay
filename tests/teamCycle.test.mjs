import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleEnd,cycleContains,recentParticipants,cycleCandidates,draftCycle,validateCycle,matchFromCycle } from '../js/modules/teamCycleCore.js';
import { lineupImageModel } from '../js/modules/lineupImage.js';

const members=Array.from({length:24},(_,i)=>({name:`Player ${i}`,role:['DM','CB','FW'][i%3],second:['DM','CB','FW'][i%3],skill:50+i,issue:''}));
test('8 weeks is date based; recent participants use 3 calendar months and omit recorded no-shows',()=>{
    assert.equal(cycleEnd('2026-09-30'),'2026-11-25');
    const c={startDate:'2026-09-30',endDateExclusive:cycleEnd('2026-09-30')};
    assert.equal(cycleContains(c,'2026-11-24'),true);assert.equal(cycleContains(c,'2026-11-25'),false);
    assert.deepEqual(recentParticipants([{date:'2026-06-30',name:'A'},{date:'2026-06-29',name:'Old'},{date:'2026-07-01',name:'A'},{date:'2026-09-01',name:'No-show',paymentStatus:'N'},{date:'2026-10-01',name:'Future'}],'2026-09-30'),['A']);
});
test('missing/duplicate survey answers are never guessed; legacy CM is read as DM only',()=>{
    const responses=[{name:'A',first:'CM',second:'DM',note:'private'},{name:'B',first:'FW',second:'FW'},{name:'B',first:'CB',second:'CB'}],before=structuredClone(responses);
    const rows=cycleCandidates(['A','B','C'],responses,{A:{s1:0},B:{s1:70},C:{s1:60}});
    assert.equal(rows[0].role,'DM');assert.equal(rows[0].skill,0);assert.equal(rows[1].issue,'중복 응답 확인');assert.equal(rows[2].issue,'미응답');
    assert.throws(()=>draftCycle(rows,'2026-09-30'));assert.deepEqual(responses,before);
});
test('draft balances 8 players per role into two 12-person teams without mutating inputs',()=>{
    const before=structuredClone(members),c=draftCycle(members,'2026-09-30');validateCycle(c);
    for(const t of [0,1]){assert.equal(c.members.filter(p=>p.team===t).length,12);for(const r of ['DM','CB','FW'])assert.equal(c.members.filter(p=>p.team===t&&p.role===r).length,4);}
    assert.equal(new Set(c.members.map(p=>p.name)).size,24);assert.deepEqual(members,before);
    assert.ok(c.members.every(p=>!('skill' in p)&&!('note' in p)));
    const next=draftCycle(members,'2026-11-25',c.members);
    const pairs=plan=>plan.members.flatMap((p,i)=>plan.members.slice(i+1).filter(q=>p.team===q.team&&p.role===q.role).map(q=>[p.name,q.name].sort().join('|')));
    const old=new Set(pairs(c));assert.ok(pairs(next).filter(k=>old.has(k)).length<old.size,'next cycle remixes same-role partnerships');
});
test('match preview keeps home teams; only loans enough to balance and reports unknown attendees',()=>{
    const cycle=draftCycle(members,'2026-09-30'),before=structuredClone(cycle);
    const a=cycle.members.filter(p=>p.team===0),b=cycle.members.filter(p=>p.team===1);
    const present=[...a.slice(0,8),...b].map(p=>p.name);
    const result=matchFromCycle(cycle,[...present,'Guest'],'2026-10-07');
    assert.deepEqual(result.teams.map(t=>t.length),[10,10]);assert.equal(result.loans.length,2);assert.deepEqual(result.unassigned,['Guest']);
    assert.equal(new Set(result.teams.flat().map(p=>p.name)).size,20);assert.deepEqual(cycle,before);
    assert.throws(()=>matchFromCycle(cycle,present,'2026-11-25'));
});
test('a role-rich donor sends a needed role; balanced attendance requires no loans',()=>{
    const cycle={schemaVersion:1,startDate:'2026-09-30',endDateExclusive:'2026-11-25',members:[
        {name:'A',team:0,role:'CB',second:'CB'},
        ...['B','C','D'].map(name=>({name,team:1,role:'DM',second:'DM'}))]};
    const r=matchFromCycle(cycle,['A','B','C','D'],'2026-10-07');
    assert.equal(r.loans[0].role,'DM');assert.match(r.loans[0].reason,/같은 역할 유지/);
    assert.equal(matchFromCycle(cycle,['A','B'],'2026-10-07').loans.length,0);
});
test('published image model handles legacy quarter maps, only public fields, and leaves source unchanged',()=>{
    const formations={'test':[{pos:'GK',x:50,y:90},{pos:'CB',x:30,y:70},{pos:'CB',x:70,y:70}]};
    const share={meetingInfo:{time:'2026-09-23 21:00'},teams:{team1:[]},teamNames:['A'],lineups:{team1:{formations:Array(6).fill('test'),lineups:Array.from({length:6},()=>({GK:['One'],CB:['Two','Three']})),resters:{q1:['Ref','Rest']},referees:{q1:'Ref'}}},ratings:{private:'must not export'}};
    const before=structuredClone(share),model=lineupImageModel(share,'team1',formations);
    assert.equal(model.quarters.length,6);assert.deepEqual(model.quarters[0].rest,['Rest']);assert.equal(model.quarters[0].referee,'Ref');
    assert.deepEqual(model.quarters[0].players.map(p=>p.name),['One','Two','Three']);assert.equal('ratings' in model,false);assert.deepEqual(share,before);
});
