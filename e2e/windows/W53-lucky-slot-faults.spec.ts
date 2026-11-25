import {liveWindow, type LiveWorld} from '../windows';
import {luckySessionPlay} from '../lucky-session-rows';

// W53 Lucky slot upgrades under faults (test-windows DESIGN.md 2.2 W53).
// Play: one merchant upgrading in lucky slots (lucky-session-rows.ts `luckySessionPlay`): the
// priest's seashells arrive while the slot is prepared and restored (A43), a restoration swap is
// lost with the local journals (A46), journal writes and removals echo older entries (A36, A42), a
// completion response is lost before a CODE reload (A32), and the slot's cargo moves under the
// restoration across a CODE reload and a coordinator restart, open (A40) and locked (A41).
// Failure modes: an order dropped or replayed, a result lost or duplicated, spend or attempts reset,
// a lucky swap that overwrites moved cargo, a roll counted on the wrong slot, a lock lost.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W53', name: 'Lucky slot upgrades under faults',
  // A hang guard from the play's own run: the longest green run's 207 s (liveb-step11-run1.log, 3.4 min; run4 3.0 min), plus its
  // longest step bound, so that step fails with its own message first (lucky-session-rows.ts 300 s), plus
  // 20 s for the reset proof and dump.
  timeoutMs: 527_000,
  async play({live, info}: LiveWorld) {
    await luckySessionPlay(live, info);
  },
  observers: [
    {id: 'A32', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A36', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A40', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A41', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A42', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A43', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A46', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
