import type { ICoord } from 'typed-adventureland';
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../settings/api.ts';
import { bankStagingReserved, stagingCell } from '../items/api.ts';
import { automaticNpcRetrieval, hasMarkedWithdrawals, freeSlots, protectedSlotsOf, luckySlotOf, type LuckySlots } from '../items/api.ts';

import type { MerchantKindAsk } from '../hooks/registry.ts';
import type { CommandInputs, MerchantWork } from './coordinator/owner.ts';

// The job kinds: one record per reason string. Each field answers one question the reason lists of
// v1.5.0 answered by membership, so every reader asks `merchantKind(reason).<field>`
// and no list remains. A reason with no record is an own improvement job: its command is
// `merchant-self-improve` and it needs home.
export interface JobNeeds { slots?: number; gold?: 'postage' }
export interface JobKind {
  // The command an own job of this kind sends (command-kind.ts `commandTypes`).
  command?: string;
  // Where the merchant runs it: on its home realm, on the listing's realm (the job hops), or where
  // it stands (home-recovery.ts `merchantRoutineNeedsHome`, merchant-realms.ts `realmJobs`).
  realm: 'home' | 'listing' | 'here';
  // A marketplace kind whose command carries the home realm it returns to (commands.ts `travelling`).
  market?: boolean;
  // A purchase carries its listings (`buy`); a bid purchase also carries its bid (`bid`).
  purchase?: 'buy' | 'bid';
  // The command carries the listings it already finished (commands.ts `resumable`).
  resumable?: boolean;
  // The command names its automatic routine (commands.ts `processingRoutine`).
  processing?: boolean;
  // The kind merges only with its own kind at a member (queue.ts `separateRoutines`).
  separate?: boolean;
  // Kinds of one group take each other's place at a target: the merchant's bank withdrawals, and
  // the item pickups the cleanout route counts as already queued.
  mergeGroup?: 'bank' | 'pickup';
  // An automatic improvement or sale pickup that becomes a party collection at another character.
  autoPickup?: boolean;
  // A visit that collects party items (pickup-jobs.ts `collectsPartyItems`).
  collects?: boolean;
  // The kind is the target's current demand, not a separate order: the running job of the kind owns
  // a queued copy at its target.
  demand?: boolean;
  // A collection that waits for its item threshold (collection.ts `isItemCollection`).
  thresholdCollection?: boolean;
  // A pickup of items marked for an NPC sale (merchant-handoff.ts's handoff scope).
  salePickup?: boolean;
  // An own job that empties the bank's outbound staging slot (job-policy.ts).
  releasesStaging?: boolean;
  // What the job needs from storage and gold, which the items owner's `items.needs` reads:
  // `slots` free merchant slots above the items owner's protected free slots and the game's
  // postage.
  needs?: JobNeeds;
  // An improvement whose lost reply is a movement retry (completion-retries.ts).
  improvement?: boolean;
  // A failure short of gold or space blocks the kind until resources change.
  resourceHold?: boolean;
  // An interrupted job of this kind is never replayed (completion-retries.ts `retryAllowed`).
  retry?: 'never';
  // A failed job fails its NPC sale marks (completion-retries.ts `npcSales`).
  failsSales?: boolean;
  // Nothing pauses it; it runs to its end or its deadline (recovery.ts `expire`).
  interrupt?: 'never';
  // A Merchant's Luck itinerary (clusters.ts, luck-scheduler.ts).
  luck?: boolean;
  // What follows a finished job (completion.ts `finish` and `authenticate`).
  after?: 'market-recheck' | 'auth-check';
  // A finished job sends the merchant home with this reason (completion.ts `finish`); it goes with
  // The realm owner's home want.
  homeAfter?: string;
  // The dispatch's line in the activity log (command-kind.ts's descriptions; v1.5.0's wording).
  line?: string | ((job: MerchantWork) => string);
  // The fields an own job's command carries for its kind (commands.ts's per-reason details).
  details?: (job: MerchantWork, inputs: CommandInputs) => object;
  // The routine an older or helper reason runs as, which routineFor answers.
  routine?: string;
  // The priority key a raw reason reads when it has none of its own.
  priorityRoutine?: string;
  // The queue words of a kind whose routine names another kind (12-dashboard-and-status 2.1 item 2).
  label?: string;
  // A queued job of the kind leaves the queue once its `expiresAt` passes (the queue hygiene).
  expires?: boolean;
  // The dispatch plans the job's Ponty listings once before its command.
  plansPonty?: boolean;
  // A partial run queues the kind again while the member's bag stays full (completion.ts).
  repeatsCleanout?: boolean;
  // The target's saved work the job needs, or it leaves the queue empty (the queue hygiene's work check).
  work?: 'deliveries' | 'compounds';
}
const legacyImprovement: JobKind = { realm: 'home', releasesStaging: true, improvement: true, resourceHold: true };
const luck: JobKind = { realm: 'home', luck: true };
const improvement: JobKind = { ...legacyImprovement, separate: true };
const mailDetails = (job: MerchantWork) => ({ mail: job.mail });
const kinds = {
  'bank unlock': { realm: 'home', command: 'merchant-bank-unlock', line: 'Merchant dispatched to unlock bank storage',
    details: job => ({ pack: job.pack, floor: job.floor, gold: job.gold, key: job.key }) },
  'manual bank exchange': { realm: 'home', command: 'merchant-self-bank', releasesStaging: true, line: 'Merchant dispatched for its own bank exchange' },
  withdrawals: { realm: 'home', command: 'merchant-self-bank', mergeGroup: 'bank', releasesStaging: true,
    line: 'Merchant dispatched to retrieve marked bank withdrawals' },
  // (the items owner's): the merchant fetches the bank's NPC sale stock when no visit is planned,
  // at the automatic sale's priority (its `routine`).
  'auto npc withdrawals': { realm: 'home', command: 'merchant-self-bank', mergeGroup: 'bank', releasesStaging: true, routine: 'auto npc sales',
    line: 'Merchant dispatched to retrieve bank stock for automatic NPC sales' },
  'bank collection': { realm: 'home', command: 'merchant-self-bank', mergeGroup: 'bank', releasesStaging: true, label: 'Bank item collection',
    line: 'Merchant dispatched to collect bank marks at the collection threshold' },
  // The items owner's native stand asks for the gold its buy orders need, which replaces the
  // working gold.
  'native stand funding': { realm: 'home', command: 'merchant-self-bank', details: job => ({ goldTarget: Number(job.goldTarget) }) },
  restock: { realm: 'home', command: 'merchant-self-restock', line: 'Merchant dispatched to restock its potions',
    details: (job, inputs) => ({ restock: inputs.restock(job.target) }) },
  'merchant commerce': { realm: 'home', command: 'merchant-commerce', resourceHold: true, line: 'Merchant dispatched for shopping and crafting' },
  exchange: { realm: 'home', command: 'merchant-exchange', line: 'Merchant dispatched for item exchanges',
    details: job => ({ exchanges: job.exchanges || [], exchangeRewards: job.exchangeRewards || [], exchangeResume: job.exchangeResume === true,
      autoExchangeKeys: job.autoExchangeKeys || [] }) },
  'merchant donation': { realm: 'home', command: 'merchant-donate',
    line: job => 'Merchant dispatched to donate ' + Number(job.amount).toLocaleString() + ' gold', details: job => ({ amount: job.amount }) },
  'stand search': { realm: 'home', command: 'merchant-stand-search', routine: 'manual marketplace purchases',
    line: job => 'Merchant searching player stands for ' + job.itemId, details: job => ({ itemId: job.itemId }) },
  'join giveaway': { realm: 'listing', command: 'merchant-join-giveaway', homeAfter: 'giveaway completion', expires: true,
    line: job => 'Merchant dispatched to join ' + job.seller + "'s giveaway",
    details: job => ({ seller: job.seller, slot: job.slot, rid: job.rid, realm: job.realm, location: job.location, expiresAt: job.expiresAt,
      expectedItem: job.expectedItem }) },
  'send mail': { realm: 'home', command: 'merchant-send-mail', needs: { gold: 'postage' }, details: mailDetails },
  'collect mail': { realm: 'home', command: 'merchant-collect-mail', details: mailDetails },
  'Ponty purchases': { realm: 'listing', command: 'merchant-ponty-buy', market: true, purchase: 'bid', resumable: true, after: 'market-recheck',
    priorityRoutine: 'stand bid purchases', plansPonty: true,
    line: 'Merchant dispatched to buy from Ponty' },
  'ALData marketplace purchases': { realm: 'listing', command: 'merchant-aldata-buy', market: true, purchase: 'bid', resumable: true, after: 'market-recheck',
    line: 'Merchant dispatched for an ALData marketplace purchase' },
  'ALData marketplace sales': { realm: 'listing', command: 'merchant-aldata-sell', market: true, interrupt: 'never', homeAfter: 'WTB completion',
    line: 'Merchant dispatched to fill an ALData marketplace buy order', details: job => ({ buyOrder: job.buyOrder, sellQuantity: job.sellQuantity }) },
  'ALData authentication': { realm: 'home', command: 'merchant-aldata-auth', after: 'auth-check', needs: { gold: 'postage' },
    line: 'Merchant dispatched to send the ALData authentication key', details: (_job, inputs) => ({ aldataKey: inputs.aldataKey }) },
  'stand purchases': { realm: 'home', command: 'merchant-stand-buy', purchase: 'buy', line: 'Merchant dispatched to buy from player stands' },
  'stand bid purchases': { realm: 'home', command: 'merchant-stand-buy', purchase: 'bid', after: 'market-recheck',
    line: job => 'Merchant dispatched to fill bid for ' + job.bidItemId },
  'npc sales': { realm: 'home', command: 'merchant-npc-sale', separate: true, retry: 'never', failsSales: true,
    line: 'Merchant dispatched to sell marked items to an NPC' },
  'auto npc sales': { realm: 'home', command: 'merchant-npc-sale', separate: true, processing: true, failsSales: true },
  deconstruction: { realm: 'home', command: 'merchant-deconstruct', line: 'Merchant dispatched to deconstruct marked items',
    details: (_job, inputs) => ({ deconstructionMarks: inputs.deconstructionMarks || [] }) },
  'stand maintenance': { realm: 'here' },
  'upgrade preview': { realm: 'home', line: 'Merchant dispatched to refresh upgrade chances' },
  'upgrades and compounds': { ...legacyImprovement, routine: 'manual upgrades' },
  'manual upgrades': { ...improvement, line: 'Merchant dispatched for manual upgrades' },
  'auto upgrade': { ...improvement, processing: true, autoPickup: true, line: 'Merchant dispatched for automatic upgrades' },
  'manual compounds': { ...improvement, work: 'compounds' },
  'auto compound': { ...improvement, processing: true, autoPickup: true },
  'manual buying': { realm: 'home', separate: true },
  // A member's bank visit the player asks for, and the marked visit the queue sends when a caller
  // names no reason. Both run as an own improvement job.
  'manual visit': { realm: 'home' },
  service: { realm: 'home' },
  // The visits a stat scroll mark and a member over the gold threshold ask for
  // (merchant-scheduling.ts:227), own improvement jobs too.
  'stat scrolls': { realm: 'home' },
  'gold threshold': { realm: 'home' },
  deliveries: { realm: 'home', separate: true, work: 'deliveries' },
  'exchange pickup': { realm: 'home', separate: true, collects: true, thresholdCollection: true, needs: { slots: 1 }, routine: 'manual exchange' },
  'npc sale pickup': { realm: 'home', separate: true, thresholdCollection: true, salePickup: true, routine: 'npc sales' },
  'auto npc sale pickup': { realm: 'home', separate: true, autoPickup: true, thresholdCollection: true, salePickup: true, routine: 'auto npc sales' },
  'deconstruction pickup': { realm: 'home', autoPickup: true },
  'party collection': { realm: 'home', collects: true },
  'marked items': { realm: 'home', collects: true, thresholdCollection: true, needs: { slots: 1 }, mergeGroup: 'pickup',
    routine: 'party collection', priorityRoutine: 'party collection' },
  'inventory cleanout': { realm: 'home', collects: true, needs: { slots: 1 }, mergeGroup: 'pickup', demand: true, repeatsCleanout: true },
  'merchant luck': luck,
  // The old saved reason: a saved queue loads it as a luck job.
  'merchant luck exchange': luck,
} satisfies Record<string, JobKind>;
// A kind key: every enqueue, queue and bankCollectionReason answer names one, so tsc refuses a reason
// the table does not hold. Saved jobs keep `reason: string`, since a saved queue can hold an old or
// add-on reason.
export type JobReason = keyof typeof kinds | `addon:${string}:${string}`;
export const JOB_KINDS: Readonly<Record<keyof typeof kinds, JobKind>> = kinds;
const isKey = (reason: string): reason is keyof typeof kinds => Object.hasOwn(JOB_KINDS, reason);
// The merchant job owner's one command type for
// add-on kinds. A kind that declares it carries its job's fields and steps whole into the command
// body (commands.ts `addonStepsCommand`), and the merchant runs the steps one at a time
// (character/steps.ts).
export const ADDON_STEPS = 'addon-steps';
// A merchant job's command stays in the status owner's command slot until its completion route
// acknowledges it, so a delivery the merchant defers is not lost. These are the commands of the job
// kinds and of the merchant's own jobs; the gathering command is one delivery, as today.
const JOB_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.values(JOB_KINDS).flatMap(kind => kind.command ? [kind.command] : []),
  'merchant-self-improve', 'merchant-upgrade-preview', 'merchant-service', 'merchant-handoff', 'merchant-idle',
  'merchant-stand-sync', 'merchant-mluck', 'merchant-order-handoff', ADDON_STEPS,
]);
export const jobCommandRetained = (type: string): boolean => JOB_COMMANDS.has(type);
// The completion route's code for a job that is no longer current. A character's report of a failed
// job swallows only this answer; any other failure of the report is logged (characters/shared.js
// `request` carries the code as `partyRequest.code`).
export const JOB_ENDED = 'job-ended';
export const jobEnded = (error: unknown): boolean => (error as { partyRequest?: { code?: unknown } } | null)?.partyRequest?.code === JOB_ENDED;
const ownImprovement: JobKind = { realm: 'home' };
// The visit kind a player's bank command asks for: the merchant's own bank exchange, or a visit to
// the member.
export const manualVisitReason = (name: string, merchant: string | null): JobReason =>
  name === merchant ? 'manual bank exchange' : 'manual visit';
