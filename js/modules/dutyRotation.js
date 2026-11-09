// Final teams are authoritative. Loaded application order is a reference, not eligibility.
export function rosterDutyOrder(teams, reference=[]) {
    const all=teams.flat(), used=new Set(), ordered=[];
    const norm=value=>String(value??'').normalize('NFC').trim();
    for(const value of Array.isArray(reference)?reference:[]) {
        const name=norm(value);
        const matches=all.filter(n=>norm(n).toLowerCase()===name.toLowerCase());
        const member=all.includes(name)?name:matches.length===1?matches[0]:null;
        if(member!==null&&!used.has(member)){ordered.push(member);used.add(member);}
    }
    // No invented vote timestamps: manual additions follow the loaded names in roster order.
    return ordered.concat(all.filter(name=>!used.has(name)));
}

// GK (unless dedicated), referee and bench all consume one non-outfield turn.
// One circular queue per team gives counts differing by at most one and the
// minimum possible overlap with the previous quarter, even with mixed formations.
// The legacy options argument remains accepted; both match modes use this policy.
export function planDuties(teams, earlyFirst, fieldCounts, dedicatedNames=[], options={}) {
    const all=teams.flat(), dedicated=new Set(dedicatedNames);
    if(new Set(all).size!==all.length)throw new Error('팀 명단에 중복 선수가 있습니다.');
    const lateFirst=rosterDutyOrder(teams,earlyFirst).reverse();
    const queues=teams.map(team=>lateFirst.filter(n=>team.includes(n)&&!dedicated.has(n)));
    const refQueue=lateFirst.filter(n=>!dedicated.has(n));
    const result=teams.map(()=>({gks:[],resters:[],referees:[]})), notes=[];
    const rotate=(queue,name)=>{const i=queue.indexOf(name);if(i>=0){queue.splice(i,1);queue.push(name);}};
    const keepers=teams.map(team=>lateFirst.find(n=>team.includes(n)&&dedicated.has(n)));
    const previous=teams.map(()=>[]);
    let lastRefTeam=-1;
    const count=fieldCounts[0]?.length;
    if(fieldCounts.length!==teams.length||![4,6].includes(count)||fieldCounts.some(row=>row.length!==count))throw new Error('쿼터 수를 확인해 주세요.');
    for(let q=0;q<count;q++) {
        if(fieldCounts.some(row=>!Number.isInteger(row[q])||row[q]<1))throw new Error('출전 인원을 확인해 주세요.');
        const spaces=teams.map((team,t)=>team.length-fieldCounts[t][q]);
        if(spaces.some(n=>n<0))throw new Error('팀 인원보다 출전 인원이 많습니다.');
        // Choose combined non-outfield groups BEFORE assigning individual duties.
        // Never rotate separately for GK/ref: doing so reselects last quarter's GK.
        const groups=teams.map((team,t)=>{
            const needed=spaces[t]+(keepers[t]?0:1),queue=queues[t];
            if(needed>queue.length)throw new Error('전담 GK를 제외하면 교대 인원이 부족합니다. 팀 인원을 확인해 주세요.');
            const group=queue.slice(0,needed);
            for(const name of group)rotate(queue,name);
            const repeated=group.filter(n=>previous[t].includes(n));
            if(repeated.length)notes.push(`${q+1}쿼터 · ${String.fromCharCode(65+t)}팀: 인원·포메이션상 ${repeated.length}명의 연속 필드 미출전이 불가피합니다(GK·심판·휴식 합산).`);
            previous[t]=group;
            return group;
        });
        // Alternate the referee's team whenever both teams have an off-field player.
        const available=teams.map((team,t)=>t).filter(t=>spaces[t]>0&&groups[t].length>0);
        const nextTeam=lastRefTeam<0?null:available.find(t=>t!==lastRefTeam);
        const nextName=refQueue.find(n=>available.some(t=>groups[t].includes(n)));
        const refTeam=nextTeam??(nextName?teams.findIndex(team=>team.includes(nextName)):-1);
        const ref=refTeam<0?null:refQueue.find(n=>groups[refTeam].includes(n))||null;
        if(!ref)notes.push(`${q+1}쿼터: 휴식 가능 인원이 없어 별도 심판이 필요합니다.`);
        else {
            if(lastRefTeam===refTeam&&available.length>1)notes.push(`${q+1}쿼터: 반대 팀에 심판 가능 인원이 없어 같은 팀이 다시 맡았습니다.`);
            rotate(refQueue,ref);
            lastRefTeam=refTeam;
        }
        teams.forEach((team,t)=>{
            const gk=keepers[t]||groups[t].find(n=>n!==ref);
            if(!gk)throw new Error('키퍼를 배정할 선수가 없습니다.');
            // Preserve the stored schema: resters is BENCH/ref only, never GK.
            const reserved=groups[t].filter(n=>n!==gk);
            result[t].gks.push(gk);result[t].resters.push(reserved);
            result[t].referees.push(ref);
        });
    }
    return {teams:result,notes};
}

// Preserve existing field positions and resters when only the shared referee duty needs repair.
// This is read-only: callers decide whether to save the returned referee names.
export function sharedRefereesFromLineups(lineups, earlyFirst=[], count=6) {
    const entries=Array.isArray(lineups)?lineups.map((value,index)=>[index,value]):Object.entries(lineups||{});
    const rank=new Map(earlyFirst.map((name,index)=>[name,index]));
    const at=(value,q)=>Array.isArray(value)?value[q]:value?.[`q_${q}`]??value?.[`q${q+1}`];
    let lastTeam=null;
    return Array.from({length:count===4?4:6},(_,q)=>{
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
