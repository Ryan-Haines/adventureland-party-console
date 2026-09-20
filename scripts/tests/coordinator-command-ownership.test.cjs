const test = require('node:test');
const assert = require('node:assert/strict');
const createOwnership = require('../command-ownership.cjs');

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

test('convoy ownership logs are bounded and omit command payloads', () => {
  const state = {commands: {}, combatLogs: {}};
  const ownership = createOwnership(state);
  for (let id = 1; id <= 205; id++) {
    state.commands.A = {id, type: 'party-monster-travel', convoyId: 'convoy', items: ['private inventory']};
  }
  assert.equal(state.combatLogs.A.length, 200);
  assert.equal(state.combatLogs.A[0].details.after.id, 6);
  ownership.clear('A', command => command.convoyId === 'convoy');
  const last = state.combatLogs.A.at(-1);
  assert.equal(last.details.before.id, 205);
  assert.equal(last.details.after, null);
  assert.equal(state.combatLogs.A.length, 200);
  assert.equal(JSON.stringify(state.combatLogs).includes('private inventory'), false);
});
