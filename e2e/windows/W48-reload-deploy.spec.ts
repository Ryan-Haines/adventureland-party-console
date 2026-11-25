import {liveWindow, type LiveWorld} from '../windows';
import {deploySessionPlay} from '../deploy-session-rows';

// W48 Reload, drain and deploy during farming (test-windows DESIGN.md 2.2 W48).
// Play: one farming session of reloads and deploys (deploy-session-rows.ts `deploySessionPlay`):
// the lifecycle add-on's hold and the safe reload round with its restart beside the occupied probe
// port (C27, E53), CODE reloads during a walk and in combat (E66, E67), a safe reload through a Hunt
// and event selection turnover (E65), one published warrior build with a held old heartbeat and a
// rollback (C1, E50), a Main reload from the forest farm (E51), and the headless deployment barrier
// (E52). The fixture joins the old tests' options: combat-range for the planted goos (C27, E65-E67),
// the occupied port (E53), and headless workers on the coordinator's shadow planner (E52).
// Failure modes: a drain that never parks or never ends, a deploy that lands without activation, an
// old CODE callback or heartbeat after the replacement, a reload that loses the farm, a restart that
// takes the occupant's port, a headless worker the barrier misses.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W48', name: 'Reload, drain and deploy during farming',
  // A hang guard from the play's own steps: the rounds' measured 390 s (w48-round-times,
  // liveb-step10-run1.log: lifecycle 148 s, walk and combat reloads 38 s, turnover 45 s, code deploy
  // 17 s, Main reload 94 s, mixed deployment 48 s), plus its longest step bound, so that step fails
  // with its own message first (console-reload-rows.ts 200 s), plus 20 s for the reset proof and dump.
  timeoutMs: 610_000,
  use: {loadout: 'combat-range', occupyCoordinatorPort: true, liveHeadless: true, movementMode: 'shadow'},
  async play({live, info}: LiveWorld) {
    await deploySessionPlay(live, info);
  },
  observers: [
    {id: 'C27', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E53', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E66', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E67', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E65', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'C1', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E50', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E51', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'E52', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
  ],
});
