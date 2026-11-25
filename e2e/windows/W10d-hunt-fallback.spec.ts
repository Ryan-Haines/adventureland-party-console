import {liveWindow, type LiveWorld} from '../windows';
import {huntFallbackPlay} from '../restart-walk-rows';

// W10d A Hunt walk on the native fallback (test-windows DESIGN.md 2.2 W10, split in DEVIATIONS.md).
// Play: a goo Hunt walk is stopped mid-route while the leader drifts off its rally point, and the
// native fallback takes the party to the farm. Failure mode: the fallback keeps restarting travel.
// H36's checks are the play's own steps: a failed step ends the play and the runner marks H36 not
// observed, with that step's message.
liveWindow({
  id: 'W10d', name: 'A Hunt walk on the native fallback',
  // H36's old test bound: 240 s (live-hunt-recovery.spec.ts at 21fe30a2b).
  timeoutMs: 300_000,
  async play({live, info}: LiveWorld) { await huntFallbackPlay(live, info, false); },
  observers: [{id: 'H36', owner: 'hunting', behaviours: [], start() {}, verdict() {}}],
});
