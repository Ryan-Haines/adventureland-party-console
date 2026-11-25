import {liveWindow, type LiveWorld} from '../windows';
import {sv12StompRows} from '../survival-rows';
import {fightersReady} from '../movement-owner-helpers';
import {party} from '../game/hunt-lifecycle';

// W08d The emergency Stomp (test-windows DESIGN.md 2.2 W08 and 4.3 T14, split in DEVIATIONS.md).
// Play: the warrior equips a basher, stands at a spot east of the town square and meets two planted
// bees. Failure mode: T14's SV12, the emergency Stomp does not go, or goes through a calls.band ask
// or as survival's request.
// The checks are the play's own steps (survival-rows.ts `sv12StompRows`): a failed step ends the
// play and the runner marks T14 not observed, with that step's message.
liveWindow({
  id: 'W08d', name: 'The emergency Stomp',
  // The row's waits: 30 s for Stomp's cooldown, then the spot, the report and the plant.
  timeoutMs: 300_000,
  async play({live, info}: LiveWorld) {
    await fightersReady(live);
    await party(live);
    await sv12StompRows(live, info);
  },
  observers: [{id: 'T14', owner: 'survival', behaviours: [], start() {}, verdict() {}}],
});
