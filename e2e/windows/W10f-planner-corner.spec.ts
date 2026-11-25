import {liveWindow, type LiveWorld} from '../windows';
import {W, P} from '../game/hunt-events';
import {plannerCornerPlay, plannerStart} from '../restart-walk-rows';

// W10f A walk from a town corner, then unloadable game files (test-windows DESIGN.md 2.2 W10, split
// in DEVIATIONS.md). Play: from (135, 72) the party walks to the tunnel door, then the coordinator
// restarts on unloadable game files and the party walks back on the native planner. Failure modes:
// a planned route needs client repair, or a planner with no geometry stops the walk.
// C19's checks are the play's own steps: a failed step ends the play and the runner marks C19 not
// observed, with that step's message.
liveWindow({
  id: 'W10f', name: 'A walk from a town corner, then unloadable game files',
  use: {initialPositions: {[W]: plannerStart, [P]: plannerStart}},
  // C19's old test bound: 600 s (live-planner-corner.spec.ts at 21fe30a2b).
  timeoutMs: 660_000,
  async play({live, info}: LiveWorld) { await plannerCornerPlay(live, info, false); },
  observers: [{id: 'C19', owner: 'movement', behaviours: [], start() {}, verdict() {}}],
});
