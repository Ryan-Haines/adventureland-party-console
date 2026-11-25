import {liveWindow, type LiveWorld} from '../windows';
import {cipherSessionPlay} from '../event-session-rows';

// W39 The Witch's Cipher rounds (test-windows DESIGN.md 2.2 W39).
// Play: the party Hunts arctic bees when the Cipher starts, a member dies on the way and the party
// gathers (E18); at the goo spawn the merchant brews early on the mix it affords (E19); from the
// Halloween checkpoint the Cipher gathering interrupts a lower-priority Green and reaches the
// spider spawn (E20); and the merchant solves a constrained recipe without replaying it after a
// restart (E10) (event-session-rows.ts `cipherSessionPlay`).
// Failure modes: a death losing the Cipher, a late brew, Green holding the gathering, a brew
// replayed after a restart.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W39', name: "The Witch's Cipher rounds",
  // The old tests' 600, 420, 600 and 360 s bounds, three settles of 240 s and three travels of
  // 150 s (event-session-rows.ts), plus 20 s for the reset proof and dump.
  timeoutMs: 3_170_000,
  use: {initialPosition: null, initialMonsterSpawn: 'arcticbee'},
  // The fixture places every character at the arctic bee pack's centre (live-fixtures.ts
  // initialMonsterSpawn; game data 17175 winterland boundary 682, -967, 1482, -779), which the reset
  // proof reads in place of the seeded point.
  start: {positions: Object.fromEntries(['E2EWarrior', 'E2EPriest', 'E2EMerchant'].map(n => [n, {map: 'winterland', x: 1082, y: -873}]))},
  async play({live, page, info}: LiveWorld) {
      await cipherSessionPlay(live, page, info);
  },
  observers: [
    {id: 'E18', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E19', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E20', owner: 'events', behaviours: [], start() {}, verdict() {}},
    {id: 'E10', owner: 'events', behaviours: [], start() {}, verdict() {}},
  ],
});