export function merchantKind(reason: string): JobKind {
  return (isKey(reason) ? JOB_KINDS[reason] : addonKinds.get(reason)) ?? ownImprovement;
}

// The add-on row: an add-on's kind runs one core command type, at a priority the
// owner clamps into 1 to 74, so an add-on job never outranks the core routines.
// Its reason is `addon:<add-on>:<kind>`, and its record joins the table for the dispatch pass that
// read it.
export const ADDON_PRIORITY = { low: 1, high: 74 } as const;
export interface AddonKind extends JobKind { reason: string; addon: string; label: string; priority: number; asked: number; spends?: true }
const addonKinds = new Map<string, AddonKind>();
export const addonReason = (addon: string, kind: string): `addon:${string}:${string}` => `addon:${addon}:${kind}`;
// admitAddonKinds replaces the last pass's add-on kinds with this pass's. It refuses a kind with no
// core command type or an unknown realm and hands the refusals back for the ring.
export function admitAddonKinds(answers: readonly { addon: string; answer: readonly MerchantKindAsk[] }[]):
  { admitted: AddonKind[]; refused: { addon: string; kind: string; reason: string }[] } {
  addonKinds.clear();
  const commands = new Set([...Object.values(JOB_KINDS).map(kind => kind.command).filter(Boolean), ADDON_STEPS]), refused: { addon: string; kind: string; reason: string }[] = [];
  for (const { addon, answer } of answers) for (const ask of answer) {
    if (!commands.has(ask.command)) refused.push({ addon, kind: ask.kind, reason: `no core command type ${ask.command}` });
    else if (!['home', 'here', 'listing'].includes(ask.realm)) refused.push({ addon, kind: ask.kind, reason: `no realm ${ask.realm}` });
    else {
      const asked = Math.round(Number(ask.priority)) || ADDON_PRIORITY.low;
      addonKinds.set(addonReason(addon, ask.kind), { reason: addonReason(addon, ask.kind), realm: ask.realm, command: ask.command, addon, label: ask.label ?? ask.kind,
        line: 'Merchant dispatched for ' + (ask.label ?? ask.kind), ...(spendsDeclared(ask) ? { spends: true as const } : {}),
        asked, priority: Math.min(ADDON_PRIORITY.high, Math.max(ADDON_PRIORITY.low, asked)) });
    }
  }
  return { admitted: [...addonKinds.values()], refused };
}
// An admitted kind as the merchant-routines slot lists it: its routine key (the job's
// reason, which the player's switch and priority are saved under), its add-on, label and priority.
export interface AddonKindRow { reason: string; addon: string; label: string; priority: number }
// The merchant doors: the band the dispatcher names, and the door's
// answer. A `job` band ask names its job as `holder` ('job:<id>', character/steps.ts).
export type MerchantDoorBand = 'job' | 'background';
export type MerchantDoorAnswer = { outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string };
export type MerchantDoor = (args: Readonly<Record<string, unknown>>, band: MerchantDoorBand, holder?: string) => Promise<MerchantDoorAnswer>;
export interface MerchantDoors { standOpen?: MerchantDoor; standClose?: MerchantDoor; joinGiveaway?: MerchantDoor }
// The background band asks the call budget once and goes no further on a refusal.
// The job band waits for its window, as the merchant job owner's own job calls do.
export const BACKGROUND_REFUSED = 'call budget refused the background band';
export function kindRow(kind: AddonKind): AddonKindRow {
  return { reason: kind.reason, addon: kind.addon, label: kind.label, priority: kind.priority };
}
export function addonKind(reason: string): AddonKind | undefined {
  return addonKinds.get(reason);
}

