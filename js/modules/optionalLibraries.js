// Large read/export helpers are loaded only by the feature that needs them.
const sources={Chart:'https://cdn.jsdelivr.net/npm/chart.js',XLSX:'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'};
const pending=new Map();
export function ensureLibrary(name) {
    if(window[name])return Promise.resolve(window[name]);
    if(!sources[name])return Promise.reject(new Error('지원하지 않는 도구입니다.'));
    if(pending.has(name))return pending.get(name);
    const promise=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src=sources[name];script.async=true;
        const finish=ok=>{clearTimeout(timer);script.onload=null;script.onerror=null;
            if(ok&&window[name])resolve(window[name]);
            else{script.remove();pending.delete(name);reject(new Error('도구를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.'));}
        };
        const timer=setTimeout(()=>finish(false),12000);
        script.onload=()=>finish(true);script.onerror=()=>finish(false);document.head.append(script);
    });
    pending.set(name,promise);return promise;
}
