import {liveWindow, type LiveWorld} from '../windows';
import {bankboiRestartPlay} from '../bankboi-session-rows';

// W55 Restart during a BankBoi transaction (test-windows DESIGN.md 2.2 W55).
// Play: one BankBoi delivery (bankboi-session-rows.ts `bankboiRestartPlay`): the offline BankBoi
// holds the only offerings for a manual and an automatic +8 wand upgrade, and the coordinator
// restarts while the transaction is open and again when an offering reaches the merchant.
// Failure modes: a restart that drops an upgrade mark, a delivery replayed or lost, an upgrade that
// runs without its required offering.
// A19, A22 and A23 merge into A18's check: the manual and automatic marks and the handoff and
// delivery restarts are one play.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W55', name: 'Restart during a BankBoi transaction',
  // The old test's 360 s bound (live-bankboi-offerings.spec.ts at 21fe30a2b), plus 20 s for the reset
  // proof and dump.
  timeoutMs: 380_000,
  use: {liveHeadless: true},
  async play({live, info}: LiveWorld) {
    await bankboiRestartPlay(live, info);
  },
  observers: [
    {id: 'A18', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A19', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A22', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A23', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
