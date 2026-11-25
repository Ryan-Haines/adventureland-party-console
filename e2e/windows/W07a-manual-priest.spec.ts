import {liveWindow, type LiveWorld} from '../windows';
import {m2Row} from '../user-holds-rows';

// W07a A member on Manual while the party moves (test-windows DESIGN.md 2.2 W07, split in
// DEVIATIONS.md). Play: the priest goes on Manual with Follows me, the party Town moves only the
// warrior, the warrior follows the hand-walked priest past a seeded Mr. Green and fights goo
// beside it, the switches go off, and the priest Escapes home before Manual ends.
// Failure modes: a Manual member is moved by a party Town or an event, the party leaves it, or its
// switches leave potions or combat on.
// T7's checks are the play's own steps: each step stands on the one before it (the Escape needs
// the priest still held), so a failed step ends the play and the runner marks T7 not observed,
// with that step's message.
liveWindow({
  id: 'W07a', name: 'A member on Manual while the party moves',
  // T7's row took 33 s of wall time (catalog wall_s); its own waits reach 180 s for the follow and
  // 300 s for the Escape home.
  timeoutMs: 600_000,
  async play({live, info}: LiveWorld) { await m2Row(live, info); },
  observers: [{id: 'T7', owner: 'tasks', behaviours: [], start() {}, verdict() {}}],
});
