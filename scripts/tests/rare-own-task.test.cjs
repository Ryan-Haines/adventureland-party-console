// A rare encounter asks whether the table refuses it. Its own live rare task never counts as a refusal;
// the Hunt with "May interrupt Hunt" off and a higher task still do.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { installedTasks } = require('./fixtures/task-owner-scenario.cjs');

const ask = owner => ({ kind: 'rare', owner, members: ['L', 'F'], phase: 'combat', label: 'Rare', rare: 'goldenbat' });

test('a live rare task does not refuse its own encounter', () => {
  const { tasks } = installedTasks();
  tasks.owner.sync([{ id: 'party:L', kind: 'party', members: ['L', 'F'] }]);
  assert.equal(tasks.rareRefused('goldenbat'), false, 'nothing is live');
  assert.equal(tasks.owner.request('party:L', ask('rare:1')).status, 'granted');
  assert.equal(tasks.rareRefused('goldenbat'), false, 'the encounter keeps asking while its task holds the group');
  assert.equal(tasks.rareRefused(), false, 'a read with no rare type answers the same');
});

test('a higher task still refuses the rare', () => {
  const { tasks } = installedTasks();
  tasks.owner.sync([{ id: 'party:L', kind: 'party', members: ['L', 'F'] }]);
  assert.equal(tasks.owner.request('party:L', { kind: 'escape', owner: 'escape:1', members: ['L', 'F'] }).status, 'granted');
  assert.equal(tasks.rareRefused('goldenbat'), true);
});
