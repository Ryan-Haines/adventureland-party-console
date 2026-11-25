import {liveWindow, type LiveWorld} from '../windows';
import {commandLeaveSessionPlay} from '../event-session-rows';

// W29a One session of player commands that end event attendance (test-windows DESIGN.md 2.2 W29).
// Play: the party attends a Mr. Pumpkin occurrence and leaves it by a party command (H30), then a
// new one by travel (H31), then a new one by a monster farm (H32); a follower fights a live boss a
// map away from its leader (C22); a farm focus changes during a Halloween round that ends
// naturally (E42); an escape and Resume end a Green attendance (T6)
// (event-session-rows.ts `commandLeaveSessionPlay`).
// Failure modes: a leave skipping more than its occurrence, an event rejoin stealing the route, a
// leader held by a follower's fight, the old focus resuming after the event, Resume inside its
// lockout.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W29a', name: 'One session of player commands that end event attendance',
  // The rounds' old bounds plus each settle and travel bound (event-session-rows.ts), plus 20 s for
  // the reset proof and dump.
  timeoutMs: 4_970_000,
  use: {initialConsoleHold: true, initialPositions: {E2EWarrior: {map: 'halloween', x: 0, y: 0}, E2EPriest: {map: 'halloween', x: 1212, y: 101}}},
  async play({live, info}: LiveWorld) {
      await commandLeaveSessionPlay(live, info);
  },
  observers: [
    {id: 'H30', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'H31', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'H32', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'C22', owner: 'convoy', behaviours: [], start() {}, verdict() {}},
    {id: 'E42', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'T6', owner: 'movement', behaviours: [], start() {}, verdict() {}},
  ],
});
