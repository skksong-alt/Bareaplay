import test from 'node:test';
import assert from 'node:assert/strict';
import { voteTimes, canOpenVote } from '../js/modules/voteTiming.js';

test('Dubai match time is independent of the admin browser timezone', () => {
    assert.deepEqual(voteTimes('2026-09-30', '21:00'), {
        startAtMs: Date.parse('2026-09-30T17:00:00Z'),
        deadlineMs: Date.parse('2026-09-30T15:00:00Z')
    });
});

test('a next-week vote can open before its deadline', () => {
    assert.equal(canOpenVote('2026-09-30', '21:00', Date.parse('2026-09-23T21:00:00Z')).reason, '');
});

test('a vote cannot open when the two-hour deadline has already passed', () => {
    assert.equal(canOpenVote('2026-09-23', '21:00', Date.parse('2026-09-23T21:00:00Z')).reason, 'deadline-passed');
    assert.equal(canOpenVote('2026-09-23', '21:00', Date.parse('2026-09-23T19:00:00Z')).reason, 'deadline-passed');
});

test('invalid calendar dates are rejected', () => {
    assert.equal(canOpenVote('2026-02-31', '21:00').reason, 'invalid');
    assert.equal(canOpenVote('2026-09-30', '25:00').reason, 'invalid');
});
