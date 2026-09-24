// One pending patch per document. Different rows/fields never cancel each other.
// Failed patches stay in memory until explicitly retried; no automatic write loop.
export function createSaveQueue(commit, onChange = () => {}, delay = 350) {
    const entries = new Map();
    const notify = () => onChange([...entries].map(([key,e]) => ({key, status:e.error?'error':e.running?'saving':'pending'})));
    async function run(key) {
        const e=entries.get(key);
        if (!e) return;
        if(e.running) { await e.running; if(entries.has(key)) return run(key); return; }
        clearTimeout(e.timer);
        const patch=e.patch; e.patch={}; e.active=patch; e.error=null;
        e.running=Promise.resolve().then(()=>commit(key,patch)); notify();
        try {
            await e.running;
            e.running=null; e.active={};
            if(Object.keys(e.patch).length) return run(key);
            entries.delete(key); notify();
        } catch(error) {
            e.patch={...patch,...e.patch}; e.active={}; e.running=null; e.error=error; notify(); throw error;
        }
    }
    return {
        enqueue(key,patch) {
            let e=entries.get(key);
            if(!e) { e={patch:{},active:{}}; entries.set(key,e); }
            e.patch={...e.patch,...patch}; clearTimeout(e.timer); notify();
            if(!e.running&&!e.error) e.timer=setTimeout(()=>run(key).catch(()=>{}),delay);
        },
        pending(key) { const e=entries.get(key); return {...e?.active,...e?.patch}; },
        dirty:()=>entries.size>0,
        async flush() {
            const results=await Promise.allSettled([...entries.keys()].map(run));
            if(results.some(r=>r.status==='rejected')) throw new Error('저장하지 못한 회계 변경이 있습니다. 연결·권한을 확인한 뒤 다시 저장하세요.');
        }
    };
}
