import {liveWindow, type LiveWorld} from '../windows';
import {halloweenCleanup, halloweenRestore, slendermanPlay} from '../halloween-rows';
import {eventScrub} from '../event-window-helpers';

// W33 Slenderman warp (test-windows DESIGN.md 2.2 W33).
// Play: the party fights a Slenderman on Halloween that is warped to Spooky Town, follows the
// map-only sightings, kills it and returns.
// Failure modes: stale sightings followed, the warp lost, the return lost after a death.
// The check is the play's own steps: a failed step ends the play and the runner marks it not
// observed, with that step's message.
liveWindow({
  id: 'W33', name: 'Slenderman warp',
  // The old test's 600 s bound plus 20 s for the reset proof and dump (DESIGN.md 2.2).
  timeoutMs: 620_000,
  use: {nativeStatusObserver: true, initialPosition: {map: 'halloween', x: 0, y: 0}},
  async play({live, info}: LiveWorld) {
      await halloweenCleanup({live}, info);
      try { await slendermanPlay({live}, info); }
      finally { try { await halloweenRestore({live}, info); } finally { await eventScrub(live, info); } }
  },
  observers: [
    {id: 'E7', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
