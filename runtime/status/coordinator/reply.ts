// The heartbeat reply (TABLE_R): one section per owner, each that owner's
// published reply read for the character, assembled in TABLE_R's order. Moved from
// runtime/coordinator/status/response.ts, response-party.ts, response-composition.ts and
// telemetry/transport-timing.ts, and from application.ts's `response` port.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createPassingStatus } from '../../coordinator/targeting/api.ts';
import { createEventReply } from '../../events/coordinator/api.ts';
import { jobCommandRetained } from '../../merchant-jobs/api.ts';
import { merchantHeartbeat } from '../../merchant-jobs/coordinator/api.ts';
import { leaderReply, partyReply } from '../../tasks/coordinator/api.ts';
import { merchantRealmErrors } from '../../merchant-realm/api.ts';
import { farmingReply } from '../../hunting/coordinator/api.ts';
import { restoreTownCommand, retireTownCommand, travelCombatFor, type heartbeatMovement, type HeartbeatMovementPorts, type TravelState } from '../../movement/api/coordinator.ts';
import { partyHooks } from '../../hooks/index.ts';
import { addonReplySections } from '../../hooks/reply-sections.ts';
import { escapeReply, recoveryReply } from '../../coordinator/survival/api.ts';
import type { Diagnostics } from './diagnostics.ts';
import { coordinatorSettings, type DeliveredField } from '../../settings/coordinator/api.ts';
import { CATALOG_VERSIONS, TABLE_R, navigational, retained, type ReplySectionName } from '../rules.ts';
import type { CardLine, HeartbeatResponsePorts, HeartbeatState } from '../api.ts';
import type { Registration } from '../../hooks/registry.ts';

type Section = Record<string, unknown>;
type Sections = Partial<Record<ReplySectionName, (name: string) => Section>>;

// The catalogs the character sends while the coordinator lacks one (the status owner's
// `needsCatalog`).
const requiredCatalogs = ['travelPlaces', 'monsterChoices', 'monsterHunterLocation', 'bestiaryCatalog', 'skillCatalog', 'appearanceChoices', 'merchantCatalog'] as const;
export function needsCatalog(state: HeartbeatState): boolean {
  return state.monsterLocationsVersion !== CATALOG_VERSIONS.monsterLocations || requiredCatalogs.some((field) => !state[field]) ||
    state.merchantCatalogVersion !== CATALOG_VERSIONS.merchant;
}

type GroupPorts<State extends HeartbeatState> = Omit<HeartbeatResponsePorts, keyof ReturnType<typeof heartbeatMovement>> & HeartbeatMovementPorts<State>;