// The steps that move the account's gold or items. A kind runs them only when it declares
// `spends: true` and the player has switched its routine on (routineEnabled), which is the player's
// consent; a declared kind starts switched off. Every other gold spend in the console runs behind a
// confirmation too.
export const ASSET_STEPS: ReadonlySet<string> = new Set(['gold.donate', 'gold.send', 'item.send', 'mail.send']);
const spendsDeclared = (ask: MerchantKindAsk): boolean => ask.spends === true;
// One step of an add-on job against the kind's bounds, before the dispatcher sees it: its shape and the kind's
// spend consent. A send step may name any recipient, because the player chose the add-on and switched its
// routine on. It answers the refusal's reason, or nothing.
export function addonStepRefusal(step: unknown, facts: { spends: boolean }): string | undefined {
  const s = step as { action?: unknown; walk?: { to?: unknown } } | null;
  if (!s || typeof s !== 'object') return 'a step is an action or a walk';
  if (s.walk) return s.walk.to === 'town' || typeof (s.walk.to as { map?: unknown })?.map === 'string' ? undefined : 'a walk names a point or town';
  if (typeof s.action !== 'string') return 'a step is an action or a walk';
  if (ASSET_STEPS.has(s.action) && !facts.spends) return `KY: ${s.action} needs a kind that declares spends`;
  return undefined;
}
// The command's fields and steps are saved with the job (coordinator/owner.ts), so they must survive
// a JSON round trip unchanged, as the settings writer's restore check (SV) reads them.
export function jsonWhole(value: unknown): boolean {
  try { return JSON.stringify(JSON.parse(JSON.stringify(value ?? null))) === JSON.stringify(value ?? null); } catch { return false; }
}
// A refused or failed step's core retry (`retry.policy`). A step a common hold
// refused waits one call window and does not count, so the job goes on once the hold lifts. Every
// other refusal or failure ends the job, and an add-on answer may only give up sooner.
export function stepRetry(outcome: { outcome: string; by?: string }): { wait: number; giveUp: boolean; counts: boolean } {
  return outcome.outcome === 'refused' && outcome.by === 'holds' ? { wait: 0, giveUp: false, counts: false } : { wait: 0, giveUp: true, counts: true };
}
// The gathering modes a merchant can switch on: the saved field's check, the routes and the
// cooldown report read this one list, so the import refuses what the routes refuse.
export const GATHERING_MODES = ['fishing', 'mining'] as const;
export type GatheringMode = (typeof GATHERING_MODES)[number];
export function isGatheringMode(value: unknown): value is GatheringMode {
  return (GATHERING_MODES as readonly unknown[]).includes(value);
}
// Merchant's Luck as both runtimes read it, v1.5.0's numbers
// (character/luck.ts): a cast reaches 200 and needs merchant level 40.
export const MERCHANT_LUCK = { range: 200, level: 40 } as const;
// The visit visibility range (v1.5.0's): a visited fighter within 180 of the
// merchant drops its invisibility.
export const VISIBILITY_RANGE = 180;
// The collection threshold: the merchant is near a member within 200 (v1.5.0's
// collection radius).
export const NEARBY_RADIUS = 200;
// The commerce report fence's version: a job stamped with it answers only reports of its own
// command (runtime/coordinator/merchant/commands.ts:202).
export const COMMERCE_PROGRESS_VERSION = 2;
// The visit handoff's two values (v1.5.0's): the send reach 400, which
// saved-fields.ts declares, and the order handoff's 45 s wait for the merchant, which the
// character's visits.ts reads.
export const HANDOFF = { sendDistance: 400, playerWaitMs: 45_000 } as const;
// How long a group walk stays paused for the merchant's visit to a member; movement's gives the
// pause's deadline to its asker. names it here, a pick no screen shows.
export const MERCHANT_PAUSE_DEADLINE_MS = 60_000;
// A routine priority is a whole number from 0 to 100: the saved field's check.
export const ROUTINE_PRIORITY = { min: 0, max: 100 } as const;
// `after: 'market-recheck'`: the completion reads the market again this long after a purchase
// (runtime/coordinator/merchant/completion.ts:74).
export const MARKET_RECHECK_MS = 1_000;

// The holds: who has the merchant before a job runs. The dispatch pass reads the rows top down and the first that holds
// decides. The rows sit in the order the dispatcher of v1.5.0 tested them, so the table gives the same
// decision for every state. `then` is what the pass does for the holder: nothing (`wait`),
// start Bankboi storage, send the stand return, send the items owner's recover command, or pause an unacknowledged job.
// The merchant check passes into the queue hygiene, which runs only for a merchant that can work.
export interface HoldFacts {
  consoleUpdate(): boolean; partySwitch(): boolean; eventReserved(): boolean; productionPending(): boolean; upgradeBagBusy(): boolean; castInFlight(): boolean;
  partyVisitMoving(): boolean; homeMoving(): boolean; merchantUnfit(): boolean; jobRunning(): boolean;
  noMerchant(): boolean; manualCommand(): boolean; storagePending(): boolean; standFeatured(): boolean;
  anniversaryHeld(): boolean; forceStand(): boolean;
}
export interface HoldRow {
  row: number; holder: string; holds: (facts: HoldFacts) => boolean;
  then: 'wait' | 'storage' | 'stand' | 'recover' | 'pause'; passes?: 'observe' | 'eligibility' | 'hygiene';
}
// The two rows above the event row hold the stand return too; passing them runs the silence
// check and the prune of ineligible pickups. Passing the party visit's realm hold marks each party
// visit's realm block, before the home return and the merchant's life are read, so the card's
// realm reason stays fresh while the merchant is dead, silent or going home.
export const HOLDS: readonly HoldRow[] = [
  { row: 1, holder: 'lifecycle', holds: f => f.consoleUpdate(), then: 'wait' },
  { row: 1, holder: 'party-switch', holds: f => f.partySwitch(), then: 'wait', passes: 'observe' },
  // An event reservation pauses an assigned job the character has not acknowledged, so the reply
  // that carries the reservation carries no job command.
  { row: 1, holder: 'event', holds: f => f.eventReserved(), then: 'pause' },
  { row: 4, holder: 'production', holds: f => f.productionPending(), then: 'recover' },
  { row: 4, holder: 'upgrade-bag', holds: f => f.upgradeBagBusy(), then: 'wait' },
  { row: 6, holder: 'cast', holds: f => f.castInFlight(), then: 'wait' },
  { row: 1, holder: 'realm-hold:visit', holds: f => f.partyVisitMoving(), then: 'wait', passes: 'eligibility' },
  { row: 1, holder: 'realm-hold:home', holds: f => f.homeMoving(), then: 'wait' },
  { row: 7, holder: 'merchant', holds: f => f.merchantUnfit(), then: 'wait', passes: 'hygiene' },
  { row: 0, holder: 'job', holds: f => f.jobRunning(), then: 'wait' },
  { row: 7, holder: 'no-merchant', holds: f => f.noMerchant(), then: 'wait' },
  { row: 5, holder: 'manual', holds: f => f.manualCommand(), then: 'wait' },
  { row: 3, holder: 'storage', holds: f => f.storagePending(), then: 'storage' },
  { row: 2, holder: 'anniversary:featured', holds: f => f.standFeatured(), then: 'stand' },
  { row: 1, holder: 'anniversary', holds: f => f.anniversaryHeld(), then: 'wait' },
  { row: 2, holder: 'user:force-stand', holds: f => f.forceStand(), then: 'stand' },
];
export function holdOf(facts: HoldFacts, passed: (row: HoldRow) => void): HoldRow | null {
  for (const hold of HOLDS) {
    if (hold.holds(facts)) return hold;
    passed(hold);
  }
  return null;
}

