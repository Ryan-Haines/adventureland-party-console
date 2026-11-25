import {liveWindow, type LiveWorld} from '../windows';
import {anniversaryPreemptionPlay} from '../anniversary-rows';

// W36 One Anniversary visit during a goo Hunt (test-windows DESIGN.md 2.2 W36).
// Play: the party Hunts goo with Anniversary selected; the round goes live on the priest, and the
// first reply admitting the priest is held while its walk owns it; the merchant gets the gift, the
// coordinator restarts, the player deselects, and the held admission reaches the priest only once a
// newer Hunt walk owns it; the party reaches its retained mission and kills a planted goo
// (anniversary-rows.ts `anniversaryPreemptionPlay` with the restart).
// H9 and H10 merge into H1 (DESIGN.md 4.2): H10 is H9's visit after a restart, and H9's resume is
// this play's resume, which H1 reads with the stricter poll (cycle kept and not paused).
// Failure modes: a stale admission stopping the resumed Hunt, a restart losing the visit or the
// Hunt cycle, a second gift.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W36', name: 'One Anniversary visit during a goo Hunt',
  // The old test's 420 s bound plus 20 s for the reset proof and dump (DESIGN.md 2.2).
  timeoutMs: 440_000,
  async play({live, info}: LiveWorld) {
      await anniversaryPreemptionPlay({live}, info, true);
  },
  observers: [
    {id: 'H1', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'H9', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'H10', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
