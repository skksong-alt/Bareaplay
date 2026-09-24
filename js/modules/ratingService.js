// Enable only with the matching server endpoint AND reviewed Firestore Rules.
export const RATING_SERVICE_ENABLED=true;
export function ratingFailureMessage(error, en=false) {
    if(error?.code==='quota')return en
        ? 'The service has reached a usage limit. Your choices remain on this screen. Please let the coach know; repeated retries will not help.'
        : '서비스 사용량 한도에 도달했습니다. 선택 내용은 이 화면에 유지됩니다. 반복해서 누르지 말고 감독에게 알려 주세요.';
    if(error?.name==='AbortError'||error instanceof TypeError)return en
        ? 'The connection was interrupted, so completion could not be confirmed. Keep this screen open and check again once connected; an existing vote will ask for replacement.'
        : '연결이 끊기거나 응답이 늦어 완료 여부를 확인하지 못했습니다. 이 화면을 유지하고 연결 후 다시 확인해 주세요. 이미 저장됐다면 교체 여부를 묻습니다.';
    return en?'Could not save. Your choices remain on this screen. Please retry later.'
        :'저장하지 못했습니다. 선택 내용은 이 화면에 유지했습니다. 잠시 후 다시 시도해 주세요.';
}
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
