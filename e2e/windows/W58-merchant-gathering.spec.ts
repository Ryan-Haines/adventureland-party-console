import {liveWindow, type LiveWorld} from '../windows';
import {gatheringSessionPlay} from '../gathering-session-rows';

// W58 Merchant gathering (test-windows DESIGN.md 2.2 W58).
// Play: one gathering day (gathering-session-rows.ts `gatheringSessionPlay`): the merchant hooks
// add-on's job, force stand and stand rows (M40); the fishing tool, then the mining tool, crafted
// only after the opt-in and from the planted recipe (M14, M15); a Broom equipped during an owned
// cast (M11, M10), after which the resumed casts are the declared rolls, a miss recast at once and a
// hit starting the game cooldown (M25), with the fishing attempts as M40's gathering row; then
// gathering stops and a coordinator restart keeps the weapon and the cooldowns.
// Failure modes: a missing tool bought or crafted before the opt-in, a second craft order, a lost
// or replaced weapon preference, a second Broom request, a cooldown started on a miss, a cast
// during the game cooldown, a hook or notice that never fires.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W58', name: 'Merchant gathering',
  // A hang guard from the play's own run: the longest green run's 135 s (liveb-step11-run3.log, 2.2 min; run1 1.9 min), plus its
  // longest step bound, so that step fails with its own message first (gathering-session-rows.ts 480 s), plus
  // 20 s for the reset proof and dump.
  timeoutMs: 635_000,
  use: {initialGatheringReady: true},
  async play({live, page, info}: LiveWorld) {
    await gatheringSessionPlay(live, page, info);
  },
  observers: [
    {id: 'M40', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M14', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M15', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M11', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M10', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M25', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