// The pick: one readiness that the dispatch, the checkpoint and the stand return all
// read, so none of them sees work the others refuse.
export interface ReadyFacts {
  now: number;
  enabled?(job: PrioritizedJob): boolean;
  waits?(job: PrioritizedJob): boolean;
  capacityBlocked(job: PrioritizedJob): boolean;
  collectionReady(job: PrioritizedJob): boolean;
  // The realm term: whether the job runs on the realm the merchant stands on.
  here?(job: PrioritizedJob): boolean;
}
export const READY: readonly { rule: string; ready: (job: PrioritizedJob, facts: ReadyFacts) => boolean }[] = [
  { rule: 'its routine is on', ready: (job, f) => f.enabled?.(job) !== false },
  { rule: "its target's task allows the visit", ready: (job, f) => !f.waits?.(job) },
  { rule: 'the realm owner has not blocked it', ready: job => !job.realmBlockedReason },
  { rule: 'its retry time has passed', ready: (job, f) => Number(job.retryAt || 0) <= f.now },
  { rule: 'it is not held on Bankboi', ready: job => !job.blockedOnBankboi },
  { rule: 'the merchant has room for it', ready: (job, f) => !f.capacityBlocked(job) },
  { rule: 'its collection is ready', ready: (job, f) => f.collectionReady(job) },
];
export function jobReady(job: PrioritizedJob, facts: ReadyFacts): boolean {
  return READY.every(row => row.ready(job, facts));
}
// A gathering mode is a candidate when it is on, its tool is not recorded missing,
// the later of the coordinator's and the report's cooldown has passed, and the merchant has `room`.
export function gatheringCandidates(modes: readonly string[], cooldown: (mode: string) => number, room: boolean,
  now: number, noTool: Readonly<Record<string, boolean>>): string[] {
  return room ? modes.filter(mode => !noTool[mode] && cooldown(mode) <= now) : [];
}

// The interrupts: what may take the merchant from a running job at its checkpoint. The
// first row that matches decides; with none the job runs on.
export interface CheckpointFacts {
  cycleBoundary: boolean; reserved: boolean; kind: JobKind; manualHeld: boolean;
  currentPriority: number; waitingPriority: number;
}
export const INTERRUPTS: readonly { row: number; when: (facts: CheckpointFacts) => boolean; yields: boolean; by: string }[] = [
  { row: 4, when: f => !f.cycleBoundary, yields: false, by: 'executor' },
  { row: 1, when: f => f.reserved && f.kind.interrupt !== 'never', yields: true, by: 'event' },
  { row: 2, when: f => f.manualHeld, yields: true, by: 'manual' },
  { row: 3, when: f => f.waitingPriority > f.currentPriority, yields: true, by: 'priority' },
];
export function interruptOf(facts: CheckpointFacts) {
  return INTERRUPTS.find(row => row.when(facts)) ?? null;
}

// The endings: every way a job ends and what its retry keeps. `id` keeps the job's id or
// gives the retry a new one that names the old (`resumedFrom`); `queuedAt` keeps its place in line
// or puts it at now; `retryAt` is v1.5.0's wait; `ladder` is the failure the next
// claim books on the tasks owner's merchant-job ladder. The rows sit in the order the
// completion classifier tested them. `orderWait` is the wait a failed buy-upgrade order takes at
// that row instead: v1.5.0 gave any failed buy order the commerce delay after the
// death and movement checks, and:207 gave a realm failure its 10 s after that.
export interface EndingFacts {
  movementOwned: boolean; movement: boolean; anniversaryYield: boolean; realm: boolean; rendezvous: boolean;
  storageYield: boolean; death: boolean; interrupted: boolean; interruptedOrder: boolean; commerce: boolean; kind: JobKind;
}
export type EndingWait = 'none' | 'ten-seconds' | 'commerce' | 'movement-streak' | 'realm';
export interface EndingRow {
  row: number; ending: string; when: (facts: EndingFacts) => boolean; id: 'keep' | 'new'; queuedAt: 'keep' | 'now';
  retryAt: EndingWait; ladder: string | null; counts: boolean; message: string; orderWait?: EndingWait;
}
export const ENDINGS: readonly EndingRow[] = [
  { row: 2, ending: 'hunt_movement_owned', when: f => f.movementOwned, id: 'keep', queuedAt: 'keep', retryAt: 'none', ladder: null,
    orderWait: 'commerce', counts: false, message: 'Merchant work deferred until Hunt releases movement' },
  { row: 7, ending: 'movement', when: f => f.movement, id: 'new', queuedAt: 'now', retryAt: 'movement-streak', ladder: 'job-interrupted',
    counts: true, message: 'Merchant work queued for movement retry; progress preserved' },
  { row: 3, ending: 'merchant_anniversary_reserved', when: f => f.anniversaryYield && f.kind.retry !== 'never', id: 'new', queuedAt: 'now',
    retryAt: 'none', orderWait: 'commerce', ladder: null, counts: false, message: 'Merchant paused for anniversary; preserving job' },
  { row: 8, ending: 'wrong realm', when: f => f.realm, id: 'new', queuedAt: 'now', retryAt: 'realm', ladder: 'realm-switch',
    counts: true, message: 'Merchant target changed realm; preserving unfinished work' },
  { row: 6, ending: 'rendezvous-timeout', when: f => f.rendezvous && f.kind.retry !== 'never', id: 'new', queuedAt: 'now',
    retryAt: 'ten-seconds', orderWait: 'commerce', ladder: 'rendezvous-timeout', counts: false, message: 'Merchant rendezvous stalled; retrying in ten seconds' },
  { row: 2, ending: 'bankboi_pending', when: f => f.storageYield && f.kind.retry !== 'never', id: 'keep', queuedAt: 'now', retryAt: 'none',
    orderWait: 'commerce', ladder: null, counts: false, message: 'Merchant paused for Bankboi storage; preserving job' },
  { row: 5, ending: 'died on rendezvous', when: f => f.death && f.kind.retry !== 'never', id: 'new', queuedAt: 'now', retryAt: 'ten-seconds',
    ladder: 'job-interrupted', counts: true, message: 'Merchant job interrupted; preserving it for retry' },
  { row: 4, ending: 'order interrupted', when: f => f.interruptedOrder, id: 'new', queuedAt: 'now', retryAt: 'commerce', ladder: 'job-interrupted',
    counts: true, message: 'Merchant commerce interrupted; preserving it for retry' },
  { row: 4, ending: 'commerce interrupted', when: f => f.interrupted && f.commerce, id: 'new', queuedAt: 'now', retryAt: 'none',
    ladder: 'job-interrupted', counts: true, message: 'Merchant commerce interrupted; preserving it for retry' },
  { row: 4, ending: 'interrupted', when: f => f.interrupted && f.kind.retry !== 'never', id: 'new', queuedAt: 'now', retryAt: 'none',
    ladder: 'job-interrupted', counts: true, message: 'Merchant job interrupted; preserving it for retry' },
];
export function endingOf(facts: EndingFacts): EndingRow | null {
  const row = ENDINGS.find(candidate => candidate.when(facts));
  if (!row) return null;
  return facts.interruptedOrder && row.orderWait ? { ...row, retryAt: row.orderWait } : row;
}
// The endings' waits, v1.5.0's numbers. `ten-seconds` follows a rendezvous or a death and
// `realm` a realm retry: each runs at the member's next report (endings.ts `waitFor`), and
// ENDING_RETRY_MS bounds a member that never reports. `commerce` and `movement-streak` climb the
// commerce delay by the order's count or the movement failure streak; `recovery` is row 9's stopped
// job, doubling to its cap. Both backoffs are bounds against an outside failure, and each one booked
// goes to the status owner's bound record. `cleanout-repeat` is a partial cleanout's next pickup.
const ENDING_RETRY_MS = 10_000;
const COMMERCE_RETRY_MS = [10_000, 30_000, 60_000, 300_000] as const;
const RECOVERY_RETRY_MS = 20_000, RECOVERY_RETRY_CAP_MS = 300_000;
export function endingWaitMs(wait: EndingWait | 'recovery' | 'cleanout-repeat', attempt = 1): number {
  if (wait === 'none') return 0;
  if (wait === 'commerce' || wait === 'movement-streak') return COMMERCE_RETRY_MS[Math.min(3, Math.max(0, attempt - 1))]!;
  if (wait === 'recovery') return Math.min(RECOVERY_RETRY_CAP_MS, RECOVERY_RETRY_MS * 2 ** Math.min(4, attempt - 1));
  return ENDING_RETRY_MS;
}
// The realm ending's retry, which the completion's realm ending and the party visit's failed switch both
// book (realm half): no count blocks the job, its realm attempts climb, and the row's ladder
// failure is booked at the next claim (3.6).
const REALM_ENDING = ENDINGS.find(row => row.ending === 'wrong realm')!;
export function realmRetry(attempts: unknown, now: number): { realmAttempts: number; ladderDue: string; retryAt: number } {
  return { realmAttempts: Number(attempts || 0) + 1, ladderDue: REALM_ENDING.ladder!, retryAt: now + endingWaitMs(REALM_ENDING.retryAt) };
}
// The rung a booked failure climbs from, by the job's own count of failures (1 is
// `walk`, 5 and more `fall-back`).
const LADDER_FROM = ['walk', 'alternative', 'regroup', 'safe-point', 'fall-back'] as const;
export function ladderFrom(count: number): typeof LADDER_FROM[number] {
  return LADDER_FROM[Math.max(0, Math.min(LADDER_FROM.length, count) - 1)]!;
}
// The fields of a running job that every pause strips, so a resumed job carries no part of the
// run it left; its resume state, receipts and counts stay.
export const RUN_FIELDS = ['phase', 'operationStage', 'startedAt', 'checkpointAt', 'handoff', 'commandId', 'commandReport',
  'heartbeatAt', 'itemMarksCleared'] as const;

