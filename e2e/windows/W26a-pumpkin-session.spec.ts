import {liveWindow, type LiveWorld} from '../windows';
import {pumpkinSessionPlay} from '../event-session-rows';

// W26a One Mr. Pumpkin session on Halloween (test-windows DESIGN.md 2.2 W26).
// Play: Mr. Pumpkin is announced 55 s ahead; the party stages, the coordinator restarts during
// staging, the warrior is killed after the first damage and comes back, and the player's
// deselection with the boss alive loses the last completion reply on the walk back to the staging
// checkpoint (E5, E6). With Pumpkin selected again the next one carries its Jr threshold adds,
// dies and drops its loot (E2). The player sends the party across the wall from a visible Pumpkin,
// and the event walk keeps the route until the boss is reachable (E38). From the Halloween
// checkpoint the next walk has its first plan refused as Town unavailable and meets the boss
// beside it (E26, E41), and the last has every plan to the boss refused (E27)
// (event-session-rows.ts `pumpkinSessionPlay`).
// Failure modes: staging treated as live combat, a restart or death losing attendance, adds
// outranked by the boss, a held request after a lost reply, a refusal ending the walk, an
// advertised route kept past a visible boss.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.

// Mr. Pumpkin's catalog spawn is (-495, 685) on halloween; the staging round starts 160 east of
// it, as the old initialEventSpawn did (live-fixtures.ts).
const pumpkinStart = {map: 'halloween', x: -335.5, y: 685.5};
liveWindow({
  id: 'W26a', name: 'One Mr. Pumpkin session on Halloween',
  // The rounds' waits sum to 3015 s (event-session-rows.ts), plus 20 s for the reset proof and dump.
  timeoutMs: 3_035_000,
  use: {nativeStatusObserver: true, initialPosition: pumpkinStart},
  async play({live, info}: LiveWorld) {
      await pumpkinSessionPlay(live, info);
  },
  observers: [
    {id: 'E5', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E6', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E2', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E38', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E26', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E41', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E27', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
