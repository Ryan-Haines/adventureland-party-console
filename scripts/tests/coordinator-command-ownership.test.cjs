const test = require('node:test');
const assert = require('node:assert/strict');
const createOwnership = require('../../runtime/movement/coordinator/records.ts').createCommandOwnership;

test('command ownership clears only a matching current job and retains the underlying registry', () => {
  const original = {}, state = {commands: original, combatLogs: {}};
  const ownership = createOwnership(state);
  const command = {id: 1, type: 'merchant', jobId: 'current'};
  state.commands.M = command;
  assert.equal(original.M, command);
  ownership.clear('M', value => value.jobId === 'previous');
  assert.equal(state.commands.M, command);
  ownership.clear('M', value => value.jobId === 'current');
  assert.equal(Object.hasOwn(original, 'M'), false);
  ownership.clear('missing', () => {throw Error('No command to match');});
  assert.deepEqual(state.combatLogs, {});
});

// The log keeps the settings owner's historyKept (500 by default), the bound the history document
// saves, where this writer kept 200 of its own.
test('convoy ownership logs are bounded and omit command payloads', () => {
  const state = {commands: {}, combatLogs: {}};
  const ownership = createOwnership(state);
  for (let id = 1; id <= 505; id++) {
    state.commands.A = {id, type: 'party-monster-travel', convoyId: 'convoy', items: ['private inventory']};
  }
  assert.equal(state.combatLogs.A.length, 500);
  assert.equal(state.combatLogs.A[0].details.after.id, 6);
  ownership.clear('A', command => command.convoyId === 'convoy');
  const last = state.combatLogs.A.at(-1);
  assert.equal(last.details.before.id, 505);
  assert.equal(last.details.after, null);
  // v1.5.0's convoy-defense test checked that a command change names its caller.
  assert.ok(last.details.source.length);
  assert.equal(state.combatLogs.A.length, 500);
  assert.equal(JSON.stringify(state.combatLogs).includes('private inventory'), false);
});
