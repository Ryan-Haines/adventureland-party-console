import {liveWindow, type LiveWorld} from '../windows';
import {bankDaySessionPlay} from '../bank-day-session-rows';

// W51 Merchant bank and NPC sale day (test-windows DESIGN.md 2.2 W51).
// Play: one merchant bank day (bank-day-session-rows.ts `bankDaySessionPlay`): it withdraws and
// drinks a stored Liquid Luck (M08); the popup's sort request swaps a merchant-luck pair (A1); it
// compresses candy and the sort merges silk (A6); the popup's Auto sell to NPC sells banked helmets
// once withdrawals turn on (A3, A4) and past the collection threshold (A5); a disabled sale rule
// holds across a restart (A10); a full bag holds a compound until NPC sales free cells (A8); a legacy
// store caps one withdrawal pass at ten stacks (A11); a partial NPC sale credits its gold (A51); a
// marked deposit and a requested withdrawal conserve a stack (A52); mailed beewings come back before
// the mail is deleted (M30, M31); an automatic sale keeps 450 across bag, bank and an offline
// BankBoi (M50, M51). The coordinator restarts inside A10, A11, A51, A52, M30 and M51.
// Failure modes: a sort that drops a lock or keeps the luck attribution, a stack left split, a rule
// that never withdraws, a locked or stand-listed copy sold, a sale past the keep, gold not credited,
// a compound admitted into a full bag, a stack lost across a restart, mail deleted before collection.
// Merges (DESIGN.md): A4 reads A3's toggle round, M31 reads M30's round, M50 reads M51's round.
// The checks are the play's own steps: a failed step ends the play and the runner marks each
// not observed, with that step's message.
liveWindow({
  id: 'W51', name: 'Merchant bank and NPC sale day',
  // The old tests' bounds at 21fe30a2b summed: M08 180 s (live-elixir-restock.spec.ts), A1, A6, A3 and A5
  // 300 s each (live-bank-collection.spec.ts), A10 240 s, A8 420 s and A11 360 s
  // (live-bank-npc-sales.spec.ts), A51 and A52 420 s each (live-economy.spec.ts), M30 300 s
  // (live-mailbox.spec.ts) and M51 660 s (live-npc-sale-keep.spec.ts), 4200 s; plus 270 s for each
  // of the 11 round changes (jobFinished's 150 s, the 90 s bank exit and the 30 s bag clear in
  // `nextRound`) and 20 s for the reset proof and dump.
  timeoutMs: 7_190_000,
  async play({live, page, info}: LiveWorld) {
    await bankDaySessionPlay(live, info, page);
  },
  observers: [
    {id: 'M08', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A1', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A6', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A3', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A4', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A5', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A10', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A8', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A11', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A51', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'A52', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M30', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M31', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M50', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
    {id: 'M51', owner: 'merchant', behaviours: [], start() {}, verdict() {}},
  ],
});