/** One group's reply sections: each owner's read for the character, and the command slot (table C). */
export function createHeartbeatReply<State extends HeartbeatState>(state: State, groupPorts: GroupPorts<State>) {
  // Table R: movement's sections are movement's published `movement.reply`.
  const movement = partyHooks().answerOf('movement.reply')(state, groupPorts);
  const ports: HeartbeatResponsePorts = { ...groupPorts, ...movement };
  // Survival's `survival.escaping` says whether the escape owns the
  // character.
  const escapeOwns = (name: string) => !!partyHooks().survival.escaping(name);
  const events = createEventReply(state, ports);
  // The passing parts are targeting's (table R).
  const { passingReports, passingAdmission } = createPassingStatus(state, ports);
  // Table C: the escape that owns the character admits no command outside its recovery walk,
  // a one-shot command leaves the slot on delivery, a retained one stays, and a navigation
  // command carries the revision it was delivered under.
  function command(name: string) {
    retireTownCommand(state, ports, name);
    if (escapeOwns(name) && state.escape?.stage !== 'recovery-convoy') return null;
    restoreTownCommand(state, ports, name);
    const command = state.commands[name] || null;
    if (command && !retained(command, state.statuses[name]?.lastCommandId as number | undefined, jobCommandRetained)) delete state.commands[name];
    if (command && navigational(command) && command.navigationRevision === undefined)
      command.navigationRevision = ports.navigationRevision(name);
    return command;
  }
  const leader = () => (state.leader && state.statuses[state.leader]) || null;
  let delivered: ReturnType<typeof command> = null;
  // The add-on system's sections.
  const addon = addonReplySections(state);
  const sections: Sections = {
    // Each delivered setting carries the value it plays with for this character.
    settings: name => Object.fromEntries(coordinatorSettings().lists.characterFields.map(({ field, reply }) =>
      [reply, partyHooks().overlay(field, state[field as DeliveredField<'characters'>], name)])),
    clock: () => ({ serverNow: ports.now() }),
    'travel-combat': name => ({ travelCombat: travelCombatFor(state as unknown as TravelState, name) }),
    'realm-errors': name => merchantRealmErrors(state, name),
    command: name => ({ command: delivered = command(name) }),
    rare: name => ({ rareControl: ports.rareControl(name) }),
    escape: name => escapeReply(state, escapeOwns(name)),
    'event-trip': name => events.tripReply(name),
    'convoy-signal': name => ({ convoySignal: ports.convoySignal(name) }),
    return: name => ({ partyTownCycleId: ports.partyTownCycleId(), returnProgress: ports.returnProgress(name), ...events.returnReply(name) }),
    movement: name => ports.movementSection(name),
    'map-telemetry': name => ({ mapTelemetry: ports.mapSubscriberCount(name) > 0 }),
    task: name => ({ task: ports.task(name) }),
    diagnostics: name => ({ diagnosticsRings: ports.diagnosticsRings(name) }),
    merchant: name => merchantHeartbeat(state, name),
    // The items owner's reply fields read the command this reply delivers (its
    // lucky slot).
    items: name => ports.items(name, delivered),
    party: () => partyReply(state, ports.activeNames(), leader()),
    'grouped-combat': () => ({ groupedCombat: ports.groupedCombat(), passingEncounters: passingReports(), passingControl: passingAdmission() }),
    'combat-recovery': name => recoveryReply(state, name),
    events: name => events.eventReply(name),
    leader: () => leaderReply(state, leader()),
    catalog: () => ({ needsCatalog: needsCatalog(state) }),
    farming: name => farmingReply(state, name, ports.task(name)?.kind, ports.rareOwns()),
    'addon-stores': name => addon.stores(name),
    'addon-actions': name => addon.actions(name),
    'addon-inbox': name => addon.inbox(name),
  };
  return { sections };
}

interface ReplyPorts {
  // The lifecycle owner's observers of a report (the workers, the CODE generation, the
  // lease) and its table D `reply` row with the lease it serves.
  lifecycle: { observe(name: string): void; allows(): boolean; served(): unknown };
  // The group's reply sections for the character: its solo group's, else its party's (01).
  group(name: string): Sections;
  // The tasks owner's hand and visit fields, the hunting owner's Cave control, the merchant jobs owner's merchant visibility and the status owner's
  // dashboard lease.
  hand(name: string): Section;
  visit(name: string): boolean;
  groupedCombat(): unknown;
  cave(name: string): Section;
  merchantVisibility(name: string): unknown;
  dashboardLease(name: string): unknown;
  now(): number;
}

/** The reply to a report (`mode` absent) or a combat poll: table R's sections for that mode. `read`
 *  only assembles them, so the combat channel compares revisions on it; `send` is the reply a
 *  character gets: the lifecycle owner's observers of that character's report run first, and `status.replied`
 * names the sections it carried. */
