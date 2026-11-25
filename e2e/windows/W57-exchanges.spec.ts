import {liveWindow, type LiveWorld} from '../windows';
import {exchangeSessionPlay} from '../exchange-session-rows';

// W57 Exchanges (test-windows DESIGN.md 2.2 W57).
// Play: one exchange day (exchange-session-rows.ts `exchangeSessionPlay`): ten gems with every
// reward stack carried bank their rewards and the Auto bank rules survive a restart (M18); a box
// banks its reward with no rule, then Auto exchange chains the marked boxes and sells the rewards
// across a restart (A47); a resumed gem exchange compresses the candy the priest sends mid-job (A7);
// the player marks a fighter's box Exchange across a restart (M16), then Auto exchange, and turning
// the rule off keeps the next box (M17).
// Failure modes: a reward left carried or lost, a nested box banked, a mark lost to a restart, a
// stack merge that steals a reward receipt, a fighter that exchanges, a removed rule that still
// exchanges.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W57', name: 'Exchanges',
  // The old tests' bounds at 21fe30a2b summed: M18 420 s (live-exchange-reward-bank.spec.ts), A47 720 s
  // (live-economy.spec.ts), A7 300 s (live-bank-collection.spec.ts), M16 and M17 360 s each
  // (live-exchange-collection.spec.ts), plus the end of A7's order on jobFinished's 150 s and 20 s
  // for the reset proof and dump.
  timeoutMs: 2_330_000,
  async play({live, page, info}: LiveWorld) {
    await exchangeSessionPlay(live, page, info);
  },
  observers: [
    {id: 'M18', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A47', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A7', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M16', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M17', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
