// Render an existing PUBLIC snapshot locally. No fetch, Firebase, or DOM screenshots.
export function imageTeams(share) {
    return Object.keys(share.teams||{}).sort((a,b)=>Number(a.replace(/\D/g,''))-Number(b.replace(/\D/g,'')));
}
const quarter=(value,q)=>Array.isArray(value)?value[q]:value?.[`q${q+1}`]??value?.[`q_${q}`];
export function lineupImageModel(share,key,positions) {
    const keys=imageTeams(share),index=keys.indexOf(key),data=share.lineups?.[key];
    if(index<0||!Array.isArray(data?.lineups)||data.lineups.length!==6)throw new Error('공개된 6쿼터 라인업이 없습니다.');
    return {team:share.teamNames?.[index]||`Team ${String.fromCharCode(65+index)}`,time:share.meetingInfo?.time||'',
        venue:share.meetingInfo?.location||'',publishedAt:share.createdAt||'',quarters:data.lineups.map((lineup,q)=>{
            const formation=data.formations?.[q],slots=positions[formation];
            if(!slots?.length)throw new Error('확인할 수 없는 포메이션입니다. 원본 공개 페이지를 사용해 주세요.');
            const counters={},referee=quarter(data.referees,q)||'';
            return {q:q+1,formation,referee,rest:(quarter(data.resters,q)||[]).filter(n=>n!==referee),players:slots.map(slot=>{
                const i=counters[slot.pos]||0;counters[slot.pos]=i+1;
                return {...slot,name:lineup[slot.pos]?.[i]||'미배정'};
            })};
        })};
}
function text(ctx,value,x,y,size=22,color='#213c32',max=430,align='left') {
    const label=String(value);ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';
    ctx.font=`600 ${size}px system-ui, sans-serif`;
    while(ctx.measureText(label).width>max&&size>10){size--;ctx.font=`600 ${size}px system-ui, sans-serif`;}
    ctx.fillText(label,x,y,max);
}
export async function createLineupImage(model) {
    const canvas=document.createElement('canvas');canvas.width=1500;canvas.height=1580;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지를 만들 수 없는 브라우저입니다.');
    ctx.fillStyle='#f1f5f2';ctx.fillRect(0,0,1500,1580);
    text(ctx,`BAREA PLAY  /  ${model.team}`,42,48,32,'#124b36',1416);
    text(ctx,`${model.time} · ${model.venue}`,42,93,22,'#425b4e',1416);
    text(ctx,'확정 라인업 · 6쿼터 / PUBLISHED LINEUP',42,129,17,'#67766d',1416);
    for(const card of model.quarters){
        const x=30+((card.q-1)%3)*490,y=160+Math.floor((card.q-1)/3)*660;
        ctx.fillStyle='white';ctx.fillRect(x,y,460,642);
        text(ctx,`Q${card.q}  /  ${card.formation}`,x+18,y+30,24);
        const px=x+16,py=y+58,w=428,h=480;
        ctx.fillStyle='#276348';ctx.fillRect(px,py,w,h);
        for(let i=0;i<8;i+=2){ctx.fillStyle='#2d6d50';ctx.fillRect(px,py+i*h/8,w,h/8);}
        ctx.strokeStyle='#ffffff66';ctx.lineWidth=2;ctx.strokeRect(px+8,py+8,w-16,h-16);
        ctx.beginPath();ctx.moveTo(px+8,py+h/2);ctx.lineTo(px+w-8,py+h/2);ctx.stroke();
        ctx.beginPath();ctx.arc(px+w/2,py+h/2,46,0,Math.PI*2);ctx.stroke();
        ctx.strokeRect(px+w*.25,py+8,w*.5,60);ctx.strokeRect(px+w*.25,py+h-68,w*.5,60);
        for(const p of card.players){
            const cx=px+w*p.x/100,cy=py+h*p.y/100;
            ctx.fillStyle=p.pos==='GK'?'#e6c66a':'#ffffff';ctx.beginPath();ctx.arc(cx,cy-9,13,0,Math.PI*2);ctx.fill();
            text(ctx,p.pos,cx,cy-9,12,'#234b36',26,'center');
            ctx.fillStyle='#153c2e';ctx.fillRect(cx-49,cy+7,98,25);
            text(ctx,p.name,cx,cy+20,17,'white',94,'center');
        }
        text(ctx,`심판 / REF: ${card.referee||'—'}`,x+18,y+568,18,'#234b36',420);
        const rest=card.rest.join(', ')||'없음 / None';
        text(ctx,`휴식 / REST: ${rest}`,x+18,y+607,18,'#56685c',420);
    }
    text(ctx,`공개본 기준 / Snapshot: ${model.publishedAt||model.time}`,42,1522,16,'#647669',1416);
    text(ctx,'변경 시 새 이미지 확인 / Check for a newer image if the lineup changes.',42,1554,16,'#647669',1416);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지 생성 실패')),'image/png'));
}
export function mountLineupImage(host,share,positions,en=false) {
    const keys=imageTeams(share);if(!keys.length)return;
    const panel=document.createElement('section');panel.className='bp-card';
    const title=document.createElement('h2');title.className='bp-h2';title.textContent=en?'Save / share the lineup image':'단톡방에 공유할 라인업 이미지';
    const hint=document.createElement('p');hint.textContent=en?'Creates a PNG from this published version. It does not change any assignment.':'이 공개본의 6쿼터를 팀별 PNG 한 장으로 만듭니다. 배정은 변경하지 않습니다.';
    const select=document.createElement('select');select.setAttribute('aria-label',en?'Team to export':'이미지로 만들 팀');
    keys.forEach((key,i)=>{const option=document.createElement('option');option.value=key;option.textContent=share.teamNames?.[i]||`Team ${String.fromCharCode(65+i)}`;select.append(option);});
    const prepare=document.createElement('button');prepare.type='button';prepare.textContent=en?'Prepare image':'이미지 만들기';
    const output=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
    for(const el of [select,prepare])el.style.cssText='padding:12px 16px;margin:12px 8px 8px 0;border:1px solid #b6cabc;border-radius:8px;background:#f2f7f3;font-weight:700';
    let objectUrl=null;
    const clear=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;output.replaceChildren();status.textContent='';};
    select.onchange=clear;window.addEventListener('pagehide',clear,{once:true});
    prepare.onclick=async()=>{
        prepare.disabled=true;select.disabled=true;clear();status.textContent=en?'Preparing…':'이미지를 만들고 있습니다…';
        try{
            const model=lineupImageModel(share,select.value,positions),blob=await createLineupImage(model);
            if(!panel.isConnected)return;
            const filename=`Barea-${model.time.slice(0,10).replace(/[^0-9-]/g,'')}-${select.value.replace(/[^a-z0-9_-]/gi,'')}.png`;
            objectUrl=URL.createObjectURL(blob);
            const image=document.createElement('img');image.src=objectUrl;image.alt=`${model.team} · ${model.time} · 6쿼터`;image.style.cssText='display:block;width:100%;max-width:650px;margin:12px auto';
            const download=document.createElement('a');download.href=objectUrl;download.download=filename;download.textContent=en?'Download PNG':'PNG 이미지 저장';download.style.cssText='display:inline-block;padding:12px;background:#17664d;color:white;border-radius:8px;margin:8px';
            output.append(download,image);
            if(typeof File!=='undefined'){
                const file=new File([blob],filename,{type:'image/png'});
                if(navigator.canShare?.({files:[file]})&&navigator.share){
                    const button=prepare.cloneNode();button.disabled=false;button.textContent=en?'Share image':'이미지 공유';
                    button.onclick=async()=>{try{await navigator.share({files:[file],title:`Barea ${model.team}`});}catch(e){if(e.name!=='AbortError')status.textContent=en?'Please download the PNG and attach it in your chat.':'PNG를 저장한 뒤 카톡방에 사진으로 첨부해 주세요.';}};
                    output.prepend(button);
                }
            }
            status.textContent=en?'Download and attach in your team chat. A newer publication needs a new image.':'저장한 이미지를 카톡방에 첨부하세요. 재공개한 경우 새 이미지를 만들어 주세요.';
        }catch(e){status.textContent=en?'Could not create the image. Please use the published link.':e.message;}
        finally{prepare.disabled=false;select.disabled=false;}
    };
    panel.append(title,hint,select,prepare,status,output);host.append(panel);
}
