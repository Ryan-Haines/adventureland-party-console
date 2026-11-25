import {liveWindow, type LiveWorld} from '../windows';
import {horsemanSessionPlay} from '../event-session-rows';

// W30a One Horseman session on Halloween (test-windows DESIGN.md 2.2 W30).
// Play: the party farms south of the Horseman spawn, leaves at the walk estimate and fights only
// after LIVE (E24); walks to the forest graveyard Horseman (E11); clears each Jack-o-Walker wave
// and resumes the boss (E12); farms goo with the all focus beside an unjoined Horseman (E21); and
// the priest dies at the Horseman and walks back while the coordinator keeps the failed walk (T2)
// (event-session-rows.ts `horsemanSessionPlay`).
// Failure modes: an early departure or fight before LIVE, the boss outranking its adds, an
// unjoined boss pulled, a respawned member left idle.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W30a', name: 'One Horseman session on Halloween',
  // The rounds' old bounds plus each settle and travel bound (event-session-rows.ts), plus 20 s for
  // the reset proof and dump.
  timeoutMs: 4_010_000,
  use: {initialPeacefulAmbientMaps: ['spookytown', 'halloween'], initialPosition: {map: 'halloween', x: -405, y: -1440}},
  async play({live, info}: LiveWorld) {
      await horsemanSessionPlay(live, info);
  },
  observers: [
    {id: 'E24', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E11', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E12', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E21', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'T2', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'T3', owner: 'movement', behaviours: [], start() {}, verdict() {}},
  ],
});
