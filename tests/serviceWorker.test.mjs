import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('worker installation does not replace editing clients or preload admin bundles',async()=>{
    const handlers={},cached=[],removed=[];let activated=0,claimed=0,waiting;
    const sandbox={URL,Promise,console,fetch:async()=>({ok:true,clone(){return this;}}),
        self:{location:{origin:'https://local.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>activated++,clients:{claim:()=>claimed++}},
        caches:{open:async()=>({add:async url=>cached.push(url),put:async()=>{}}),keys:async()=>['bareaplay-cache-old','bareaplay-cache-v74'],delete:async key=>removed.push(key),match:async()=>null}};
    vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),sandbox);
    handlers.install({waitUntil:p=>waiting=p});await waiting;
    assert.equal(activated,0);assert.ok(cached.includes('/js/boot.js?v=1'));
    assert.ok(cached.includes('/js/modules/votePage.js?v=14'));
    assert.equal(cached.some(p=>/teamBalancer|lineupGenerator|accounting\.js|teamCycles/.test(p)),false);
    handlers.message({data:'SKIP_WAITING'});assert.equal(activated,1);
    handlers.activate({waitUntil:p=>waiting=p});await waiting;
    assert.deepEqual(removed,['bareaplay-cache-old']);assert.equal(claimed,1);
    let intercepted=false;
    handlers.fetch({request:{url:'https://local.test/api/ratings',method:'POST'},respondWith:()=>intercepted=true});
    assert.equal(intercepted,false,'ballots never enter the asset cache');
});
