import {liveWindow, type LiveWorld} from '../windows';
import {convoyInterruptionRow} from '../live-game-rows';

// W10b A coordinator restart during a travel that arrives (test-windows DESIGN.md 2.2 W10, split
// in DEVIATIONS.md). Play: a dashboard travel 450 out, the coordinator restarts mid-walk and the
// party arrives. Failure mode: a restart loses the trip's destination.
// T15's checks are the play's own steps: a failed step ends the play and the runner marks T15 not
// observed, with that step's message.
liveWindow({
  id: 'W10b', name: 'A coordinator restart during a travel that arrives',
  // T15 was one 120 s table row (live-movement-owner.spec.ts at 21fe30a2b).
  timeoutMs: 180_000,
  async play({live, info}: LiveWorld) { await convoyInterruptionRow(live, info); },
  observers: [{id: 'T15', owner: 'movement', behaviours: [], start() {}, verdict() {}}],
});
