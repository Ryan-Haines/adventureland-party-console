import {liveWindow, type LiveWorld} from '../windows';
import {greenSessionPlay} from '../event-session-rows';

// W25b One Mr. Green session from Spooky Town (test-windows DESIGN.md 2.2 W25; W25a keeps the
// Hunt return, DEVIATIONS.md "Live B").
// Play: Mr. Green is announced 55 s ahead; the party stages, the coordinator restarts during
// staging, the warrior is killed after the first damage and comes back, and the player's
// deselection with the boss alive turns the warrior's CODE over on the exit walk back to the
// staging checkpoint (E4). With Green selected again the next one carries its native threshold
// adds, dies and drops its loot (E1). The player sends both to a stale last-seen point and Green
// is reacquired at its catalog spawn (E29). From the Halloween checkpoint three walks follow: the
// warrior dies before the priest's walk is admitted (E31), dies after both depart (E30), and meets
// the boss beside the walk (E40) (event-session-rows.ts `greenSessionPlay`).
// Failure modes: staging treated as live combat, a restart or death losing attendance, adds
// outranked by the boss, a stale hint completed again, a dead member admitted or holding the walk,
// an advertised route kept past a visible boss.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.

// Mr. Green's catalog spawn is the centre of spookytown's mrgreen box (game data 17175: 524, 860,
// 748, 1129); the staging round starts 160 east of it, as the old initialEventSpawn did
// (live-fixtures.ts).
const greenStart = {map: 'spookytown', x: 796, y: 994.5};
liveWindow({
  id: 'W25b', name: 'One Mr. Green session from Spooky Town',
  // The rounds' waits sum to 3955 s (event-session-rows.ts), plus 20 s for the reset proof and dump.
  // The empty-hint walk ends on its progress rule (event-window-helpers.ts `walkUntil`); its old
  // 90 s wait stays in the sum as the cap's share for that walk.
  timeoutMs: 3_975_000,
  use: {nativeStatusObserver: true, initialPosition: greenStart},
  async play({live, info}: LiveWorld) {
      await greenSessionPlay(live, info);
  },
  observers: [
    {id: 'E4', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E1', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E29', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E31', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E30', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E40', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
