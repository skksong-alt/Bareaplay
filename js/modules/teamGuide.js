import { approvedCycle, CYCLE_ROLE_LABELS, CYCLE_NOTES } from './approvedCycle.js?v=1';
// Public approved plan only. This page never initializes Firebase or reads surveys.
const cycle=approvedCycle('2026-10-07'),host=document.getElementById('guide-teams');
for(const team of [0,1]){
    const box=document.createElement('article');box.className='guide-team';
    const members=cycle.members.filter(p=>p.team===team),title=document.createElement('h3');
    title.textContent=`${team===0?'A':'B'}팀 · ${members.filter(p=>p.name!=='김우주').length}명${team===0?' + 비정기 1명':''}`;box.append(title);
    const list=document.createElement('dl');
    for(const role of ['CB','LB','RB','DM','AM','LW','RW','FW','GK']){
        const group=members.filter(p=>p.role===role);if(!group.length)continue;
        const heading=document.createElement('dt');heading.textContent=role+' · '+CYCLE_ROLE_LABELS[role];list.append(heading);
        for(const p of group){const row=document.createElement('dd');row.textContent=p.name+(p.role===p.second?' · 한 자리 집중':` · 대체 ${CYCLE_ROLE_LABELS[p.second]}`);
            if(CYCLE_NOTES[p.name]){const note=document.createElement('small');note.textContent=CYCLE_NOTES[p.name];row.append(note);}list.append(row);}
    }
    box.append(list);if(team===0)host.replaceChildren();host.append(box);
}
