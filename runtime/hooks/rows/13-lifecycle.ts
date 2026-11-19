// Owner 13's rows of the hook table: lifecycle. Only 13's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import { doorOnly, readsOf, type DecisionRow, type PlainKind } from './row.ts';
import type { ActionRow, DispatchContext, HookRow, ReadRow, SlotRow } from '../registry.ts';
import type { Readiness, ReadyAsk } from '../../lifecycle/api.ts';

export const HOOKS = {
  // The character's report timer: the
  // role loop's backstop pass when every other event is lost.
  'report.sent': { kind: 'notice', side: 'character', part: 'lifecycle (13), the report timer', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#report.sent: each report sends report.sent',
    receives: "character, sequence (the run's report count), by 'core:lifecycle'", returns: 'nothing' },
  // Drain readiness: the lifecycle owner's own answer (the game's queue and the
  // open boundary count), the items owner's bag holder, the merchant jobs owner's job, idle job and gathering and
  // The events owner's anniversary staging answer as an add-on would.
  'lifecycle.ready': { kind: 'request', side: 'character', part: 'lifecycle (13), drain readiness (table R, A2)', answers: 'many', addonMayAsk: false,
    bound: 'refusal only: an answer can hold readiness, never grant it',
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.ready: the add-on holds the drain while its own work runs, and the deploy waits on its reason',
    receives: 'the character and the deploy lease', returns: '{ready, reason}: ready false holds the drain with the reason' },
  // The roster's two reads for the items owner's BankBoi swap: the account list
  // shows the character offline, and a headless slot takes a character.
  'roster.offline': { kind: 'request', side: 'coordinator', part: 'lifecycle (13), the roster', answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/coordinator-ownership.test.cjs#roster.offline, roster.assign: the BankBoi swap sees the old character offline, then starts the new one in its slot",
    receives: 'a character name', returns: 'a promise of whether two account answers in a row showed it offline before a handoff phase would expire' },
  'roster.assign': { kind: 'request', side: 'coordinator', part: 'lifecycle (13), the roster', answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/coordinator-ownership.test.cjs#roster.offline, roster.assign: the BankBoi swap sees the old character offline, then starts the new one in its slot",
    receives: 'a slot number from 1 and a character name', returns: 'nothing; the slot starts the character' },
  // L4 part 2: the read-only events, one notify at each change (K-S5 names).
  'lifecycle.started': { kind: 'notice', side: 'coordinator', part: "lifecycle (13), the coordinator's start (C70)", answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.started: the restart sends started with reason start',
    receives: "the realm, the generation and the reason: start, reload or resume; by 'core:lifecycle'", returns: 'nothing' },
  'lifecycle.paused': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the Pause', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.paused: Pause sends paused by user',
    receives: "the Pause's id and the running names; by 'user' or 'shutdown'", returns: 'nothing' },
  'lifecycle.played': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), Play', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.played: Play sends played by user',
    receives: "by 'user', 'auto-resume' or 'shutdown-cancel', and the skipped names", returns: 'nothing' },
  'lifecycle.drainStarted': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the deploy lease', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.drainStarted: the safe deploy sends drainStarted',
    receives: "the lease id, mode and load mode; by 'host'", returns: 'nothing' },
  'lifecycle.drainEnded': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the deploy lease', answers: 'many', 
    fixture: "e2e/live-lifecycle-hooks.spec.ts#lifecycle.drainEnded: the safe deploy's release sends drainEnded",
    receives: "the lease id; by 'host'", returns: 'nothing' },
  'lifecycle.readiness': { kind: 'notice', side: 'character', part: 'lifecycle (13), drain readiness (table R)', answers: 'many', 
    fixture: "e2e/live-lifecycle-hooks.spec.ts#lifecycle.readiness: the add-on's hold appears in waiting, then clears",
    receives: "the character, the lease id and the waiting reasons; by 'core:lifecycle'", returns: 'nothing' },
  'lifecycle.shutdown': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the clean shutdown', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.shutdown: the clean shutdown sends draining then safe',
    receives: "the phase (deferred, draining, safe or cancelled) and the hold reason; by 'user'", returns: 'nothing' },
  'lifecycle.reloaded': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the CODE reload (table W)', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.reloaded: the CODE reload sends reloaded ready',
    receives: "the character, the script hash and the outcome: ready, busy or failed; by 'core:lifecycle'", returns: 'nothing' },
  'lifecycle.holdChanged': { kind: 'notice', side: 'both', part: 'lifecycle (13), the run scope (table P)', answers: 'many', 
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.holdChanged: the paused warrior sends holdChanged held, then released at Play',
    receives: "the character, whether it is held, and by: 01's hold (`user` or `pause`) or 'core:lifecycle' for the first reply", returns: 'nothing' },
  'worker.started': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the headless workers (table W)', answers: 'many', 
    fixture: "e2e/live-lifecycle-hooks.spec.ts#worker.started, worker.exited: the restart's workers send exited then started",
    receives: "the character and the pid; by 'core:lifecycle'", returns: 'nothing' },
  'worker.exited': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the headless workers (table W)', answers: 'many', 
    fixture: "e2e/live-lifecycle-hooks.spec.ts#worker.started, worker.exited: the restart's workers send exited then started",
    receives: "the character, the pid and the exit {at, code, signal, reason}; by 'core:lifecycle'", returns: 'nothing' },
  'roster.changed': { kind: 'notice', side: 'coordinator', part: 'lifecycle (13), the roster', answers: 'many', 
    fixture: "scripts/tests/coordinator-ownership.test.cjs#roster.changed: a Steam group change sends roster.changed with the members and the slots",
    receives: "the Steam members and headless slots; by the actor that committed the change: 'user', 'steam-handoff', 'steam' or 'recovery'", returns: 'nothing' },
  // L4 part 3: the published reads, each with one core answer. `lifecycle.boundary` opens an atomic
  // boundary the drain waits on, so an add-on may not ask it; the others read and change nothing.
  'lifecycle.state': { kind: 'request', side: 'coordinator', part: 'lifecycle (13), published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.state: the add-on reads paused true while paused',
    receives: 'nothing', returns: '{paused, pausedAt, drain, shutdown}' },
  'lifecycle.drain': { kind: 'request', side: 'both', part: 'lifecycle (13), published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-lifecycle-hooks.spec.ts#lifecycle.drain: the add-on reads the drain's targets during the safe deploy",
    receives: 'nothing', returns: 'on the character {targets, park} or null; on the coordinator {lease, participants} or null' },
  'lifecycle.allows': { kind: 'request', side: 'coordinator', part: 'lifecycle (13), published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "scripts/tests/lifecycle-rules.test.cjs#LF8 table D: each coordinator question is refused under the Pause and under its lease rows",
    receives: 'nothing', returns: 'table D: whether the merchant, recovery, pulls or reply question may go' },
  'lifecycle.boundary': { kind: 'request', side: 'character', part: 'lifecycle (13), published read', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.boundary: a boundary opened during the deploy settles on drainEnded',
    receives: 'nothing', returns: 'a promise that settles once neither a drain nor table P1 holds the character (C69, K-B2)' },
  'lifecycle.held': { kind: 'request', side: 'character', part: 'lifecycle (13), published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#lifecycle.held: the add-on reads held while paused',
    receives: 'nothing', returns: 'table P on the character: whether it is held or starting' },
} as const satisfies Record<string, HookRow>;

