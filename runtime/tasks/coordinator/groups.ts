// The groups:
// Follow and the leader make them. The leader's party is one
// group with its followers, each combat character that follows no one is a solo group, and the
// merchant is its own. A Follow or leader change moves members between groups in the request that
// saved it (1.4, install.ts `settings.changed`). This file holds the one group list, each group's
// farming scope, the membership move and the members a Hunt takes in. The Hunt's own roster repair
// is the hunting owner's (runtime/hunting/coordinator/hunt.ts `reconcileCurrentHuntParty`).
import { restoredConvoy, type NavigationIntent } from "../../movement/api/coordinator.ts";
import type { HuntCycle } from "../../hunting/api.ts";
import { huntOwnerLeft, writeHunt, writeSpot } from "../../hunting/coordinator/api.ts";
import type { ReturnLocation } from "../../events/api.ts";
import type { GroupSpec } from './owner.ts';
import { fresh } from '../../protocol/reports.ts';
import { scopeOwner } from '../rules.ts';
import { writeSlot } from '../../status/api.ts';

export interface GroupPorts {
  leader(): string | null;
  merchant(): string | null;
  // The members of a scope led by `name`: the leader first, then its followers.
  members(name: string): string[];
  // The character whose scope `name` farms in: its leader while it follows, else itself.
  owner(name: string): string;
  activeNames(): string[];
  isCombat(name: string): boolean;
}
// A group's id is its kind and its leader; a group with no leader has none.
export function groupId(kind: 'party' | 'solo', leader: string | null | undefined): string | null {
  return leader ? `${kind}:${leader}` : null;
}
// The leader a group id names (`groupId`'s inverse).
export function leaderOf(id: string): string { return id.slice(id.indexOf(':') + 1); }
// A group of one reads only its own report: its leader, while active.
export function activeOf(leader: string | null | undefined, active: readonly string[]): string[] { return active.filter(name => name === leader); }
// The key a walk and its notices carry for a group: the party with no leader is `party:`.
export function groupKey(id: string | null): string { return id ?? 'party:'; }
export function groupSpecs(ports: GroupPorts): GroupSpec[] {
  const leader = ports.leader(), merchant = ports.merchant(), specs: GroupSpec[] = [];
  if (leader) specs.push({ id: groupId('party', leader)!, kind: 'party', members: ports.members(leader) });
  for (const name of ports.activeNames()) if (ports.isCombat(name) && ports.owner(name) === name && name !== leader)
    specs.push({ id: groupId('solo', name)!, kind: 'solo', members: [name] });
  if (merchant) specs.push({ id: `merchant:${merchant}`, kind: 'merchant', members: [merchant] });
  return specs;
}

// The combat groups the coordinator composes: the party's group, and
// a solo group for each combat character that farms in its own scope, composed on first use and kept.
// The coordinator's one composition builds each group's services (application.ts
// `composeCombatGroup`); this decides which groups there are and whose scope a member reads.
export interface CombatScope { leader: string | null }
export interface CombatGroupsPorts<S extends CombatScope, G extends { state: S }, Solo extends { state: S; scopePorts: P }, P> {
  party: S & { merchantCharacter: string | null; statuses: Record<string, { ctype?: string } | undefined> };
  owned(name: string): { type?: string } | null | undefined;
  // The scope `name` farms in (`createFarmingScopes` `owner`), and the members of a scope.
  owner(name: string): string;
  members(name: string): string[];
  activeNames(): string[];
  // The party's composed group, and a solo group's composition for `name`.
  partyGroup(): G;
  compose(name: string): Solo;
  // The target mode ports of the party's own scope.
  leaderScopePorts(): P;
}
export function createCombatGroups<S extends CombatScope, G extends { state: S }, Solo extends { state: S; scopePorts: P }, P>(ports: CombatGroupsPorts<S, G, Solo, P>) {
  const party = ports.party, solos = new Map<string, Solo>();
  // The merchant is never a combat character, by the console's setting, its report or its account.
  const isCombat = (name: string) => name !== party.merchantCharacter && party.statuses[name]?.ctype !== 'merchant' && ports.owned(name)?.type !== 'merchant';
  function solo(name: string) {
    if (!isCombat(name) || ports.owner(name) === party.leader) return null;
    let group = solos.get(name);
    if (!group) { group = ports.compose(name); solos.set(name, group); }
    return group;
  }
  // A member's records live in its own scope: a solo character's trips and return in its profile.
  const scopeOf = (name: string): S => solo(name)?.state ?? party;
  // The one group list: the task owner's groups and the combat groups whose services act.
  const list = () => groupSpecs({ leader: () => party.leader, merchant: () => party.merchantCharacter, members: ports.members,
    owner: ports.owner, activeNames: ports.activeNames, isCombat });
  // One entry per combat group, the party first. The party's entry stays without a leader, with no
  // group id, so its walks still step.
  const combat = () => [{ ...ports.partyGroup(), id: groupId('party', party.leader) },
    ...list().filter(g => g.kind === 'solo').map(g => ({ ...solo(g.members[0]!)!, id: g.id as string | null }))];
  // The party's event services and heartbeat serve the members of the leader's scope and the
  // merchant (b9b5c91e application.ts:291, :569).
  const partyScoped = () => ports.activeNames().filter(name => name === party.merchantCharacter || ports.owner(name) === party.leader);
  const scopePortsOf = (state: S): P => state === party ? ports.leaderScopePorts() : solo(String(state.leader))?.scopePorts ?? ports.leaderScopePorts();
  // The group whose walk a walk key names (movement's `walks.end` and notices): the party under its
  // current leader, or a solo scope's group, composed on first use, which keeps its walk after its
  // member follows a leader until the walk ends.
  function walkGroup(key: string) {
    if (key.startsWith('solo:')) { const name = key.slice('solo:'.length); return solos.get(name) ?? solo(name) ?? undefined; }
    return key === groupKey(groupId('party', party.leader)) ? ports.partyGroup() : undefined;
  }
  return { isCombat, solo, scopeOf, list, combat, scopePortsOf, walkGroup, partyScoped };
}

