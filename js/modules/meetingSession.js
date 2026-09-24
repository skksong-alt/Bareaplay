// One selected match, immutable queued edits, serialized saves. No backend dependency.
export function meetingFingerprint(value) {
    const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
    if (value == null) return 'missing';
    const {lastUpdatedAt, ...content} = value;
    return JSON.stringify(sorted(content));
}
export function meetingConflict() {
    const error = new Error('다른 기기에서 같은 경기를 수정했습니다. 현재 편집은 유지했고 덮어쓰지 않았습니다.');
    error.code = 'meeting-conflict'; return error;
}
export function createMeetingSession({commit, changed = () => {}, delay = 1000}) {
    let date = '', base = null, pending = null, active = null, timer = null, status = 'idle', error = null;
    const notify = () => changed({date, status, error: error?.code || '', dirty: !!pending || !!active});
    const setStatus = value => {status = value; notify();};
    const api = {
        get dirty() {return !!pending || !!active;},
        get status() {return status;},
        get date() {return date;},
        load(nextDate, data) {
            if (api.dirty) throw new Error('이전 경기의 저장을 먼저 완료하세요.');
            clearTimeout(timer);date = nextDate; base = data; error = null;setStatus('saved');
        },
        acceptRemote(data) {
            if (api.dirty) return false;
            if (meetingFingerprint(base) === meetingFingerprint(data)) return false;
            base = data;error = null;setStatus('saved');return true;
        },
        schedule(payload) {
            if (!date || payload.date !== date) throw new Error('작업 날짜가 일치하지 않아 저장하지 않았습니다.');
            pending = structuredClone(payload);clearTimeout(timer);
            if (status === 'conflict') {notify();return;}
            setStatus('pending');timer = setTimeout(() => api.flush().catch(() => {}), delay);
        },
        async flush() {
            clearTimeout(timer);
            if (active) {await active; return api.flush();}
            if (!pending) return;
            if (status === 'conflict') throw error;
            const task = pending, expected = base, target = date;pending = null;error = null;
            // Promise microtask ensures active is set before commit callbacks run.
            active = Promise.resolve().then(async () => {
                setStatus('saving');
                try {
                    base = await commit(target, task, expected);
                    setStatus(pending ? 'pending' : 'saved');
                } catch (e) {
                    pending ||= task;error = e;setStatus(e.code === 'meeting-conflict' ? 'conflict' : 'error');throw e;
                }
            });
            try {await active;} finally {active = null;notify();}
            if (pending) return api.flush();
        },
        // Caller must obtain explicit confirmation before discarding pending local work.
        discard() {if(active)throw new Error('저장 중에는 다시 불러올 수 없습니다.');clearTimeout(timer);pending=null;error=null;setStatus('idle');}
    };
    return api;
}
