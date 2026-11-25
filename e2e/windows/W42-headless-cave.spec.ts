import {liveWindow, type LiveWorld} from '../windows';
import {headlessCavePlay} from '../cave-headless-rows';

// W42 Headless Cave visit (test-windows DESIGN.md 2.2 W42).
// Play: a headless party enters the Cave; only the leader asked for full floors, the follower's
// card draws the floor from the leader, the map stream sends the floor once, and the floor is
// dropped when the visit ends (cave-headless-rows.ts `headlessCavePlay`).
// Failure modes: a follower card with no floor, a floor sent twice, a floor kept after the visit.
// The check is the play's own steps: a failed step ends the play and the runner marks it not
// observed, with that step's message.
liveWindow({
  id: 'W42', name: 'Headless Cave visit',
  // The old test's 900 s bound (live-cave-headless.spec.ts at 21fe30a2b) plus 20 s for the reset proof
  // and dump.
  timeoutMs: 920_000,
  use: {liveHeadless: true, initialPosition: {map: 'main', x: 816, y: 1180}},
  async play({live, page, info}: LiveWorld) {
      await headlessCavePlay({live, page}, info);
  },
  observers: [
    {id: 'E48', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
