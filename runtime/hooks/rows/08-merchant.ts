// Owner 08's rows of the hook table: merchant jobs. Only 08's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
//
// Core-only points (14 0.4's closed list) each cite a reason. J1's survival holds decide survival. J1's
// rows for your own commands are the player's. J3 and J4 end jobs and write the slot the owners
// decided, so they are not decision points. The slot, block and add-on refusal rows are unit rows:
// the live setup plants no refused slot write, no failure for lack of gold and no second add-on.
import { doorOnly, readsOf, type DecisionRow, type PlainKind } from './row.ts';
import type { ActionRow, AddonContext, DispatchContext, HookRow, MerchantJobAsk, MerchantJobView, MerchantKindAsk, MerchantRoutineAnswer, MerchantRoutineView,
  MerchantStepAnswer, MerchantStepView, ReadRow, Registration, SlotRow } from '../registry.ts';

const SPEC = 'e2e/live-merchant-hooks.spec.ts', UNIT = 'scripts/tests/hook-registry.test.cjs';

export const HOOKS = {
  // A4 part 1: an add-on's job kinds and its one job of them per dispatch pass. The job owner clamps
  // a kind's priority into 1 to 74 and refuses a job of a kind the add-on did not declare, or one
  // whose listing realm the realm owner refuses (J5's add-on row).
  'merchant.jobKind': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08), J5', answers: 'many', addonMayAsk: false,
    bound: 'priority 1 to 74, and one core J5 command type',
    fixture: `${SPEC}#merchant.jobKind: the fixture's kind at priority 90 runs at 74, with a ring entry`,
    receives: "the add-on's settings", returns: 'its kinds: name, command type, realm (home, here or listing) and priority' },
  'merchant.job': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08), J2', answers: 'many', addonMayAsk: false,
    bound: "one job of the add-on's own kinds per pass, ranked by J2",
    fixture: `${SPEC}#merchant.job: the fixture's job is queued and runs; its PVP and blacklisted listings are refused`,
    receives: 'the merchant, its current job and the queue', returns: 'one job: its kind, target and listing realm, or nothing' },
  // C2: an `addon-steps` job's next steps, asked on the
  // merchant between steps. Each step passes C2's bounds (rules.ts addonStepRefusal) and its owner's
  // door through the C1 dispatcher; a refused step goes through P5.
  'merchant.step': { kind: 'request', side: 'character', part: 'merchant jobs (08), J5 addon-steps', answers: 'many', addonMayAsk: false,
    bound: "only the add-on whose job runs; offered actions in the job band; gold.donate, gold.send, item.send and mail.send only for a kind that declares spends and the player switched on; a send step names any recipient",
    fixture: `${UNIT}#C2: an addon-steps job carries its fields and steps whole; a donate-then-buy chain runs with consent and a send to any recipient runs`,
    receives: "the job (id, kind, target, the add-on's fields) and the outcomes of the steps it ran", returns: '{steps}, {end: done or failed}, or nothing for done' },
  // P14 (hook-coverage-2 R3): the merchant's picked routine entry names the job J2 runs next. The
  // player's manual jobs, J1's holds, J4's retries and the realm owner's refusals run first.
  'merchant.routine': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08), J2 row 3, the merchant routine slot', answers: 'slot', addonMayAsk: false,
    bound: "only for the merchant whose merchant routine pick is the add-on's entry, and never while the player's manual job is ready; run names a queued job J2 row 1 passes, else the built-in pick runs; queue takes merchant.jobKind's bound; an answer that throws or breaks the shape runs the built-in pick",
    fixture: `${UNIT}#P14: the fixture routine runs its restock before the queued upgrade; a manual visit still goes first`,
    receives: 'the merchant, its current job, and each queued job with its J2 readiness and priority',
    returns: "{run: a queued job's id}, {queue: one job of its own kinds}, {idle: true}, or nothing for the built-in pick" },
  // A4 part 3's reads and the realm owner's two asks of the job owner.
  'jobs.current': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08)', answers: 'one', core: true, addonMayAsk: true,
    fixture: `${SPEC}#jobs.current: names the fixture's job while it runs`,
    receives: 'nothing', returns: "the current job's id, reason, target and phase, or null" },
  'jobs.ready': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08)', answers: 'one', core: true, addonMayAsk: true,
    fixture: `${UNIT}#MJ23: with no add-on registered, the merchant hooks change no answer`,
    receives: 'the merchant', returns: "J2's ready jobs in the pick's order, each with its priority and the realm it runs on (E08-10b)" },
  'merchant.kind': { kind: 'request', side: 'coordinator', part: 'merchant jobs (08), J5', answers: 'one', core: true, addonMayAsk: true,
    fixture: `${SPEC}#merchant.kind: answers a core kind and the fixture's clamped kind`,
    receives: 'a reason', returns: "the kind's J5 record" },
  // A4 part 2 and S11: one notice at each change the job owner makes.
  'merchant.job.queued': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${SPEC}#merchant.job.queued, .started, .ended: one each for the fixture's job`,
    receives: 'subject (the merchant), owner (job:<id>), kind, by', returns: 'nothing' },
  'merchant.job.started': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${SPEC}#merchant.job.queued, .started, .ended: one each for the fixture's job`,
    receives: 'subject, owner, kind, by', returns: 'nothing' },
  'merchant.job.paused': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${SPEC}#merchant.job.paused, .resumed: force stand pauses the fixture's job, which resumes after it`,
    receives: 'subject, owner, by (who paused it)', returns: 'nothing' },
  'merchant.job.resumed': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${SPEC}#merchant.job.paused, .resumed: force stand pauses the fixture's job, which resumes after it`,
    receives: 'subject, owner, kind, by', returns: 'nothing' },
  'merchant.job.ended': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${SPEC}#merchant.job.queued, .started, .ended: one each for the fixture's job`,
    receives: 'subject, owner, code (the J4 ending), by', returns: 'nothing' },
  'merchant.job.blocked': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${UNIT}#MJ22: a resource block and its release send one notice each`,
    receives: 'subject (the target), kind, code (the error), by', returns: 'nothing' },
  'merchant.job.unblocked': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08)', answers: 'many', 
    fixture: `${UNIT}#MJ22: a resource block and its release send one notice each`,
    receives: 'subject, kind, code (the part of the signature that changed), by', returns: 'nothing' },
  'merchant.slot.written': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08), the command slot', answers: 'many', 
    fixture: `${UNIT}#MJ22: each slot write, hold and refusal sends one notice with its writer`,
    receives: 'subject, owner (the writer), decision (slot-written or slot-cleared), by', returns: 'nothing' },
  'merchant.slot.held': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08), the command slot', answers: 'many', 
    fixture: `${UNIT}#MJ22: each slot write, hold and refusal sends one notice with its writer`,
    receives: 'subject, owner, code (the held command), by', returns: 'nothing' },
  'merchant.slot.refused': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08), the command slot', answers: 'many', 
    fixture: `${UNIT}#MJ22: each slot write, hold and refusal sends one notice with its writer`,
    receives: 'subject, owner, code, by', returns: 'nothing' },
  'merchant.holder.changed': { kind: 'notice', side: 'character', part: 'merchant jobs (08), the runner (3.3)', answers: 'many', 
    fixture: `${SPEC}#merchant.holder.changed: the runner's holder goes to the fixture's job and back to none`,
    receives: 'character, from, to, command, by', returns: 'nothing' },
  'merchant.stand.opened': { kind: 'notice', side: 'character', part: 'merchant jobs (08), the stand holder', answers: 'many', 
    fixture: `${SPEC}#merchant.stand.opened, .closed: the stand return opens the stand and the fixture's job closes it`,
    receives: 'character, by (the holder)', returns: 'nothing' },
  'merchant.stand.closed': { kind: 'notice', side: 'character', part: 'merchant jobs (08), the stand holder', answers: 'many', 
    fixture: `${SPEC}#merchant.stand.opened, .closed: the stand return opens the stand and the fixture's job closes it`,
    receives: 'character, by (the holder that took the stand)', returns: 'nothing' },
  'merchant.gathering.phase': { kind: 'notice', side: 'character', part: 'merchant jobs (08), gathering', answers: 'many', 
    fixture: `${SPEC}#merchant.gathering.phase, .cast: one fishing attempt walks, casts and reports its catch or miss`,
    receives: 'character, mode, phase, by', returns: 'nothing' },
  'merchant.gathering.cast': { kind: 'notice', side: 'character', part: 'merchant jobs (08), gathering', answers: 'many', 
    fixture: `${SPEC}#merchant.gathering.phase, .cast: one fishing attempt walks, casts and reports its catch or miss`,
    receives: 'character, mode, outcome (catch or miss), by', returns: 'nothing' },
  'merchant.gathering.noTool': { kind: 'notice', side: 'coordinator', part: 'merchant jobs (08), gathering (M14)', answers: 'many', 
    fixture: 'scripts/tests/coordinator-settings.test.cjs#gathering toggles preserve other modes, clear no-tool status, and reject stale merchant reports',
    receives: 'subject (the merchant), kind (the mode), code (set or cleared), by', returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

// The add-on capability tables: each game call the merchant jobs owner's code makes, offered
// through its door or closed with a code, and each state an add-on may read with the door export
// that answers it.
export const ACTIONS = {
  // The stand's game calls (`merchant`, open_stand, close_stand) go out from 10's stand call
  // (items/character/calls.ts), so 10's ACTIONS row holds them; 08's door decides when.
  'stand.open': { events: [], functions: [], door: 'standOpen', args: '{}',
    bound: "08's stand holder: only while nothing holds the merchant, or inside the add-on's own job" },
  'stand.close': { events: [], functions: [], door: 'standClose', args: '{}',
    bound: "08's stand holder: only while nothing holds the merchant, or inside the add-on's own job" },
  // The merchant job's casts: Merchant's Luck (luck.ts) and the gathering casts (gathering.ts).
  'skill.mluck': { events: [], functions: ['use_skill:mluck'], closed: 'FW', cite: "runtime/merchant-jobs/character/luck.ts: 08's luck job casts it; an add-on asks through merchant.job" },
  'skill.gather': { events: [], functions: ['use_skill:fishing', 'use_skill:mining'], closed: 'FW',
    cite: "runtime/merchant-jobs/character/gathering.ts: 08's gathering job casts them; an add-on asks through merchant.job" },
  'giveaway.join': { events: ['join_giveaway'], functions: ['join_giveaway'], door: 'joinGiveaway', args: '{seller, slot}',
    bound: "08's giveaway door (M-4): an open giveaway of a seller in view and in reach, joined once" },
} as const satisfies Record<string, ActionRow>;
// C3's tables (addon-capabilities.md "The completeness rule"): each export of the merchant jobs owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const JOBS = 'runtime/merchant-jobs/api.ts', JOBS_COORDINATOR = 'runtime/merchant-jobs/coordinator/api.ts';
export const READS = {
  ...readsOf('merchant', 'both', JOBS, { merchantKind: "JobKind", jobCommandRetained: "boolean", merchantLine: "string", realmRetry: "the realm retry ladder", routineEnabled: "boolean", manualVisitReason: "string", merchantRoutinePriority: "number", autoUpgradeEnabled: "boolean", defaultMerchantAutomations: "the default automations", defaultMerchantRoutinePriorities: "the default routine priorities", routineFor: "the routine entry", validStandLocation: "boolean", legacyStandLocation: "MerchantStandLocation", AT_STAND: "number", ROUTINE_PRIORITY: "the routine priority table", NEARBY_RADIUS: "number", COMMERCE_PROGRESS_VERSION: "number", typedRoutinePriority: "the typed routine priorities", movedRoutinePriorities: "the routine priorities after a move", coordinatorMerchantPriority: "number", merchantAnniversaryControl: "AnniversaryControl", automaticRoutine: "boolean", coordinatorMerchantTransferBlocked: "boolean", pickupReason: "string", routineLabel: "string", ROUTINE_DIALOG_LABELS: "the routine dialog labels", merchantJobLabel: "string" }),
  ...readsOf('merchant', 'coordinator', JOBS_COORDINATOR, { collectionPickups: "the pickups a collection holds", exchangePickup: "the exchange pickup", merchantAdoption: "the adoption answer", merchantHeartbeat: "the merchant's heartbeat section", plannedOperationStage: "string", gatheringCastActive: "boolean", merchantVisibility: "the visibility window", merchantEventRecoveryReserved: "boolean", merchantEventReserved: "boolean", coordinatorCollectionSlots: "number", coordinatorCollectionNearby: "boolean", coordinatorCollectionReady: "boolean", coordinatorMerchantCapacitySignature: "string", coordinatorPrioritizedBids: "the bids in priority order", hasStrongMluck: "boolean", mluckTravelLead: "number" }),
  ...readsOf('merchant', 'both', 'runtime/merchant-jobs/rules.ts', { jobEnded: "boolean", isGatheringMode: "boolean", mergeTiming: "the merged timing" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(JOBS, 'write', ['migrateExchangeAutomations', 'migrateRoutinePriorities']),
  ...doorOnly(JOBS_COORDINATOR, 'port', ['createCoordinatorMerchantAutomation', 'createCoordinatorMerchantServices', 'installStandLocationRoute', 'createMerchantPartyRoutes', 'createCoordinatorMerchantConfiguration', 'createCoordinatorMerchantJobActions', 'createMerchantCompletionRoute', 'createMerchantHandoffRoutes', 'createMerchantIdleRoute', 'createMerchantScheduling', 'merchantJobSource', 'createCoordinatorMerchantQueue', 'createCoordinatorMerchantRecovery', 'createCoordinatorMerchantActions']),
  ...doorOnly(JOBS_COORDINATOR, 'write', ['migrateMerchantSettings', 'reviseQueuedJobs', 'pruneLuckCasts', 'recoverMerchantQueue', 'stampMerchantJob']),
  ...doorOnly(JOBS_COORDINATOR, 'command', ['endMerchantJob', 'merchantSlotCommand', 'pauseCurrentJob', 'takeCoordinatorMerchantJob']),
};

// A4 part 4: an add-on kind's row in the merchant card's routine priorities list. 12 draws it.
export const SLOTS = {
  'merchant-routines': { owner: 'merchant jobs (08)', data: "{priorities, enabled: the dialog's drafts by routine key, kinds: the add-on job kinds the merchant runs (reason, addon, label, priority), settings}; the add-on's piece draws its kind's row",
    section: true, bound: "adds one row per add-on after the routine priorities; the core routines keep their order and switches",
    fixture: "scripts/tests/dashboard-addon-slots.test.cjs#merchant-routines: the add-on's routine row follows the routine priorities" },
  // P14: the merchant's pick in the merchant routine slot, saved in `routines` under its name.
  'merchant-routine': { owner: 'merchant jobs (08)', data: "{entry, label, classes} on the merchant.routine registration's slot entry; the merchant's pick is saved in `routines` under its character and slot",
    section: false, fixture: `${UNIT}#P14: the fixture routine runs its restock before the queued upgrade; a manual visit still goes first` },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the merchant jobs owner's two add-on hooks: each enabled add-on's answer, named
// by the add-on, in load order. An answer that throws gives nothing and is kept with the notices'
// errors. The job owner's J5 add-on row decides what each answer does (runtime/merchant-jobs/rules.ts).
export function dispatch(ctx: DispatchContext) {
  // C3: the add-on context each of the merchant jobs owner's add-on answers gets as its third argument, with the
  // store. The registry builds it (L1's `addonContext`); a realm without it hands none.
  const context = (r: Registration): AddonContext | undefined => (ctx as DispatchContext & { addonContext?(name: string): AddonContext }).addonContext?.(r.name);
  // merchant.job and merchant.routine get the context as a third argument, which their signatures in
  // registry.ts do not name yet.
  const withContext = <T>(answer: ((...args: never[]) => T) | undefined, ...args: unknown[]): T => Reflect.apply(answer!, undefined, args);
  return {
    merchantJobs: {
      kinds: () => ctx.answers<readonly MerchantKindAsk[]>('merchant.jobKind', r => r.hooks['merchant.jobKind']!(ctx.settings(r.name))),
      // Whether an enabled add-on declares a kind or proposes a job, which only the dispatch pass asks.
      proposes: () => ctx.answering('merchant.jobKind').length > 0 || ctx.answering('merchant.job').length > 0,
      jobs: (view: MerchantJobView) => ctx.answers<MerchantJobAsk>('merchant.job', r => withContext(r.hooks['merchant.job'], view, ctx.settings(r.name), context(r))),
      // C2: the running job's add-on answers its next steps. Another add-on's answer is not asked.
      step(addon: string, view: MerchantStepView): MerchantStepAnswer {
        const r = ctx.answering('merchant.step').find(o => o.name === addon), c = r && context(r);
        if (!r || !c) return r ? { end: 'failed', reason: 'this realm builds no add-on context' } : undefined;
        const answer = ctx.call(r, 'merchant.step', () => r.hooks['merchant.step']!(view, ctx.settings(r.name))) as Record<string, unknown> | undefined;
        if (answer?.end === 'done' || answer?.end === 'failed') return { end: answer.end, ...(typeof answer.reason === 'string' ? { reason: answer.reason } : {}) };
        return Array.isArray(answer?.steps) ? { steps: answer.steps } : undefined;
      },
      // P14: the answer of the merchant routine entry `pick` names, when an enabled add-on fills it.
      // The built-in entry, a missing pick and an answer outside the shape read as nothing.
      routine(pick: string | undefined, view: MerchantRoutineView): { addon: string; answer: NonNullable<MerchantRoutineAnswer> } | undefined {
        const holder = pick ? ctx.slotHolder('merchant-routine:' + pick) : undefined, r = holder && ctx.answering('merchant.routine').find(o => o.name === holder.name);
        if (!r || holder.classes && !holder.classes.includes('merchant')) return undefined;
        const answer = ctx.call(r, 'merchant.routine', () => withContext(r.hooks['merchant.routine'], view, ctx.settings(r.name), context(r))) as Record<string, unknown> | undefined;
        if (typeof answer?.run === 'string') return { addon: r.name, answer: { run: answer.run } };
        if (answer?.idle === true) return { addon: r.name, answer: { idle: true } };
        const job = answer?.queue as MerchantJobAsk | undefined;
        if (job && typeof job.kind === 'string' && typeof job.target === 'string') return { addon: r.name, answer: { queue: job } };
        return undefined;
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/merchant-jobs/rules.ts'] as const;
export const DECISIONS = {
  'which job runs next': { at: 'runtime/merchant-jobs/rules.ts#selectMerchantJob', hook: 'merchant.routine' },
  'the order jobs are picked in': { at: 'runtime/merchant-jobs/rules.ts#pickOrder', hook: 'merchant.routine' },
  'an add-on job joins the queue': { site: 'runtime/merchant-jobs/coordinator/dispatch.ts:226', hook: 'merchant.job' },
  'an add-on job kind': { at: 'runtime/merchant-jobs/rules.ts#admitAddonKinds', hook: 'merchant.jobKind' },
  'an add-on job kind\'s row': { at: 'runtime/merchant-jobs/rules.ts#addonKind', hook: 'merchant.jobKind' },
  'holds J1': { at: 'runtime/merchant-jobs/rules.ts#holdOf', core: 'tier-table', cite: 'runtime/merchant-jobs/rules.ts:297, each row is a core owner\'s hold or a game state' },
  'readiness J2': { at: 'runtime/merchant-jobs/rules.ts#jobReady', hook: 'group.questions' },
  'interrupts J3': { at: 'runtime/merchant-jobs/rules.ts#interruptOf', hook: 'merchant.jobKind' },
  'endings J4': { at: 'runtime/merchant-jobs/rules.ts#endingOf', hook: 'retry.policy' },
  'retry waits J4': { at: 'runtime/merchant-jobs/rules.ts#endingWaitMs', hook: 'retry.policy' },
  'gathering mode': { at: 'runtime/merchant-jobs/rules.ts#gatheringCandidates', hook: 'settings.overlay' },
  'routine priorities': { at: 'runtime/merchant-jobs/rules.ts#merchantRoutinePriority', hook: 'settings.overlay' },
  'a routine is on': { at: 'runtime/merchant-jobs/rules.ts#routineEnabled', hook: 'settings.overlay' },
  'auto upgrade priority': { at: 'runtime/merchant-jobs/rules.ts#autoUpgradePriority', hook: 'settings.overlay' },
  'auto upgrade is on': { at: 'runtime/merchant-jobs/rules.ts#autoUpgradeEnabled', hook: 'settings.overlay' },
  'a job\'s priority': { at: 'runtime/merchant-jobs/rules.ts#merchantJobPriority', hook: 'settings.overlay' },
  'the coordinator\'s merchant priority': { at: 'runtime/merchant-jobs/rules.ts#coordinatorMerchantPriority', hook: 'settings.overlay' },
  'the bids in priority order': { at: 'runtime/merchant-jobs/rules.ts#coordinatorPrioritizedBids', hook: 'settings.overlay' },
  'realm retry ladder': { at: 'runtime/merchant-jobs/rules.ts#realmRetry', hook: 'retry.policy' },
  'the realm ladder from a failure': { at: 'runtime/merchant-jobs/rules.ts#ladderFrom', hook: 'retry.policy' },
  "an add-on job's next steps": { site: 'runtime/merchant-jobs/character/steps.ts:46', hook: 'merchant.step' },
  // C2's bound keeps the account's assets inside the player's consent: the routine switch of a kind
  // that declares spends.
  "an add-on job step's bounds": { at: 'runtime/merchant-jobs/rules.ts#addonStepRefusal', core: 'safety', cite: "runtime/merchant-jobs/rules.ts:240, the steps that move the account's gold or items" },
  "a refused add-on step's retry": { at: 'runtime/merchant-jobs/rules.ts#stepRetry', hook: 'retry.policy' },
  'pickup jobs merge into one': { at: 'runtime/merchant-jobs/rules.ts#mergePickupJobs', core: 'integrity', cite: 'runtime/merchant-jobs/rules.ts:875, one job per pickup' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  coordinatorMerchantTransferBlocked: 'read', routineFor: 'read', automaticRoutine: 'read', merchantAnniversaryControl: 'read',
  jobCommandRetained: 'read', jobEnded: 'read', merchantKind: 'read', isGatheringMode: 'read',
  typedRoutinePriority: 'read', kindRow: 'format', defaultMerchantRoutinePriorities: 'read', defaultMerchantAutomations: 'read',
  mergeTiming: 'read',
  manualVisitReason: 'label', addonReason: 'label', routineLabel: 'label', merchantJobLabel: 'label',
  pickupReason: 'label', merchantLine: 'label',
  migrateRoutinePriorities: 'migration', migrateExchangeAutomations: 'migration', splitLegacyWork: 'migration',
  movedRoutinePriorities: 'migration', normalizePickupJob: 'migration',
  stampMerchantJob: 'format', coordinatorMerchantCapacitySignature: 'format',
  validStandLocation: 'validator', jsonWhole: 'validator',
} satisfies Record<string, PlainKind>;
