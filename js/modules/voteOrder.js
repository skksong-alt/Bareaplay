// Read-only ordering helpers. Existing response fields and document IDs are unchanged.
export function responseTime(response) {
    return response.status === 'attend' ? response.attendingSince : response.updatedAt;
}
export function compareResponseTime(a, b) {
    const x=responseTime(a), y=responseTime(b);
    const xs=Number.isFinite(x?.seconds)?x.seconds:Infinity;
    const ys=Number.isFinite(y?.seconds)?y.seconds:Infinity;
    if(xs!==ys)return xs<ys?-1:1;
    const xn=Number.isFinite(x?.nanoseconds)?x.nanoseconds:0;
    const yn=Number.isFinite(y?.nanoseconds)?y.nanoseconds:0;
    if(xn!==yn)return xn-yn;
    // Equal/missing server timestamps have no recoverable chronological order.
    return String(a.name||a.id||'').localeCompare(String(b.name||b.id||''));
}
export function registeredVoteName(value, names) {
    const name=String(value ?? '').normalize('NFC').trim();
    if(names.includes(name))return name;
    const matches=names.filter(n=>n.normalize('NFC').trim().toLowerCase()===name.toLowerCase());
    return matches.length===1?matches[0]:null;
}
// Reuse existing response IDs; never rename, merge or delete historical ballots.
export function responseIdentity(value, names, responses) {
    const input=String(value ?? '').normalize('NFC').trim();
    if(names.filter(n=>n.normalize('NFC').trim().toLowerCase()===input.toLowerCase()).length>1)throw new Error('ambiguous-name');
    const registered=registeredVoteName(input,names);
    const matches=responses.filter(r=>String(r.name ?? r.id).normalize('NFC').trim().toLowerCase()===input.toLowerCase());
    if(matches.length>1)throw new Error('ambiguous-name');
    const existing=matches[0],name=existing?.name || registered || input;
    return {id:existing?.id || name,name,guest:!registered};
}
export function confirmGuest(name, names, lang='ko', ask=message=>window.confirm(message)) {
    if(registeredVoteName(name,names))return true;
    return ask(lang==='en'
        ? `“${name}” is not on the registered player list. Are you a guest?\n\nIf you are an existing player, choose Cancel and check the spelling of your name. Choose OK only to submit as a guest.`
        : `등록된 선수 명단에 “${name}” 이름이 없습니다. Guest이신가요?\n\n기존 선수라면 [취소] 후 이름의 오타를 확인하거나 명단에서 선택해 주세요. 게스트가 맞으면 [확인]을 눌러 신청하세요.`);
}
