import {liveWindow, type LiveWorld} from '../windows';
import {reloadRestartSessionPlay} from '../event-session-rows';

// W28a One event walk session with CODE reloads and coordinator restarts (test-windows DESIGN.md
// 2.2 W28).
// Play: in Upper Hills the event exit retires and the entry resumes from a restored snapshot
// (E33); from the Halloween checkpoint a fixed-end Pumpkin survives a reload and a time limit (E32),
// the priest's CODE turns over and the coordinator restarts on the Pumpkin walk (E36), a
// higher-priority Green replaces the Pumpkin walk across a reload and restart (E37), and Pumpkin's
// time limit and Green's death limit end each instance across a restart (E39)
// (event-session-rows.ts `reloadRestartSessionPlay`).
// Failure modes: a restart or reload losing the walk owner, a failed entry holding a new boss, a
// limit outliving its instance.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W28a', name: 'One event walk session with CODE reloads and coordinator restarts',
  // The rounds' old bounds plus each settle and travel bound (event-session-rows.ts), plus 20 s for
  // the reset proof and dump.
  timeoutMs: 3_350_000,
  use: {nativeStatusObserver: true, initialPosition: {map: 'uhills', x: -550, y: -160}},
  async play({live, info}: LiveWorld) {
      await reloadRestartSessionPlay(live, info);
  },
  observers: [
    {id: 'E33', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E32', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E36', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E37', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E39', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