// Each group's farming scope (1.2 "Saved state").

/** Durable personal preferences and controller state. Never copy these when Follow changes. */
export type FarmingProfiles = Record<string, Record<string, unknown>>;
interface ScopeState {
  leader: string | null;
  followers: Record<string, boolean>;
  merchantCharacter: string | null;
  farmingProfiles: FarmingProfiles;
  monsterFocusByCharacter?: Record<string, string[] | undefined>;
  characterLocations?: Record<string, unknown>;
  escape?: { participants: string[] } | null;
  townCycle?: { pending: string[] } | null;
  anniversary?: { eventCycle?: { participants?: string[] } | null };
}

/** Stable views share observations/IDs, but have independent controller storage. No global-state swapping. */
// The settings owner's lists of the fields a farming scope keeps
// (runtime/settings/lists.ts `settingsLists`), which the coordinator passes from its table.
export interface ScopeLists {
  scopedFields: string[];
  scopeDefaults(): Record<string, unknown>;
  derivedFields: { field: string; derive(scope: Record<string, unknown>): unknown }[];
}
export function createFarmingScopes<T extends ScopeState>(root: T, lists: ScopeLists, now: () => number = Date.now) {
  // Each farming scope keeps its own copy of every field declared `scope: 'scope'`, and a new or
  // incomplete profile takes their declared defaults.
  const { scopedFields: fields, scopeDefaults: defaults, derivedFields } = lists, scopedFields = new Set<string>(fields);
  // Each scope computes a derived record from its own fields (the v1.4.0 `farmingPolicy` copy),
  // so a save always carries the value its fields give. The getter
  // reads `this`, so a profile copied with its property descriptors derives from the copy. The
  // copies the save held before are kept for the start's migration (`loaded`).
  const loaded = new Map<Record<string, unknown>, Record<string, unknown>>();
  function derives<P extends Record<string, unknown>>(scope: P, saved?: Record<string, unknown>): P {
    if (saved) loaded.set(scope, Object.fromEntries(derivedFields.map(({ field }) => [field, saved[field]])));
    for (const { field, derive } of derivedFields)
      Object.defineProperty(scope, field, { enumerable: true, configurable: true, get(this: Record<string, unknown>) { return derive(this); } });
    return scope;
  }
  const legacy = Object.fromEntries(fields.filter(key => Reflect.get(root, key) !== undefined).map(key => [key, Reflect.get(root, key)]));
  const orphan = derives({ ...defaults(), ...legacy }, legacy);
  const views = new Map<string, T>();
  const existing = Object.keys(root.farmingProfiles);
  for (const name of existing) {
    const saved = root.farmingProfiles[name]!;
    root.farmingProfiles[name] = derives({ ...defaults(), ...saved,
      activeConvoy: restoredConvoy(saved, now), groupedCombat: null }, saved);
  }
  function profile(name: string): Record<string, unknown> {
    return root.farmingProfiles[name] ||= derives({ ...defaults(),
      monsterFocus: [...(root.monsterFocusByCharacter?.[name] || [])],
      location: root.characterLocations?.[name] || null });
  }
  if (root.leader && !existing.includes(root.leader)) root.farmingProfiles[root.leader] = orphan;
  function main() { return root.leader ? profile(root.leader) : orphan; }
  for (const key of fields) Object.defineProperty(root, key, {
    enumerable: true, configurable: true,
    get: () => main()[key], set: value => { main()[key] = value; },
  });
  const owner = (name: string): string => scopeOwner(root, name);
  function members(name: string): string[] {
    return name === root.leader
      ? [name, ...Object.keys(root.followers).filter(n => n !== name && n !== root.merchantCharacter && root.followers[n])]
      : [name];
  }
  function soloField(name: string, key: string | symbol, anniversary: Record<string, unknown>): unknown {
    if (key === "anniversary") return anniversary;
    if (key === "escape") return root.escape?.participants.includes(name) ? root.escape : null;
    if (key === "townCycle") return root.townCycle?.pending.includes(name) ? root.townCycle : null;
    return Reflect.get(root, key);
  }
  function view(name: string): T {
    if (views.has(name)) return views.get(name)!;
    profile(name);
    const anniversary = Object.create(root.anniversary || {}) as Record<string, unknown>;
    Object.defineProperty(anniversary, "eventCycle", {
      get: () => root.anniversary?.eventCycle?.participants?.includes(name) ? root.anniversary.eventCycle : null,
    });
    const state = new Proxy(root, {
      get(target, key) {
        if (key === "leader") return name;
        if (key === "followers") return name === root.leader ? root.followers : {};
        if (typeof key === "string" && scopedFields.has(key)) return profile(name)[key];
        return name === root.leader ? Reflect.get(target, key) : soloField(name, key, anniversary);
      },
      set(target, key, value) {
        if (typeof key === "string" && scopedFields.has(key)) { profile(name)[key] = value; return true; }
        return Reflect.set(target, key, value);
      },
    });
    views.set(name, state);
    return state;
  }
  // Every farming scope with the copy of `field` its save held at start: each profile by its
  // character, and the orphan, which has none, while there is no leader.
  function savedCopies(field: string): { character?: string; scope: Record<string, unknown>; saved: unknown }[] {
    const scopes: { character?: string; scope: Record<string, unknown> }[] = Object.entries(root.farmingProfiles).map(([character, scope]) => ({ character, scope }));
    if (!root.leader) scopes.push({ scope: orphan });
    return scopes.map(entry => ({ ...entry, saved: loaded.get(entry.scope)?.[field] }));
  }
  return { owner, members, profile, view, effective: (name: string) => view(owner(name)), savedCopies };
}

