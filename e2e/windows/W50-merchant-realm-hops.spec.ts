import {liveWindow, type LiveWorld} from '../windows';
import {merchantHopPlay, realmStayPlay} from '../merchant-hop-rows';

// W50 Merchant realm hops while the fighters farm (test-windows DESIGN.md 2.2 W50).
// Play: the fighters farm their solo goo fields from the boot while the merchant works one series
// of realm hops (merchant-hop-rows.ts): a saved Ponty job takes it to US II, force stand brings it
// home at once and releasing it lets the job run again and the merchant open its stand at home
// (M41); then two queues of jobs on both realms, the first with an equal job on US II, which the
// merchant takes before it hops home (M46), the second with a more urgent home job, which takes
// it home first (M47). Each queue starts after the one before it has run out.
// Failure modes: a hop with no reconnect, saved work that stays current, a stand return that
// strands the merchant away, a realm stay that ignores the urgency order.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W50', name: 'Merchant realm hops while the fighters farm',
  // The three old tests' 420 s bounds (live-merchant-realm-recovery.spec.ts at 21fe30a2b) plus 20 s for
  // the reset proof and dump.
  timeoutMs: 1_280_000,
  async play({live, info}: LiveWorld) {
    await merchantHopPlay(live, info);
    await realmStayPlay(live, info, false);
    await realmStayPlay(live, info, true);
  },
  observers: [
    {id: 'M41', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M46', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M47', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
