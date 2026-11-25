import {liveWindow, type LiveWorld} from '../windows';
import {rangerPlay, rangerRecord, rangerVerdict} from '../gameplay-scenarios';
import {rangerNeedsPlay, rangerNeedsVerdict} from '../survival-rows';

// W02 Solo ranger goo farm (test-windows DESIGN.md 2.2). Play: a solo ranger leader farms goo on
// Main in Group mode, then drinks through a planted low HP and a planted low MP, the second after
// the first potion's window. Its own party shape (a ranger alone) keeps it apart, and it bounds
// kills and potion timing, which a second stack slows, so it runs alone.
// Failure modes (C17): a singleton leader receives no group; its first pre-heartbeat shot hides
// starvation; automatic Scatter masks the broken group; another fighter supplies the kills; the
// ranger dies with HP potions in its bags (live finding of 2026-11-01).
const record = rangerRecord();
let needs: unknown;
liveWindow({
  id: 'W02', name: 'Solo ranger goo farm', alone: true,
  // C17 took 0.5 min of play today (catalog); its old test bound was 360 s with the boot inside it.
  timeoutMs: 360_000,
  use: {primaryClass: 'ranger'},
  async play({live, info}: LiveWorld) {
    await rangerPlay(live, info, record);
    needs = await rangerNeedsPlay(live, info);
  },
  observers: [{
    id: 'C17', owner: 'hunting', behaviours: [],
    start() {},
    async verdict({live, info}: LiveWorld) { await rangerVerdict(live, info, record); rangerNeedsVerdict(needs); },
    reads: () => ({record, needs}),
  }],
});
