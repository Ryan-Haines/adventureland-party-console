import {liveWindow, type LiveWorld} from '../windows';
import {graveyardSessionPlay} from '../event-session-rows';

// W31a One Graveyard session in the cemetery (test-windows DESIGN.md 2.2 W31).
// Play: the party farms in the cemetery, leaves at the walk estimate for the Graveyard spawn and
// returns when it is cancelled (E25), then fights a zombie with the Gargoyle unchecked and the
// Gargoyle after the setting changes (E13) (event-session-rows.ts `graveyardSessionPlay`).
// Failure modes: an early departure, no return on cancel, an unchecked boss targeted.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W31a', name: 'One Graveyard session in the cemetery',
  // The rounds' old bounds plus each settle and travel bound (event-session-rows.ts), plus 20 s for
  // the reset proof and dump.
  timeoutMs: 1_190_000,
  use: {initialPeacefulAmbientMaps: ['spookytown', 'halloween'], initialPosition: {map: 'spookytown', x: 255, y: -1150}},
  async play({live, info}: LiveWorld) {
      await graveyardSessionPlay(live, info);
  },
  observers: [
    {id: 'E25', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E13', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
