import {liveWindow, type LiveWorld} from '../windows';
import {goobrawlHuntSessionPlay} from '../event-session-rows';

// W34 Goobrawl during a goo Hunt (test-windows DESIGN.md 2.2 W34).
// Play: the party Hunts goo when Goobrawl goes live, joins the arena, the coordinator restarts
// inside it, the timer ends it and the party walks out and resumes the same Hunt mission (T35,
// T36); the next Goobrawl goes live during a new Hunt and the player turns Hunt off as the leader
// joins, so the party clears the survivors and walks out with Hunt off (C11); then the events
// hooks add-on hears a Mr. Green come due, refuses the priest's Goobrawl admission once, and hears
// the join, the end, the return, a manual leave and its own event kind (C28); last, the tasks hooks
// add-on's task holds the farming group until a Goobrawl takes it, and hears the Follow, Manual,
// mode and hand-in rows (M63) (event-session-rows.ts `goobrawlHuntSessionPlay`).
// T35 merges into T36 (DESIGN.md 4.2); T36's stale-marker half is a coordinator unit check
// (DESIGN.md 4.3), mapped to step 12.
// Failure modes: the Hunt not suspended by the event walk, a restart losing attendance, the Hunt
// mission changed by the event, Hunt revived after a Hunt off, a hook or notice that never fires.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W34', name: 'Goobrawl rounds during a goo Hunt',
  // T36 plays T37's Goobrawl (live-game-rows.ts goobrawlPlay, 750 s of waits), C11's bound is
  // 240 s (live-game.spec.ts at 21fe30a2b), C28's and M63's are 900 s each (their old specs), and three
  // settles are 240 s each (event-session-rows.ts), plus 20 s for the reset proof and dump.
  timeoutMs: 3_530_000,
  async play({live, info}: LiveWorld) {
      await goobrawlHuntSessionPlay(live, info);
  },
  observers: [
    {id: 'T36', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T35', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'C11', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'C28', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'M63', owner: 'tasks', behaviours: [], start() {}, verdict() {}},
  ],
});
