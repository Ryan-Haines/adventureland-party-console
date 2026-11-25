import {liveWindow, type LiveWorld} from '../windows';
import {anniversaryHostSessionPlay} from '../event-session-rows';

// W37 Anniversary with its host offline, Hunt off (test-windows DESIGN.md 2.2 W37).
// Play: an Anniversary round is announced and the warrior stages for it near town through an
// old-round slice (H45); with the party on a goo Hunt the next round starts, the host priest logs
// out while the merchant banks leather, the merchant's visit resumes when the priest logs back in
// and brings its one gift (M38), and the player turns Hunt off during that visit (H11): a member
// that holds the kiss condition gets no second gift, so one visit serves both
// (event-session-rows.ts `anniversaryHostSessionPlay`).
// Failure modes: repeated Town warps while staging, bank work held by an unavailable host, Hunt
// turned back on by the event's end.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W37', name: 'Anniversary with its host offline, Hunt off',
  // The old tests' 240 and 420 s bounds (the merged visit keeps the longer one), one settle of 240 s
  // (event-session-rows.ts), plus 20 s for the reset proof and dump.
  timeoutMs: 920_000,
  use: {initialPosition: {map: 'main', x: 200, y: -120}},
  async play({live, info}: LiveWorld) {
      await anniversaryHostSessionPlay(live, info);
  },
  observers: [
    {id: 'H45', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'M38', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'H11', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
