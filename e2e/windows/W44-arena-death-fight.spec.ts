import {liveWindow, type LiveWorld} from '../windows';
import {arenaPositions} from '../live-fixtures';
import {deathFightSessionPlay} from '../escape-session-rows';

// W44 Arena death under a monster that out-damages heals (test-windows DESIGN.md 2.2 W44).
// Play: in the Arena the warrior is killed beside a planted monster the party outdamages, and the
// priest finishes the fight (E61); back at the farm the warrior is killed beside a monster whose
// damage outruns the priest's heals, and the priest leaves (E62) (escape-session-rows.ts
// `deathFightSessionPlay`).
// Failure modes: an escape from a fight the party wins, a stand in a fight it cannot outlast.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W44', name: 'Arena death under a monster that out-damages heals',
  // The old B and C table's 3600 s bound (live-farm-death-escape.spec.ts at 21fe30a2b) plus 20 s for the
  // reset proof and dump.
  timeoutMs: 3_620_000,
  use: {loadout: 'combat-range', initialPositions: arenaPositions(['E2EWarrior', 'E2EPriest'])},
  async play({live, info}: LiveWorld) {
      await deathFightSessionPlay(live, info);
  },
  observers: [
    {id: 'E61', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E62', owner: 'survival', behaviours: [], start() {}, verdict() {}},
  ],
});
