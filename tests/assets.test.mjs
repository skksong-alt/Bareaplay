import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const sw=readFileSync(resolve(root,'sw.js'),'utf8');
test('all module URLs exist and versioned imports are precached',()=>{
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
        const html=readFileSync(resolve(root,file),'utf8');assert.ok(html.includes('js/app.js?v=22'));
    }
});
test('new coaching modules do not write accounting/player/attendance records',()=>{
    for(const file of ['coachWorkspace.js','coachCore.js','weeklyContent.js','votePage.js']){
        const text=readFileSync(resolve(root,'js/modules',file),'utf8');
        assert.doesNotMatch(text,/deleteDoc|writeBatch/);
        assert.doesNotMatch(text,/(?:setDoc|updateDoc)\(doc\(db,\s*['"](?:attendance|expenses|incomes|players)['"]/);
    }
});
