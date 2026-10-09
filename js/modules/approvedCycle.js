// Coach-approved public training plan, not a copy of private survey responses.
// No scores, account identifiers, survey notes or attendance writes.
export const CYCLE_ROLE_LABELS={GK:'골키퍼',LB:'왼쪽 풀백',CB:'중앙 수비',RB:'오른쪽 풀백',DM:'수비형 미들',AM:'공격형 미들',LW:'왼쪽 윙',RW:'오른쪽 윙',FW:'공격수'};
const groups=[
    [['김건효','CB','CB'],['Casey','CB','RB'],['정명일','DM','FW'],['지승현','DM','DM'],['김해식','AM','FW'],['장선경','AM','FW'],['문석형','AM','DM'],['Kei','LW','AM'],['박정진','LW','LB'],['김경윤','LB','FW'],['박경용','LB','DM'],['김대근','RB','RB'],['박상묵','RB','CB'],['이찬희','CB','RB'],['정영락','FW','FW'],['박대영','FW','LB']],
    [['전의용','CB','LB'],['이승','CB','DM'],['김규남','DM','AM'],['김겸일','DM','CB'],['나원건','AM','DM'],['여인혁','AM','LW'],['황영조','AM','FW'],['Ghazi','LW','CB'],['박춘우','LW','AM'],['신정호','LW','FW'],['윤중부','RW','LW'],['최준경','LB','LW'],['전성우','LB','LB'],['김인수','RB','DM'],['장도영','RB','RW'],['김세웅','FW','AM'],['송준용','FW','RB']]
];
export function approvedCycle(date) {
    if(!date || date<'2026-10-07' || date>='2026-12-02')return null;
    return {schemaVersion:1,startDate:'2026-10-07',endDateExclusive:'2026-12-02',
        members:groups.flatMap((team,t)=>team.map(([name,role,second])=>({name,team:t,role,second})))};
}
// Runtime/public support roster only: never add a fake preference or a new
// Firestore field. Apply only to this exact approved plan, not other saved plans.
export function cycleSupporters(cycle) {
    const approved=approvedCycle(cycle?.startDate);
    if(!approved || cycle.schemaVersion!==approved.schemaVersion || cycle.startDate!==approved.startDate ||
        cycle.endDateExclusive!==approved.endDateExclusive || !Array.isArray(cycle.members) ||
        cycle.members.length!==approved.members.length || !approved.members.every(expected=>
            cycle.members.some(p=>['name','team','role','second'].every(field=>p[field]===expected[field]))))return [];
    return [{name:'송진호',team:0}];
}
export const CYCLE_NOTES={
    '송진호':'본인 지망이 아닌 팀의 부족 포지션 보충을 위한 운영 배정',
    '김규남':'운영진 · 당일 부족 포지션 보충 가능',
    '윤중부':'운영진 · 당일 부족 포지션 보충 가능'
};
