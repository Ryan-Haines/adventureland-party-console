import {liveWindow, type LiveWorld} from '../windows';
import {standSessionPlay} from '../stand-session-rows';

// W56 Merchant stand and WTB (test-windows DESIGN.md 2.2 W56).
// Play: one stand session (stand-session-rows.ts `standSessionPlay`): the merchant relogs at level
// 80 with 30 trade slots (A62), walks to a dashboard-set stand point and opens its stand (A38), a
// blocked reservation goes live after the restart (A56), one covered bid funds once across six jobs
// (A39), and a bid above its carried gold withdraws bank funding and survives a reopened stand (A55).
// Failure modes: a stand point in a wall, a location rerolled by a restart, a reservation blocked for
// good, funding queued per job, a replaced offer counted as a purchase.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W56', name: 'Merchant stand and WTB',
  // A hang guard from the play's own run: the longest green run's 41.4 s (liveb-step11-run3.log; run 4 of step 10 40.6 s), plus its
  // longest step bound, so that step fails with its own message first (stand-session-rows.ts 420 s), plus
  // 20 s for the reset proof and dump.
  timeoutMs: 482_000,
  async play({live, page, info}: LiveWorld) {
    await standSessionPlay(live, page, info);
  },
  observers: [
    {id: 'A62', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A38', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A56', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A39', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A55', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