// The silence safety bound: it catches a merchant that the lifecycle owner holds online and that still reports
// while the system has stopped its job. The reports stop naming the running job while they go on, because a code reload replaced its frame without a stop or the network lost the job's
// completion. The value is v1.5.0's; no game data or measurement gives it (queue). The runner
// reads the same bound, so a holder no older than it after a code reload is still live and runs no duplicate.
export const JOB_LIVE_MS = 20_000;

// The routines: the routine a job runs as, its words, its switch and the saved priorities' migration.
/** User-facing priorities are independent of the executor transport. */
export interface RoutineJob { reason: string; manual?: boolean; bidItemId?: string | null; routine?: string; order?: unknown; autoExchangeKeys?: string[] }
const purchases = new Set(['stand purchases', 'stand bid purchases', 'ALData marketplace purchases', 'Ponty purchases']);
function purchaseRoutine(job: RoutineJob): string {
  return job.manual === true || (!job.bidItemId && job.reason !== 'stand bid purchases') ? 'manual marketplace purchases' : 'stand bid purchases';
}
function exchangeRoutine(job: RoutineJob): string {
  return job.autoExchangeKeys?.length ? 'automatic exchange' : 'manual exchange';
}
export function routineFor(job: RoutineJob): string {
  if (job.reason === 'bank collection') return 'party collection';
  if (job.reason === 'exchange') return exchangeRoutine(job);
  if (job.routine) return job.routine;
  if (purchases.has(job.reason)) return purchaseRoutine(job);
  if (job.reason === 'merchant commerce') return (job.order as {crafts?: unknown[]})?.crafts?.length ? 'manual crafting' : 'manual buying';
  return merchantKind(job.reason).routine ?? job.reason;
}
// Each routine's two word sets as v1.5.0 showed them. `queue` names a job in the queue
// rows, tooltips and the card line; `dialog` names a routine in the priorities dialog and the cancel
// dialog's title, in the dialog's order. A routine with no `queue` word reads as its name with a
// capital. `automatic` marks a routine with an automation switch: the priorities dialog shows its
// switch, and a cancel of its job turns it off, so the cancel control asks your confirmation first.
const ROUTINE_WORDS: Readonly<Record<string, { queue?: string; dialog?: string; automatic?: true }>> = {
  'merchant luck': { queue: "Merchant's Luck", dialog: "Merchant's Luck", automatic: true },
  'inventory cleanout': { queue: 'Emergency cleanout', dialog: 'Emergency inventory cleanout', automatic: true },
  'manual visit': { queue: 'Manual visit', dialog: 'Manual player visit' },
  deliveries: { queue: 'Marked deliveries', dialog: 'Marked deliveries' },
  withdrawals: { queue: 'Marked withdrawals', dialog: 'Marked withdrawals' },
  'party collection': { queue: 'Item collection', dialog: 'Automatic item collection', automatic: true },
  restock: { queue: 'Party restock', dialog: 'Party restock', automatic: true },
  'gold threshold': { queue: 'Auto gold collection', dialog: 'Automatic gold collection', automatic: true },
  'npc sales': { queue: 'NPC sales', dialog: 'Manual NPC sales' },
  'manual marketplace purchases': { queue: 'Manual purchase', dialog: 'Manual marketplace purchases' },
  'auto npc sales': { queue: 'Auto NPC sales', dialog: 'Auto NPC sales', automatic: true },
  'collect mail': { dialog: 'Collect mail' },
  'stand bid purchases': { queue: 'Auto purchase', dialog: 'Automatic WTB fills', automatic: true },
  'upgrade preview': { dialog: 'Refresh upgrade chances' },
  'manual upgrades': { dialog: 'Manual upgrades' },
  'auto upgrade': { dialog: 'Auto upgrade', automatic: true },
  'manual compounds': { dialog: 'Manual compounds' },
  'ALData marketplace sales': { dialog: 'ALData marketplace sales' },
  'auto compound': { dialog: 'Auto compound', automatic: true },
  'manual buying': { dialog: 'Manual buying' },
  'manual crafting': { queue: 'Craft', dialog: 'Manual crafting' },
  'manual exchange': { dialog: 'Manual exchange' },
  'automatic exchange': { dialog: 'Automatic exchange', automatic: true },
  'merchant donation': { queue: 'Donate gold', dialog: 'Donate gold' },
  'send mail': { dialog: 'Send mail' },
  'join giveaway': { dialog: 'Join giveaways', automatic: true },
  'stand maintenance': { queue: 'Stand maintenance', dialog: 'Stand listing maintenance' },
  fishing: { queue: 'Fishing', dialog: 'Fishing' },
  mining: { queue: 'Mining', dialog: 'Mining' },
  'merchant idle': { queue: 'Idle', dialog: 'Idle at stand' },
  'manual bank exchange': { queue: 'Bank exchange', dialog: 'Manual bank exchange' },
};
export function automaticRoutine(routine: string): boolean {
  return ROUTINE_WORDS[routine]?.automatic === true;
}
export function routineLabel(routine: string): string {
  return ROUTINE_WORDS[routine]?.queue ?? routine.charAt(0).toUpperCase() + routine.slice(1);
}
// A job's whole label, which the card's queue rows, tooltips and cancel control read: the bank stage
// while the job is in the bank, a giveaway's host and prize, the manual buying words, the job kind's own queue
// words for a kind whose routine names another ('bank collection'), else the routine's, and a
// purchase's Ponty, item and realm details. The catalog names the items.
interface LabelItem { name?: string; level?: number }
export interface LabelJob extends RoutineJob {
  operationStage?: string; seller?: string; expectedItem?: LabelItem;
  order?: { buys?: { desiredLevel?: number }[] };
  listings?: { item?: LabelItem; buyQuantity?: number; quantity?: number; serverRegion?: string; serverIdentifier?: string }[];
}
type LabelCatalog = readonly { id: string; name: string }[];
function itemLabel(item: LabelItem | undefined, catalog: LabelCatalog): string {
  if (!item?.name) return '';
  const name = catalog.find(entry => entry.id === item.name)?.name || item.name;
  return name + (item.level === undefined ? '' : ` +${item.level}`);
}
function purchaseDetails(job: LabelJob, catalog: LabelCatalog): string[] {
  const items = new Map<string, number>(), realms = new Set<string>();
  for (const listing of job.listings || []) {
    const name = itemLabel(listing.item || { name: job.bidItemId ?? undefined }, catalog);
    if (name) items.set(name, (items.get(name) || 0) + Number(listing.buyQuantity || listing.quantity || 1));
    if (listing.serverRegion && listing.serverIdentifier) realms.add(`${listing.serverRegion} ${listing.serverIdentifier}`);
  }
  return [
    ...(job.reason === 'Ponty purchases' ? ['Ponty'] : []),
    ...[...items].map(([name, quantity]) => quantity > 1 ? `${quantity.toLocaleString()} × ${name}` : name),
    ...realms,
  ];
}
export function merchantJobLabel(job: LabelJob, catalog: LabelCatalog = []): string {
  if (job.operationStage === 'retrieving') return 'Bank retrieval';
  if (job.operationStage === 'storing') return 'Bank storage';
  const routine = routineFor(job);
  if (routine === 'join giveaway') {
    const prize = itemLabel(job.expectedItem, catalog);
    return `Join ${job.seller ? `${job.seller}'s ` : ''}giveaway${prize ? ` for ${prize}` : ''}`;
  }
  if (routine === 'manual buying')
    return job.order?.buys?.some(item => Number(item.desiredLevel) > 0) ? 'Buy and upgrade' : 'Buy';
  const label = merchantKind(job.reason).label ?? routineLabel(routine);
  return ['manual marketplace purchases', 'stand bid purchases'].includes(routine)
    ? [label, ...purchaseDetails(job, catalog)].join(' · ') : label;
}
// The routines the priorities dialog lists, with their dialog words.
export const ROUTINE_DIALOG_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ROUTINE_WORDS).flatMap(([routine, words]) => words.dialog ? [[routine, words.dialog]] : []));
export function routineEnabled(job: RoutineJob, enabled: Record<string, boolean | undefined>): boolean {
  if (routineFor(job) === 'manual exchange') return true;
  // A kind that declares spends runs only after the player switches it on.
  if (addonKind(job.reason)?.spends) return enabled[routineFor(job)] === true;
  if (job.reason === 'party collection' && job.manual === true) return true;
  return enabled[routineFor(job)] !== false;
}
export function autoUpgradePriority(saved: Record<string, number>): number {
  return saved['manual upgrades'] ?? saved['upgrades and compounds'] ?? 70;
}
export function autoUpgradeEnabled(saved: Record<string, boolean> = {}): boolean {
  return saved['manual upgrades'] ?? saved['upgrades and compounds'] ?? true;
}
export function migrateRoutinePriorities(saved: Record<string, number> = {}): Record<string, number> {
  const { exchange, ...current } = saved;
  return {
    ...exchangePriorities(exchange),
    'manual marketplace purchases': Math.max(saved['stand purchases'] ?? 75, saved['ALData marketplace purchases'] ?? 76),
    'manual upgrades': saved['upgrades and compounds'] ?? 70,
    'auto upgrade': autoUpgradePriority(saved),
    'manual compounds': saved['upgrades and compounds'] ?? 70,
    'manual buying': saved['merchant commerce'] ?? 65,
    'manual crafting': saved['merchant commerce'] ?? 65,
    'auto npc sales': saved['npc sales'] ?? 80,
    ...current,
  };
}
function exchangePriorities(priority: number | undefined): Record<string, number> {
  return { 'manual exchange': priority ?? 67, 'automatic exchange': priority ?? 67 };
}

