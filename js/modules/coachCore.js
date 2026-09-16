// Pure coaching calculations. No Firebase, browser state, or writes.
export const cleanName = value => String(value ?? '').replace(' (신규)', '').normalize('NFC').trim();
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clone = value => JSON.parse(JSON.stringify(value));
export const quarterValue = (value, q) => Array.isArray(value) ? value[q] : value?.[`q_${q}`] ?? value?.[`q${q + 1}`];
export const ROLES = { connector: ['연결', 'Link player'], organiser: ['수비 정리', 'Defensive organiser'], outlet: ['전방 연결', 'Forward outlet'], mentor: ['안내', 'Guide'], learner: ['학습 중', 'Learning'] };
export function positionGroup(pos, formation = '') {
    if (pos === 'GK') return 'GK';
    if (['CB','LB','RB','DF','LWB','RWB','WB','SW','LCB','RCB'].includes(pos)) return 'DEF';
    if (['LW','RW'].includes(pos)) return ['4-3-3','4-2-3-1'].includes(formation) ? 'ATT' : 'MID';
    if (['FW','ST','CF','SS','LF','RF'].includes(pos)) return 'ATT';
    return 'MID';
}
export function roleTip(pos, formation = '', lang = 'ko') {
    const tips = {
        GK: ['가까운 패스 길 확인 · 수비수에게 짧고 분명하게 안내', 'Find a short passing option. Give clear, brief directions.'],
        DEF: ['동료가 나가면 뒤 공간 커버 · 공을 잡으면 가까운 패스 길 확인', 'Cover behind a teammate who steps out. Find a short passing option.'],
        MID: ['받기 전 주변 확인 · 패스한 뒤 다시 받을 각도 만들기', 'Look around before receiving. Move to offer another passing angle.'],
        ATT: ['동료가 줄 수 있는 패스 길 만들기 · 공을 잃으면 수비에 참여', 'Offer a reachable passing option. Help defend after losing the ball.']
    };
    if (['LW','RW'].includes(pos) && ['3-5-2','3-4-2','3-4-1'].includes(formation)) return lang === 'en'
        ? 'Provide width with the ball. Recover to support your outside centre-back.'
        : '우리 공일 때 폭 만들기 · 상대 공일 때 바깥 센터백 지원';
    return tips[positionGroup(pos, formation)][lang === 'en' ? 1 : 0];
}
export function recentHistory(meetings, beforeDate, count = 4) {
    const history = {};
    const seenDates = new Set();
    for (const meeting of [...meetings].filter(m => m.date && m.date < beforeDate).sort((a,b) => b.date.localeCompare(a.date))) {
        if (seenDates.has(meeting.date)) continue;
        seenDates.add(meeting.date);
        const day = {};
        const seenReferees = new Set();
        const item = name => day[cleanName(name)] ||= { ATT:0, MID:0, DEF:0, GK:0, REST:0, REF:0, positions:{} };
        for (const result of Object.values(meeting.teamLineupCache || {})) {
            (result?.lineups || []).forEach((lineup, q) => {
                for (const [pos, names] of Object.entries(lineup || {})) for (const name of names || []) {
                    if (!name) continue;
                    const p = item(name); p[positionGroup(pos, result.formations?.[q])]++;
                    p.positions[pos] = (p.positions[pos] || 0) + 1;
                }
                for (const name of quarterValue(result.resters, q) || []) if (name) item(name).REST++;
                const refs = quarterValue(result.referees, q);
                for (const name of Array.isArray(refs) ? refs : [refs]) if (name && !seenReferees.has(`${q}:${cleanName(name)}`)) { item(name).REF++; seenReferees.add(`${q}:${cleanName(name)}`); }
            });
        }
        for (const [name, totals] of Object.entries(day)) {
            const h = history[name] ||= { dates:[], ATT:0, MID:0, DEF:0, GK:0, REST:0, REF:0, positions:{} };
            if (h.dates.length >= count) continue;
            h.dates.push(meeting.date);
            for (const k of ['ATT','MID','DEF','GK','REST','REF']) h[k] += totals[k];
            for (const [pos, n] of Object.entries(totals.positions)) h.positions[pos] = (h.positions[pos] || 0) + n;
        }
    }
    return history;
}
export function rolePenalty(teams, profiles = {}) {
    let penalty = 0;
    for (const role of ['connector','organiser','outlet','mentor']) {
        const counts = teams.map(t => t.filter(p => profiles[cleanName(p.name)]?.roles?.includes(role)).length);
        penalty += (Math.max(0,...counts) - Math.min(...counts)) * (role === 'mentor' ? 24 : 16);
    }
    for (const team of teams) {
        const roles = team.flatMap(p => profiles[cleanName(p.name)]?.roles || []);
        if (roles.includes('learner') && !roles.includes('mentor')) penalty += 40;
    }
    return penalty;
}
export function effectivePlayer(player, profiles = {}) {
    const profile = profiles[cleanName(player.name)] || {};
    return profile.guest && Number.isFinite(profile.skill)
        ? { ...player, s1: profile.skill, pos1: profile.positions || player.pos1 || [] }
        : player;
}
export function lineupSummary(result, players, profiles = {}) {
    return (result?.lineups || []).map((lineup,q) => {
        const names = Object.values(lineup).flat().filter(Boolean);
        const roleCounts = {};
        for (const name of names) for (const role of profiles[cleanName(name)]?.roles || []) roleCounts[role] = (roleCounts[role] || 0) + 1;
        return { q, names, average: names.length ? names.reduce((s,n) => s + (effectivePlayer(players[n] || {name:n,s1:65},profiles).s1 ?? 65),0) / names.length : 0, roleCounts };
    });
}
export function locate(result, q, name) {
    for (const [pos, names] of Object.entries(result.lineups?.[q] || {})) {
        const index = names.indexOf(name); if (index >= 0) return { pos, index };
    }
    const index = (quarterValue(result.resters, q) || []).indexOf(name);
    return index >= 0 ? { pos:'REST', index } : null;
}
export function validateLineup(result, members) {
    if (!result || result.lineups?.length !== 6) return false;
    for (let q=0; q<6; q++) {
        const names = [...Object.values(result.lineups[q]).flat(), ...(quarterValue(result.resters,q) || [])];
        if (names.length !== members.length || new Set(names).size !== members.length || names.some(n => !members.includes(n))) return false;
    }
    return true;
}
// Apply locked positions to a candidate using swaps, never dropping a player.
export function applyLocks(candidate, original, locks = []) {
    const result = clone(candidate);
    const lockedSlots = new Set();
    for (const { name, q } of locks) {
        const target = locate(original,q,name), from = locate(result,q,name);
        if (!target || !from) return null;
        const key = `${q}:${target.pos}:${target.index}`;
        if (lockedSlots.has(key)) continue;
        const array = loc => loc.pos === 'REST' ? result.resters[q] : result.lineups[q]?.[loc.pos];
        const dest = array(target), src = array(from);
        if (!dest || target.index >= dest.length || lockedSlots.has(`${q}:${from.pos}:${from.index}`)) return null;
        [dest[target.index], src[from.index]] = [src[from.index], dest[target.index]];
        lockedSlots.add(key);
    }
    // Recalculate referees after swaps; manual choices that still rest are preserved.
    result.manualReferees = Array.from({length:6},(_,q) => {
        const old = quarterValue(original.manualReferees,q);
        return result.resters[q]?.includes(old) ? old : null;
    });
    result.referees = result.resters.map((names,q) => result.manualReferees[q] || names[0] || null);
    return result;
}
export function historyBonus(name, pos, history, player) {
    const h = history[cleanName(name)];
    if (!h || !player.wishPos?.includes(pos)) return 0;
    const opportunities = player.wishPos.reduce((n,p) => n + (h.positions[p] || 0),0);
    return Math.max(0,h.dates.length - opportunities) * 35;
}
export function chooseReviewDate(meetings, currentDate, override, today) {
    const dates = [...new Set(meetings.map(m => m.date).filter(d => d && d < currentDate && d < today))].sort().reverse();
    if (override === 'none') return '';
    return override ? (dates.includes(override) ? override : '') : dates[0] || '';
}
export function validVideoUrl(value) {
    try {
        const u = new URL(value);
        if (u.protocol !== 'https:') return '';
        const hosts = ['www.youtube.com','youtube.com','youtu.be','www.fifatrainingcentre.com','fifatrainingcentre.com'];
        return hosts.includes(u.hostname) ? u.href : '';
    } catch { return ''; }
}
export function candidateCost(result, players, history = {}, original = null) {
    const counts={}, gks={}; let cost=0;
    result.lineups.forEach((lineup,q)=>{
        for(const [pos,names] of Object.entries(lineup)) for(const name of names) {
            const p=players[name] || {}, c=counts[name] ||= {played:0,primary:0,wish:0}; c.played++;
            if(p.pos1?.includes(pos)) c.primary++; else cost += p.pos2?.includes(pos) ? 2 : 60;
            if(p.wishPos?.includes(pos)) c.wish++;
            cost -= historyBonus(name,pos,history,p);
            if(pos==='GK') gks[name]=(gks[name]||0)+1;
            if(original && locate(original,q,name)?.pos!==pos) cost+=3;
        }
    });
    for(const [name,c] of Object.entries(counts)) {
        const p=players[name] || {};
        if(p.pos1?.length)cost+=Math.max(0,Math.min(2,c.played)-c.primary)*1000;
        cost+=Math.max(0,Math.min(p.wishQuota||0,c.played)-c.wish)*250;
        if(!(p.pos1?.includes('GK')&&p.pos2?.includes('GK')))cost+=Math.max(0,(gks[name]||0)-1)*600;
    }
    return cost;
}
