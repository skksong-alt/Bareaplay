import { approvedCycle, cycleSupporters, CYCLE_ROLE_LABELS } from './approvedCycle.js?v=2';
// Public approved plan only. This page never initializes Firebase or reads surveys.
const cycle=approvedCycle('2026-10-07'),host=document.getElementById('guide-teams');
const en=document.documentElement.lang==='en';
const roles=en?{GK:'Goalkeeper',CB:'Centre-back',LB:'Left-back',RB:'Right-back',DM:'Defensive midfielder',AM:'Attacking midfielder',LW:'Left winger',RW:'Right winger',FW:'Forward'}:CYCLE_ROLE_LABELS;
document.querySelectorAll('[data-guide-language]').forEach(link=>link.addEventListener('click',()=>{
    try{localStorage.setItem('bp_lang',link.dataset.guideLanguage);}catch{/* optional language preference */}
}));
document.querySelectorAll('a[href="/?vote=current"]').forEach(link=>link.addEventListener('click',()=>{
    try{localStorage.setItem('bp_lang',en?'en':'ko');}catch{/* optional language preference */}
}));
for(const team of [0,1]){
    const box=document.createElement('article');box.className='guide-team';
    const members=cycle.members.filter(p=>p.team===team),supporters=cycleSupporters(cycle).filter(p=>p.team===team),title=document.createElement('h3');
    title.textContent=en?`Team ${team===0?'A':'B'} · ${members.length+supporters.length} players`:`${team===0?'A':'B'}팀 · ${members.length+supporters.length}명`;box.append(title);
    const list=document.createElement('dl');
    for(const role of ['CB','LB','RB','DM','AM','LW','RW','FW','GK']){
        const group=members.filter(p=>p.role===role);if(!group.length)continue;
        const heading=document.createElement('dt');heading.textContent=role+' · '+roles[role];list.append(heading);
        for(const p of group){const row=document.createElement('dd'),name=document.createElement('strong');name.textContent=p.name;row.append(name);
            const note=document.createElement('span');note.textContent=p.role===p.second?(en?' (same-position focus)':' (같은 자리 집중)'):(en?` (2nd choice: ${roles[p.second]})`:` (2지망: ${roles[p.second]})`);row.append(note);list.append(row);}
    }
    if(supporters.length){
        const heading=document.createElement('dt');heading.textContent=en?'Flexible support':'부족 포지션 보충';list.append(heading);
        for(const p of supporters){const row=document.createElement('dd');row.textContent=en?`${p.name} (head coach · fills match-day gaps)`:`${p.name}(감독) · 당일 부족한 자리 보충`;list.append(row);}
    }
    box.append(list);if(team===0)host.replaceChildren();host.append(box);
}
