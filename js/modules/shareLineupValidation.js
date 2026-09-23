// Validate exactly the eleven/ten/nine players that the formation renderer shows.
// Saved lineups can contain unused legacy position keys; never rewrite the source.
const clean = value => String(value ?? '').replace(' (신규)', '').normalize('NFC').trim();
const quarter = (value, q) => Array.isArray(value) ? value[q] : value?.[`q_${q}`] ?? value?.[`q${q + 1}`];

export function prepareShareLineups(lineups, squads, posCellMap) {
    if (!Array.isArray(lineups) || lineups.length !== squads.length) throw new Error('팀과 라인업 수가 맞지 않습니다.');
    return lineups.map((result, teamIndex) => {
        const teamLabel=`팀 ${teamIndex + 1}`;
        const roster=(squads[teamIndex] || []).map(clean);
        const rosterSet=new Set(roster);
        if (roster.length !== rosterSet.size) throw new Error(`${teamLabel}: 팀 명단에 중복 선수가 있습니다.`);
        if (!result || result.lineups?.length !== 6 || result.formations?.length !== 6) {
            throw new Error(`${teamLabel}: 저장된 6쿼터 라인업 또는 포메이션이 없습니다.`);
        }
        const visibleLineups=[];
        const resters=[];
        for (let q=0; q<6; q++) {
            const label=`${teamLabel} ${q + 1}쿼터`;
            const slots=posCellMap[result.formations[q]];
            if (!Array.isArray(slots) || !slots.length) throw new Error(`${label}: 지원하지 않는 포메이션입니다.`);
            const source=result.lineups[q];
            if (!source || typeof source !== 'object') throw new Error(`${label}: 필드 배정이 없습니다.`);
            const counters={},visible={},field=[];
            for (const {pos} of slots) {
                const index=counters[pos]||0;
                counters[pos]=index+1;
                const name=source[pos]?.[index];
                if (typeof name !== 'string' || !clean(name)) throw new Error(`${label}: 필드에 빈 자리가 있습니다.`);
                (visible[pos] ||= []).push(name);
                field.push(clean(name));
            }
            const rawRest=quarter(result.resters,q);
            if (!Array.isArray(rawRest)) throw new Error(`${label}: 휴식 명단이 없습니다.`);
            const offField=rawRest.map(clean);
            const all=[...field,...offField];
            if (all.length !== roster.length || new Set(all).size !== roster.length || all.some(name=>!rosterSet.has(name))) {
                throw new Error(`${label}: 화면의 출전·휴식 명단이 팀 인원과 맞지 않습니다.`);
            }
            visibleLineups.push(visible);
            resters.push([...rawRest]);
        }
        return {...result,lineups:visibleLineups,resters};
    });
}
