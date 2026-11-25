import {liveWindow, type LiveWorld} from '../windows';
import {escapeMembershipPlay} from '../restart-walk-rows';

// W10e An Escape on a failed saved record (test-windows DESIGN.md 2.2 W10, split in DEVIATIONS.md).
// Play: from (200, -120), the old test's start, an Escape whose saved record is replaced with a
// failed one-member escape walks both members home. Failure mode: the escape drops a member.
// H40's checks are the play's own steps: a failed step ends the play and the runner marks H40 not
// observed, with that step's message.
liveWindow({
  id: 'W10e', name: 'An Escape on a failed saved record',
  use: {initialPosition: {map: 'main', x: 200, y: -120}},
  // H40's old test bound: 120 s (live-hunt-round2-recovery.spec.ts at 21fe30a2b).
  timeoutMs: 180_000,
  async play({live, info}: LiveWorld) { await escapeMembershipPlay(live, info, 'missing'); },
  observers: [{id: 'H40', owner: 'survival', behaviours: [], start() {}, verdict() {}}],
});
