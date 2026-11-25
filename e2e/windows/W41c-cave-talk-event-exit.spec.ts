import {liveWindow, type LiveWorld} from '../windows';
import {talkOwnerPlay} from '../cave-rows';

// W41c Cave talk, rescue vote and the event exit (test-windows DESIGN.md 2.2 W41).
// Play: with the hunting-hooks add-on on, the player enters the Cave and the add-on hears each
// phase and reads the visit (E47); the pair answers the entry merchant, walks on, talks to reopen
// it, buys its item, and a waypoint inside rock repairs past three until Retry (E49); then the
// warrior dies inside and is revived after the rescue vote, and a planted Goo Brawl ends the
// visit (E47) (cave-rows.ts `talkOwnerPlay`).
// Failure modes: a second talk that replaces the first, a repair count cap, a revival authorized
// during an open vote, an exit that leaves a vote open.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W41c', name: 'Cave talk, rescue vote and the event exit',
  // The old tests' 900 s bounds (live-cave.spec.ts, live-cave-talk.spec.ts at 21fe30a2b) plus 20 s for the
  // reset proof and dump.
  timeoutMs: 1_820_000,
  use: {initialPosition: {map: 'main', x: 816, y: 1180}},
  async play({live, page, info}: LiveWorld) {
      await talkOwnerPlay({live, page}, info);
  },
  observers: [
    {id: 'E49', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'E47', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
