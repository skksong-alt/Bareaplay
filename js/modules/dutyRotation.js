// Pure planner: chronological order is supplied from server timestamps, never skill scores.
export function planDuties(teams, earlyFirst, fieldCounts, dedicatedNames=[]) {
    const all=teams.flat(), dedicated=new Set(dedicatedNames);
    if(new Set(all).size!==all.length)throw new Error('팀 명단에 중복 선수가 있습니다.');
    if(all.some(n=>!earlyFirst.includes(n)))throw new Error('참석 투표 시각이 없는 선수가 있습니다. 투표 명단을 확인해 주세요.');
    const lateFirst=earlyFirst.filter(n=>all.includes(n)).slice().reverse();
    const queues=teams.map(team=>lateFirst.filter(n=>team.includes(n)&&!dedicated.has(n)));
    const refQueue=lateFirst.filter(n=>!dedicated.has(n));
    const result=teams.map(()=>({gks:[],resters:[],referees:[]})), notes=[];
    const rotate=(queue,name)=>{const i=queue.indexOf(name);if(i>=0){queue.splice(i,1);queue.push(name);}};
    let lastRefTeam=-1;
    for(let q=0;q<6;q++) {
        const spaces=teams.map((team,t)=>team.length-fieldCounts[t][q]);
        if(spaces.some(n=>n<0))throw new Error('팀 인원보다 출전 인원이 많습니다.');
        // Alternate the referee's team whenever both teams have an off-field player.
        const available=teams.map((team,t)=>t).filter(t=>spaces[t]>0&&refQueue.some(n=>teams[t].includes(n)));
        const nextTeam=lastRefTeam<0?null:available.find(t=>t!==lastRefTeam);
        const nextName=refQueue.find(n=>available.some(t=>teams[t].includes(n)));
        const refTeam=nextTeam??(nextName?teams.findIndex(team=>team.includes(nextName)):-1);
        const ref=refTeam<0?null:refQueue.find(n=>teams[refTeam].includes(n))||null;
        if(!ref)notes.push(`${q+1}쿼터: 휴식 가능 인원이 없어 별도 심판이 필요합니다.`);
        else {
            if(lastRefTeam===refTeam&&available.length>1)notes.push(`${q+1}쿼터: 반대 팀에 심판 가능 인원이 없어 같은 팀이 다시 맡았습니다.`);
            rotate(refQueue,ref);
            lastRefTeam=refTeam;
        }
        teams.forEach((team,t)=>{
            const queue=queues[t], reserved=team.includes(ref)?[ref]:[];
            if(reserved.length)rotate(queue,ref);
            const keepers=lateFirst.filter(n=>team.includes(n)&&dedicated.has(n));
            const gk=keepers[0]||queue.find(n=>!reserved.includes(n));
            if(!gk)throw new Error('키퍼를 배정할 선수가 없습니다.');
            if(!keepers.length)rotate(queue,gk);
            while(reserved.length<spaces[t]) {
                const next=queue.find(n=>n!==gk&&!reserved.includes(n));
                if(!next)throw new Error('전담 GK를 제외하면 휴식 인원이 부족합니다. 팀 인원을 확인해 주세요.');
                reserved.push(next);rotate(queue,next);
            }
            result[t].gks.push(gk);result[t].resters.push(reserved);
            result[t].referees.push(ref);
        });
    }
    return {teams:result,notes};
}

// Preserve existing field positions and resters when only the shared referee duty needs repair.
// This is read-only: callers decide whether to save the returned referee names.
export function sharedRefereesFromLineups(lineups, earlyFirst=[]) {
    const entries=Array.isArray(lineups)?lineups.map((value,index)=>[index,value]):Object.entries(lineups||{});
    const rank=new Map(earlyFirst.map((name,index)=>[name,index]));
    const at=(value,q)=>Array.isArray(value)?value[q]:value?.[`q_${q}`]??value?.[`q${q+1}`];
    let lastTeam=null;
    return Array.from({length:6},(_,q)=>{
        const available=entries.flatMap(([index,lineup])=>{
            const names=at(lineup?.resters,q);
            return Array.isArray(names)&&names.length?[{team:Number(index),lineup,names}]:[];
        });
        if(!available.length)return null;
        let selected=lastTeam===null?null:available.find(item=>item.team!==lastTeam);
        if(!selected) {
            selected=available.find(item=>item.names.includes(at(item.lineup?.referees,q))) ||
                available.reduce((best,item)=>Math.max(...item.names.map(n=>rank.get(n)??-1))>Math.max(...best.names.map(n=>rank.get(n)??-1))?item:best);
        }
        const stored=at(selected.lineup?.referees,q);
        const name=selected.names.includes(stored)?stored:[...selected.names].sort((a,b)=>(rank.get(b)??-1)-(rank.get(a)??-1))[0];
        lastTeam=selected.team;
        return {name,team:selected.team};
    });
}
