// The merchant realm owner's rules: which want for the merchant's realm wins, which realm a want
// may not go to, and when a move has arrived. The coordinator half (coordinator/owner.ts) applies
// them; both runtimes may read this file.
import { fresh } from '../protocol/reports.ts';
import { normalizedRealm } from '../protocol/realm.ts';

// The wants, highest first. A want is named by its owner: the party realm switch
// (`party-switch:<id>`, its leg and its set-home visit `party-switch:<id>:home`), your hold
// (`user:force-stand`), the current job's listing or party visit (`job:<id>`), the items owner's realm stay
// after a market job (`items:stay`) and home. With no other want the merchant wants
// home; a lower want waits until the higher one is released. A job's want is `job:<id>`; the
// earlier console saved its realm request's owner as `job`.
export function jobWant(owner: string): boolean {
  return owner === 'job' || owner.startsWith('job:');
}
const WANT_RANKS: readonly { rank: number; owner: (name: string) => boolean }[] = [
  { rank: 5, owner: name => name.startsWith('party-switch:') },
  { rank: 4, owner: name => name === 'user:force-stand' },
  { rank: 3, owner: jobWant },
  { rank: 2, owner: name => name === 'items:stay' },
  { rank: 1, owner: name => name === 'home' },
];
export function wantRank(owner: string): number {
  return WANT_RANKS.find(row => row.owner(owner))?.rank ?? 0;
}

// The answer a want gets: the merchant is on the realm, a move is on its way, the want is refused,
// or an order you give for a blacklisted realm waits for your confirmation.
export type RealmAnswer = 'here' | 'moving' | `refused:${'pvp' | 'blacklisted' | 'no-merchant' | 'unknown'}` | 'confirm:blacklisted';
export interface WantOptions {
  // An order you give (a manual job, a party switch, set home, force stand); every other want is
  // automatic.
  manual?: boolean;
  // Your confirmation of a blacklisted realm, bound to this one order.
  confirm?: boolean;
  // The asker saw no progress and asks again: an in-flight move of the same want starts its next
  // attempt in place of answering `moving`.
  again?: boolean;
  // The asker's reply to the merchant: a headless move's stop waits until it is sent.
  acknowledged?(stop: () => void): void;
}

// The refusals. A realm ending in `PVP` is refused for every want, an order you give included,
// with no override (v1.5.0's every listing source and route). A realm on your
// blacklist is refused for an automatic want and asks your confirmation for an order you give; the
// home want is never refused by the blacklist, so the merchant can always get home.
export function realmRefusal(owner: string, realm: string, blacklist: readonly string[], options: WantOptions = {}): RealmAnswer | null {
  if (/PVP$/.test(realm)) return 'refused:pvp';
  if (owner === 'home' || !blacklist.includes(realm)) return null;
  if (!options.manual) return 'refused:blacklisted';
  return options.confirm ? null : 'confirm:blacklisted';
}
// The blacklist's own check: realm keys, no duplicates, and no PVP realm, which the refusals already cover.
export function validRealmBlacklist(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(realm => typeof realm === 'string' && /^SR_[A-Z]+[A-Z0-9]*$/.test(realm) && !/PVP$/.test(realm)) &&
    new Set(value).size === value.length;
}

// Arrival and attempts. An attempt's arrival window is v1.5.0's 60 s (and:122,
// party-realm.ts:98-101, realm-switch.ts:100-119); a missed window is one failure on the merchant
// group's `realm-hold` ladder. A headless move stops its worker on an event, not a delay: the
// merchant's own route stops it once its reply is sent, so the reply leaves first (the order the
// earlier console's 150 ms kept, merchant-realms.ts:66, 87), and every other move stops it as soon
// as `block.realm` is written, which the worker manager reads when it starts the worker again.
export const ARRIVAL_WINDOW_MS = 60_000;

// The party realm switch's bounds against a login or a game answer that never comes, each the
// earlier console's value (168:257; http/realms.ts:137). No screen shows them, so they are named
// picks of this table (decisions.md). Each firing ends the operation and reports through the
// status owner's boundFired under its name.
export const REALM_LOGIN_MS = 60_000;
export const REALM_HOME_CONFIRM_MS = 120_000;
export const REALM_HOME_REPLY_MS = 30_000;

// A durable move in flight, saved as the merchant's realm request.
export interface RealmRequest {
  realm: string;
  // The want that asked the move: `home`, `job:<id>` (`job` in a save), `user:force-stand` or
  // `party-switch:<id>`.
  owner: string;
  requestedAt: number;
  attempts: number;
  // Written only by versions before the home want's next attempt clears it.
  exhausted?: boolean;
  // The attempt the realm hold's task ladder already counted as failed.
  climbedAt?: number;
}

// The realm id rule is the protocol's (protocol/realm.ts); the call budget's readers take it
// through this door.
export { normalizedRealm };
// A move has arrived when a report newer than the request, under 3 s old (the `report` reading),
// is on the want's realm (realm-request.ts:10-13).
export function realmRequestArrived(status: { server?: string; seenAt?: number } | undefined, request: RealmRequest, now: number): boolean {
  return Number(status?.seenAt) > request.requestedAt && fresh(status?.seenAt, now) &&
    normalizedRealm(status?.server) === request.realm;
}
