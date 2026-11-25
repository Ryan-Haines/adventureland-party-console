import {liveWindow, type LiveWorld} from '../windows';
import {arenaPositions} from '../live-fixtures';
import {magiportSessionPlay} from '../escape-session-rows';

// W45 Arena escape with Magiport (ranger, priest, mage) (test-windows DESIGN.md 2.2 W45).
// Play: a ranger, a priest and a mage farm cgoo in the Arena with a monster planted on each; the
// player presses Escape and the mage Blinks and ports both (E68); back at the farm, with the mage's
// MP planted to one Magiport, it ports one and the other walks (E69); back at the farm the priest
// is planted dead after the Blink and leaves to its own recovery while the ranger is ported (E70)
// (escape-session-rows.ts `magiportSessionPlay`).
// Failure modes: a walk before the ports, a port the MP does not cover, a dead member held in the
// port stage.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W45', name: 'Arena escape with Magiport (ranger, priest, mage)',
  // The old case D table's 3600 s bound (live-farm-death-escape.spec.ts at 21fe30a2b) plus 20 s for the reset
  // proof and dump.
  timeoutMs: 3_620_000,
  use: {loadout: 'combat-range', primaryClass: 'ranger', extraFighter: 'mage', initialPositions: arenaPositions(['E2EWarrior', 'E2EPriest', 'E2EBankBoi'])},
  async play({live, info}: LiveWorld) {
      await magiportSessionPlay(live, info);
  },
  observers: [
    {id: 'E68', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E69', owner: 'survival', behaviours: [], start() {}, verdict() {}},
    {id: 'E70', owner: 'survival', behaviours: [], start() {}, verdict() {}},
  ],
});
