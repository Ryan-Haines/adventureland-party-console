// The call budget's limits: the game server's window and call limit, the costs the bands are sized
// from, and the band limits. The file imports nothing, so the dashboard can read the limit and where
// a job call starts to wait. The server's window and limit (server_functions.js:5481-5483;
// server.js:262).
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
// The band limits (3.4) come from the cost table. A potion use costs 4 (3.2), and the 2000 ms
// potion cooldown (server.js:7816) lets three into one window, so the survival room never falls
// below 12. The largest job call of this layer is the bank floor with its door, 40; a later
// owner whose job call costs more raises it. The largest background call is the tracker's 50
// (server.js:258).
export const ROOM_FLOOR = 3 * 4;
export const JOB_MAX = BANK_FLOOR + DOOR;
export const BACKGROUND_MAX = 50;

export interface BandLimits { room: number; survival: number; job: number; background: number }
// The room and the three limits (3.4): the room follows the survival band's own peak per
// window, from the potion floor up to what leaves the largest job call and one tracker read.
export function bandLimits(peak: number): BandLimits {
  const room = Math.min(Math.max(ROOM_FLOOR, peak), CALL_LIMIT - JOB_MAX - BACKGROUND_MAX);
  return { room, survival: CALL_LIMIT, job: CALL_LIMIT - room, background: CALL_LIMIT - room - JOB_MAX };
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
