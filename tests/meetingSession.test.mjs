import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingSession,meetingFingerprint,meetingConflict} from '../js/modules/meetingSession.js';
const date='2026-09-30';
test('saving captures date and immutable edit, preserves unknown fields, refuses switching while dirty',async()=>{
    let server={date,legacy:{keep:1},teams:{team_2:['old']}};
    const calls=[],session=createMeetingSession({delay:60000,commit:async(d,p,expected)=>{
        assert.equal(meetingFingerprint(expected),meetingFingerprint(server));calls.push(d);server={...server,...p};return server;
    }});
    session.load(date,server);const payload={date,teams:{team_0:['A']}};
    session.schedule(payload);payload.teams.team_0.push('mutated');
    assert.throws(()=>session.load('2026-10-07',null),/저장/);await session.flush();
    assert.deepEqual(server,{date,legacy:{keep:1},teams:{team_0:['A']}});assert.deepEqual(calls,[date]);
    session.load('2026-10-07',null);assert.equal(session.dirty,false);
});
test('failed writes retain pending state; retries do not overwrite external changes',async()=>{
    let server={date,teams:{}},fail=true;
    const session=createMeetingSession({delay:60000,commit:async(d,p,expected)=>{
        if(fail)throw new Error('offline');
        if(meetingFingerprint(expected)!==meetingFingerprint(server))throw meetingConflict();
        server={...server,...p};return server;
    }});
    session.load(date,server);session.schedule({date,teams:{team_0:['local']}});
    await assert.rejects(session.flush(),/offline/);assert.equal(session.dirty,true);assert.equal(session.status,'error');
    fail=false;server={date,teams:{team_0:['remote']}};
    assert.equal(session.acceptRemote(server),false);await assert.rejects(session.flush(),/다른 기기/);
    assert.equal(session.status,'conflict');assert.deepEqual(server.teams.team_0,['remote']);
    session.schedule({date,teams:{team_0:['new local']}});await assert.rejects(session.flush(),/다른 기기/);
    session.discard();session.load(date,server);assert.equal(session.status,'saved');
});
test('in-flight edits serialize; a temporary failure can retry and commit latest content',async()=>{
    let release,calls=0,server={date,teams:{}};
    const session=createMeetingSession({delay:60000,commit:async(d,p,expected)=>{
        if(++calls===1)await new Promise(r=>release=r);
        assert.equal(meetingFingerprint(expected),meetingFingerprint(server));server={...server,...p};return server;
    }});
    session.load(date,server);session.schedule({date,teams:{team_0:['first']}});const flushing=session.flush();
    await Promise.resolve();session.schedule({date,teams:{team_0:['last']}});release();await flushing;
    assert.equal(calls,2);assert.equal(session.dirty,false);assert.deepEqual(server.teams.team_0,['last']);
    assert.equal(meetingFingerprint({...server,lastUpdatedAt:{seconds:1}}),meetingFingerprint({...server,lastUpdatedAt:{seconds:2}}));
    assert.notEqual(meetingFingerprint(null),meetingFingerprint({}));
});
