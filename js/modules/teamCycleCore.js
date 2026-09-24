// Pure planning only. No Firebase, global state, or automatic assignment writes.
import { surveyRoleCode } from './positionPreferencesCore.js?v=4';
export const CYCLE_ROLES=['GK','LB','CB','RB','DM','AM','LW','RW','FW'];
const nameOf=n=>String(n||'').normalize('NFC').trim();
const day=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function cycleEnd(start) {
    if(!day(start))throw new Error('시작일을 확인해 주세요.');
    return new Date(Date.parse(start+'T00:00:00Z')+56*86400000).toISOString().slice(0,10);
}
export function cycleContains(cycle,date) {return day(date)&&date>=cycle.startDate&&date<cycle.endDateExclusive;}
export function recentParticipants(records,date) {
    if(!day(date))throw new Error('기준 날짜를 확인해 주세요.');
    const start=new Date(date+'T00:00:00Z'),n=start.getUTCDate();
    start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-3);
    const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
    start.setUTCDate(Math.min(n,last));const since=start.toISOString().slice(0,10);
    return [...new Set(records.filter(r=>r.date>=since&&r.date<=date&&r.paymentStatus!=='N').map(r=>nameOf(r.name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
}
export function cycleCandidates(names,responses,players) {
    return [...new Set(names.map(nameOf).filter(Boolean))].map(name=>{
        const answers=responses.filter(r=>nameOf(r.name)===name),p=players[name];
        const first=answers.length===1?surveyRoleCode(answers[0].first):'';
        const second=answers.length===1?surveyRoleCode(answers[0].second):'';
        return {name,role:CYCLE_ROLES.includes(first)?first:'',second:CYCLE_ROLES.includes(second)?second:'',
            skill:p&&Number.isFinite(Number(p.s1))?Number(p.s1):null,
            issue:!p?'선수 명단 확인':answers.length>1?'중복 응답 확인':!first?'미응답':!CYCLE_ROLES.includes(first)||!CYCLE_ROLES.includes(second)?'포지션 확인':''};
    });
}
export function validateCycle(cycle) {
    if(!cycle||cycle.schemaVersion!==1||cycle.endDateExclusive!==cycleEnd(cycle.startDate))throw new Error('8주 기간을 확인해 주세요.');
    if(!Array.isArray(cycle.members)||cycle.members.length<2||cycle.members.length>200)throw new Error('고정 멤버 명단을 확인해 주세요.');
    const seen=new Set();
    for(const p of cycle.members){
        if(!p.name||nameOf(p.name)!==p.name||seen.has(p.name)||![0,1].includes(p.team)||!CYCLE_ROLES.includes(p.role)||!CYCLE_ROLES.includes(p.second))throw new Error('이름 중복·소속팀·훈련 포지션을 확인해 주세요.');
        seen.add(p.name);
    }
    if(![0,1].every(t=>cycle.members.some(p=>p.team===t)))throw new Error('양 팀에 고정 멤버가 필요합니다.');
    return true;
}
const count=(team,role)=>team.filter(p=>p.role===role).length;
const power=team=>team.reduce((sum,p)=>sum+p.skill,0);
function repeatPairs(teams,previous) {
    let cost=0;const old=new Map(previous.map(p=>[p.name,p]));
    for(const team of teams)for(let a=0;a<team.length;a++)for(let b=a+1;b<team.length;b++) {
        const x=old.get(team[a].name),y=old.get(team[b].name);
        if(x&&y&&x.team===y.team&&team[a].role===team[b].role)cost++;
    }
    return cost;
}
export function draftCycle(candidates,startDate,previous=[]) {
    if(candidates.some(p=>p.issue||!CYCLE_ROLES.includes(p.role)||!CYCLE_ROLES.includes(p.second)||!Number.isFinite(p.skill)))throw new Error('미응답·중복·능력치 확인을 마친 후 초안을 만드세요.');
    if(new Set(candidates.map(p=>p.name)).size!==candidates.length)throw new Error('중복된 선수가 있습니다.');
    const teams=[[],[]];
    // Distribute each training role evenly; break ties by size, strength, prior pairs.
    for(const role of CYCLE_ROLES){
        const group=candidates.filter(p=>p.role===role).sort((a,b)=>b.skill-a.skill||a.name.localeCompare(b.name,'ko'));
        for(const p of group){
            const cost=t=>count(teams[t],role)*100000+teams[t].length*10000+power(teams[t])*10+
                repeatPairs(teams.map((team,i)=>i===t?[...team,p]:team),previous)*30;
            teams[cost(0)<=cost(1)?0:1].push({...p});
        }
    }
    // Swaps within the same role preserve sizes and role counts while mixing
    // previous partnerships and balancing skill. Bounded, deterministic search.
    const objective=()=>Math.abs(power(teams[0])-power(teams[1]))+repeatPairs(teams,previous)*12;
    for(let pass=0;pass<30;pass++){
        let best=objective(),swap=null;
        for(let a=0;a<teams[0].length;a++)for(let b=0;b<teams[1].length;b++){
            if(teams[0][a].role!==teams[1][b].role)continue;
            [teams[0][a],teams[1][b]]=[teams[1][b],teams[0][a]];
            const value=objective();if(value<best){best=value;swap=[a,b];}
            [teams[0][a],teams[1][b]]=[teams[1][b],teams[0][a]];
        }
        if(!swap)break;const[a,b]=swap;[teams[0][a],teams[1][b]]=[teams[1][b],teams[0][a]];
    }
    const cycle={schemaVersion:1,startDate,endDateExclusive:cycleEnd(startDate),members:teams.flatMap((team,i)=>team.map(p=>({name:p.name,team:i,role:p.role,second:p.second})))};
    validateCycle(cycle);return cycle;
}
export function matchFromCycle(cycle,attendees,date,players={}) {
    validateCycle(cycle);if(!cycleContains(cycle,date))throw new Error('선택한 경기는 이 8주 기간에 포함되지 않습니다.');
    const present=[...new Set(attendees.map(nameOf).filter(Boolean))],teams=[[],[]],loans=[];
    for(const member of cycle.members)if(present.includes(member.name))teams[member.team].push({...member});
    const unassigned=present.filter(n=>!cycle.members.some(p=>p.name===n));
    // Never move more players than needed to balance head counts. Role surplus
    // at the donor and shortage at the receiving team outrank ability balance.
    while(Math.abs(teams[0].length-teams[1].length)>1){
        const from=teams[0].length>teams[1].length?0:1,to=1-from;
        const candidates=teams[from].map(p=>{
            const donor=count(teams[from],p.role),receiver=count(teams[to],p.role);
            const priority=(donor>1&&receiver<donor-1?1000:0)+(donor-receiver)*100;
            const strength=t=>t.reduce((s,p)=>s+(Number(players[p.name]?.s1)||0),0);
            const difference=Math.abs(strength(teams[from])-2*(Number(players[p.name]?.s1)||0)-strength(teams[to]));
            return {p,priority,difference,reason:donor>1&&receiver<donor-1?`${p.role} 부족 보충 · 보내는 팀에 같은 역할 유지`:'인원 균형 · 같은 역할 여유 부족, 감독 확인 필요'};
        }).sort((a,b)=>b.priority-a.priority||a.difference-b.difference||a.p.name.localeCompare(b.p.name,'ko'));
        const chosen=candidates[0];teams[from]=teams[from].filter(p=>p.name!==chosen.p.name);teams[to].push({...chosen.p,team:to});
        loans.push({name:chosen.p.name,from,to,role:chosen.p.role,reason:chosen.reason});
    }
    return {teams,loans,unassigned,absent:cycle.members.filter(p=>!present.includes(p.name)).map(p=>p.name)};
}
