import {liveWindow, type LiveWorld} from '../windows';
import {carriesVerdict, followsVerdict, manualRecord, merchantCollection} from '../hunt-rows';

// W07b A merchant visit to a member on Manual during a Hunt (test-windows DESIGN.md 2.2 W07, split
// in DEVIATIONS.md). Play: the party Hunts armadillo, the warrior goes on Manual that carries on in
// the mission walk, the merchant's visit queues on it, the player switches it to Follows me, the
// merchant walks to where it stands and collects, the Hunt rewards and the coordinator restarts
// once. Failure modes: T33, a visit runs into a member on Manual that carries on; T34, the
// merchant moves the member it delivers to; both, cargo is lost or doubled.
const record = manualRecord();
liveWindow({
  id: 'W07b', name: 'A merchant visit to a member on Manual during a Hunt',
  // The two collection rows took 39 s and 35 s of wall time (catalog wall_s); the collection's own
  // waits reach 90 s for the visit, 180 s for the stack and 240 s for the reward (hunt-rows.ts).
  timeoutMs: 600_000,
  async play({live, info}: LiveWorld) { await merchantCollection(live, info, 'a member on Manual that carries on, then follows me', record); },
  observers: [
    {id: 'T33', owner: 'merchant', behaviours: [], start() {}, verdict() { carriesVerdict(record); }, reads: () => record.carries},
    {id: 'T34', owner: 'merchant', behaviours: [], start() {}, verdict() { followsVerdict(record); }, reads: () => record.follows},
  ],
});
