import {liveWindow, type LiveWorld} from '../windows';
import {beeFieldPlay, beeFieldVerdict} from '../movement-step-safety-row';

// W08a Bee field farm with idle aggro (test-windows DESIGN.md 2.2 W08, split in DEVIATIONS.md).
// Play: the party farms the Main bee field, where every bee but the selected one is an idle
// monster in the server's aggro grid, for one 5 min window from the first selected bee.
// Failure modes: T14, a combat step pulls an idle bee or closes on an attacker while the
// character fights, or the movement owner logs an error.
let windows: any[] = [];
liveWindow({
  id: 'W08a', name: 'Bee field farm with idle aggro',
  // The farm's 5 min (DESIGN.md 2.2 W08) and the walk to the field, whose first selection
  // beeFieldPlay waits 180 s for.
  timeoutMs: 600_000,
  async play({live, info}: LiveWorld) { windows = await beeFieldPlay(live, info, 1, 300_000); },
  observers: [
    {id: 'T14', owner: 'movement', behaviours: [], start() {}, verdict() { beeFieldVerdict(windows); }, reads: () => windows},
  ],
});