// The membership move (1.4).
interface MembershipState {
  leader: string | null; merchantCharacter: string | null; followers: Record<string, boolean>;
  farmingProfiles: Record<string, unknown>;
  statuses: Record<string, {map: string; x: number; y: number; seenAt: number} | undefined>;
  commands: Record<string, {id?: number; type: string; purpose?: string | null; convoyId?: string} | undefined>;
  navigationIntents: Record<string, NavigationIntent | undefined>;
  characterLocations: Record<string, ReturnLocation | undefined>;
  combatResetByCharacter: Record<string, number | undefined>; groupedCombatResetAt: number;
  groupedCombat?: unknown;
  activeConvoy: {id: string; participants: string[]; leader?: string | null; expected?: Record<string, unknown>} | null;
  monsterHunt: HuntCycle | null; combatRecovery: unknown;
  location: ReturnLocation | null; nextCommandId: number;
}
// A member left the Hunt that its quest or hand-in was for: the hunting owner's huntOwnerLeft starts
// the quest choice again, and a Follow change also drops the leaver's loot.
function removeHuntMember(hunt: HuntCycle, name: string): void {
  hunt.participants = hunt.participants.filter(member => member !== name);
  if (hunt.owner !== name && hunt.turnIn?.owner !== name) return;
  huntOwnerLeft(hunt);
  delete hunt.loot;
  hunt.stage = "checking-quests";
}
// A Follow
// or leader change applies at once, and the walk goes on for the members that did not change, so
// only the leaver's share of it ends. The walk ends when its leader leaves or no member remains.
// It keeps personal preferences and revokes only the departing controller's work.
// A departing member leaves the walk through movement's `walks.end`, which names the group's walk
// key and the member, and the member's new group walks from the new groups. The walk lives in the previous
// owner's scope, which is the party's when that owner leads now and its own solo scope otherwise.
export function reconcileFarmingMembership<T extends MembershipState>(party: T, farmingScopes: { owner(name: string): string; view(name: string): T }, previous: { leader: string | null; followers: Record<string, boolean> },
  endWalk: (key: string, member: string) => void, now = Date.now) {
    const names = [...new Set([...Object.keys(party.statuses), ...Object.keys(party.farmingProfiles), ...Object.keys(previous.followers)])];
    const oldOwner = (name: string) => previous.leader && previous.followers[name] ? previous.leader : name;
    const changed = names.filter(name => name !== party.merchantCharacter && oldOwner(name) !== farmingScopes.owner(name));
    if (previous.leader !== party.leader) {
      for (const name of [previous.leader, party.leader]) if (name && !changed.includes(name)) changed.push(name);
    }
    for (const name of changed) retireFarmingMembership(name, oldOwner(name));
    for (const name of changed) joinFarmingMembership(name);
    function retireFarmingMembership(name: string, previousOwner: string) {
      const state = farmingScopes.view(previousOwner), hunt = state.monsterHunt;
      if (state.activeConvoy?.participants.includes(name))
        endWalk(groupKey(groupId(previousOwner === party.leader ? 'party' : 'solo', previousOwner)), name);
      if (["monster-hunt", "farming-follow"].includes(state.commands[name]?.purpose || "")) delete state.commands[name];
      party.navigationIntents[name] = { revision: (party.navigationIntents[name]?.revision || 0) + 1, cancelled: false };
      delete party.characterLocations[name];
      party.combatResetByCharacter[name] = now();
      state.groupedCombatResetAt = now();
      if (name === previousOwner) {
        if (hunt?.returnLocation) writeSpot<MembershipState, { location: ReturnLocation }>(state, { location: hunt.returnLocation });
        writeHunt<MembershipState, { monsterHunt: null }>(state, { monsterHunt: null });
        state.combatRecovery = null;
      } else if (hunt) removeHuntMember(hunt, name);
    }
    function joinFarmingMembership(name: string) {
      const owner = farmingScopes.owner(name), state = farmingScopes.view(owner);
      // A joining client already discarded queues older than its personal reset.
      // Carry that boundary into its new controller, preserving stale rejection.
      const previousReset = state.groupedCombatResetAt || 0;
      const resetAt = Math.max(previousReset, party.combatResetByCharacter[name] || 0);
      if (resetAt > previousReset) state.groupedCombat = null;
      state.groupedCombatResetAt = resetAt;
      if (owner === name) return;
      const hunt = state.monsterHunt;
      if (hunt && !hunt.participants.includes(name)) hunt.participants.push(name);
      const leader = party.statuses[owner];
      if (!leader || !fresh(leader.seenAt, now(), 'presence') || party.commands[name]) return;
      // return-leader resolves the live rendezvous in the character client.
      // Following shares the controller's saved farm; a temporary event position
      // must not become a personal event-return checkpoint.
      writeSlot(party.commands, name, { id: party.nextCommandId++, type: "return-leader", purpose: "farming-follow" });
    }
}

// The Hunt roster: the combat members on the leader's realm, the leader first.
interface HuntMember {
  seenAt: number;
  ctype?: string;
  server?: string;
}
interface PartyMembers {
  leader: string | null;
  statuses: Record<string, HuntMember | undefined>;
  followers: Record<string, unknown>;
}
function memberOrder(leader: string | null, first: string, second: string): number {
  if (first === leader) return -1;
  return second === leader ? 1 : first.localeCompare(second);
}

/** Only a fresh combat leader can gather followers on its current realm. */
export function coordinatorHuntParticipants(
  state: PartyMembers,
  now: () => number,
  activeNames: () => string[],
): string[] {
  const leader = state.leader && state.statuses[state.leader];
  if (!leader || !fresh(leader.seenAt, now(), 'presence') || leader.ctype === "merchant") return [];
  return activeNames()
    .filter((name) => {
      const status = state.statuses[name];
      return (
        status &&
        status.ctype !== "merchant" &&
        status.server === leader.server &&
        (name === state.leader || state.followers[name])
      );
    })
    .sort((first, second) => memberOrder(state.leader, first, second));
}