export function migrateExchangeAutomations(saved: Record<string, boolean> = {}): Record<string, boolean> {
  const { exchange, 'manual exchange': _manual, ...current } = saved;
  return { 'automatic exchange': exchange ?? true, ...current };
}

export function splitLegacyWork<T extends RoutineJob & {id: string}>(job: T): T[] {
  if (job.reason === 'upgrades and compounds') return [{...job, reason: 'manual upgrades'}, {...job, id: job.id + '-compounds', reason: 'manual compounds'}];
  const order = job.order as {buys?: unknown[]; crafts?: unknown[]} | undefined;
  if (job.reason !== 'merchant commerce' || !order?.buys?.length || !order.crafts?.length) return [job];
  return [{...job, order: {...order, buys: []}, routine: 'manual crafting'},
    {...job, id: job.id + '-buy', routine: 'manual buying', blockedOnBankboi: false, order: {...order, crafts: [], sources: {}, bank: [], storage: [], requirements: [], materialBuys: []}}];
}

// The priority: a job's rank from its routine, its own override or its bid's, and the queue stamp.
export interface PrioritizedJob {
  offeringSupply?: {offering: string; outstanding: number; state: string; blockingReason: string | null; rulesSignature: string; intents?: unknown};
  exchangePickupId?: string;
  exchangeDeliveryId?: string;
  autoExchangeKeys?: string[];
  realmBlockedReason?: string;
  reason: string;
  manual?: boolean;
  routine?: string;

  target?: string | null;
  bidItemId?: string;
  priorityOverride?: number;
  queuedAt?: number;
  retryAt?: number;
  // The member whose next report runs the retry before retryAt (endings.ts `waitFor`).
  retryOn?: { character: string; living: boolean };
  blockedOnBankboi?: boolean;
  // The retry state a merge keeps (mergeTiming) and the ladder failure the next claim books (3.6).
  retryCount?: number;
  rendezvousRetryCount?: number;
  recoveryAttempts?: number;
  ladderDue?: string;
}

export interface PriorityPolicy {
  routines: Readonly<Record<string, number>>;
  bids: Readonly<Record<string, { priorityOverride?: number } | undefined>>;
  /** True only for a merchant retrieval from occupied outbound staging. */
  completesStorageHandoff(job: PrioritizedJob): boolean;
}

export function merchantRoutinePriority(
  priorities: Readonly<Record<string, number>>,
  reason: string,
): number {
  const value = Number(priorities[merchantKind(reason).priorityRoutine ?? reason]);
  return Number.isInteger(value) ? Math.max(ROUTINE_PRIORITY.min, Math.min(ROUTINE_PRIORITY.max, value)) : 50;
}

// The priorities dialog's two edits, v1.5.0's rule (routine-priorities-dialog.tsx). A
// typed value keeps its digits and clamps to the range. A drag puts `keys[index]` one below the routine
// above it, or one above the next at the top; each routine after it stays below the one above. A chain
// that falls under the range's floor renumbers from the top of the range down, one per routine.
export function typedRoutinePriority(text: string): number {
  return Math.max(ROUTINE_PRIORITY.min, Math.min(ROUTINE_PRIORITY.max, Number(text.replace(/[^0-9]/g, '')) || 0));
}
export function movedRoutinePriorities(draft: Readonly<Record<string, number>>, keys: readonly string[], index: number): Record<string, number> {
  const next = { ...draft }, source = keys[index]!;
  next[source] = index
    ? merchantRoutinePriority(next, keys[index - 1]!) - 1
    : merchantRoutinePriority({ [source]: merchantRoutinePriority(next, keys[1]!) + 1 }, source);
  for (let i = 1; i < keys.length; i++)
    next[keys[i]!] = Math.min(merchantRoutinePriority(next, keys[i]!), merchantRoutinePriority(next, keys[i - 1]!) - 1);
  if (keys.some(key => next[key]! < ROUTINE_PRIORITY.min)) keys.forEach((key, i) => { next[key] = ROUTINE_PRIORITY.max - i; });
  return next;
}

function validOverride(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= ROUTINE_PRIORITY.min && value <= ROUTINE_PRIORITY.max;
}

export function merchantJobPriority(job: PrioritizedJob, policy: PriorityPolicy): number {
  // An outbound handoff must release staging before optional merchant work.
  if (policy.completesStorageHandoff(job)) return 101;
  if (validOverride(job.priorityOverride)) return job.priorityOverride;
  const override = job.manual !== true && job.bidItemId ? policy.bids[job.bidItemId]?.priorityOverride : undefined;
  return validOverride(override) ? override : merchantRoutinePriority(migrateRoutinePriorities(policy.routines), routineFor(job));
}

