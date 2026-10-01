import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the actual restore function without Firebase, network or DOM writes.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function applyMeetingData(data) {'),
    app.indexOf('async function changeMeetingDate(date) {'));
function restore(data) {
    const state = {};
    const noop = () => {};
    const context = vm.createContext({state,
        balancer: {setAttendees: noop, setAces: noop, setPins: noop, renderResults: noop},
        lineup: {renderTeamSelectTabs: noop}, document: {getElementById: () => null}});
    vm.runInContext(source, context);
    context.applyMeetingData(data);
    return JSON.parse(JSON.stringify(state));
}
test('reversed Firestore map order keeps A/B names, rosters and lineups aligned', () => {
    const data = {teams: {team_1: [{name: 'B player'}], team_0: [{name: 'A player'}]},
        teamNames: ['Team A', 'Team B'], initialAttendeeOrder: ['B player', 'A player'],
        quarterCount: 4, teamLineupCache: {
            1: {q_0: ['B field'], q_5: ['B retained'], resters: {q_0: ['B rest']}},
            0: {q_0: ['A field'], q_5: ['A retained'], resters: {q_0: ['A rest']}}}};
    const before = JSON.stringify(data);
    const state = restore(data);
    assert.deepEqual(state.teams, [[{name: 'A player'}], [{name: 'B player'}]]);
    assert.deepEqual(state.teamNames, ['Team A', 'Team B']);
    assert.deepEqual(state.initialAttendeeOrder, ['B player', 'A player']);
    assert.deepEqual(state.teamLineupCache[0].q_0, ['A field']);
    assert.deepEqual(state.teamLineupCache[1].q_0, ['B field']);
    assert.deepEqual(state.teamLineupCache[0].q_5, ['A retained']);
    assert.deepEqual(state.teamLineupCache[1].resters, [['B rest']]);
    assert.equal(state.quarterCount, 4);
    assert.equal(JSON.stringify(data), before);
});
test('missing team indices do not shift another team into A or B', () => {
    assert.deepEqual(restore({teams: {team_2: ['C'], team_0: ['A']}}).teams,
        [['A'], [], ['C']]);
});
test('five teams are restored by saved index rather than insertion order', () => {
    assert.deepEqual(restore({teams: {team_4: ['E'], team_2: ['C'], team_1: ['B'],
        team_3: ['D'], team_0: ['A']}}).teams, [['A'], ['B'], ['C'], ['D'], ['E']]);
});
test('empty meetings and legacy array rosters remain compatible', () => {
    assert.deepEqual(restore(null).teams, []);
    assert.deepEqual(restore({teams: {}}).teams, []);
    assert.deepEqual(restore({teams: [['A'], ['B']]}).teams, [['A'], ['B']]);
});
