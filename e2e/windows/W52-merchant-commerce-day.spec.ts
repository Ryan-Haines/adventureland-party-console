import {liveWindow, type LiveWorld} from '../windows';
import {merchantDaySessionPlay} from '../merchant-day-session-rows';

// W52 Merchant buy, upgrade and compound day (test-windows DESIGN.md 2.2 W52).
// Play: one merchant commerce day (merchant-day-session-rows.ts `merchantDaySessionPlay`): it buys
// a Liquid Luck at the Winter Inn bar (A31), a duplicate helmet order once (A50) and a helmet after
// a cancelled scroll order (A53); it upgrades a helmet by hand (A54), buys ten coats beside an old
// +5 one (A45) and stops an unavailable estimate at its gold cap (A35); one upgrade batch resumes
// an interrupted broom beside a displaced wcap and a withdrawn and a carried shield (M32, M33,
// M34); banked stat scrolls go onto two helmets (M58, M60); a manual and then an automatic
// compound each take a reserved bank triplet (A60, A61); the merchant casts both mass skill tiers,
// runs low on MP and recovers from critical HP and MP during an exchange (A44); headless, a helmet
// upgrade takes its offering from the bag, from the bank, and runs past locked offerings (A24, A25,
// A28). The coordinator restarts inside A50, A53, A54, A35 and the upgrade batch.
// Failure modes: a purchase duplicated, replayed or past its cap, a cancelled order that comes
// back, a batch sized from upgraded stock, an interrupted or displaced upgrade lost or replayed, a
// stat scroll bought again, a compound on unrelated or locked stock, a ++ tier that spends the
// Merchant's Luck reserve, work that fences recovery, a locked offering spent.
// Merges (DESIGN.md): M33 and M34 read M32's batch, M60 reads M58's bank visit, A61 reads A60's
// bank. A27's fix leaves it A54's manual upgrade: its offering wait and its restart are
// upgrade-offerings.test.cjs's (DESIGN.md 4.3). A44's fix: use_skill on the merchant's own work and
// planted vitals, with no runtime timer stopped.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
// Every old spec this window cites is at 21fe30a2b.
liveWindow({
  id: 'W52', name: 'Merchant buy, upgrade and compound day',
  // The old tests' bounds summed (live-economy.spec.ts unless named): A31 240 s, A50, A53 and A54
  // 420 s each (the describe's bound), A45 360 s, A35 600 s, M32 300 s, M33 180 s and M34 240 s
  // (live-manual-upgrade.spec.ts), M58 and M60 300 s each (live-stat-scroll-bank.spec.ts), A60 and
  // A61 300 s each, A44 900 s, A24, A25 and A28 240 s each (live-bankboi-offerings.spec.ts),
  // 6000 s. A27 plays no round of its own. Plus 300 s for each of the 12 round changes
  // (jobFinished's 150 s, the 90 s bank exit, and the 30 s game queue and 30 s bag clear in
  // `nextRound`), 90 s for the
  // added coordinator start that puts the lucky slot back (live-fixtures.ts `start`), 300 s for the
  // headless move (logoutNative's 90 s, 90 s and 30 s, and the 90 s headless report), and 20 s for
  // the reset proof and dump.
  timeoutMs: 10_010_000,
  // The offering rounds need a headless merchant (live-bankboi-offerings.spec.ts:5); the play moves
  // the merchant there after the native rounds.
  use: {liveHeadless: true},
  async play({live, info}: LiveWorld) {
    await merchantDaySessionPlay(live, info);
  },
  observers: [
    {id: 'A31', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A50', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A53', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A54', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A27', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A45', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A35', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M32', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M33', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M34', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M58', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M60', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A60', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A61', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A44', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A24', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A25', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A28', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
