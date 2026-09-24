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
export function applyTrainingRoles(result, members, positionMap, players = {}, locks = []) {
    if (!result || !members?.length) return result;
    const copy = JSON.parse(JSON.stringify(result));
    const roles = new Map(members.map(p => [p.name, p]));
    const primaryUses = new Map();
    for (let q = 0; q < copy.lineups.length; q++) {
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
            return (preferred?.role === role ? 1000000 - (primaryUses.get(name) || 0) * 1000 : preferred?.second === role ? 10000 : 0)
                + (player.pos1?.includes(slot.pos) ? 100 : player.pos2?.includes(slot.pos) ? 50 : 0)
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
            if(roles.get(name)?.role===trainingRole(slot))primaryUses.set(name,(primaryUses.get(name)||0)+1);
        }
    }
    // Keep legacy summary fields truthful; these still refer to assessed primary roles.
    let guaranteeShort = 0, preferShort = 0;
    for (const name of copy.members) {
        let played = 0, primary = 0;
        for (const lineup of copy.lineups) for (const [pos, names] of Object.entries(lineup))
            if (names.includes(name)) { played++; if (players[name]?.pos1?.includes(pos)) primary++; }
        guaranteeShort += Math.max(0, Math.min(2, played) - primary);
        preferShort += Math.max(0, Math.min(3, played) - primary);
    }
    copy.guaranteeShort = guaranteeShort; copy.preferShort = preferShort;
    return copy;
}
