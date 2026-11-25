import {liveWindow, type LiveWorld} from '../windows';
import {goobrawlFinishedSessionPlay} from '../event-session-rows';

// W35 Goobrawl after a finished Hunt, and Hunt off in the arena (test-windows DESIGN.md 2.2 W35).
// Play: the party has a finished goo Hunt when Goobrawl goes live, goes to the event before the
// hand-in, walks out when the timer ends it and hands in (T37); then a new Goobrawl goes live
// during the next Hunt, and the player turns Hunt off once both stand in the arena, so the party
// clears the survivors and walks out with Hunt still off (C12)
// (event-session-rows.ts `goobrawlFinishedSessionPlay`).
// Failure modes: a hand-in before the event, a stale event marker after the return, Hunt revived
// by the event's end.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W35', name: 'Goobrawl after a finished Hunt, and Hunt off in the arena',
  // T37's waits sum to 750 s (live-game-rows.ts goobrawlRows), C12's bound is 240 s (live-game.spec.ts at
  // 21fe30a2b) and one settle is 240 s (event-session-rows.ts), plus 20 s for the reset proof and dump.
  timeoutMs: 1_250_000,
  async play({live, page, info}: LiveWorld) {
      await goobrawlFinishedSessionPlay(live, page, info);
  },
  observers: [
    {id: 'T37', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'C12', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
