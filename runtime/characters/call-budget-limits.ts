// The call budget's limits: the game server's window and call limit, the crossing costs the cost
// table reads, the survival floor, and the band limits. The file imports nothing, so the
// dashboard can read the limit and where a job call starts to wait. The server's window and
// limit (server_functions.js:5481-5483; server.js:262).
export const CALL_WINDOW_MS = 4000;
export const CALL_LIMIT = 200;
// Every `transport_player_to` charges the moved player's socket 8 (server.js:4808) and ends with a
// `u+cid` resend (4839), which charges the socket of the call being handled 2. A crossing inside
// the sender's own handler pays both; one that completes after its call (Town, Blink, Magiport, a
// bank floor) runs with no call being handled, so it pays the door's 8 alone (design 3.2).
export const DOOR = 8;
export const CROSSING = DOOR + 2;
// Blink and an accepted Magiport land when the condition their handler sets runs out: `s.blink`
// of 200 ms (server.js:10842) and `s.magiport` of 400 ms (server_functions.js:4088), each ending
// in `transport_player_to` (server.js:14784, 14803). Their door is booked with the call, dated at
// the landing (design 3.2).
export const BLINK_LANDS_MS = 200;
export const MAGIPORT_LANDS_MS = 400;
// A bank floor's door charges 32 at the call (server.js:5978); its door's 8 follows on `new_map`.
export const BANK_FLOOR = 32;
// A potion use costs 4 (3.2), and the 2000 ms potion cooldown (server.js:7816) lets three into
// one window, so survival keeps 12 free beyond what it has spent.
export const SURVIVAL_FLOOR = 3 * 4;

export interface BandLimits { reserve: number; survival: number; job: number; background: number }
// The survival reserve and the three limits on `used`. Survival's reserve is what it spent in the
// current window and the potion floor beyond it, and job and background share the rest of the
// server's limit. `used` holds the survival spend, so the job and background limit on `used` is
// the server's limit less the floor, whatever survival has spent. Once survival spends into the
// floor, job and background wait until the window frees the floor again, so the room that frees
// goes to survival first. The window forgets each spend as the server does, so a fight's share
// ends one window after the fight. A band's live wait holds every band below it (call-budget.ts
// `band`).
export function bandLimits(survivalSpent: number): BandLimits {
  const reserve = survivalSpent + SURVIVAL_FLOOR, shared = CALL_LIMIT - reserve + survivalSpent;
  return { reserve, survival: CALL_LIMIT, job: shared, background: shared };
}

// The two background reads' picks (call-budget-reads.ts). No screen shows them and no player
// chooses one, so each is a named pick and none is a saved setting (as every character-side
// hidden pick is). No game fact, measured state or progress rule gives one, so
// each keeps v1.5.0's value.
export const READ_PICKS = {
  // The Tracktrix fields a `kill_credit` does not carry (`monsters_diff`, the exchanges, the drop
  // tables, `max`) are read again this long after each reply (v1.5.0 shared.js:801).
  callTrackerRefreshMs: 30000,
  // The realm's player list, which the status report and Warcry's unseen players read, is read
  // this often (v1.5.0 shared.js:890).
  callPlayersEveryMs: 10000,
  // The native client's tracker window stays shut this long after an automatic reply (the
  // earlier console shared.js:767), and shows for this long after the player's own request (:746).
  callTrackerQuietMs: 60000,
  callTrackerManualMs: 15000,
};
