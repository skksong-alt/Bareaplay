import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guidelinesFor, lessonHtml, parseGuidelines } from '../js/modules/weeklyContent.js';

test('guidelines link the instruction itself; defaults are six coach-supplied resources',()=>{
    const list=guidelinesFor('2026-09-23');
    assert.equal(list.length,6);
    const html=lessonHtml('2026-09-23',{},'ko');
    assert.match(html,/<details class="coach-card preparation-card"><summary>/);
    assert.doesNotMatch(html,/<details[^>]*\sopen(?:\s|>)/);
    assert.doesNotMatch(html,/>https?:\/\//);
    assert.match(html,/준비운동 후 · 15분/);
    assert.match(html,/rel="noopener noreferrer"/);
});

test('old single-resource lessons and plain descriptions remain visible without changes',()=>{
    const custom={ko:'기존 교육자료',en:'Saved resource',url:'https://youtu.be/example',segmentKo:'기존 설명',drillKo:'기존 연습'};
    const before=JSON.stringify(custom);
    assert.deepEqual(guidelinesFor('2026-09-23',custom),[{title:'기존 교육자료',url:custom.url}]);
    assert.match(lessonHtml('2026-09-23',custom),/기존 설명/);
    assert.match(lessonHtml('2026-09-23',custom),/기존 연습/);
    assert.equal(JSON.stringify(custom),before);
});

test('optional legacy text fields accept safe link lists, with language fallback',()=>{
    const custom={segmentKo:'[공을 받기 전에 보기](https://youtu.be/example)\n[패스 후 이동](https://www.youtube.com/watch?v=example2)',segmentEn:'[Look before receiving](https://youtu.be/example)'};
    assert.equal(guidelinesFor('2026-09-23',custom).length,2);
    assert.equal(guidelinesFor('2026-09-23',custom,'en')[0].title,'Look before receiving');
    assert.equal(guidelinesFor('2026-09-23',{segmentKo:custom.segmentKo},'en').length,2);
    assert.equal(parseGuidelines('[Bad](https://youtube.com.evil.test/a)\n[Bad](javascript:alert(1))').length,0);
    const html=lessonHtml('2026-09-23',{segmentKo:'[<img src=x onerror=alert(1)>](https://youtu.be/example)'},'ko');
    assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});

test('match resources stylesheet is versioned and included in the offline cache',()=>{
    const root=new URL('../',import.meta.url);
    assert.match(readFileSync(new URL('index.html',root),'utf8'),/css\/match-hub\.css\?v=1/);
    assert.match(readFileSync(new URL('sw.js',root),'utf8'),/'\/css\/match-hub\.css\?v=1'/);
    const shared=readFileSync(new URL('js/app.js',root),'utf8');
    assert.doesNotMatch(shared,/Next match RSVP · Previous match appreciation/);
});
