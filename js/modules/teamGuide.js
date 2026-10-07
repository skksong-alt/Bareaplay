import { approvedCycle, CYCLE_ROLE_LABELS } from './approvedCycle.js?v=1';
// Public approved plan only. This page never initializes Firebase or reads surveys.
const cycle=approvedCycle('2026-10-07'),host=document.getElementById('guide-teams');
for(const team of [0,1]){
    const box=document.createElement('article');box.className='guide-team';
    const members=cycle.members.filter(p=>p.team===team),title=document.createElement('h3');
    title.textContent=`${team===0?'A':'B'}팀 · ${members.length}명`;box.append(title);
    const list=document.createElement('dl');
    for(const role of ['CB','LB','RB','DM','AM','LW','RW','FW','GK']){
        const group=members.filter(p=>p.role===role);if(!group.length)continue;
        const heading=document.createElement('dt');heading.textContent=role+' · '+CYCLE_ROLE_LABELS[role];list.append(heading);
        for(const p of group){const row=document.createElement('dd'),name=document.createElement('strong');name.textContent=p.name;row.append(name);
            const note=document.createElement('span');note.textContent=p.name==='송진호'?' (부족 포지션 담당)':p.role===p.second?' (같은 자리 집중)':` (2지망: ${CYCLE_ROLE_LABELS[p.second]})`;row.append(note);list.append(row);}
    }
    box.append(list);if(team===0)host.replaceChildren();host.append(box);
}
