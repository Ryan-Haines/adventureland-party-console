import {liveWindow, type LiveWorld} from '../windows';
import {pacingRegroupPlay} from '../cave-rows';

// W41b Cave pacing, regroup and the stay hold (test-windows DESIGN.md 2.2 W41).
// Play: the party at the Cave spot enters; in the first room a completed assembly regroups the
// displaced warrior (E45, E46); the party walks a shared route to a farm room on one cruise and
// stops when progress goes off; the priest goes solo and back; the player exits with "After a
// run" on stay, so the party holds outside, the priest dies there and recovers, and go back
// retires the visit (T39) (cave-rows.ts `pacingRegroupPlay`).
// Failure modes: a member left behind on the route, a regroup that never completes, a death
// recovery stuck under the held visit, a Cave task outliving the visit.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W41b', name: 'Cave pacing, regroup and the stay hold',
  // E45's 300 s bound (live-cave.spec.ts at 21fe30a2b) and T39's waits, 1540 s summed (cave-pacing-row.ts),
  // plus 20 s for the reset proof and dump.
  timeoutMs: 1_860_000,
  use: {initialPosition: {map: 'main', x: 816, y: 1180}},
  async play({live, page, info}: LiveWorld) {
      await pacingRegroupPlay({live, page}, info);
  },
  observers: [
    {id: 'T39', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'E45', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'E46', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
