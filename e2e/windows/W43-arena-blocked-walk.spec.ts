import {liveWindow, type LiveWorld} from '../windows';
import {arenaPositions} from '../live-fixtures';
import {blockedWalkSessionPlay} from '../escape-session-rows';

// W43 Arena death and blocked walk home (test-windows DESIGN.md 2.2 W43).
// Play: the warrior and priest farm cgoo in the Arena under a cgoo Hunt; the warrior is killed;
// the priest's first four walks home fail at the door and then climb, while the Hunt quest comes
// due on the walk and waits for the recovery (E58, E59); back at the farm the warrior is killed
// again and the player's travel command ends the priest's walk home (E57); back at the farm the
// player presses Escape and the two walk home (E60) (escape-session-rows.ts `blockedWalkSessionPlay`).
// Failure modes: a walk that never climbs, a turn-in granted under death recovery, an escape that
// outlives the player's command, a Scare without a jacko.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W43', name: 'Arena death and blocked walk home',
  // The old B and C table's 3600 s bound (live-farm-death-escape.spec.ts at 21fe30a2b) plus 20 s for the
  // reset proof and dump.
  timeoutMs: 3_620_000,
  use: {loadout: 'combat-range', initialPositions: arenaPositions(['E2EWarrior', 'E2EPriest'])},
  async play({live, info}: LiveWorld) {
      await blockedWalkSessionPlay(live, info);
  },
  observers: [
    {id: 'E58', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E59', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E57', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E60', owner: 'survival', behaviours: [], start() {}, verdict() {}},
  ],
});
