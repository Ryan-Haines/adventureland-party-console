// The hunting owner's Hunt count notices (runtime/hunting/coordinator/hunt.ts, rows/07-hunting.ts):
// `hunt.counted` and `hunt.blacklisted` name the combat group whose Hunt counted the target, as the
// other hunting notices do.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { recordHuntFailure, editHuntBlacklist } = require('../../runtime/hunting/coordinator/hunt.ts');

test('the Hunt count and blacklist notices name their group', () => {
  const hooks = partyHooks(), saved = hooks.notify, heard = [];
  hooks.notify = (hook, payload) => { heard.push([hook, payload.group, payload.target]); };
  try {
    const state = { huntSettings: { blacklistDeaths: true, deathThreshold: 1 }, huntFailures: {}, huntBlacklist: {} };
    recordHuntFailure(state, 'bee', 'deaths', 1, 100, 'party:L');
    editHuntBlacklist(state, 'add', 'goo', 100, 'solo:R');
  } finally { hooks.notify = saved; }
  assert.deepEqual(heard, [['hunt.counted', 'party:L', 'bee'], ['hunt.blacklisted', 'party:L', 'bee'], ['hunt.blacklisted', 'solo:R', 'goo']]);
});
