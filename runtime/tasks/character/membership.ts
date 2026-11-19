// The game party on the character, where groups come from Follow and the leader.
// The groups and tasks owner's one character-side
// module: the game party follows the console's leader and Follow settings, so this is where the
// party invites, requests and leaves go out (a game call goes out only
// from its owner's module). The character runtime installs it with `installPartyMembership`
// before characters/shared.js runs, as movement installs `installPartyMovement`.
import type { CallAnswer, CallQuestion } from '../../hooks/registry.ts';
import { scope } from '../../lifecycle/api.ts';

interface PartyGame {
  accept_party_invite(name: string): Promise<unknown>;
  accept_party_request(name: string): Promise<unknown>;
  leave_party(): Promise<unknown>;
  send_party_invite(name: string): Promise<unknown>;
  send_party_request(name: string): Promise<unknown>;
}
interface GameSocket { on?(event: string, listener: () => void): unknown }
export interface MembershipPorts {
  name(): string;
  // The game's current party, leader first.
  partyList(): string[];
  // The game's socket (`parent.socket`): a new one is a reconnect or a realm change.
  socket(): GameSocket | null;
  log(message: string): void;
}
// The game answers a redundant action with one of these; none of them is a failure.
const SETTLED = new Set(["already_in_party", "already_invited", "pending", "not_found"]);
// Each party call asks the call budget's job band first and goes in the same turn on `send`
//, through the realm's hook registry, which
// movement's install creates before shared.js installs this module.
type Calls = { calls: { band(question: CallQuestion): CallAnswer } };
const registry = (): Calls => (globalThis as unknown as { __partyHooks: Calls }).__partyHooks;
const party = (event: string, name?: string): CallQuestion => ({ band: 'job', method: 'party', data: { event, name } });
const reason = (error: unknown) => String((error as { reason?: string; message?: string })?.reason || (error as { message?: string })?.message || error || "failed");

