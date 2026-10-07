// Field-only optimization. Never changes the duty queue or persisted preferences.
export function trainingRole(cell) {
    if (cell.pos === 'CM') return 'DM';
    if (cell.pos === 'MF') return cell.y <= 50 ? 'AM' : 'DM';
    return cell.pos;
}
export function trainingForDate(context, date) {
    return context && date && context.date === date && date >= context.startDate && date < context.endDateExclusive
        ? context.members : [];
}
const nameKey=name=>String(name||'').normalize('NFC').trim().toLowerCase();
function preferenceMap(names,members){
    return new Map(names.map(name=>{const matches=members.filter(p=>nameKey(p.name)===nameKey(name));return [name,members.find(p=>p.name===name)||(matches.length===1?matches[0]:undefined)];}));
}
function fieldSlots(result,q,positionMap){
    const counts={},cells=positionMap[result.formations[q]];
    if(!cells)throw new Error('훈련 포지션을 적용할 포메이션을 확인해 주세요.');
    return cells.map(cell=>({...cell,index:(counts[cell.pos]=(counts[cell.pos]||0)+1)-1})).filter(s=>s.pos!=='GK');
}
// Plan all quarters together. Max flow fills available primary-role seats;
// convex costs prioritize giving everyone a first turn, then balanced opportunity.
// GK/rest/referee and explicit field locks are inputs, never changed here.
function primarySchedule(result,roles,positionMap,locks){
    const rounds=result.lineups.map((lineup,q)=>{
        const fixed=new Set(locks.filter(l=>l.q===q).map(l=>l.name));
        const slots=fieldSlots(result,q,positionMap);
        return {slots,free:slots.filter(s=>!fixed.has(lineup[s.pos]?.[s.index])),fixed};
    });
    const planned=rounds.map(()=>new Map()),Q=rounds.length;
    for(const role of new Set([...roles.values()].filter(Boolean).map(p=>p.role))){
        if(role==='GK')continue;
        const names=[...roles].filter(([,p])=>p?.role===role).map(([name])=>name);
        const source=0,pStart=1,qStart=pStart+names.length,sink=qStart+Q,graph=Array.from({length:sink+1},()=>[]),choices=[];
        const edge=(a,b,capacity,cost)=>{const f={to:b,rev:graph[b].length,capacity,cost},r={to:a,rev:graph[a].length,capacity:0,cost:-cost};graph[a].push(f);graph[b].push(r);return f;};
        names.forEach((name,i)=>{
            const fixedCount=rounds.filter((r,q)=>r.slots.some(s=>r.fixed.has(name)&&result.lineups[q][s.pos]?.[s.index]===name&&trainingRole(s)===role)).length;
            const blockSize=Q===4?2:3;
            for(let n=fixedCount;n<Q;n++)edge(source,pStart+i,1,n===0?-1e10:-(Q-Math.floor(n/blockSize)*blockSize)*1e6);
            rounds.forEach((r,q)=>{
                if(!r.free.some(s=>result.lineups[q][s.pos]?.[s.index]===name))return;
                // Prefer a contiguous block. Coverage/fairness always outrank this tie-break.
                const cost=(Math.floor(q/blockSize)!==i%2?1000:0)+q;
                choices.push({name,q,link:edge(pStart+i,qStart+q,1,cost)});
            });
        });
        rounds.forEach((r,q)=>edge(qStart+q,sink,r.free.filter(s=>trainingRole(s)===role).length,0));
        while(true){
            const dist=Array(graph.length).fill(Infinity),prev=Array(graph.length);dist[source]=0;
            for(let step=0;step<graph.length-1;step++){
                let changed=false;
                for(let a=0;a<graph.length;a++)if(Number.isFinite(dist[a]))graph[a].forEach((e,i)=>{
                    if(e.capacity>0&&dist[e.to]>dist[a]+e.cost){dist[e.to]=dist[a]+e.cost;prev[e.to]=[a,i];changed=true;}
                });
                if(!changed)break;
            }
            if(!prev[sink])break;
            for(let node=sink;node!==source;){const [a,i]=prev[node],e=graph[a][i];e.capacity--;graph[node][e.rev].capacity++;node=a;}
        }
        for(const {name,q,link} of choices)if(link.capacity===0)planned[q].set(name,role);
    }
    return planned;
}

