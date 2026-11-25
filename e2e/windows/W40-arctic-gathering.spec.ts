import {liveWindow, type LiveWorld} from '../windows';
import {cipherGatherPlay} from '../october-rows';
import {eventScrub} from '../event-window-helpers';

// W40 The Cipher gathering on arctic bees (test-windows DESIGN.md 2.2 W40).
// Play: the fighters gather on a planted peaceful arctic bee until gather_end, the coordinator
// restarts mid-gather, and they hand their ingredients to the merchant at the Witch
// (october-rows.ts `cipherGatherPlay`).
// Failure modes: the merchant gathering, the brewing plan lost to a restart, a hand-over before
// gather_end.
// The check is the play's own steps: a failed step ends the play and the runner marks it not
// observed, with that step's message.
liveWindow({
  id: 'W40', name: 'The Cipher gathering on arctic bees',
  // The old test's 720 s bound plus 20 s for the reset proof and dump (DESIGN.md 2.2).
  timeoutMs: 740_000,
  use: {initialPosition: null, initialMonsterSpawn: 'arcticbee'},
  // The fixture places every character at the arctic bee pack's centre (live-fixtures.ts
  // initialMonsterSpawn; game data 17175 winterland boundary 682, -967, 1482, -779), which the reset
  // proof reads in place of the seeded point.
  start: {positions: Object.fromEntries(['E2EWarrior', 'E2EPriest', 'E2EMerchant'].map(n => [n, {map: 'winterland', x: 1082, y: -873}]))},
  async play({live, info}: LiveWorld) {
      try { await cipherGatherPlay({live}, info); }
      finally { await eventScrub(live, info); }
  },
  observers: [
    {id: 'E14', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
