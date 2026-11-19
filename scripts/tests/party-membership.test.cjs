'use strict';
// The game party on the character.
// The module's game calls and its call budget are
// stubs on one realm, so each row checks a failure mode no live row can plant on demand: the
// asker repeats against an unchanged pair, a held accept is dropped, or a new socket leaves the
// party split (F25, F61). The live rows of F25 to F27 run the real game party.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
// The lifecycle owner's run scope, which shared.js creates before the membership installs.
require('./helpers/run-scope.cjs').processScope();
require('../../runtime/tasks/character/membership.ts');

function realm({ leader = 'W', me = 'P', follow = true, members = ['W', 'P'], party = [] } = {}) {
  const calls = [], listeners = [];
  // Each pass reads a clock 5 s on, past any wait an asker might keep.
  let clock = 0;
  let band = 'send', socket = { on: (event, listener) => listeners.push({ event, listener }) };
  const state = { leader, me, follow, members, party };
  Object.assign(globalThis, {
    __partyHooks: { calls: { band: () => band } },
    accept_party_invite: async name => { calls.push('accept ' + name); },
    accept_party_request: async name => { calls.push('raccept ' + name); },
    leave_party: async () => { calls.push('leave'); },
    send_party_invite: async name => { calls.push('invite ' + name); },
    send_party_request: async name => { calls.push('request ' + name); },
  });
  const m = globalThis.installPartyMembership({ now: () => (clock += 5000), name: () => state.me, partyList: () => state.party, socket: () => socket, log() {} });
  m.leaderReply({ leader: state.leader, followLeader: state.follow, desiredPartyMembers: state.members });
  return { m, calls, state, listeners, hold: () => { band = 'not-now'; }, send: () => { band = 'send'; }, reconnect: () => { socket = { on: socket.on }; } };
}

scenarioTable('the game party asks once per change of the pair, for the leader, a follower and a character that follows no one', realm, [
['the game party: one action per change of the pair, a held accept stays pending, a new socket acts again', async r => {
  await r.m.reconcile(); await r.m.reconcile(); await r.m.reconcile();
  assert.deepEqual(r.calls, ['request W'], 'F25: the follower asks once while the pair is unchanged');
  assert.ok(r.listeners.some(l => l.event === 'party_update'), 'each pass also runs on the game party update');
  r.hold(); r.m.acceptInvite('W');
  assert.deepEqual(r.calls, ['request W'], 'a held accept sends nothing yet');
  r.send(); await r.m.reconcile();
  assert.deepEqual(r.calls, ['request W', 'accept W'], 'E01-10: the held accept goes on the next pass');
  r.reconnect(); await r.m.reconcile();
  assert.deepEqual(r.calls, ['request W', 'accept W', 'request W'], 'F61: a new socket counts as no last action, so the follower asks once more');
  r.state.party = ['W', 'P']; await r.m.reconcile();
  assert.equal(r.calls.length, 3, 'a joined party needs no action');
}],
['the leader invites each missing member once per pair, and leaves a party another leads', async r => {
  await r.m.reconcile(); await r.m.reconcile();
  assert.deepEqual(r.calls, ['invite P'], 'the leader invites the missing member once while the pair is unchanged');
  r.state.party = ['X', 'W']; await r.m.reconcile();
  assert.deepEqual(r.calls, ['invite P', 'leave'], 'the leader leaves a party it does not lead');
  r.state.party = ['W']; await r.m.reconcile();
  assert.deepEqual(r.calls, ['invite P', 'leave', 'invite P'], 'a changed pair is a new action');
  r.state.party = ['W', 'P']; await r.m.reconcile();
  assert.equal(r.calls.length, 3, 'a full party needs no action');
}, { leader: 'W', me: 'W' }],
['a character that follows no one leaves its party and stays out', async r => {
  r.state.party = ['W', 'P']; await r.m.reconcile(); await r.m.reconcile();
  assert.deepEqual(r.calls, ['leave'], 'it leaves once while the pair is unchanged');
  r.state.party = []; await r.m.reconcile();
  assert.deepEqual(r.calls, ['leave'], 'with no party it does nothing');
}, { follow: false }],
['a follower that accepted an invite does not also ask to join the same pair', async r => {
  r.hold(); await r.m.reconcile(); r.send(); r.m.acceptInvite('W');
  assert.deepEqual(r.calls, ['accept W'], 'the follower accepts the invite');
  await r.m.reconcile();
  assert.deepEqual(r.calls, ['accept W'], 'the accept in flight holds the request, so the pair has one path into the party');
}],
['the leader that invited a pair does not accept its request, and one that accepted a request does not invite', async r => {
  await r.m.reconcile();
  assert.deepEqual(r.calls, ['invite P'], 'the leader invites');
  r.m.acceptRequest('P');
  assert.deepEqual(r.calls, ['invite P'], 'a request crossing the invite is left for the accept of the invite');
  r.state.party = ['X', 'W']; await r.m.reconcile(); r.state.party = ['W'];
  r.m.acceptRequest('P');
  assert.deepEqual(r.calls, ['invite P', 'leave', 'raccept P'], 'a changed pair accepts a request');
  await r.m.reconcile();
  assert.equal(r.calls.length, 3, 'the accept in flight holds an invite for the same pair');
}, { leader: 'W', me: 'W' }],
]);
