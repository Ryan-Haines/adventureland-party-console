import {liveWindow, type LiveWorld} from '../windows';
import {checkpointRoundPlay, leftOutPlay} from '../event-checkpoint-rows';

// W27a A Halloween checkpoint round from Pumpkin to Green and back (test-windows DESIGN.md 2.2
// W27, split in DEVIATIONS.md).
// Play: from the Halloween checkpoint the party walks to Mr. Pumpkin with the priest's walk point
// moved (T20), turns to Mr. Green, leaves Green for Pumpkin (T16), splits with the priest on Green
// under a Pumpkin leader and follows again (T17), turns to Green and is deselected; an escape and
// Resume interrupt the real Green return (T19), the coordinator restarts during it (T18), Pumpkin
// takes both and its deselection walks both back to the checkpoint (event-checkpoint-rows.ts
// `checkpointRoundPlay`). Last, a new Pumpkin occurrence leaves the priest out: the player's trip
// skips its occurrence and it waits in Main while the warrior attends (T22). An ignored occurrence
// stays ignored to the event's end, so this round comes after every round the priest attends.
// Failure modes: an event return holds a member after the party moved to another boss, a restart
// or escape loses the return, a moved boss point splits the walk.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W27a', name: 'A Halloween checkpoint round from Pumpkin to Green and back',
  // The play's waits sum to 1740 s and the left-out round's to 1080 s (event-checkpoint-rows.ts),
  // plus 20 s for the reset proof and dump.
  timeoutMs: 2_840_000,
  async play({live, info}: LiveWorld) {
      await checkpointRoundPlay(live, info);
      await leftOutPlay(live, info);
  },
  observers: [
    {id: 'T16', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T17', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T18', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T19', owner: 'tasks', behaviours: [], start() {}, verdict() {}},
    {id: 'T20', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'T22', owner: 'movement', behaviours: [], start() {}, verdict() {}},
  ],
});