// The add-on capability tables: each game call the lifecycle owner's code makes, offered
// through its door or closed with a code, and each state an add-on may read with the door export
// that answers it.
export const ACTIONS = {
  // Login and the session.
  session: { events: ['auth', 'loaded', 'ping_trig', 'test', 'requested_ack'], functions: [], closed: 'FW', cite: 'runtime/lifecycle/api.ts:1, 13 owns the session' },
  // Runs code in the character, past every other bound.
  code: { events: ['code', 'eval'], functions: [], closed: 'AS', cite: 'addon-capabilities.md C1, the add-on never calls the game' },
} as const satisfies Record<string, ActionRow>;
// C3's tables (addon-capabilities.md "The completeness rule"): each export of the lifecycle owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const LIFECYCLE = 'runtime/lifecycle/api.ts';
export const READS = {
  // 13's roster: names, classes, slots and whether each is online.
  'roster.members': { side: 'coordinator', type: 'CharacterConnection[]', door: `${LIFECYCLE}#characterConnections` },
  ...readsOf('lifecycle', 'both', LIFECYCLE, { CHARACTER_PICKS: "string[]", caveMap: "string", characterNameAllowed: "boolean", CHARACTER_NAME_MAX: "number", CHARACTER_NAME_MIN: "number", CHARACTER_NAME_REFUSAL: "string", nameCharacters: "string[]", isRequestObject: "boolean", requestObject: "the request body", requestText: "string", holdLabel: "string", orderCharacters: "the characters in order", deploymentPending: "boolean" }),
  ...readsOf('lifecycle', 'coordinator', 'runtime/lifecycle/coordinator/api.ts', { initialSteamRoster: "the saved Steam roster", initialHeadlessSlots: "string[]", memberLost: "boolean" }),
  ...readsOf('lifecycle', 'both', 'runtime/lifecycle/rules.ts', { participates: "boolean", codeStopped: "boolean" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(LIFECYCLE, 'port', ['scope']),
  // The Steam session's setup is a credential (addon-capabilities.md C3: the Steam session stays closed).
  [`${LIFECYCLE}#validSteamSetup`]: { closed: 'KY', cite: 'tools/steam/clients.ts, the Steam session' },
};

export const SLOTS = {} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the lifecycle owner's rows.
export function dispatch(ctx: DispatchContext) {
  return {
    // Drain readiness (table R's A2): every core owner and add-on that
    // answers may hold it with a reason, and none can grant it. An answer that throws holds nothing,
    // and the registry keeps its error.
    lifecycle: {
      ready(ask: ReadyAsk): Readiness {
        const waiting: Readiness['waiting'] = [];
        for (const { addon, answer } of ctx.answers('lifecycle.ready', r => r.hooks['lifecycle.ready']!(ask)))
          if (answer.ready === false) waiting.push({ by: addon, reason: String(answer.reason ?? 'busy') });
        return { ready: waiting.length === 0, waiting };
      },
    },
    // Lifecycle's roster reads: the items owner's BankBoi swap asks them. The roster
    // answers on the coordinator, so each ask fails without one.
    roster: {
      offline(name: string): Promise<boolean> {
        return ctx.one('roster.offline').hooks['roster.offline']!(name);
      },
      assign(slot: number, name: string): void {
        ctx.one('roster.assign').hooks['roster.assign']!(slot, name);
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/lifecycle/rules.ts'] as const;
export const DECISIONS = {
  'a participant keeps the drain waiting': { at: 'runtime/lifecycle/rules.ts#waiting', hook: 'lifecycle.ready' },
  'what runs during a Pause or lease (table D)': { at: 'runtime/lifecycle/rules.ts#allows', core: 'safety', cite: 'runtime/lifecycle/rules.ts:80, the deploy' },
  'deploy refusal during a Cave run': { at: 'runtime/lifecycle/rules.ts#deployRefusal', core: 'game', cite: 'runtime/lifecycle/rules.ts:109, a reload loses the run' },
  'shutdown hold': { at: 'runtime/lifecycle/rules.ts#shutdownHold', core: 'safety', cite: 'runtime/lifecycle/rules.ts:114' },
  'worker lifetime (table W)': { site: 'runtime/lifecycle/rules.ts:125', core: 'integrity', cite: 'runtime/lifecycle/rules.ts:125, the processes' },
  'a command refused at intake': { at: 'runtime/lifecycle/rules.ts#intakeAdmits', core: 'safety', cite: 'runtime/lifecycle/rules.ts:151, Pause, lease and Manual' },
  'run row': { at: 'runtime/lifecycle/rules.ts#runRow', core: 'safety', cite: 'runtime/lifecycle/rules.ts:57' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  characterNameAllowed: 'read',
  participates: 'read', caveMap: 'read', codeStopped: 'read',
  parseLease: 'validator',
  newLease: 'format', commandKey: 'format', nameCharacters: 'format', codeStoppedKey: 'format',
  holdLabel: 'label',
} satisfies Record<string, PlainKind>;
