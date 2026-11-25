import {liveWindow, type LiveWorld} from '../windows';
import {desert, transporterSessionPlay} from '../transporter-collection-rows';

// W59 Merchant collects from a far start (test-windows DESIGN.md 2.2 W59).
// Play: one collection session (transporter-collection-rows.ts `transporterSessionPlay`): the
// headless merchant collects the farming warrior's leather from its desert start (M48), the player
// sends it to the Winter Inn exit, and its next collection takes the Winterland transporter to Main
// (M49).
// Failure modes: a transport sent out of range or from a blocked spot, a collection that never
// reaches Main, cargo lost or copied on the way.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W59', name: 'Merchant collects from a far start',
  // A hang guard from the play's own run: the longest green run's 49.6 s (liveb-step11-run4.log; step 10 run 4 37.1 s), plus its
  // longest step bound, so that step fails with its own message first (transporter-collection-rows.ts 120 s), plus
  // 20 s for the reset proof and dump.
  timeoutMs: 190_000,
  use: {liveHeadless: true, initialPositions: {E2EWarrior: {map: 'main', x: 0, y: 0}, E2EPriest: {map: 'main', x: 0, y: 0}, E2EMerchant: {map: desert.map, x: desert.x, y: desert.y}}},
  start: {positions: {E2EWarrior: {map: 'main', x: 0, y: 0}, E2EPriest: {map: 'main', x: 0, y: 0}, E2EMerchant: {map: desert.map, x: desert.x, y: desert.y}}},
  async play({live, info}: LiveWorld) {
    await transporterSessionPlay(live, info);
  },
  observers: [
    {id: 'M48', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M49', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
