import {liveWindow, type LiveWorld} from '../windows';
import {doorTourPlay} from '../october-rows';
import {eventScrub} from '../event-window-helpers';

// W38a The party's trick-or-treat door tour (test-windows DESIGN.md 2.2 W38).
// Play: in the October season the party walks the seven doors in route order and returns to its
// farming checkpoint, and a coordinator restart keeps the doors (october-rows.ts `doorTourPlay`).
// DEVIATIONS.md "Live B" says why W38 is two windows.
// Failure modes: a door visited twice or skipped, no return to the checkpoint.
// The check is the play's own steps: a failed step ends the play and the runner marks it not
// observed, with that step's message.
liveWindow({
  id: 'W38a', name: "The party's trick-or-treat door tour",
  // The old test's 420 s bound (live-october-events.spec.ts at 21fe30a2b) plus 20 s for the reset proof
  // and dump.
  timeoutMs: 440_000,
  use: {initialPosition: {map: 'halloween', x: 0, y: 0}},
  async play({live, info}: LiveWorld) {
      try { await doorTourPlay({live}, info); } finally { await eventScrub(live, info); }
  },
  observers: [
    {id: 'E9', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
