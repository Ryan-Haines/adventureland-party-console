import {liveWindow, type LiveWorld} from '../windows';
import {cipherDoorHandoffPlay} from '../merchant-event-rows';
import {eventScrub} from '../event-window-helpers';

// W38b The merchant's door tour (test-windows DESIGN.md 2.2 W38).
// Play: with the fighters on a goo Hunt, the merchant adopts a deferred Cipher return into its own
// door tour and sells its helmets (merchant-event-rows.ts `cipherDoorHandoffPlay`).
// DEVIATIONS.md "Live B" says why W38 is two windows.
// Failure modes: a deferred return left on the merchant, the merchant listed in the Hunt.
// The check is the play's own steps: a failed step ends the play and the runner marks it not
// observed, with that step's message.
liveWindow({
  id: 'W38b', name: "The merchant's door tour",
  // The old test's 360 s bound (live-merchant-anniversary-availability.spec.ts at 21fe30a2b) plus 20 s
  // for the reset proof and dump.
  timeoutMs: 380_000,
  async play({live, info}: LiveWorld) {
      try { await cipherDoorHandoffPlay({live}, info); } finally { await eventScrub(live, info); }
  },
  observers: [
    {id: 'M37', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
