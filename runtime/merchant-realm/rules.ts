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
// A realm the console may keep as a home or list on the blacklist: a realm key that is no PVP realm.
// The party switch refuses a PVP home, and the refusals already cover a PVP want.
function homeableRealm(realm: unknown): realm is string {
  return typeof realm === 'string' && /^SR_[A-Z]+[A-Z0-9]*$/.test(realm) && !/PVP$/.test(realm);
}
// The home realm setting (user, 2026-11-09: "other people have different home realms"): the realm
// the console treats as the party's home, or null to follow the account.
export function validHomeRealm(value: unknown): value is string | null {
  return value === null || homeableRealm(value);
}
// The console's home realm, the one home every reader takes: your setting, else the one home every
// account character shares in the game, else none, and the caller reads its own next fact. The
// settings owner checked the setting on its write (`validHomeRealm`).
export function consoleHomeRealm(setting: string | null, accountHome: string | null): string | null {
  return setting ?? accountHome;
}
// The first realm the account lists that is no PVP realm: the game's own list, the console's last
// answer for a realm when nothing else names one.
export function firstAccountRealm(account: { response?: { servers?: { key?: unknown }[] } }): string | null {
  return (account.response?.servers ?? []).map(server => server.key).find(homeableRealm) ?? null;
}
// The blacklist's own check: realms `homeableRealm` takes, with no duplicates.
export function validRealmBlacklist(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(homeableRealm) && new Set(value).size === value.length;
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

// A move is in flight from its request until its arrival, while the merchant is online (a Steam
// member or a headless slot). An offline merchant makes no move: its request stays saved, and its
// next login starts on the realm the move wrote to its block and finishes it. A job's listing hop
// holds only inside v1.5.0's 60 s window, the time v1.5.0's home return gave a job's realm request
// before it took the merchant home (home-recovery.ts:122).
export function moveInFlight(request: RealmRequest | undefined, online: boolean,
  status: { server?: string; seenAt?: number } | undefined, now: number): boolean {
  if (!request || request.exhausted || !online) return false;
  if (realmRequestArrived(status, request, now)) return false;
  return !jobWant(request.owner) || now - request.requestedAt < ARRIVAL_WINDOW_MS;
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
