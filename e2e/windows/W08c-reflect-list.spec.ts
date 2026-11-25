import {liveWindow, type LiveWorld} from '../windows';
import {reflectListRow} from '../targeting-rows';
import {spendLog} from '../turns-rows';
import {fightersReady} from '../movement-owner-helpers';
import {fighters, party} from '../game/hunt-lifecycle';

// W08c The reflect list across a CODE reload (test-windows DESIGN.md 2.2 W08 and 4.3 T14, split in
// DEVIATIONS.md). Play: the priest fights a planted sparkbot, its "Don't hit with magic" list gains
// sparkbot, its CODE reloads, and the list loses sparkbot again.
// Failure modes: T14's TG9, TG11 and TG39, the reflect list does not stop or resume the priest's
// basic attacks, or a CODE reload loses it.
// The checks are the play's own steps (targeting-rows.ts `reflectListRow`): a failed step ends the
// play and the runner marks T14 not observed, with that step's message.
liveWindow({
  id: 'W08c', name: 'The reflect list across a CODE reload',
  // The row's waits: 60 s for the first attack, 20 s for each list, two 8 s holds and the reload.
  timeoutMs: 300_000,
  async play({live, info}: LiveWorld) {
    await fightersReady(live);
    await party(live);
    // The row counts the priest's attacks in the turns log (targeting-rows.ts `priestAttacks`).
    for (const name of fighters) await live.clients[name]!.run(spendLog);
    await reflectListRow(live, info);
  },
  observers: [{id: 'T14', owner: 'targeting', behaviours: [], start() {}, verdict() {}}],
});