export function stampMerchantJob<T extends PrioritizedJob>(
  job: T,
  priority: (job: PrioritizedJob) => number,
  now: number,
) {
  const normalized =
    job.reason === "merchant luck exchange"
      ? { ...job, reason: "merchant luck", expandLuckCluster: false, castMerchantLuck: true }
      : job;
  return {
    ...normalized,
    queuedAt: Number(normalized.queuedAt) || now,
    priority: priority(normalized),
  };
}

// The order reads the readiness.
export interface QueueSelection extends ReadyFacts {
  priority(job: PrioritizedJob): number;
}

// The order, which the pick and `jobs.ready` both read: the higher priority first, then the
// job on the merchant's realm, then the earlier queued. A negative answer puts `a` first. The realm
// term keeps the merchant on another realm for a second job there; v1.5.0 hopped home for an
// older home job of the same priority and back.
export function pickOrder(a: PrioritizedJob, b: PrioritizedJob, priority: (job: PrioritizedJob) => number,
  here?: (job: PrioritizedJob) => boolean): number {
  return priority(b) - priority(a) || Number(!!here?.(b)) - Number(!!here?.(a)) || Number(a.queuedAt) - Number(b.queuedAt);
}

/** Returns an index, leaving dequeueing and persistence to the queue owner. */
export function selectMerchantJob(
  queue: readonly PrioritizedJob[],
  policy: QueueSelection,
): number | null {
  let selected: number | null = null;
  queue.forEach((job, index) => {
    if (!jobReady(job, policy)) return;
    if (selected === null || pickOrder(job, queue[selected]!, policy.priority, policy.here) < 0) selected = index;
  });
  return selected;
}


// The staging and capacity policy: the outbound staging's rank, the bid order, the transfer room
// check and the capacity signature.
interface BankCapacity {
  bankbois?: Record<string, unknown>;
  merchantCharacter: string | null;
  bankSnapshot?: { packs?: Record<string, Record<number, unknown> | undefined> } | null;
}
export interface PriorityState<Bid extends { priorityOverride?: number }> extends BankCapacity {
  merchantRoutinePriorities: Record<string, number>;
  standBids?: Record<string, Bid | undefined> | null;
  merchantAutomations?: Record<string, boolean | undefined>;
  withdrawals: Record<string, { pack?: string; slot?: number; improvement?: string; autoNpcRuleKey?: string }[] | undefined>;
}
interface InventoryCapacity extends BankCapacity, LuckySlots {
  statuses: Record<string, { items?: unknown } | undefined>;
}

function completesStorageHandoff<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): boolean {
  if (!bankStagingReserved(state)) return false;
  if (job.target !== state.merchantCharacter || !merchantKind(job.reason).releasesStaging) return false;
  return (state.withdrawals?.[String(state.merchantCharacter)] || []).some(
    (request) =>
      (routineFor(job) === routineFor({reason: request.improvement || "manual bank exchange"}) ||
        merchantKind(job.reason).mergeGroup === 'bank' && hasMarkedWithdrawals([request])) &&
      // The staging row is the items owner's (rules.ts `stagingCell`).
      stagingCell(request.pack, request.slot) &&
      state.bankSnapshot?.packs?.items1?.[Number(request.slot)],
  );
}

/** Outbound staging retrieval outranks optional jobs only while its reserved slot is occupied. */
export function coordinatorMerchantPriority<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): number {
  const policy: PriorityPolicy = {
    routines: played(state, 'merchantRoutinePriorities'),
    bids: state.standBids || {},
    completesStorageHandoff: (candidate) => completesStorageHandoff(state, candidate),
  };
  const priority = merchantJobPriority(job, policy);
  // The merchant's bank job that carries auto NPC stock is the sale's prerequisite, so it runs at
  // the sale's priority when that is higher; its own enable and threshold gates stay.
  if (job.target !== state.merchantCharacter || merchantKind(job.reason).mergeGroup !== 'bank' || !automaticNpcRetrieval(state)) return priority;
  return Math.max(priority, merchantJobPriority({ reason: 'auto npc sales' }, policy));
}

export function coordinatorPrioritizedBids<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  reason: string,
): [string, Bid][] {
  return Object.entries(state.standBids || {}).filter((entry): entry is [string, Bid] => !!entry[1]).sort(
    ([first], [second]) =>
      coordinatorMerchantPriority(state, { reason, bidItemId: second }) -
      coordinatorMerchantPriority(state, { reason, bidItemId: first }),
  );
}

export function coordinatorMerchantTransferBlocked(
  state: InventoryCapacity,
  job: PrioritizedJob | null | undefined,
): boolean {
  const slots = job && job.target !== state.merchantCharacter ? merchantKind(job.reason).needs?.slots : undefined;
  if (!slots) return false;
  // The items owner's free slots: the lucky slot's held cell, by the items owner's
  // precedence (luckySlotOf), does not count as room, as bagFull reads it.
  const merchant = String(state.merchantCharacter), items = state.statuses[merchant]?.items;
  return Array.isArray(items) && freeSlots(items, luckySlotOf(state, merchant), protectedSlotsOf(state, merchant)) < slots;
}

/** Movement, gold and heartbeat timestamps must not retry a job whose storage capacity is unchanged. */
export function coordinatorMerchantCapacitySignature(
  state: InventoryCapacity,
  name: string | null,
): string {
  return JSON.stringify([
    state.statuses[String(state.merchantCharacter)]?.items || [],
    state.statuses[String(name)]?.items || [],
    state.bankSnapshot?.packs || {},
  ]);
}

// The defaults of the routine priorities and the automation switches.

export function defaultMerchantRoutinePriorities(): Record<string, number> {
  return {
    "merchant luck": 100,
    "inventory cleanout": 95,
    "manual visit": 90,
    deliveries: 90,
    withdrawals: 90,
    "ALData authentication": 90,
    "party collection": 90,
    restock: 90,
    "gold threshold": 85,
    "npc sales": 80,
    "auto npc sales": 80,
    "auto npc sale pickup": 80,
    "manual marketplace purchases": 76,
    "upgrade preview": 70,
    "manual upgrades": 70,
    "auto upgrade": 70,
    "manual compounds": 70,
    "manual buying": 65,
    "manual crafting": 65,
    "npc sale pickup": 80,
    "deconstruction": 80,
    "deconstruction pickup": 80,
    "stand purchases": 75,
    "stand bid purchases": 75,
    "ALData marketplace purchases": 76,
    "ALData marketplace sales": 76,
    "upgrades and compounds": 70,
    "auto compound": 68,
    "manual exchange": 67,
    "automatic exchange": 67,
    "merchant commerce": 65,
    "merchant donation": 60,
    "join giveaway": 55,
    "stand search": 50,
    "stand maintenance": 40,
    fishing: 20,
    mining: 20,
    "merchant idle": 0,
    "manual bank exchange": 80,
    "bank unlock": 90,
    "send mail": 90,
    "collect mail": 90,
  };
}
export function defaultMerchantAutomations(): Record<string, boolean> {
  return {
    'craft fishing tools': false,
    'craft mining tools': false,
    deliveries: true,
    withdrawals: true,
    "merchant luck": true,
    "party collection": true,
    "auto npc sales": true,
    restock: true,
    "gold threshold": true,
    "inventory cleanout": true,
    "auto compound": true,
    "auto upgrade": true,
    "automatic exchange": true,
    "stand bid purchases": true,
    "join giveaway": true,
  };
}


