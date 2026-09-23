// Enable only with the matching server endpoint AND reviewed Firestore Rules.
export const RATING_SERVICE_ENABLED=true;
export async function requestRating(payload) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
        const response=await fetch('/api/ratings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store',signal:controller.signal});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Object.assign(new Error('rating-service'),{code:data.error||'unavailable'});
        if(payload.action==='status'&&(typeof data.exists!=='boolean'||typeof data.version!=='string'))throw new Error('rating-service');
        if(payload.action==='submit'&&data.saved!==true)throw new Error('rating-service');
        if(payload.action==='leaders'&&(!Array.isArray(data.leaders)||data.leaders.length>3))throw new Error('rating-service');
        return data;
    } finally {clearTimeout(timer);}
}
