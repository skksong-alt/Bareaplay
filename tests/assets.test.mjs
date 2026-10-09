import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const sw=readFileSync(resolve(root,'sw.js'),'utf8');

test('published logo assets derive from the approved final artwork and use correct small sizes',()=>{
    const source=readFileSync(resolve(root,'assets/barea-crest-concept.png'));
    assert.equal(createHash('sha256').update(source).digest('hex'),'f171738a48dcba77d2a4607b1729ef503ded1f1e2bb726c9a5d96fdb64f7703c');
    for(const size of [64,96,192,512]){
        const file=`/assets/barea-crest-${size}.png`,buffer=readFileSync(resolve(root,'.'+file));
        assert.equal(buffer.subarray(1,4).toString(),'PNG');
        assert.equal(buffer.readUInt32BE(16),size);assert.equal(buffer.readUInt32BE(20),size);
        assert.ok(sw.includes(`'${file}'`));
        if(size===96)assert.ok(buffer.length<20000,'header must not load the 1MB concept');
    }
    const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
    assert.deepEqual(manifest.icons.map(p=>[p.src,p.sizes]),[['/assets/barea-crest-192.png','192x192'],['/assets/barea-crest-512.png','512x512']]);
    assert.ok(existsSync(resolve(root,'assets/icon-512.png')),'old icon is preserved, not overwritten');
});
test('all module URLs exist and versioned imports match the cache manifest',()=>{
    const files=[...readdirSync(resolve(root,'js')).filter(n=>n.endsWith('.js')).map(n=>'js/'+n),...readdirSync(resolve(root,'js/modules')).filter(n=>n.endsWith('.js')).map(n=>'js/modules/'+n)];
    for(const file of files){
        const text=readFileSync(resolve(root,file),'utf8');
        for(const [,spec] of text.matchAll(/(?:from\s+|import\()['"](\.[^'"]+)['"]/g)){
            const [name,query]=spec.split('?'), target=resolve(root,dirname(file),name);
            assert.ok(existsSync(target),`${file}: missing ${spec}`);
            const url='/'+target.slice(root.length+1).replaceAll('\\','/')+(query?'?'+query:'');
            assert.ok(sw.includes(`'${url}'`),`cache missing ${url}`);
        }
    }
    for(const file of ['index.html','share.html']){
        const html=readFileSync(resolve(root,file),'utf8'),entry=html.match(/js\/app\.js\?v=\d+/)?.[0];
        assert.ok(entry);assert.ok(sw.includes(`'/${entry}'`),`${file}: entry must match cache`);
    }
});
test('new coaching modules do not write accounting/player/attendance records',()=>{
    for(const file of ['coachWorkspace.js','coachCore.js','weeklyContent.js','votePage.js']){
        const text=readFileSync(resolve(root,'js/modules',file),'utf8');
        assert.doesNotMatch(text,/deleteDoc|writeBatch/);
        assert.doesNotMatch(text,/(?:setDoc|updateDoc)\(doc\(db,\s*['"](?:attendance|expenses|incomes|players)['"]/);
    }
});
