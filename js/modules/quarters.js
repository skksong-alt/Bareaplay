// Legacy meetings are six quarters. Switching the view never erases the tail.
export const quarterCount = value => Number(value?.quarterCount ?? value) === 4 ? 4 : 6;
export function activeQuarters(result, count=6) {
    if(!result)return result;
    const next={...result};
    for(const key of ['lineups','formations','resters','referees','manualReferees']) {
        if(Array.isArray(result[key]))next[key]=result[key].slice(0,quarterCount(count));
    }
    return next;
}
export function preserveInactiveQuarters(candidate, original, count=6) {
    if(quarterCount(count)!==4||!original)return candidate;
    const next={...candidate};
    for(const key of ['lineups','formations','resters','referees','manualReferees']) {
        if(Array.isArray(original[key])&&original[key].length>4) {
            const head=Array.from({length:4},(_,q)=>candidate[key]?.[q]??null);
            next[key]=[...head,...structuredClone(original[key].slice(4))];
        }
    }
    return next;
}
