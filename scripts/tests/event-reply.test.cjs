// The events owner's reply on the character (runtime/events/character/reply.ts), table A's
// `events` row: a disabled event's lone walk stops unless another live request holds the
// character.
// Failure mode: the root decided "a walk holds the event" from three of movement's walk flags; the
// reply now asks movement's `farmWalkHeld` over `movement.live()`, so a convoy's request keeps its
// walk and the event's own lone walk stops.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('../../runtime/events/character/reply.ts');
const { installEventReply } = globalThis;

function reply(live) {
  const stops = [], posts = [];
  const attend = { selected: () => false, joined: () => 'goobrawl', traveling: () => null, leave() {}, poll: async () => {}, targets() {} };
  const r = installEventReply({
    attend: () => attend, anniversary: () => ({ disabled: async () => {}, receive() {}, kiss() {} }),
    strategy() {}, turnIn: () => false, live: () => live, eventWalk: () => ({ kind: 'task-walk', owner: 'lone-walk:event', tier: 'event-attendance' }),
    returnHolds: () => false, reunion: () => false, stop: async kind => { stops.push(kind ?? 'move'); },
    name: () => 'Ranger', request: async (path, options) => { posts.push([path, options.body.event]); }, later() {},
  });
  return { r, stops, posts };
}

test('a disabled event stops its own lone walk and leaves a convoy walk running', async () => {
  globalThis.__partyPendingEventDisables = [];
  const own = reply({ kind: 'task-walk', owner: 'lone-walk:event', tier: 'event-attendance' });
  await own.r.selectionsReply({ eventSelections: ['goobrawl'] });
  await own.r.selectionsReply({ eventSelections: [] });
  assert.deepEqual(own.stops, ['smart', 'move']);
  assert.deepEqual(own.posts, [['/event-disabled', 'goobrawl']]);

  globalThis.__partyPendingEventDisables = [];
  const convoy = reply({ kind: 'group-walk', owner: 'walk:party:c1:1:0', tier: 'farming' });
  await convoy.r.selectionsReply({ eventSelections: ['goobrawl'] });
  await convoy.r.selectionsReply({ eventSelections: [] });
  assert.deepEqual(convoy.stops, []);
  assert.deepEqual(convoy.posts, [['/event-disabled', 'goobrawl']]);
});
