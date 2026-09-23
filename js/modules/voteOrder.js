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
export function confirmGuest(name, names, lang='ko', ask=message=>window.confirm(message)) {
    if(names.includes(name))return true;
    return ask(lang==='en'
        ? `“${name}” is not on the registered player list. Are you a guest?\n\nIf you are an existing player, choose Cancel and check the spelling of your name. Choose OK only to submit as a guest.`
        : `등록된 선수 명단에 “${name}” 이름이 없습니다. Guest이신가요?\n\n기존 선수라면 [취소] 후 이름의 오타를 확인하거나 명단에서 선택해 주세요. 게스트가 맞으면 [확인]을 눌러 신청하세요.`);
}
