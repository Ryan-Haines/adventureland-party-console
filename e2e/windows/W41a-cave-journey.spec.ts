import {liveWindow, type LiveWorld} from '../windows';
import {caveJourneyPlay} from '../cave-rows';

// W41a The player's Cave visit from the dashboard (test-windows DESIGN.md 2.2 W41).
// Play: the player enters the Cave of Many Dreams from the dashboard; the pair answers native
// choices, follows map waypoints, stops and resumes travel, fights the Bat Roost, the Lockbreaker
// and a duel (E43), clears the required rooms, takes the stairs after a farewell while the pause
// gate refuses one transport, lands on the next floor, and leaves by the dashboard's exit (E44)
// (cave-rows.ts `caveJourneyPlay`: the 'interface' journey also plays every room and stairs step
// of the 'completion' one). DEVIATIONS.md "Live B" says why W41 is three visits.
// Failure modes: a lost choice vote, a waypoint that does not gather, a stalled route, a pause
// refusal journaled uncertain, a visit that does not retire once everyone is out.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W41a', name: "The player's Cave visit from the dashboard",
  // The old journey test's 2700 s bound (live-cave.spec.ts at 21fe30a2b) plus 20 s for the reset proof
  // and dump.
  timeoutMs: 2_720_000,
  use: {initialPosition: {map: 'main', x: 816, y: 1180}},
  async play({live, page, info}: LiveWorld) {
      await caveJourneyPlay({live, page}, info, 'interface');
  },
  observers: [
    {id: 'E43', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
    {id: 'E44', owner: 'hunting', behaviours: [], start() {}, verdict() {}},
  ],
});
