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
    for(let q=0;q<6;q++) {
        const spaces=teams.map((team,t)=>team.length-fieldCounts[t][q]);
        if(spaces.some(n=>n<0))throw new Error('팀 인원보다 출전 인원이 많습니다.');
        // One referee for the whole match. A team must have an off-field place available.
        const ref=refQueue.find(n=>spaces[teams.findIndex(team=>team.includes(n))]>0)||null;
        if(!ref)notes.push(`${q+1}쿼터: 휴식 가능 인원이 없어 별도 심판이 필요합니다.`);
        else {
            if(ref!==refQueue[0])notes.push(`${q+1}쿼터: 다음 심판 순번의 팀에 휴식 자리가 없어 가능한 다음 순번을 배정했습니다.`);
            rotate(refQueue,ref);
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
