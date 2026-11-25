import {liveWindow, type LiveWorld} from '../windows';
import {realmSessionPlay} from '../realm-session-rows';

// W49 Party realm switch and home realm (test-windows DESIGN.md 2.2 W49).
// Play: one realm session with the merchant offline at the start (realm-session-rows.ts
// `realmSessionPlay`): the fighters walk a convoy on Main and the player switches the party to US
// II mid-walk (C20); the merchant logs in on its home and joins US II to collect (M44), then logs in
// again with its reports held, so the switch times out and a party switch rolls back (M42); a
// respawn on a US II home banks on US I (M45); the offline merchant sets US I as home (M28); a saved
// exhausted home return runs on Retry (M43); the merchant goes headless on its home despite the
// stale worker realm (M26), the player sets US I as home from the dashboard, the game refuses the
// next set_home for 36 h and a restart keeps the merchant home (M27, M26).
// Failure modes: a realm switch that keeps the old convoy, a merchant login an event takes, a
// transition with no timer of its own, a rollback that strands a member, a stale realm that wins
// over the native home, a home change that walks the merchant or misses a character.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W49', name: 'Party realm switch and home realm',
  // A hang guard from the play's own run: the longest green run's 231 s (liveb-step11-run4.log, 3.8 min), plus its
  // longest step bound, so that step fails with its own message first (realm-session-rows.ts 180 s), plus
  // 20 s for the reset proof and dump.
  timeoutMs: 431_000,
  use: {liveHeadless: true, staleWorkerRealm: 'SR_USII'},
  async play({live, page, info}: LiveWorld) {
    await realmSessionPlay(live, page, info);
  },
  observers: [
    {id: 'C20', owner: 'movement', behaviours: [], start() {}, verdict() {}},
    {id: 'M44', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M42', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M45', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M28', owner: 'realm', behaviours: [], start() {}, verdict() {}},
    {id: 'M43', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M26', owner: 'realm', behaviours: [], start() {}, verdict() {}},
    {id: 'M27', owner: 'realm', behaviours: [], start() {}, verdict() {}},
  ],
});
