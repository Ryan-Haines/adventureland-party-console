import {liveWindow, type LiveWorld} from '../windows';
import {arenaPositions} from '../live-fixtures';
import {trioEscapePlay} from '../escape-session-rows';

// W46 Arena escape with warrior, priest and mage (test-windows DESIGN.md 2.2 W46).
// Play: the warrior, priest and mage farm cgoo in the Arena with skeletor held; the player presses
// Escape and the trio lands in the Arena and walks home to Main (E56) (escape-session-rows.ts
// `trioEscapePlay`). E60's party has no mage, so it plays in W43 (DEVIATIONS.md "Live B").
// Failure modes: a landing off home, a complete off home, idle gaps between attempts.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W46', name: 'Arena escape with warrior, priest and mage',
  // The old case A test's 900 s bound (live-farm-death-escape.spec.ts at 21fe30a2b) plus 20 s for the
  // reset proof and dump.
  timeoutMs: 920_000,
  use: {loadout: 'combat-range', extraFighter: 'mage', initialPositions: arenaPositions(['E2EWarrior', 'E2EPriest', 'E2EBankBoi'])},
  async play({live, info}: LiveWorld) {
      await trioEscapePlay(live, info);
  },
  observers: [
    {id: 'E56', owner: 'survival', behaviours: [], start() {}, verdict() {}},
  ],
});
