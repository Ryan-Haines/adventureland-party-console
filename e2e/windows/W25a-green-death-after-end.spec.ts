import {liveWindow, type LiveWorld} from '../windows';
import {up3Row} from '../movement-death-after-end-rows';

// W25a The priest dies at Mr. Green during a Hunt and the event ends (test-windows DESIGN.md 2.2
// W25).
// Play: the party Hunts crab, Mr. Green is seeded and selected, both damage it, the priest is
// killed, the event ends while it is dead, and the respawned priest walks back to its Hunt.
// T5 merges into T4 (DESIGN.md 4.2): the Hunt case is the farm case plus the Hunt cycle and the
// group task, so the one play is the Hunt row and both read it.
// Failure mode: a respawned character does not go back to its activity after the event ended (UP-3).
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W25a', name: 'The priest dies at Mr. Green during a Hunt and the event ends',
  // The row's own waits: 240 s to reach the Hunt and 300 s for the damage (movement-death-after-end-rows.ts).
  timeoutMs: 600_000,
  async play({live, info}: LiveWorld) {
      await up3Row('hunt')(live, info);
  },
  observers: [
    {id: 'T4', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T5', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
