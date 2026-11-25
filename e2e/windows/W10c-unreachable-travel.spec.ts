import {liveWindow, type LiveWorld} from '../windows';
import {walkLadderPlay} from '../movement-walks-rows';

// W10c A party travel that cannot arrive (test-windows DESIGN.md 2.2 W10, split in DEVIATIONS.md).
// Play: a party travel past Main's east edge climbs the walk ladder, then a Town-first travel waits
// on a stunned priest. Failure modes: an unreachable travel fails for good, or a stalled assembly
// climbs the ladder.
// T12's checks are the play's own steps: a failed step ends the play and the runner marks T12 not
// observed, with that step's message.
liveWindow({
  id: 'W10c', name: 'A party travel that cannot arrive',
  // T12's bounds: 780 s for the ladder plus 180 s for each travel to end (walkLadderPlay).
  timeoutMs: 1_200_000,
  async play({live, info}: LiveWorld) { await walkLadderPlay(live, info, false); },
  observers: [{id: 'T12', owner: 'movement', behaviours: [], start() {}, verdict() {}}],
});
