import {liveWindow, type LiveWorld} from '../windows';
import {admissionSessionPlay} from '../event-session-rows';

// W32a One session of event admissions that end without a fight (test-windows DESIGN.md 2.2 W32).
// Play: the A/B arena ends with the warrior inside and it reconnects once to Main (E28); an
// announced Mr. Pumpkin never appears and the party returns (E8); a fake-live Ice Golem refuses
// the join and the respawned priest goes back (T1) (event-session-rows.ts `admissionSessionPlay`).
// Failure modes: staging past the absent spawn's deadline, an ended arena left unrecovered, a
// refused join retried.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W32a', name: 'One session of event admissions that end without a fight',
  // The rounds' old bounds plus each settle and travel bound (event-session-rows.ts), plus 20 s for
  // the reset proof and dump.
  timeoutMs: 2_270_000,
  use: {initialPosition: {map: 'halloween', x: -335, y: 685}},
  async play({live, info}: LiveWorld) {
      await admissionSessionPlay(live, info);
  },
  observers: [
    {id: 'E8', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E28', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'T1', owner: 'movement', behaviours: [], start() {}, verdict() {}},
  ],
});
