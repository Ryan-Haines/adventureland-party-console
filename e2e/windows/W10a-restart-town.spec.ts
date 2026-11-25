import {liveWindow, type LiveWorld} from '../windows';
import {codeIdentityPlay, restoredTownPlay} from '../restart-walk-rows';

// W10a A coordinator restart during a party Town (test-windows DESIGN.md 2.2 W10, split in
// DEVIATIONS.md). Play: Town is cast while every Town-complete ack is refused, the coordinator
// restarts, the acks go through and the party walks to (0, 350). H2 reads the CODE hashes and the
// inventory before and after that restart.
// Failure modes: C21, a restored Town replays old command ids; H2, a restart loses CODE identity or
// inventory.
// Both checks are the play's own steps, since each reads its state at a point of the restart: a
// failed step ends the play and the runner marks both not observed, with that step's message.
liveWindow({
  id: 'W10a', name: 'A coordinator restart during a party Town',
  // The old tests' bounds: C21 240 s, H2 180 s (their specs).
  timeoutMs: 420_000,
  async play({live, info}: LiveWorld) { await codeIdentityPlay(live, info, () => restoredTownPlay(live, info)); },
  observers: [
    {id: 'C21', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'H2', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
  ],
});
