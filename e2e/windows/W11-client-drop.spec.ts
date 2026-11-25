import {liveWindow, type LiveWorld} from '../windows';
import {convoyDropPlay, convoyDropVerdict, huntDropPlay, huntDropRecord, huntDropVerdict, type ConvoyDrop} from '../reconnect-rows';

// W11 Client drop during a walk (test-windows DESIGN.md 2.2). Play: the party walks a 450 convoy on
// Main and the priest's client drops and reconnects mid-walk; then the party starts a goo Hunt and
// the priest's client drops and reconnects on the mission walk; the party turns in at Daisy and the
// coordinator restarts once. C4 and H39 each read a member reconnecting mid-walk.
// Failure modes: C4, a lost follower never finishes the convoy it was on; H39, the reconnected
// follower's runtime is not adopted, the Hunt stalls, an owner gets no Daisy reward or two, or the
// rendezvous goes out with no route version.
const convoy: ConvoyDrop = {}, hunt = huntDropRecord();
liveWindow({
  id: 'W11', name: 'Client drop during a walk',
  // C4's old test took 18 s and H39's 29 s of wall time (catalog wall_s); H39's own bound was 300 s,
  // and the window plays both walks after one boot.
  timeoutMs: 360_000,
  async play({live, info}: LiveWorld) {
    await convoyDropPlay(live, info, convoy);
    await huntDropPlay(live, info, hunt);
  },
  observers: [
    {id: 'C4', owner: 'movement', behaviours: ['MOV-016'], start() {}, verdict() { convoyDropVerdict(convoy); }, reads: () => convoy},
    {id: 'H39', owner: 'hunting', behaviours: [], start() {}, verdict() { huntDropVerdict(hunt); }, reads: () => hunt},
  ],
});
