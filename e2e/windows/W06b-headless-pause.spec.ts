import {liveWindow, type LiveWorld} from '../windows';
import {pauseHeadlessRow} from '../user-holds-rows';

// W06b A headless priest on Pause (test-windows DESIGN.md 2.2 W06, split in DEVIATIONS.md). Play:
// the priest leaves its game client and runs headless; a Tracktrix in its bag charges its socket
// once; on Pause it carries on, a party Town leaves it behind, and hurt beside a goo it drinks and
// attacks nothing; Play lets it recover; paused again it dies and stays dead past the respawn
// wait, then respawns after Play.
// Failure modes: a headless Pause moves, drinks, attacks or respawns the priest, Follows me
// applies to it, or its call budget charges the socket a second time.
// T48's checks are the play's own steps: each stands on the one before it (the death needs the
// second Pause), so a failed step ends the play and the runner marks T48 not observed, with that
// step's message.
liveWindow({
  id: 'W06b', name: 'A headless priest on Pause',
  // The headless spawn needs the fixture's headless workers (live-movement-owner.spec.ts at 21fe30a2b ran the
  // row with the same option).
  use: {liveHeadless: true},
  // T48's own waits: 90 s each for the logout, the switch and the headless report, 30 s for the
  // call budget bound, and twice the respawn wait plus 30 s for the respawn.
  timeoutMs: 600_000,
  async play({live, info}: LiveWorld) { await pauseHeadlessRow(live, info); },
  observers: [{id: 'T48', owner: 'tasks', behaviours: [], start() {}, verdict() {}}],
});