// The game keeps every
// invitation and request until it is accepted (game node/server.js:12431, :12451), so neither side
// repeats on a timer. The asking side acts once per change of the pair, the game's party list and
// the console's wanted party, and a failed reply waits for the next change. An accept the call
// budget holds back stays pending here and is asked again on the next pass, while the game party
// still differs and the console still wants that pair. A pass runs on the game's `party_update`
// and on each status reply. A new socket (a reconnect, a realm change) counts as no last action,
// as a reload does, so each side acts once more.
interface Point { map: string; x: number; y: number }
export function installPartyMembership(ports: MembershipPorts) {
  // The reply's party fields for this character: the console's leader, whether it follows that
  // leader (and whether it did before this reply), the party the leader keeps, the leader's last
  // place and, under Follows me, the character on Manual the party follows in place of its leader.
  let partyLeader: string | null = null, follows = false, followedBefore = false, members: string[] = [];
  let leaderLocation: Point | null = null, followMe: { name: string; location: Point } | null = null;
  const game = globalThis as unknown as PartyGame;
  let busy = false, acted: string | null = null, actedOn: GameSocket | null = null;
  let pending: { kind: 'accept' | 'raccept'; name: string } | null = null;
  // The pair each side's last party call answered or started, so a pair gets one path into the
  // party. The leader's invite and the follower's request cross whenever both sides see the same
  // party_update, and the game keeps both until one is accepted. The accept that comes second
  // finds nothing to accept: the server charges it nothing, but the call budget's ledger books it
  // at the price of an accept. The follower's accept of an invite always goes. The leader skips
  // a request's accept for a pair it invited, and invites no pair it already accepted.
  let invited: string | null = null, accepted: string | null = null, joined: string | null = null;
  const wanted = (kind: 'accept' | 'raccept', name: string) => kind === 'accept'
    ? follows && name === partyLeader && ports.partyList()[0] !== name
    : partyLeader === ports.name() && members.includes(name) && !ports.partyList().includes(name);
  function accept(kind: 'accept' | 'raccept', name: string): void {
    const here = pair(ports.partyList());
    if (!wanted(kind, name) || (kind === 'raccept' && invited === here)) { if (pending?.kind === kind && pending.name === name) pending = null; return; }
    if (registry().calls.band(party(kind, name)) !== 'send') { pending = { kind, name }; return; }
    pending = null;
    if (kind === 'raccept') accepted = here; else joined = here;
    (kind === 'accept' ? game.accept_party_invite(name) : game.accept_party_request(name)).catch((error: unknown) => {
      const why = reason(error);
      if (why !== "already_in_party" && why !== "not_found") ports.log((kind === 'accept' ? "Party invite failed: " : "Party request failed: ") + why);
    });
  }
  // The pair the last action was taken against: the game's party list and the wanted membership.
  const pair = (list: string[]) => JSON.stringify([list, partyLeader, follows, members]);
  // The asking side: the leader leaves a party it does not lead and invites each missing member; a
  // follower leaves a party its leader does not lead and requests to join; a character that
  // follows no one leaves. The game's own replies settle the rest.
  async function reconcile(): Promise<void> {
    const leader = partyLeader, me = ports.name(), socket = ports.socket();
    // A new socket drops the pending accept with the invitation it answered.
    if (socket !== actedOn) pending = null;
    if (pending) accept(pending.kind, pending.name);
    if (busy || !leader) return;
    // The `party_update` wake reconciles, which decides and calls, so it is the groups and tasks owner's `act` registration.
    // The game's invite and request hooks are window functions the
    // scope cannot register; their accepts ask the band, whose held row answers `not-now`.
    if (socket !== actedOn) { acted = invited = accepted = joined = null; actedOn = socket; scope('01', 'act').on(socket as never, 'party_update', () => { void reconcile(); }); }
    busy = true;
    let attempted = "read party list", now: string | null = null;
    const hooks = registry();
    // A call goes only on `send`; `not-now` leaves the pair unacted, so the next pass asks again.
    const send = (event: string, name?: string) => { if (hooks.calls.band(party(event, name)) !== 'send') return false; acted = now; return true; };
    try {
      // The pass reads the game's party list once, inside the try, so a failed read reaches the
      // "Party sync failed" line below.
      const current = ports.partyList(), currentLeader = current[0] || null;
      now = pair(current);
      if (now === acted) return;
      attempted = "none";
      if (leader === me) {
        if (current.length && currentLeader !== me) {
          attempted = "leader leaving party led by " + currentLeader;
          if (send('leave')) await game.leave_party();
          return;
        }
        const missing = members.find((name) => name !== me && !current.includes(name));
        if (!missing) { acted = now; return; }
        if (accepted === now) { acted = now; return; }
        attempted = "leader inviting missing member " + missing;
        if (send('invite', missing)) { invited = now; await game.send_party_invite(missing); }
        return;
      }
      if (!follows) {
        if (!current.length) { acted = now; return; }
        attempted = "non-follower leaving current party";
        if (send('leave')) await game.leave_party();
        return;
      }
      if (currentLeader === leader) { acted = now; return; }
      if (current.length) {
        attempted = "follower leaving party led by " + currentLeader + " before joining " + leader;
        if (send('leave')) await game.leave_party();
      } else {
        if (joined === now) { acted = now; return; }
        attempted = "follower requesting to join " + leader;
        if (send('request', leader)) await game.send_party_request(leader);
      }
    } catch (error) {
      const why = reason(error);
      if (now === null) { ports.log("Party sync failed: " + why + "; action=" + attempted); return; }
      const after = ports.partyList(), afterLeader = after[0] || null;
      const satisfied = leader === me
        ? afterLeader === me && members.every((name) => name === me || after.includes(name))
        : follows && afterLeader === leader;
      if (!satisfied && !SETTLED.has(why))
        ports.log("Party sync failed: " + why + "; action=" + attempted + "; current=[" + after.join(",") + "]; expectedLeader=" + leader +
          "; followLeader=" + follows);
    } finally {
      busy = false;
    }
  }
  return { acceptInvite: (name: string) => accept('accept', name), acceptRequest: (name: string) => accept('raccept', name), reconcile,
    /** Table A's `leader` row. */
    leaderReply(state: { leader?: string | null; followLeader?: unknown; desiredPartyMembers?: unknown }): void {
      partyLeader = state.leader || null;
      followedBefore = follows;
      follows = !!state.followLeader;
      members = Array.isArray(state.desiredPartyMembers) ? state.desiredPartyMembers.slice() : [];
    },
    /** Table A's `follow-me` row. */
    followMeReply(state: { leaderLocation?: Point | null; followMe?: { name: string; location: Point } | null }): void {
      leaderLocation = state.leaderLocation || null;
      followMe = state.followMe || null;
    },
    leader: () => partyLeader, followLeader: () => follows, members: (): readonly string[] => members,
    leaderLocation: () => leaderLocation, followMe: () => followMe,
    // This reply turned Follow off.
    followEnded: () => followedBefore && !follows,
    // Where a following character meets its leader: the leader's last place, while it follows a
    // leader other than itself.
    followedLeaderSpot: (): Point | null => follows && partyLeader && partyLeader !== ports.name() && leaderLocation
      ? { map: leaderLocation.map, x: leaderLocation.x, y: leaderLocation.y } : null };
}

// The game's party, leader first: the game's list, else its cached party.
type PartyGlobals = { parent?: { party_list?: unknown }; get_party?: () => Record<string, unknown> | null };
export function currentPartyList(): string[] {
  const g = globalThis as PartyGlobals, list = g.parent?.party_list;
  if (Array.isArray(list)) return list.slice();
  const cached = typeof g.get_party === "function" && g.get_party();
  return cached ? Object.keys(cached) : [];
}

Object.assign(globalThis, { installPartyMembership, currentPartyList });
// The membership door targeting's ports read.
export type PartyMembership = ReturnType<typeof installPartyMembership>;
