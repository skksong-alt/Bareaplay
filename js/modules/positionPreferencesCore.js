export const POSITIONS = [
    ['FW','공격수','Striker',50,10],['LW','왼쪽 윙','Left wing',17,23],['RW','오른쪽 윙','Right wing',83,23],
    ['AM','공격형 미들','Attacking mid',50,31],['CM','중앙 미들','Central mid',50,46],['DM','수비형 미들','Holding mid',50,61],
    ['LB','왼쪽 풀백','Left back',17,75],['CB','중앙 수비','Centre back',50,77],['RB','오른쪽 풀백','Right back',83,75],['GK','골키퍼','Goalkeeper',50,92]
];
// Display slots are separate from stored role codes: both centre-back slots
// record CB, preserving existing answers and the coach's one-row-per-role summary.
export const PREFERENCE_PITCH = [
    ['FW',50,16],
    ['LW',17,31],['AM',50,31],['RW',83,31],
    ['CM',34,51],['DM',66,51],
    ['LB',12,73],['CB',37,73],['CB',63,73],['RB',88,73],
    ['GK',50,92]
];
export function validatePreference(value,names) {
    return names.includes(value.name)&&['first','second'].every(k=>POSITIONS.some(p=>p[0]===value[k]))&&typeof value.stable==='boolean'&&typeof value.flexible==='boolean'&&typeof value.note==='string'&&value.note.length<=500;
}
export function preferenceSummary(responses,attendees=null) {
    const byName=new Map();
    for(const r of responses){if(!byName.has(r.name))byName.set(r.name,[]);byName.get(r.name).push(r);}
    const duplicates=[...byName].filter(([,rs])=>rs.length>1).map(([name])=>name);
    const unique=[...byName.values()].filter(rs=>rs.length===1).map(rs=>rs[0]).filter(r=>!attendees||attendees.includes(r.name));
    return {duplicates,rows:POSITIONS.map(([code,ko,en])=>({code,ko,en,first:unique.filter(r=>r.first===code).map(r=>r.name),second:unique.filter(r=>r.second===code&&r.first!==code).map(r=>r.name),same:unique.filter(r=>r.first===code&&r.second===code).map(r=>r.name)}))};
}
