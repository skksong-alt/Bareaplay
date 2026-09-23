// Device convenience only, NOT authentication. Never persist ballot choices here.
const NAME_KEY='bp_rating_name_v1';
const REMEMBER_KEY='bp_rating_remember_v1';
const receiptKey=(date,name)=>`bp_rating_sent_v1:${date}:${encodeURIComponent(name)}`;
const browserStorage=()=>{try{return globalThis.localStorage;}catch{return null;}};
export function rememberedRatingName(storage=browserStorage()) {
    try{const name=storage?.getItem(NAME_KEY);return typeof name==='string'&&name.length<=100?name:'';}catch{return '';}
}
export function rememberRatingName(name,storage=browserStorage()) {
    try{if(!storage)return false;if(name)storage.setItem(NAME_KEY,name);else storage.removeItem(NAME_KEY);return true;}catch{return false;}
}
export function ratingRememberEnabled(storage=browserStorage()) {
    try{return storage?.getItem(REMEMBER_KEY)!=='off';}catch{return false;}
}
export function setRatingRememberEnabled(enabled,storage=browserStorage()) {
    try{storage?.setItem(REMEMBER_KEY,enabled?'on':'off');if(!enabled)storage?.removeItem(NAME_KEY);}catch{/* Optional device preference. */}
}
export function wasRatingSubmittedHere(date,name,storage=browserStorage()) {
    try{return storage?.getItem(receiptKey(date,name))==='1';}catch{return false;}
}
export function markRatingSubmittedHere(date,name,storage=browserStorage()) {
    try{storage?.setItem(receiptKey(date,name),'1');}catch{/* Saving a ballot must not depend on local storage. */}
}
export function ratingConfirmation(name,knownSubmitted,en=false) {
    if(knownSubmitted)return en
        ? `${name} has a previous submission recorded on this device. Replace the saved vote with your new choices? Previous choices will not be shown. Only submit for yourself.`
        : `${name}님은 이 기기에서 제출한 기록이 있습니다. 저장된 투표를 이번 선택으로 바꿀까요? 기존 선택 내용은 표시하지 않습니다. 본인 이름으로만 제출해 주세요.`;
    return en
        ? `Submit as ${name}? If a vote already exists under this name (including from another device), it will be replaced. Previous choices will not be shown. Only submit for yourself.`
        : `${name}님으로 제출할까요? 다른 기기를 포함해 이 이름으로 저장된 투표가 있으면 이번 선택으로 교체됩니다. 기존 선택 내용은 표시하지 않습니다. 본인 이름으로만 제출해 주세요.`;
}
