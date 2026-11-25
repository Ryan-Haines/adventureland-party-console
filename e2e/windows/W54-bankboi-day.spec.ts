import {liveWindow, type LiveWorld} from '../windows';
import {bankboiDaySessionPlay} from '../bankboi-day-session-rows';

// W54 BankBoi day (test-windows DESIGN.md 2.2 W54).
// Play: one BankBoi day (bankboi-day-session-rows.ts `bankboiDaySessionPlay`): the native merchant
// fills its bank until the first offline BankBoi reserves its transfer row (A12) and stores slices
// and gifts as its own BankBoi (A30); then, headless, the offline BankBoi delivers a Lantern
// triplet for a manual compound (A13), retries a timed-out trip and drains seven reserve cells
// (A29), delivers stramulets for an automatic compound (A16), delivers offerings for a manual and
// an automatic wand upgrade (A17, A21) and again from an errored BankBoi with a remote helmet
// (A20), hands throwing stars to automatic NPC sales (A15), and holds the party under a drain
// lease (A14).
// Failure modes: a reserve row missing or left behind, a delivery lost or replayed across a
// restart, merchant work admitted on remote inputs alone, kept or locked copies sold or combined,
// an upgrade run without its required offering, maintenance that waits on the stopped merchant.
// A21 merges into A17's check: one delivery supplies the manual and the automatic mark.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W54', name: 'BankBoi day',
  // The old tests' bounds at 21fe30a2b summed: A12 240 s (live-bank-staging.spec.ts), A30 240 s
  // (live-bankboi.spec.ts), A13 300 s, A29 300 s, A16 360 s, A17 with A21 360 s, A20 360 s,
  // A15 300 s and A14 240 s (live-bankboi-offerings.spec.ts), 2700 s. Plus 90 s each for the
  // store's close before the headless move and the six round changes' idle waits, 15 s each for
  // the round changes' bank reads (the expect timeout, playwright.config.ts), 90 s each for the
  // two added coordinator starts (live-fixtures.ts `start`), and 20 s for the reset proof and dump.
  timeoutMs: 3_620_000,
  // A30's merchant is its own BankBoi with no merchant selected, and a restart reads an unset
  // merchant as the default (runtime/settings/coordinator/initial.ts:358-359), so the boot
  // selects none. The play selects the merchant for every other round.
  use: {liveHeadless: true, merchantDefault: null},
  async play({live, info, page}: LiveWorld) {
    await bankboiDaySessionPlay(live, info, page);
  },
  observers: [
    {id: 'A12', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A13', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A14', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A15', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A16', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A17', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A20', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A21', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A29', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A30', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
