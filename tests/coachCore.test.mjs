import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recentHistory, positionGroup, roleTip, rolePenalty, applyLocks, validateLineup, chooseReviewDate, validVideoUrl, effectivePlayer, historyBonus } from '../js/modules/coachCore.js';
import { lessonFor } from '../js/modules/weeklyContent.js';
const lineup=(names)=>({lineups:Array.from({length:6},()=>({GK:[names[0]],CB:[names[1]],FW:[names[2]]})),resters:Array.from({length:6},()=>[names[3]]),formations:Array(6).fill('4-3-3'),referees:Array(6).fill(names[3])});
test('formation-aware wide roles and bilingual instructions',()=>{
    assert.equal(positionGroup('RW','4-4-2'),'MID');assert.equal(positionGroup('RW','4-3-3'),'ATT');assert.match(roleTip('RW','3-5-2','en'),/centre-back/);
});
test('last four attended assignments; historical maps and source untouched',()=>{
    const records=Array.from({length:7},(_,i)=>({date:`2026-08-${String(i+1).padStart(2,'0')}`,teamLineupCache:{0:lineup(['A','B','C','D'])}}));
    records[0].teamLineupCache[0].resters={q_0:['D'],q_1:['D'],q_2:['D'],q_3:['D'],q_4:['D'],q_5:['D']};
    const before=JSON.stringify(records), h=recentHistory(records,'2026-08-07');
    assert.equal(h.B.dates.length,4);assert.deepEqual(h.B.dates,['2026-08-06','2026-08-05','2026-08-04','2026-08-03']);assert.equal(h.B.DEF,24);assert.equal(h.D.REST,24);assert.equal(JSON.stringify(records),before);
});
test('locks preserve positions, rest, unique players and original data',()=>{
    const original=lineup(['A','B','C','D']), candidate=lineup(['D','C','B','A']), old=JSON.stringify(original);
    const result=applyLocks(candidate,original,[{name:'A',q:0},{name:'D',q:0},{name:'B',q:1}]);
    assert.deepEqual(result.lineups[0].GK,['A']);assert.deepEqual(result.resters[0],['D']);assert.deepEqual(result.lineups[1].CB,['B']);assert.ok(validateLineup(result,['A','B','C','D']));assert.equal(JSON.stringify(original),old);
    assert.equal(applyLocks(candidate,original,[{name:'missing',q:0}]),null);
});
test('unknown or duplicate players fail validation',()=>{
    const x=lineup(['A','B','C','D']);x.lineups[0].CB=['A'];assert.equal(validateLineup(x,['A','B','C','D']),false);
});
test('past review excludes current/future dates and respects disabled/explicit choices',()=>{
    const meetings=['2026-09-01','2026-09-08','2026-09-15','2026-09-22'].map(date=>({date}));
    assert.equal(chooseReviewDate(meetings,'2026-09-22','','2026-09-15'),'2026-09-08');assert.equal(chooseReviewDate(meetings,'2026-09-22','none','2026-09-23'),'');assert.equal(chooseReviewDate(meetings,'2026-09-22','2026-09-01','2026-09-23'),'2026-09-01');
});
test('role distribution favours mentor support without mutating profiles',()=>{
    const profiles={A:{roles:['mentor']},B:{roles:['learner']},C:{roles:['mentor']},D:{roles:['learner']}};
    const p=n=>({name:n});assert.ok(rolePenalty([[p('A'),p('B')],[p('C'),p('D')]],profiles)<rolePenalty([[p('A'),p('C')],[p('B'),p('D')]],profiles));
});
test('guests use explicit temporary information and zero skill is valid',()=>{
    assert.equal(effectivePlayer({name:'A',s1:65},{A:{guest:true,skill:0,positions:['FW']}}).s1,0);
    assert.ok(historyBonus('A','FW',{A:{dates:['1','2'],positions:{CB:10}}},{wishPos:['FW']})>0);
});
test('weekly lessons rotate and reject executable or lookalike URLs',()=>{
    assert.notEqual(lessonFor('2026-09-16').url,lessonFor('2026-09-23').url);
    assert.equal(validVideoUrl('javascript:alert(1)'), '');assert.equal(validVideoUrl('https://youtube.com.evil.test/video'),'');assert.ok(validVideoUrl('https://www.youtube.com/watch?v=example'));
});
test('real lineup generator: 9/10/11 players, substitutions, fixed slots',async()=>{
    const core=await import('../js/modules/coachCore.js');
    let source=readFileSync(new URL('../js/modules/lineupGenerator.js',import.meta.url),'utf8');
    source=source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,'').replace(/^\{ executeLineupGeneration \};\r?\n/gm,'');
    const context=vm.createContext({...core,Math,Set,Promise,window:{showNotification(){}},document:{},localStorage:{getItem(){return null;}},console});
    vm.runInContext(source+'\nglobalThis.generate=executeLineupGeneration; globalThis.assignState=(s)=>state=s;',context);
    for(const [count,formation] of [[9,'3-4-1'],[10,'3-4-2'],[11,'4-4-2'],[13,'4-4-2']]){
        const members=Array.from({length:count},(_,i)=>`Test ${i}`), playerDB=Object.fromEntries(members.map((name,i)=>[name,{name,s1:60+i,pos1:[['GK','CB','CM','FW'][i%4]],pos2:['CB','CM'],wishPos:['FW'],wishQuota:1}]));
        context.assignState({playerDB,initialAttendeeOrder:members});
        const before=JSON.stringify(playerDB), result=await context.generate(members,Array(6).fill(formation),true);
        assert.ok(validateLineup(result,members));assert.equal(JSON.stringify(playerDB),before);
        const locked=await context.generate(members,Array(6).fill(formation),true,{original:result,locks:[{name:members[0],q:0}]});
        assert.ok(validateLineup(locked,members));assert.deepEqual(core.locate(locked,0,members[0]),core.locate(result,0,members[0]));
    }
});
