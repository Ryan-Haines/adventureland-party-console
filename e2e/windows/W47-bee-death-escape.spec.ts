import {liveWindow, type LiveWorld} from '../windows';
import {expect} from '../live-fixtures';
import {survivalHooksPlay} from '../survival-hooks-rows';
import {observed, evidence} from '../game/hunt-lifecycle';

const W = 'E2EWarrior';

// W47 Main bee field death and convoy escape (test-windows DESIGN.md 2.2 W47).
// Play: the party farms bees on Main with the survival-hooks add-on on; the warrior on the fragile
// loadout dies by a native skill the server resolves; the priest escapes home by convoy and the
// warrior respawns (survival-hooks-rows.ts `survivalHooksPlay`, C26). C13 reads the same death
// beside the hook steps: the rip, the respawn and the native client's revival, with live-game.spec.ts
// "a real character death is observed and the maintained runtime respawns it"'s polls.
// Failure modes: a death noticed twice, a recovery that never starts, no convoy home, a respawn the
// native client does not see.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
// Every old spec this window cites is at 21fe30a2b.
liveWindow({
  id: 'W47', name: 'Main bee field death and convoy escape',
  // C26's 600 s bound (live-survival-hooks.spec.ts) plus 20 s for the reset proof and dump; C13's
  // polls run beside it.
  timeoutMs: 620_000,
  use: {loadout: 'fragile'},
  async play({live, info}: LiveWorld) {
    await survivalHooksPlay({live}, info, async fault => {
      await expect.poll(async () => (await observed(live))[W].rip, { timeout: 15_000 }).toBe(true);
      await expect.poll(async () => { const p=(await observed(live))[W];return !p.rip&&p.hp>0; }, { timeout: 120_000 }).toBe(true);
      await expect.poll(async () => (await live.clients[W].snapshot()).rip,
        {timeout:15_000,message:'The real revival must propagate from the server to the native client'}).toBeFalsy();
      await evidence(live, info, 'real-death-and-respawn', { fault });
    });
  },
  observers: [
    {id: 'C26', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'C13', owner: 'survival', behaviours: [], start() {}, verdict() {}},
  ],
});