// The pickup kinds and their merge per target.
export function pickupReason(reason: string, target: string | null | undefined, merchant: string | null | undefined): string {
  return target && target !== merchant && merchantKind(reason).autoPickup ? 'marked items' : reason;
}
/** Never apply to a running command: this migration is for pending work only. */
export function normalizePickupJob<T extends PrioritizedJob>(job: T, merchant: string | null | undefined): T {
  const reason = pickupReason(job.reason, job.target, merchant);
  if (reason === job.reason && reason !== 'marked items') return job;
  const normalized = {...job, reason, routine: 'party collection', operationStage: undefined};
  delete normalized.priorityOverride;
  return normalized;
}
// A merged job keeps the earlier place in line, the later retry time and the further retry state:
// the higher of each count, so its ladder failure climbs from the higher rung.
const RETRY_COUNTS = ['retryCount', 'rendezvousRetryCount', 'recoveryAttempts'] as const;
export function mergeTiming(previous: PrioritizedJob, job: PrioritizedJob): void {
  const age = Math.min(previous.queuedAt ?? Infinity, job.queuedAt ?? Infinity);
  if (Number.isFinite(age)) previous.queuedAt = age;
  previous.retryAt = Math.max(previous.retryAt || 0, job.retryAt || 0);
  if (job.realmBlockedReason) previous.realmBlockedReason = job.realmBlockedReason;
  for (const count of RETRY_COUNTS)
    if (Number(job[count]) > (Number(previous[count]) || 0)) previous[count] = job[count];
  previous.ladderDue ??= job.ladderDue;
}
// `mergeGroup: 'pickup'`: one party collection and one inventory cleanout per
// recipient, on every pass and on the restart's saved queue. A queued copy of the running job's
// demand kind leaves, and the running job's command stays as it is.
export function mergePickupJobs<T extends PrioritizedJob>(jobs: T[], merchant: string | null | undefined, current?: PrioritizedJob | null): T[] {
  const pickups = new Map<string, T>();
  const result: T[] = [];
  for (const original of jobs) {
    const job = normalizePickupJob(original, merchant);
    if (merchantKind(job.reason).mergeGroup !== 'pickup' || !job.target) { result.push(job); continue; }
    if (merchantKind(job.reason).demand && current?.reason === job.reason && current.target === job.target) continue;
    const key = job.reason + ' ' + job.target, previous = pickups.get(key);
    if (!previous) { pickups.set(key, job); result.push(job); continue; }
    mergeTiming(previous, job);
  }
  return result;
}

// The stand location rule: a clear point on main, or v1.5.0's
// legacy point.
export interface MerchantStandLocation extends ICoord { map: 'main' }
export const legacyStandLocation: MerchantStandLocation = {map:'main',x:-63,y:100};
// The merchant's home realm until a stand return's command names one (v1.5.0's
// shared.js:871).
export const DEFAULT_HOME_REALM = 'SR_USII';
// The merchant stands at its stand location within 35 (v1.5.0's). The
// runner's stand return, the gathering rest and the idle route's market test read this one
// reach.
export const AT_STAND = 35;
export function validStandLocation(value: unknown): value is MerchantStandLocation {
  if (!value || typeof value !== 'object') return false;
  const point = value as MerchantStandLocation;
  return point.map === 'main' && Number.isFinite(point.x) && Number.isFinite(point.y);
}
// The merchant's event and anniversary reservations (read on both runtimes).
/** Optional fields preserve compatibility with saved state and older heartbeats. */
export interface MerchantEventState {
  dailyDungeons?: import("../hunting/api.ts").DungeonState;
  merchantCharacter: string | null;
  eventSelectionsByCharacter?: Record<string, string[]>;
  eventsByCharacter?: Record<string, boolean>;
  statuses: Record<string, { seenAt?: number; merchantEventReserved?: boolean } | undefined>;
}

interface AnniversaryEvent {
  active?: boolean;
  live?: boolean;
  next?: number;
  round?: string | number;
  target?: string;
  expires?: number;
  available?: boolean;
}
export interface AnniversaryMerchantStatus {
  anniversaryServer?: AnniversaryEvent;
  anniversaryState?: {
    busy?: boolean;
    retryAt?: number;
    mode?: string;
    completedRound?: string | null;
  };
  anniversaryVisit?: unknown;
}
export interface MerchantAnniversaryControl {
  live: boolean;
  featured: boolean;
  kissDue: boolean;
  preWindow: boolean;
  reserved: boolean;
  busy: boolean;
  retryAt: number;
  mode: string;
}

function stagingWindow(event: AnniversaryEvent | undefined, now: number): boolean {
  if (!event || event.active === false || event.live !== false) return false;
  const next = Number(event.next) || 0;
  return !!next && next - now <= 90_000 && next - now >= -15_000;
}

function liveRound(
  event: AnniversaryEvent | undefined,
  aborted: Readonly<Record<string, unknown>>,
  now: number,
): boolean {
  if (!event || aborted[String(event.round)]) return false;
  return (
    event.active !== false &&
    event.live !== false &&
    !!event.target &&
    (!Number(event.expires) || Number(event.expires) > now)
  );
}

function featuredFinished(
  event: AnniversaryEvent | undefined,
  merchant: string | null,
  live: boolean,
  now: number,
): boolean {
  if (!live || event?.target !== merchant || !Number(event.expires)) return false;
  return now >= Number(event.expires) - 300_000 + 60_000;
}

function isFeatured(
  event: AnniversaryEvent | undefined,
  merchant: string | null,
  live: boolean,
  complete: boolean,
): boolean {
  return live && event?.target === merchant && !complete;
}

function visitDue(
  event: AnniversaryEvent | undefined,
  status: AnniversaryMerchantStatus | undefined,
  live: boolean,
  featured: boolean,
  completed: boolean,
  retryAt: number,
  now: number,
): boolean {
  return (
    live &&
    !featured &&
    event?.available !== false &&
    !!status?.anniversaryVisit &&
    !completed &&
    retryAt <= now
  );
}

function movementReserved(preWindow: boolean, live: boolean, complete: boolean): boolean {
  return preWindow || (live && !complete);
}
function availableReservation(preWindow: boolean, featured: boolean, event: AnniversaryEvent | undefined,
  state: NonNullable<AnniversaryMerchantStatus['anniversaryState']>): boolean {
  return preWindow || featured || event?.available !== false || busy(state);
}

function busy(state: NonNullable<AnniversaryMerchantStatus["anniversaryState"]>): boolean {
  return !!state.busy || state.mode === "kiss-active";
}
function liveBusy(live: boolean, state: NonNullable<AnniversaryMerchantStatus['anniversaryState']>): boolean {
  return live && busy(state);
}

function completedVisit(
  state: NonNullable<AnniversaryMerchantStatus["anniversaryState"]>,
  event: AnniversaryEvent | undefined,
): boolean {
  return (
    state.mode === "complete" &&
    (state.completedRound === undefined || state.completedRound === String(event?.round))
  );
}

/** The featured merchant waits one minute; other visits retain their existing retry ownership. */
function claimedVisit(event: AnniversaryEvent | undefined, claimedRound: string | undefined): boolean {
  return claimedRound !== undefined && claimedRound === String(event?.round);
}

export function merchantAnniversaryControl(
  merchant: string | null,
  enabled: boolean,
  status: AnniversaryMerchantStatus | undefined,
  aborted: Readonly<Record<string, unknown>>,
  now: number,
  claimedRound?: string,
): MerchantAnniversaryControl {
  const event = enabled ? status?.anniversaryServer : undefined;
  const state = status?.anniversaryState || {};
  const preWindow = stagingWindow(event, now),
    live = liveRound(event, aborted, now);
  const complete = featuredFinished(event, merchant, live, now);
  const featured = isFeatured(event, merchant, live, complete);
  const retryAt = Number(state.retryAt) || 0;
  const completed = completedVisit(state, event) || complete || claimedVisit(event, claimedRound);
  const kissDue = visitDue(event, status, live, featured, completed, retryAt, now);
  return {
    live,
    featured,
    kissDue,
    preWindow,
    reserved: movementReserved(preWindow, live, completed) &&
      availableReservation(preWindow, featured, event, state),
    busy: liveBusy(live, state),
    retryAt,
    mode: state.mode || "idle",
  };
}


// The merchant's card line: the job with its bank stage, which the job task's label carries, else
// "Banking" while the items owner's bag says so, else the idle line.
export function merchantLine(job: (RoutineJob & { operationStage?: string }) | null | undefined, banking: boolean): { phase: string; label: string } {
  if (job?.reason) {
    const stage = job.operationStage === 'retrieving' ? ' - taking items from the bank' : job.operationStage === 'storing' ? ' - storing items in the bank' : '';
    return { phase: job.operationStage ?? 'job', label: `Merchant job - ${routineLabel(routineFor(job))}${stage}` };
  }
  return banking ? { phase: 'banking', label: 'Banking' } : { phase: 'idle', label: 'Merchant - waiting for the next job' };
}