export function createReply(ports: ReplyPorts) {
  // The sections this character's reply carries, or none while the lifecycle owner's lease
  // holds every reply.
  function sections(name: string): Sections | null {
    if (!ports.lifecycle.allows()) return null;
    const lease = ports.lifecycle.served();
    const own: Sections = {
      lifecycle: () => ({ consoleMaintenance: lease }),
      hand: member => ports.hand(member),
      visit: member => ports.visit(member) ? { groupedCombat: ports.groupedCombat() } : {},
      cave: member => ports.cave(member),
      'merchant-visibility': member => ({ merchantVisibility: ports.merchantVisibility(member) }),
      'dashboard-lease': member => { const value = ports.dashboardLease(member); return value === undefined ? {} : { dashboardLease: value }; },
    };
    return { ...own, ...ports.group(name) };
  }
  function read(name: string, mode?: 'combat'): Record<string, unknown> {
    const own = sections(name);
    return own ? assemble(own, name, mode) : { serverNow: ports.now(), consoleMaintenance: ports.lifecycle.served() };
  }
  function send(name: string, mode?: 'combat'): Record<string, unknown> {
    ports.lifecycle.observe(name);
    const own = sections(name);
    if (!own) return { serverNow: ports.now(), consoleMaintenance: ports.lifecycle.served() };
    const carried = TABLE_R.filter(row => (mode === 'combat' ? row.combat : row.heartbeat) && own[row.section]).map(row => row.section);
    const out = assemble(own, name, mode);
    partyHooks().notify('status.replied', { character: name, sections: carried, by: 'core:status' });
    return out;
  }
  return { read, send };
}
export type StatusReply = ReturnType<typeof createReply>;
// Table R's sections for one character and mode, in the table's order.
export function assemble(sections: Sections, name: string, mode?: 'combat'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of TABLE_R) {
    if (!(mode === 'combat' ? row.combat : row.heartbeat)) continue;
    const read = sections[row.section];
    if (read) Object.assign(out, read(name));
  }
  return out;
}

// Transport timing: a histogram read on existing requests, with no request loop of its own. Each
// reply reports the event loop's longest delay since the reply before it, so the window is the gap
// the requests themselves leave. The histogram samples at Node's own resolution. The first reply
// starts it, so a bundle that only imports this file (the dashboard page) never calls Node.
let delay: ReturnType<typeof monitorEventLoopDelay> | null = null;
export function transportTiming(receivedAt: number, sentAt: number) {
  if (!delay) { delay = monitorEventLoopDelay(); delay.enable(); }
  const eventLoopMaxMs = Math.round(delay.max / 1e6);
  delay.reset();
  return { receivedAt, sentAt, eventLoopMaxMs, statusStages: { ...stages } };
}
const stages: Record<string, { lastMs: number; maxMs: number; count: number }> = {};
/** Each table I row's last and longest time, with no payload. */
export function measureStatusStage<T>(name: string, run: () => T): T {
  const start = performance.now();
  try { return run(); } finally {
    const ms = Math.round((performance.now() - start) * 10) / 10;
    const old = stages[name];
    stages[name] = { lastMs: ms, maxMs: Math.max(old?.maxMs || 0, ms), count: (old?.count || 0) + 1 };
  }
}

type CommandGroups = { state(group: string): { commands?: Record<string, unknown> } | undefined };
// The reads answered from stored state: the card line table's kept line, the last stored report and the
// one presence rule.
interface StatusReads {
  cardLine(name: string): CardLine | null;
  lastReport(name: string): { report: Record<string, unknown>; seenAt: number } | null;
  connected(name: string): boolean;
}
interface Hooks { register(registration: Registration): { ok: boolean; message?: string }; map(): { registrations: { name: string }[] } }
// The status owner's coordinator notices. When an escape starts, each participant's
// pending command leaves the slot, at the moment survival sends `survival.escapeStarted`. A
// command given during the escape stays, and the slot holds it until the recovery walk. Each ring save
// (`records.saved`) lights the record icon through the diagnostics service.
export function installStatusNotices(hooks: Hooks, groups: CommandGroups, diagnostics: Pick<Diagnostics, 'saved'>, reads: StatusReads): void {
  const result = hooks.register({ name: 'core:status', folder: 'core', author: 'adventureland-party-console',
    summary: "Composes each character's heartbeat reply, drops an escaping party's pending commands, lights the record icon and answers the status reads.",
    hooks: {
      'status.cardLine': name => reads.cardLine(name),
      'status.lastReport': name => reads.lastReport(name),
      'status.connected': name => reads.connected(name),
      'records.saved': (payload: Record<string, unknown>) => diagnostics.saved(payload),
      'survival.escapeStarted': (payload: Record<string, unknown>) => {
        const commands = groups.state(String(payload.group))?.commands;
        for (const name of (payload.participants as string[] | undefined) ?? []) if (commands) delete commands[name];
      },
    } });
  if (!result.ok) throw Error(`Dashboard and status's core:status did not load: ${result.message}`);
}