export function trainingReport(result,members,positionMap,locks=[]){
    if(!result?.lineups||!members?.length)return [];
    const roles=preferenceMap(result.members||[],members);
    return [...roles].filter(([,p])=>p).map(([name,p])=>{
        let first=0,second=0,other=0,gk=0,rest=0,available=0,open=0,fixed=0;
        result.lineups.forEach((lineup,q)=>{
            const slots=fieldSlots(result,q,positionMap),seat=slots.find(s=>lineup[s.pos]?.[s.index]===name);
            const ownGK=(lineup.GK||[]).includes(name);
            if(ownGK){gk++;if(p.role==='GK')first++;return;}
            if(!seat){rest++;return;}
            const role=trainingRole(seat);
            if(role===p.role)first++;else if(role===p.second)second++;else other++;
            const targets=slots.filter(s=>trainingRole(s)===p.role);available+=targets.length;
            const quarterLocks=new Set(locks.filter(l=>l.q===q).map(l=>l.name));
            if(quarterLocks.has(name)&&role!==p.role)fixed++;
            else if(targets.some(s=>!quarterLocks.has(lineup[s.pos]?.[s.index])||lineup[s.pos]?.[s.index]===name))open++;
        });
        const totalSlots=result.lineups.reduce((sum,_,q)=>sum+fieldSlots(result,q,positionMap).filter(s=>trainingRole(s)===p.role).length,0);
        const demand=[...roles.values()].filter(other=>other?.role===p.role).length;
        let reason='';
        if(!first){
            if(p.role==='GK')reason='GK 순번·전담 GK 조건으로 희망 GK 출전이 없습니다. 감독이 GK 순번과 전담 여부를 확인하세요.';
            else if(!totalSlots)reason=`선택 포메이션에 ${p.role} 자리가 없습니다. 풀백·공미가 필요하면 10대10은 4-1-3-1, 11대11은 4-2-3-1을 검토하세요.`;
            else if(gk+rest===result.lineups.length)reason='필드 출전 없이 GK·휴식만 배정되었습니다. 인원·의무 교대 조건을 확인하세요.';
            else if(!available)reason='희망 자리가 있는 쿼터와 필드 출전 쿼터가 겹치지 않습니다. 포메이션 또는 교대 쿼터를 조정하세요.';
            else if(!open)reason='필드 출전 쿼터의 본인 또는 희망 자리가 수동 고정돼 있습니다. 고정 조건을 확인하세요.';
            else if(demand>totalSlots)reason=`${p.role} 1지망 ${demand}명에 전체 ${totalSlots}자리여서 전원 1회 배정이 불가능합니다. 역할 자리가 있는 포메이션·쿼터 수 또는 양 팀 간 당일 차출을 검토하세요.`;
            else reason=`${p.role} 1지망 ${demand}명 / 본인이 그 역할을 맡을 수 있는 쿼터 ${open}개. 희망자 간 출전 쿼터가 겹치거나 기존 배치에 희망이 반영되지 않았습니다. 훈련 모드에서 다시 생성하거나 같은 자리끼리 쿼터를 나누고, 필요하면 당일 차출을 검토하세요.`;
        }
        return {name,role:p.role,secondRole:p.second,first,second,other,gk,rest,reason,fixed,open};
    });
}
export function applyTrainingRoles(result, members, positionMap, players = {}, locks = []) {
    if (!result || !members?.length) return result;
    const copy = JSON.parse(JSON.stringify(result));
    const roles=preferenceMap(copy.members,members);
    const planned=primarySchedule(copy,roles,positionMap,locks);
    const primaryUses = new Map();
    let blockUses=new Map(),blockSlots=new Map();
    const lastSlots=new Map(),blockSize=copy.lineups.length===4?2:3;
    for (let q = 0; q < copy.lineups.length; q++) {
        if(q%blockSize===0){blockUses=new Map(primaryUses);blockSlots=new Map();}
        const lineup = copy.lineups[q], counts = {};
        const cells = positionMap[copy.formations[q]];
        if (!cells) throw new Error('훈련 포지션을 적용할 포메이션을 확인해 주세요.');
        const slots = cells.map(cell => ({...cell, index: (counts[cell.pos] = (counts[cell.pos] || 0) + 1) - 1}))
            .filter(cell => cell.pos !== 'GK');
        const locked = new Set(locks.filter(l => l.q === q).map(l => l.name));
        const free = slots.filter(s => !locked.has(lineup[s.pos]?.[s.index]));
        const names = free.map(s => lineup[s.pos]?.[s.index]);
        if (names.some(n => !n) || new Set(names).size !== names.length || free.length > 10)
            throw new Error('필드 인원·포메이션이 맞지 않아 훈련 포지션을 적용하지 않았습니다.');
        // Exact assignment, at most 10 * 2^10 states, once per quarter (not per trial).
        // Primary matches outrank all secondary matches; secondary outranks fallback fit.
        const score = (name, slot, index) => {
            const role = trainingRole(slot), preferred = roles.get(name), player = players[name] || {};
            if(planned[q].has(name)&&planned[q].get(name)!==role)return -Infinity;
            const seat=slot.pos+':'+slot.index;
            return (preferred?.role === role ? 1000000000 - (blockUses.get(name) || 0) * 20000 : preferred?.second === role ? 1000000 : 0)
                + (blockSlots.get(name)===seat?500:0)+(lastSlots.get(name)===seat?200:0)
                + (player.pos1?.includes(slot.pos) ? 10000 : player.pos2?.includes(slot.pos) ? 5000 : 0)
                + (names[index] === name ? 1 : 0);
        };
        const size = 1 << names.length, best = new Float64Array(size).fill(-Infinity);
        const parent = new Int16Array(size).fill(-1), pick = new Int8Array(size).fill(-1);
        best[0] = 0;
        for (let mask = 0; mask < size; mask++) {
            let index = 0; for (let n = mask; n; n &= n - 1) index++;
            if (index === names.length) continue;
            for (let i = 0; i < names.length; i++) if (!(mask & (1 << i))) {
                const next = mask | (1 << i), value = best[mask] + score(names[i], free[index], index);
                if (value > best[next]) { best[next] = value; parent[next] = mask; pick[next] = i; }
            }
        }
        let mask = size - 1;
        for (let index = free.length - 1; index >= 0; index--) {
            const slot = free[index]; lineup[slot.pos][slot.index] = names[pick[mask]]; mask = parent[mask];
        }
        for (const slot of slots) {
            const name=lineup[slot.pos][slot.index];
            const seat=slot.pos+':'+slot.index;
            if(!blockSlots.has(name))blockSlots.set(name,seat);
            lastSlots.set(name,seat);
            if(roles.get(name)?.role===trainingRole(slot))primaryUses.set(name,(primaryUses.get(name)||0)+1);
        }
    }
    // Keep legacy summary fields truthful; these still refer to assessed primary roles.
    let guaranteeShort = 0, preferShort = 0;
    for (const name of copy.members) {
        let played = 0, primary = 0;
        for (const lineup of copy.lineups) for (const [pos, names] of Object.entries(lineup))
            if (names.includes(name)) { played++; if (players[name]?.pos1?.includes(pos)) primary++; }
        guaranteeShort += Math.max(0, Math.min(copy.lineups.length===4?1:2, played) - primary);
        preferShort += Math.max(0, Math.min(copy.lineups.length/2, played) - primary);
    }
    copy.guaranteeShort = guaranteeShort; copy.preferShort = preferShort;
    return copy;
}
