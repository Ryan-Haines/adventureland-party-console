// Dashboard and status's rule tables. One row per case; each reader asks the table, so no order or
// list of the status pipeline lives in another file. The file imports only the status owner's own
// fields and its own types, so the characters and the dashboard read table F, the catalog versions
// and the metrics rules without the coordinator's code. Table C's writer also reads the protocol's
// rank table, which imports nothing.
import { TIERS, type Tier } from '../protocol/ranks.ts';
import type { MetricCredit, MetricDamage, MetricFrame, MetricKill, MetricLoot, MetricResets, MetricSample } from './api.ts';

// The status owner's own picks, each v1.5.0's value. None is a setting: no
// player chooses one, so a saved copy has no player-facing reason. None bounds a game or system
// failure, so none reports through boundFired: they are display rates, the memory bounds of the
// status owner's own logs and rings, and the game's ray animation.
export const STATUS_PICKS = {
  // The dashboard and map streams' heartbeat (coordinator/streams.ts). A stream sends a change with
  // each report, so the heartbeat speaks only while nothing changes, to keep proxies from closing an
  // idle stream and to tell the client the stream lives; nothing the game or the run reports stands
  // for that silence. The client fails a stream after three heartbeats it did not hear, the period
  // the stream names in each message. One pick serves both streams, where the map stream kept its
  // own 15 s.
  streamHeartbeatMs: 5_000,
  // The logs' text bounds (coordinator/logs.ts): the dashboard shows each entry as one row, and
  // neither the game nor the character bounds a line's length, so these bound a stored entry. The
  // game log lines stay in memory, newest `gameLogLines` per character; the saved logs keep
  // the settings owner's `historyKept`.
  combatLineChars: 240,
  navigationLineChars: 1_200,
  gameLineChars: 4_000,
  gameLogLines: 1_000,
  // The dashboard's polls of GET /party-api/state's sections (table S), of the mail inbox and of the
  // update service, the build and debug services, the ALData check and the live metrics graphs, each
  // { interval, stale, gc } in ms (dashboard/features/party/query-cache.tsx, mail-query.ts,
  // console-updates.tsx, console-build-control.tsx, debug-instance.tsx, use-party-console.tsx,
  // metrics-*.tsx). The core and logs sections
  // change only when a character reports, so they poll at the party's measured report period and
  // their rows hold only the cache life; the catalog follows its reference revision. The other rows
  // are how fresh a view the player gets of a section that has no signal the browser hears.
  dashboardPolls: {
    core: { gc: 300_000 }, logs: { gc: 60_000 },
    config: { interval: 15_000, stale: 15_000, gc: 300_000 }, fast: { interval: 250, gc: 60_000 },
    inventory: { interval: 2_000, gc: 60_000 }, bank: { interval: 2_000, stale: 2_000, gc: 300_000 },
    market: { interval: 10_000, stale: 10_000, gc: 120_000 }, catalog: { gc: 1_800_000 },
    mail: { interval: 2_000, stale: 2_000, gc: 300_000 }, mailCount: { interval: 10_000 },
    updates: { interval: 3_000 }, build: { interval: 1_000 }, debug: { interval: 1_500 },
    aldataAuth: { interval: 15_000, gc: 60_000 }, metrics: { stale: 500, gc: 10_000 },
  } as Record<string, { interval?: number; stale?: number; gc?: number }>,
  // The character's fast telemetry and map frames (character/telemetry.ts), while the dashboard
  // watches: the game moves a character between its packets on the client and sends nothing for
  // that step, so the frames sample at the rate the dashboard draws.
  telemetryMs: 100,
  // How long a headless map shows a ray: the game's ray animation, whose action carries no eta.
  mapRayMs: 664,
  // How long a kill credit waits for its XP (character/telemetry.ts): the game sends the XP apart
  // from the credit, as a text or in the next character update, and nothing marks a kill that gave
  // none.
  killXpWindowMs: 700,
  // The status owner's combat ring on the character (character/rings.ts), recorded only while a
  // diagnostics view leases it: the trace samples the combat state the role loop acts on, and each
  // ring keeps the history a view reads when it opens.
  combatTraceMs: 250,
  combatTraceEntries: 160,
  handoffEntries: 256,
  // The combat lines a character holds while the coordinator does not answer; the character cannot
  // read the coordinator's `historyKept`, and an outage has no end it reports.
  combatLinesQueued: 50,
  // The metrics' finest bucket (the frame rules below, coordinator/metrics/service.ts): one character
  // frame spans one bucket, and the dashboard's graphs draw at that width.
  metricBucketMs: 10_000,
  // The metrics history (coordinator/metrics/history.ts): a bucket older than a row's `after` merges
  // into that row's `width`, and history older than `keptMs` expires. The table bounds the journal's
  // size and the graphs' detail over time. The account gold points follow the same table.
  metricHistory: { keptMs: 180 * 86_400_000, merges: [{ after: 86_400_000, width: 60_000 }, { after: 30 * 86_400_000, width: 900_000 }] },
};

// The card line table: the first row that answers gives the line, in today's order
// (runtime/coordinator/status/activity.ts at an earlier build). The member's group task answers
// when no row does. Each row's words are the owner's that makes the state.
export const TABLE_L = [
  { row: 'survival', owner: '05' },
  { row: 'click', owner: '02' },
  { row: 'climber', owner: '02' },
  { row: 'cave', owner: '07' },
  { row: 'held', owner: '13' },
  { row: 'needs-you', owner: '01' },
  { row: 'merchant', owner: '08' },
  { row: 'holder', owner: '02' },
] as const;
export type LineRow = typeof TABLE_L[number]['row'];

// Table I, the intake: POST /party-api/status runs these rows in this order, each the owner's
// published function (ingestion.ts:80-149 at an earlier build, kept). `stage` names the row's
// `measureStatusStage` timer, so every row is timed; the rare report, bankboi, A/B strategy and
// scatter gained the timer, a measure only. `bounds` goes first and takes the report's queued bound
// firings off the body, so the stored status never carries them. The hunting owner's rare steps
// right after its report, before bankboi and anniversary, as v1.5.0 ran them. The
// items owner's lucky slot evidence runs ahead of every other report row, as v1.5.0
// ran it.
export const TABLE_I = [
  { row: 'bounds', owner: '12', stage: 'boundsFired' },
  { row: 'lucky-evidence', owner: '10', stage: 'luckyEvidence' },
  { row: 'addon-stores', owner: '14', stage: 'addonStores' },
  { row: 'roster-evidence', owner: '12', stage: 'rosterEvidence' },
  { row: 'native-ownership', owner: '12', stage: 'nativeOwnership' },
  { row: 'merchant-identity', owner: '08', stage: 'identifyMerchant' },
  { row: 'catalogs', owner: '12', stage: 'catalogs' },
  { row: 'items', owner: '10', stage: 'items' },
  { row: 'one-shots', owner: '07', stage: 'oneShots' },
  { row: 'merchant-observer', owner: '08', stage: 'merchant' },
  { row: 'store', owner: '12', stage: 'store' },
  { row: 'grouped-combat', owner: '04', stage: 'groupedCombat' },
  { row: 'rare-report', owner: '07', stage: 'rareReport' },
  { row: 'rare-tick', owner: '07', stage: 'rareTick' },
  { row: 'bankboi', owner: '10', stage: 'bankboi' },
  { row: 'anniversary', owner: '06', stage: 'anniversary' },
  { row: 'hunt', owner: '07', stage: 'hunt' },
  { row: 'abtesting', owner: '04', stage: 'abtesting' },
  { row: 'scatter', owner: '07', stage: 'scatter' },
  { row: 'events', owner: '06', stage: 'events' },
  { row: 'channel-flush', owner: '12', stage: 'channelFlush' },
  { row: 'market', owner: '10', stage: 'publishMarket' },
  { row: 'convoy', owner: '02', stage: 'convoyStep' },
  { row: 'merchant-scheduling', owner: '08', stage: 'merchantScheduling' },
] as const;
export type IntakeRow = typeof TABLE_I[number]['row'];

// Table R, the reply: one section per owner's published reply read, concatenated in this order
// (response.ts at an earlier build, kept). `heartbeat` sections ride the full reply; `combat`
// sections ride the combat channel's reply. The return section rides both, as v1.5.0's
// combat reply spread its return fields (response.ts:240-244), so movement's town cycle and the events owner's
// event return cycle reach a member between heartbeats. The hunting owner's farming section rides
// both, because the farming mode decides whether targeting's lock binds, and the channel's revision
// covers it.
export const TABLE_R = [
  { section: 'lifecycle', owner: '13', heartbeat: true, combat: true },
  { section: 'settings', owner: '11', heartbeat: true, combat: false },
  { section: 'clock', owner: '12', heartbeat: true, combat: true },
  { section: 'travel-combat', owner: '02', heartbeat: true, combat: true },
  { section: 'realm-errors', owner: '09', heartbeat: true, combat: false },
  { section: 'command', owner: '12', heartbeat: true, combat: false },
  { section: 'rare', owner: '07', heartbeat: true, combat: true },
  { section: 'escape', owner: '05', heartbeat: true, combat: false },
  { section: 'event-trip', owner: '06', heartbeat: true, combat: false },
  { section: 'convoy-signal', owner: '02', heartbeat: true, combat: true },
  { section: 'return', owner: '02', heartbeat: true, combat: true },
  { section: 'movement', owner: '02', heartbeat: true, combat: false },
  { section: 'map-telemetry', owner: '12', heartbeat: true, combat: false },
  { section: 'task', owner: '01', heartbeat: true, combat: false },
  { section: 'diagnostics', owner: '12', heartbeat: true, combat: false },
  { section: 'merchant', owner: '08', heartbeat: true, combat: false },
  { section: 'items', owner: '10', heartbeat: true, combat: false },
  { section: 'party', owner: '01', heartbeat: true, combat: false },
  { section: 'grouped-combat', owner: '04', heartbeat: true, combat: true },
  { section: 'combat-recovery', owner: '05', heartbeat: false, combat: true },
  { section: 'events', owner: '06', heartbeat: true, combat: false },
  { section: 'leader', owner: '01', heartbeat: true, combat: false },
  { section: 'catalog', owner: '12', heartbeat: true, combat: false },
  { section: 'farming', owner: '07', heartbeat: true, combat: true },
  { section: 'hand', owner: '01', heartbeat: true, combat: false },
  { section: 'visit', owner: '01', heartbeat: true, combat: true },
  { section: 'cave', owner: '07', heartbeat: true, combat: false },
  { section: 'merchant-visibility', owner: '08', heartbeat: true, combat: false },
  { section: 'dashboard-lease', owner: '12', heartbeat: true, combat: false },
  // The add-on system's sections: the add-on stores newer than the
  // character holds with its scope's add-on values, the add-on actions the coordinator asked, and
  // the commands it forwarded. They ride the heartbeat only, as the add-on switches do.
  { section: 'addon-stores', owner: '14', heartbeat: true, combat: false },
  { section: 'addon-actions', owner: '14', heartbeat: true, combat: false },
  { section: 'addon-inbox', owner: '14', heartbeat: true, combat: false },
] as const;
export type ReplySectionName = typeof TABLE_R[number]['section'];

// Table A, the apply (character/apply.ts): the reply's sections on the character, in the earlier
// console's order with one change: the hunting owner's farming section applies before targeting's
// combat control and its grouped lock, so no role pass reads a new lock under the old mode. An
// `ends` row ends the apply while it answers true: the lifecycle owner's held reply and maintenance
// hold, and the hunting owner's Cave runtime, which takes targeting's lock itself. The maintenance hold follows the
// lifecycle owner's lease row, so a held character applies none of the settings sections after it,
// as v1.5.0 returned before them (shared.js:11146-11155). A `kept` row still runs when
// a row ends the apply: the status owner's dashboard lease and movement's healthy heartbeat, so a
// held or Cave character keeps its heartbeat, and the events owner's exit observe, the one read of the reply's
// event return cycle, so a held or Cave reply still retires an exit of an older cycle as the earlier
// console's transport copy did. A `channel` row also runs on the combat channel's reply. `phase` is
// the status failure's phase while the row runs.
export const TABLE_A = [
  { row: 'task', owner: '01', phase: 'request status' },
  { row: 'hand', owner: '01', phase: 'request status' },
  { row: 'replied', owner: '13', phase: 'request status' },
  { row: 'held', owner: '13', phase: 'request status', ends: true },
  { row: 'game-party', owner: '01', phase: 'request status' },
  { row: 'catalog', owner: '12', phase: 'request status' },
  { row: 'lease', owner: '13', phase: 'request status' },
  { row: 'maintenance', owner: '13', phase: 'request status', ends: true },
  { row: 'addons', owner: '14', phase: 'request status' },
  { row: 'settings', owner: '02', phase: 'request status' },
  { row: 'heal-first', owner: '03', phase: 'request status' },
  { row: 'potion-lines', owner: '05', phase: 'request status' },
  { row: 'reflect-lists', owner: '04', phase: 'request status' },
  { row: 'diagnostics', owner: '12', phase: 'request status' },
  { row: 'map-telemetry', owner: '12', phase: 'request status' },
  { row: 'cave-recovery', owner: '05', phase: 'request status' },
  { row: 'cave', owner: '07', phase: 'request status', ends: true },
  { row: 'merchant-visibility', owner: '08', phase: 'request status' },
  { row: 'receipts', owner: '10', phase: 'request status' },
  { row: 'lucky-recovery', owner: '10', phase: 'request status' },
  { row: 'stand-sync', owner: '10', phase: 'request status' },
  { row: 'status', owner: '12', phase: 'apply status', kept: true },
  { row: 'reported', owner: '02', phase: 'apply status', kept: true },
  { row: 'task-hold', owner: '02', phase: 'apply status' },
  { row: 'apart', owner: '01', phase: 'apply status' },
  { row: 'walk-hold', owner: '02', phase: 'apply status' },
  { row: 'realm-errors', owner: '09', phase: 'apply status' },
  { row: 'convoy', owner: '02', phase: 'apply status' },
  { row: 'escape', owner: '05', phase: 'apply escape' },
  { row: 'exit-observe', owner: '06', phase: 'apply navigation', kept: true },
  { row: 'navigation', owner: '02', phase: 'apply navigation' },
  { row: 'farming', owner: '07', phase: 'apply farming', channel: true },
  { row: 'priorities', owner: '04', phase: 'apply farming', channel: true },
  { row: 'combat', owner: '04', phase: 'apply combat control', channel: true },
  // survival's party recovery record, on every reply targeting's combat control takes (the
  // earlier console shared.js acceptCombatControl set it there).
  { row: 'recovery', owner: '05', phase: 'apply combat control', channel: true },
  { row: 'rare', owner: '07', phase: 'apply combat control' },
  { row: 'bank-queue', owner: '10', phase: 'apply combat control' },
  { row: 'leader', owner: '01', phase: 'apply combat control' },
  { row: 'turn-in', owner: '06', phase: 'apply combat control' },
  { row: 'party-walks', owner: '02', phase: 'apply combat control' },
  { row: 'events', owner: '06', phase: 'apply event selections' },
  { row: 'leader-follow', owner: '02', phase: 'stop leader follow' },
  { row: 'party-targets', owner: '04', phase: 'apply party targets' },
  { row: 'follow-me', owner: '01', phase: 'apply party targets' },
  { row: 'follow-step', owner: '02', phase: 'apply party targets' },
  { row: 'event-hints', owner: '06', phase: 'apply party targets' },
  { row: 'anniversary', owner: '06', phase: 'apply anniversary' },
  { row: 'delivery-receipts', owner: '08', phase: 'apply anniversary' },
  { row: 'item-settings', owner: '10', phase: 'apply merchant settings' },
  { row: 'lucky-settings', owner: '10', phase: 'apply merchant settings' },
  { row: 'stand-settings', owner: '08', phase: 'apply merchant settings' },
  { row: 'stand-listings', owner: '09', phase: 'apply merchant settings' },
  { row: 'gathering-settings', owner: '08', phase: 'apply merchant settings' },
  { row: 'positions', owner: '04', phase: 'apply party settings' },
  { row: 'party-settings', owner: '04', phase: 'apply party settings' },
  { row: 'slenderman', owner: '06', phase: 'apply party settings' },
  { row: 'catalog-prepare', owner: '12', phase: 'apply party settings' },
  { row: 'failures', owner: '12', phase: 'apply party settings' },
  { row: 'elixir', owner: '10', phase: 'dispatch command' },
  { row: 'command', owner: '13', phase: 'dispatch command' },
  { row: 'tidy', owner: '10', phase: 'dispatch command' },
  { row: 'stock-up', owner: '10', phase: 'dispatch command' },
] as const;
export type ApplyRow = typeof TABLE_A[number]['row'];

// Table S, the sections of GET /party-api/state (coordinator/state.ts), one row per section. A
// `revision` section is large and often the same (bank 4.4 MB live, logs 1.2 MB, market 1.75 MB), so
// it answers 304 while its body is unchanged. An unknown section answers 400, so a typo never turns
// a small poll into the multi-megabyte full payload. `fields` names the full payload's fields a
// section carries in core's place. The dashboard's core (`dashboard=1`) leaves out every row's
// fields; the apps' core (v1.4.0's shape) leaves out only the `legacy` rows', which were sections
// apart before the dashboard's split. Config also carries the settings owner's settings
// delivered to `dashboard`, which state.ts reads from the settings owner. Core's `bankboiFields` are
// what the dashboard's bankboi summaries keep.
export const TABLE_S = [
  { section: 'core', revision: false, fields: [], legacy: false,
    bankboiFields: ['name', 'ctype', 'level', 'state', 'gold', 'seenAt', 'error', 'transaction'] },
  { section: 'config', revision: false, legacy: false,
    fields: ['deconstructionCatalog', 'standSearch', 'roster', 'classChoices', 'eventStrategy', 'giveawayRealms'] },
  { section: 'fast', revision: false, fields: [], legacy: false },
  { section: 'inventory', revision: false, fields: [], legacy: false },
  { section: 'logs', revision: true, fields: ['combatLogs', 'merchantActivity', 'settingsChanges'], legacy: true },
  { section: 'bank', revision: true, fields: ['bank', 'bankVaults'], legacy: true },
  { section: 'market', revision: true, fields: ['standPriceHistory', 'ponty'], legacy: false },
  { section: 'catalog', revision: false, fields: [], legacy: false },
] as const;
export type StateSection = typeof TABLE_S[number]['section'];

// Table G, the diagnostics lease (coordinator/diagnostics.ts): one lease for every ring. While a
// diagnostics view holds a character's lease on a ring, the reply names that ring and the
// character posts it as its own request, never inside the report. Each ring is read on the
// character through its owner's read.
export const TABLE_G = [
  { ring: 'movement', owner: '02' },
  { ring: 'turns', owner: '03' },
  { ring: 'targeting', owner: '04' },
  { ring: 'survival', owner: '05' },
  { ring: 'calls', owner: '09' },
  { ring: 'merchant', owner: '08' },
  { ring: 'combat', owner: '12' },
] as const;
export type DiagnosticsRing = typeof TABLE_G[number]['ring'];
// A ring a lease names: table G's, or an add-on's own under its add-on's name, `<add-on>.<key>`
// (`diagnostics-ring`; runtime/hooks/registry.ts `rings`).
export type LeasedRing = DiagnosticsRing | `${string}.${string}`;

// The derived stats a character's report and a saved profile's inspection carry, read from the
// game's character fields (`for`, `luckm`, `critdamage`, `dreturn` and the rest), so the two
// readers name each stat once.
const COMBAT_STAT_FIELDS = {
  heal: 'heal', output: 'output', mpCost: 'mp_cost', crit: 'crit', critDamage: 'critdamage', evasion: 'evasion',
  miss: 'miss', lifesteal: 'lifesteal', manasteal: 'manasteal', damageReturn: 'dreturn', reflection: 'reflection',
  armorPiercing: 'apiercing', resistancePiercing: 'rpiercing', poisonResistance: 'pnresistance',
  fireResistance: 'firesistance', freezeResistance: 'fzresistance', physicalResistance: 'phresistance',
  statusResistance: 'stresistance', blastResistance: 'bmresistance',
} as const;
export function reportedStats(stats: Readonly<Record<string, unknown>>) {
  const value = (field: string) => Number(stats[field]) || 0;
  const multiplier = (field: string) => Number(stats[field]) || 1;
  return {
    attack: value('attack'), frequency: value('frequency'), range: value('range'), armor: value('armor'),
    resistance: value('resistance'), str: value('str'), int: value('int'), dex: value('dex'), vit: value('vit'),
    fortitude: value('for'), luck: Math.round(multiplier('luckm') * 100), goldBonus: (multiplier('goldm') - 1) * 100,
    xpBonus: (multiplier('xpm') - 1) * 100,
    combatStats: Object.fromEntries(Object.entries(COMBAT_STAT_FIELDS).map(([key, field]) => [key, value(field)])) as
      Record<keyof typeof COMBAT_STAT_FIELDS, number>,
  };
}

// The command slot: a command is consumed by its delivery. A retained type stays
// deliverable until its completion route acknowledges it; the merchant job owner's kind table
// answers for a merchant job's command type (`jobRetained`, which reply.ts asks through the
// merchant job owner's door), and this row names every other one with the owner of its completion
// route and the rank table tier its writer acts at. A group walk's command carries its
// requester's tier, so its row names none.
const RETAINED: Readonly<Record<string, { owner: string; tier?: Tier }>> = {
  bank: { owner: '10', tier: 'errand' }, upgrade: { owner: '10', tier: 'errand' },
  'apply-stat-scrolls': { owner: '10', tier: 'errand' }, 'equip-deliveries': { owner: '10', tier: 'errand' },
  'bankboi-service': { owner: '10', tier: 'errand' }, 'merchant-production-recover': { owner: '10', tier: 'errand' },
  'town-party': { owner: '02', tier: 'town' }, 'event-return-town': { owner: '06', tier: 'event-return' },
  'event-resume-travel': { owner: '06', tier: 'event-return' },
  'party-monster-travel': { owner: '07' }, 'monster-hunt-interact': { owner: '07', tier: 'hunt-turn-in' },
  'realm-set-home': { owner: '09', tier: 'realm-hold' },
};
// An equip or unequip command stays until a report's `lastCommandId` is at or past its id, so a
// deferred delivery is not lost; the merchant job owner's runner runs an id once.
const UNTIL_REPORTED = new Set(['equip', 'unequip']);
// A navigation command carries the navigation revision it was delivered under. The tasks
// owner's player travel route and the hunting owner's destination change read the same set.
const NAVIGATION = new Set(['travel', 'force-travel', 'character-travel', 'party-monster-travel', 'event-resume-travel', 'return-leader']);

interface SlotCommand { id?: number | string; type: string; navigationRevision?: number; tier?: string; requester?: { tier?: string } | null; [field: string]: unknown }
// Whether the slot keeps `command` after this delivery, given the character's last applied id.
export function retained(command: SlotCommand, lastCommandId: number | undefined, jobRetained: (type: string) => boolean): boolean {
  if (UNTIL_REPORTED.has(command.type)) return !(Number(lastCommandId) >= Number(command.id));
  return command.type in RETAINED || jobRetained(command.type);
}
// The rank table tier a command's writer acts at, one source per kind: a group walk names its
// requester's, an app command (arrivals.ts `appTier`) carries its own `tier`, and a retained row
// names the rest.
function slotTier(command: SlotCommand): Tier | undefined {
  const tier = command.type === 'party-monster-travel' ? command.requester?.tier
    : 'tier' in command ? command.tier : RETAINED[command.type]?.tier;
  return tier !== undefined && Object.hasOwn(TIERS, tier) ? tier as Tier : undefined;
}
export type SlotWrite = 'written' | 'refused';
// The slot's one writer. A retained command stays in the slot until its completion route clears
// it, so a write over it ranks by the rank table: a write whose tier ranks below the held command's
// is refused, and the held command keeps the slot. An equal tier writes, as a walk's next phase or
// an event return's next leg does over its own last command. A command with no tier is not ranked
// and writes as asked. A clear always writes.
export function writeSlot(commands: Record<string, unknown>, name: string, command: SlotCommand | null): SlotWrite {
  const held = commands[name] as SlotCommand | undefined;
  if (command && held && held.id !== command.id && held.type in RETAINED) {
    const heldTier = slotTier(held), tier = slotTier(command);
    if (heldTier && tier && TIERS[tier].rank < TIERS[heldTier].rank) return 'refused';
  }
  if (command) commands[name] = command;
  else delete commands[name];
  return 'written';
}
export const navigational = (command: SlotCommand): boolean => NAVIGATION.has(command.type);

// Table F, the field registry: every report field with its tier, size, readers and
// storage, and the whitelists that build the per-character parts of the polled sections. Moved
// whole from runtime/coordinator/telemetry/character-fields.ts; docs/state-field-registry.md has
// the tiers, the readers inventory and its method, and character-field-registry.test.cjs checks
// that every reported field has an entry. The tiers, by request:
// - `section=fast`: `fastFields` (the default), or every stored field except `shadowFastOmitted`
//   with PARTY_STATE_FIELDS=shadow, the registry's audit mode.
// - `section=inventory`: `inventoryFields`, item metadata compacted.
// - `section=core&dashboard=1`: `characterDetails` from `diagnosticFields` plus `combat.positioning`,
//   and `characters` from `coreSummaryFields`.
// - the live stream (coordinator/streams): `streamFields`, items and slots.
// - `/party-api/state` without a section: the debug tier, every stored field unchanged.
// `stored: false` marks report fields the coordinator consumes and deletes before storing. `readers`
// lists the external clients that read the field from a lean section or the live stream; the
// coordinator reads the stored statuses directly, so the lists leave it out. Sizes are per
// character, from a saved four-character state dump (2026-09-23); "small" stays under about 1 KB.
type FieldReader = "dashboard" | "pwa" | "android" | "metrics";
interface CharacterField {
  description: string;
  tier: "lean" | "debug";
  size: "small" | "large";
  bytes?: string;
  stored: boolean;
  readers: readonly FieldReader[];
  // A reference catalog, kept once in state (CATALOG_FIELDS).
  catalog?: boolean;
}

const all = ["dashboard", "pwa", "android"] as const;
const apps = ["pwa", "android"] as const;
const lean = (description: string, readers: readonly FieldReader[], size: Pick<CharacterField, "size" | "bytes"> = { size: "small" }) =>
  ({ description, tier: "lean", stored: true, readers, ...size }) as const;
const debug = (description: string, size: Pick<CharacterField, "size" | "bytes"> = { size: "small" }) =>
  ({ description, tier: "debug", stored: true, readers: [], ...size }) as const;
const consumed = (description: string, size: Pick<CharacterField, "size" | "bytes"> = { size: "large", bytes: "estimated: one whole game catalog" }) =>
  ({ description, tier: "debug", stored: false, readers: [], ...size }) as const;
const large = (bytes: string) => ({ size: "large", bytes }) as const;
// A catalog row: consumed by the status owner's intake, which keeps it once in state
// (coordinator/intake.ts).
const catalog = (description: string, size?: Pick<CharacterField, "size" | "bytes">) => ({ ...consumed(description, size), catalog: true }) as const;

export const characterFields = {
  // Identity and runtime
  name: lean("Character name; the status key.", ["dashboard", "android"]),
  actualParty: debug("The game party's leader the character is in (`character.party`), which 13's roster ownership groups by (lifecycle/roster/ownership.ts)."),
  boundsFired: consumed("The kept bounds' firings the character queued since its last taken report; 12's intake row hands them to the bound record (coordinator/intake.ts `bounds`).", { size: "small" }),
  busy: debug("True while an inventory operation holds the character, so 13's reload waits (lifecycle/character/drain.ts `canReload`)."),
  busyReason: debug("The operation behind `busy` and who holds it, for the reload wait's debug view (lifecycle/character/drain.ts `busyReason`)."),
  owner: lean("Game account id; core derives accountId from it.", all),
  ctype: lean("Class id, such as merchant or priest.", [...all, "metrics"]),
  level: lean("Character level.", [...all, "metrics"]),
  server: lean("Realm as region plus identifier, such as USII.", all),
  ping: lean("Latest game ping in ms, or null.", all),
  home: debug("The character's home server from the game, or null."),
  runtime: debug("native (Steam or browser client) or headless (caracAL)."),
  platform: debug("caracal, the game platform name, or browser."),
  clientVersion: debug("Game client version the script runs under."),
  clientInstance: debug("Client instance id from the loader, or null."),
  steamPrimary: debug("True for the Steam window that owns native input."),
  steamRealmProtocol: debug("Steam bridge realm protocol version, 0 when absent."),
  codeGeneration: debug("Runtime generation counter of the loaded character code."),
  dashboardRuntime: debug("Runtime id the dashboard stream uses to fence stale sessions."),
  loaderGeneration: debug("Loader generation number."),
  codeHash: debug("Hash of the loaded character code, or null."),
  codeLoad: debug("The game window's CODE install count and the age of this install, which 13's native reload notice reads."),
  codeRevision: debug("Fixed protocol label of the report, such as realm-logistics-v3."),
  consoleMaintenance: debug("The character's view of the console maintenance lease."),
  bankSortProtocol: debug("Bank sort protocol version."),
  convoyProtocol: debug("Convoy protocol version."),
  commandHold: debug("What holds a member that has the group walk's command and does not run it, or null (walk-client.ts commandHold)."),
  lastCommandId: debug("Id of the last coordinator command the character applied."),
  seenAt: lean("Coordinator receive time of the last status (coordinator/intake.ts, table I's store row).", [...all, "metrics"]),
  inventorySeenAt: debug("Coordinator receive time of the last report that carried items (coordinator/intake.ts, table I's store row)."),
  // Appearance
  skin: lean("Skin id for the portrait.", all),
  characterSprite: lean("Sprite sheet definition for the portrait.", all),
  characterDollHtml: lean("Rendered character doll markup for the portrait.", all, large("1.6 KB")),
  // Vitals and position
  hp: lean("Current HP.", all),
  max_hp: lean("Maximum HP.", all),
  mp: lean("Current MP.", all),
  max_mp: lean("Maximum MP.", all),
  cc: lean("Code call cost, rounded up, for the CC meter (connected-character-card.tsx).", ["dashboard"]),
  calls: debug("The call budget's largest used since the last report, when it held, the interval and its margin, for the call budget's checks."),
  xp: lean("Current XP into the level.", [...all, "metrics"]),
  max_xp: lean("XP needed for the next level.", [...all, "metrics"]),
  gold: lean("Carried gold.", [...all, "metrics"]),
  map: lean("Current map id.", [...all, "metrics"]),
  in: lean("Instance id of the current map; the live stream sends it and fast is the stream fallback.", []),
  x: lean("Rounded x position.", all),
  y: lean("Rounded y position.", all),
  moving: debug("True while the character is moving."),
  transporting: debug("True during a map transport (sampleTravelReport)."),
  rip: lean("True while dead.", [...apps, "metrics"]),
  lastDeath: lean("Last death record: time, killer and details.", ["metrics"]),
  conditions: lean("Active conditions with remaining time.", all, large("2.8 KB")),
  inventorySize: lean("Bag capacity.", all),
  standSlots: debug("Stand trade slots by the game's get_trade_slots (owner 10, I5 N1); only the coordinator reads it (items/rules.ts `merchantStandSlots`)."),
  upgradeInventoryBusy: lean("True while upgrade or tidy work holds the inventory; the live stream sends it and fast is the stream fallback.", []),
  standOpen: lean("True while the merchant stand is open.", all),
  standItem: debug("The stand the merchant has open, else the bag's stand the game opens, else null (items/character/bag.ts `standItem`); 08's stand return goes only with one."),
  target: lean("Current combat target summary, or null.", apps),
  mainTownSpawn: debug("Main town spawn point from game data."),
  realmPlayers: debug("Player names seen on the realm, for giveaways (coordinator/state.ts `giveawayDirectory`)."),
  gameParty: debug("The game's party member list."),
  // Stats
  primaryStat: lean("Class main stat: str, int or dex.", all),
  attack: lean("Attack.", all),
  frequency: lean("Attack frequency.", all),
  range: lean("Attack range.", all),
  speed: lean("Run speed.", all),
  unrestrictedSpeed: lean("Merchant run speed without stand and cart limits, else null.", all),
  baseSpeed: debug("Run speed from class, gear and stats without conditions, stand or cruise, which a walk's pace reads (sampleTravelReport)."),
  armor: lean("Armor.", all),
  resistance: lean("Resistance.", all),
  str: lean("Strength.", all),
  int: lean("Intelligence.", all),
  dex: lean("Dexterity.", all),
  vit: lean("Vitality.", all),
  fortitude: lean("Fortitude.", all),
  luck: lean("Luck as a percentage.", all),
  goldBonus: lean("Gold find bonus in percent.", all),
  xpBonus: lean("XP bonus in percent.", all),
  combatStats: lean("Secondary combat stats: crit, evasion, piercing, resistances.", all),
  // Activity flags
  banking: lean("True while a bank trip runs.", all),
  bankQueued: lean("True while a bank trip is queued.", all),
  stocking: lean("True while the merchant restocks.", all),
  upgrading: lean("True while the merchant upgrades.", apps),
  farmingMode: lean("Active farming mode.", all),
  farmingMonsterType: debug("Monster type the farming mode targets."),
  monsterHunt: lean("Monster hunt quest status.", all),
  huntEventPending: debug("True while a hunt waits on an event."),
  donationXpPerGold: lean("Donation XP per gold the merchant receives.", all),
  donationLevelXp: lean("XP per level from G.levels, indexed by level, for the donation preview (donation-preview.tsx).", ["dashboard"], large("about 1.5 KB")),
  merchantCommand: debug("Report on the merchant command in progress."),
  merchantEventReserved: debug("True while event work reserves the merchant."),
  upgradePreviewSession: debug("Upgrade preview session id."),
  upgradePreviewRevision: debug("Upgrade preview revision counter."),
  luckySlotTracking: lean("Lucky-slot roll evidence for the slot tracker.", all),
  luckySlotCharacterId: debug("Character id that owns the lucky-slot evidence."),
  // The items owner's bank merge failure text (items/character/bank.ts `stackError`).
  inventoryStackError: debug("Last stacking error, or null."),
  // Gathering
  gatheringActive: debug("Active gathering mode, if any."),
  gatheringBlockedReason: debug("Why gathering cannot run, or null."),
  gatheringPhase: debug("Gathering attempt phase, idle when none."),
  gatheringAttemptId: debug("Gathering attempt id, or null."),
  gatheringCooldowns: lean("Fishing and mining cooldowns.", all),
  gatheringAccess: debug("Whether the character can fish and mine."),
  // Achievements and items
  monsterAchievementKills: lean("Kill counts per monster toward achievements.", ["android", "metrics"], large("1.7 KB")),
  monsterAchievements: lean("Achievement progress per monster.", all, large("4.3 KB")),
  tracktrix: lean("Tracktrix status and bonuses.", all),
  items: lean("Bag entries with item fingerprints and metadata.", [...all, "metrics"], large("117 to 273 KB")),
  slots: lean("Equipped entries with item fingerprints and metadata.", [...all, "metrics"], large("457 to 484 KB")),
  nearbyStandListings: debug("Player stand listings near the character.", large("up to 1.9 MB")),
  nearbyGiveaways: debug("Giveaways near the character."),
  bank: consumed("Bank snapshot; 10's items row moves it to bankSnapshot (items/coordinator/storage.ts writeBankSnapshot; a null report stays on the status).", large("all bank packs with item metadata")),
  bankVaults: consumed("Bank vault catalog; 10's owner.ts moves it to state.bankVaults.", { size: "small" }),
  ponty: consumed("Merchant's Ponty listings; 10's items row moves them to state.ponty (items/coordinator/owner.ts observe).", large("grows with the listing count")),
  inventoryRevision: consumed("Revision of the items, slots and bank the report names; 10's inventory carry removes it (items/coordinator/storage.ts createInventoryCarry).", { size: "small" }),
  // Events
  activeEvent: debug("Selected live combat event name, or null."),
  activeEventId: debug("Id of the selected live event, or null."),
  eventRefusal: debug("Occurrence whose join the game refused for good (cant_join, join_too_late), or null; attendance-limits.ts marks it event-over."),
  joinedEvent: debug("Event the character joined; set on normal maps too."),
  mapEvent: debug("Event bound to the current map, or null."),
  serverLiveEvents: debug("Live events the server reports."),
  serverStagingEvents: debug("Staging events the server reports."),
  eventFeedConnected: debug("True while the game socket is connected."),
  eventFeedAt: debug("Time of the last event feed update."),
  eventWalks: debug("The staged events the character walks to before their spawn, with spawn time and destination (events/character/clock.ts `walks`); 06's occurrences.ts opens and misses occurrences from it."),
  eventAdmission: debug("06's admission answer for the member's live event (event and allowed), stamped by events/coordinator/attendance.ts `admit`; the reply carries it to the character."),
  eventRejoin: debug("The occurrence the member died in and has not reached again, or null; 06's attendance.ts stamps it and the reply carries it for the rejoin (1.5 row 6 (3))."),
  presence: debug("06's event presence answer for the member, or null (events/coordinator/source.ts `observe`)."),
  addonReports: lean("Each enabled add-on's own report, by add-on name (runtime/hooks/registry.ts status.report).", ["dashboard"]),
  addonStores: debug("The add-on stores the character holds, as revisions by store key, add-on and key, and its own writes; the coordinator keeps the newest per key (runtime/hooks/store.ts)."),
  addonActionResults: consumed("The outcomes of the add-on actions the coordinator asked; 14's intake row settles each ask and sends addon.acted (runtime/hooks/registry.ts `reported`).", { size: "small" }),
  addonCommandReplies: consumed("The character's replies to the add-on commands the coordinator forwarded; 14's intake row sends addon.commanded (runtime/hooks/registry.ts `reported`).", { size: "small" }),
  reportIntervalMs: debug("The gap between the character's last two reports; a group walk goes on through a late report for two of them (queue A20)."),
  eventClockStale: debug("True when the event clock has not synced for six minutes."),
  eventSchedules: debug("Event schedule snapshot; projectEventSchedules reads it."),
  eventTeam: debug("Event team of the character."),
  eventRecovery: debug("Event recovery state machine."),
  eventCombatSighting: debug("Event combat sighting of the current target."),
  slendermanSighting: debug("Local Slenderman sighting, or null."),
  slendermanSearchExhausted: debug("True when the Slenderman search found nothing."),
  goobrawlCombat: debug("True while Goobrawl combat is available."),
  anniversaryVisit: lean("Anniversary visit timer and round.", all),
  anniversaryServer: debug("Anniversary event status from the server."),
  anniversaryState: lean("Merchant anniversary work: stage, round and retries.", all),
  eventLeads: lean("06's K2 `due` lead per staged event of the member's group (events/coordinator/install.ts), which the anniversary dialog's departure time reads.", ["dashboard"]),
  // Combat
  combat: debug("Combat runner state, positioning and performance; core sends combat.positioning only.", large("0.9 to 1.1 KB")),
  combatSelection: debug("Combat selection id, revision, map and nomination."),
  combatDeviation: debug("The combat deviation while its monster lives in the character's view, or null."),
  groupedCombat: debug("Grouped combat queue protocol: claims, candidates, evidence, handoffs.", large("17 to 19 KB")),
  activeCombatTarget: debug("Combat target the runner owns."),
  engagedCombatTarget: debug("Combat target the character is engaged with."),
  threats: debug("Monsters targeting the character."),
  oneShotMonsterTypes: consumed("One-shot monster types learned; 07's modes.ts merges them.", { size: "small" }),
  oneShotEpoch: consumed("Scatter epoch of oneShotMonsterTypes.", { size: "small" }),
  queueTiming: debug("Queue client timing."),
  recovery: debug("Combat recovery state."),
  lootStatus: debug("Loot client status: pending, eligible and capacity."),
  rareLoot: debug("Rare loot client report."),
  huntLoot: debug("Hunt loot client report."),
  convoyLoot: debug("Convoy loot client report."),
  rareObservation: debug("Latest rare monster observation."),
  rareSightings: debug("Rare monster sightings."),
  rareFields: debug("Rare monster field observations."),
  rareKills: debug("Rare monster kills."),
  rareDeployment: debug("Rare hunt deployment state."),
  escape: debug("Local escape state."),
  turns: debug("03's turns report (skills.report): the ranking's damage per MP and each support cast's ready time, target and MP; the party reply hands it to every member's ranking (TRN-Q-DPS)."),
  activity: lean("The card's activity line: the assigned task and its phase in plain words, and the stuck notice while it lasts; derived state that coordinator/line.ts holds; each section that hands a character out adds it to its own copy, and the stored report never carries it.", ["dashboard"]),
  online: debug("A75's presence answer, true while the last report is younger than the presence age; derived like `activity`, status/coordinator/state.ts adds it to the diagnostics copy and the stored report never carries it."),
  movementLive: debug("The request that holds the character's movement (row, owner identity, tier), or null; the activity line reads it."),
  movementClick: debug("The player's click to walk in the game client (queue C1): walking, or the milliseconds left before the owner takes over again, with 02's card words (label); null without a click. The activity line reads the label."),
  movementClimb: debug("The movement owner's climber: its activity, the rung it tries and, after a rung with no progress, the stuck notice and that record's id; null without a climber."),
  returnTownReady: debug("True when the town skill is ready."),
  // Navigation and movement
  movement: debug("Movement executor report."),
  movementGeometry: debug("Movement geometry identity."),
  convoyNavigation: debug("Convoy navigation report."),
  travelSample: debug("Sequenced travel sample (sampleTravelReport, movement/coordinator/routes.ts)."),
  navigationState: debug("town, convoy, follow, departing or idle."),
  navigationDetail: debug("Navigation detail while traveling."),
  smartNavigation: debug("Game smart-move state."),
  farmReunion: debug("Farm reunion state."),
  farmingNavigationDebug: debug("Farming navigation flags for debugging."),
  eventWalkFailure: debug("Last event walk failure."),
  farmAreaEvidence: debug("Farm area monster evidence.", large("2.7 to 4 KB")),
  farmAreaObservation: debug("Latest farm area observation."),
  farmFocusInView: debug("True while a live focus monster the farm would take is in view."),
  farmCompetition: debug("Other players competing for the farm area."),
  dungeon: debug("Dungeon runtime report, with recovery inside a cave."),
  // Catalogs, reported once when the coordinator has none (coordinator/intake.ts)
  merchantCatalogVersion: catalog("Merchant catalog version.", { size: "small" }),
  travelPlaces: catalog("Travel place catalog."),
  monsterChoices: catalog("Monster choice catalog."),
  monsterLocationsVersion: catalog("Monster locations version.", { size: "small" }),
  monsterHunterLocation: catalog("Monster hunter NPC location.", { size: "small" }),
  bestiaryCatalog: catalog("Bestiary catalog."),
  skillCatalog: catalog("Skill catalog."),
  appearanceChoices: catalog("Class appearance choices."),
  merchantCatalog: catalog("Merchant item catalog."),
} as const satisfies Record<string, CharacterField>;
// The catalog rows, which the intake deletes from the report once it keeps them.
export const CATALOG_FIELDS = (Object.keys(characterFields) as (keyof typeof characterFields)[])
  .filter(name => (characterFields[name] as { catalog?: boolean }).catalog);

type CharacterFieldName = keyof typeof characterFields;

/**
 * The live stream's vitals fields: coordinator/streams.ts sends them, and browser code
 * (field-read-audit.ts) reads the same list.
 */
export const streamFields = [
  "hp", "mp", "max_hp", "max_mp", "cc", "x", "y", "map", "in", "xp", "max_xp", "gold", "rip",
  "target", "standOpen", "conditions", "inventorySize", "upgradeInventoryBusy",
] as const satisfies readonly CharacterFieldName[];

/** v1.4.0's fast omit list, kept for PARTY_STATE_FIELDS=shadow. */
export const shadowFastOmitted = [
  "items", "slots", "bank", "realmPlayers", "nearbyStandListings", "nearbyGiveaways", "characterDollHtml",
] as const satisfies readonly CharacterFieldName[];

/**
 * Coded whitelists. `fast` stands in for the live stream while it is down
 * and fills the dashboard's diagnostics cache before core's first answer
 * (dashboard/features/party/query-cache.tsx), so it carries every lean field
 * except the large ones the inventory section sends.
 */
export const sectionFields = {
  fast: [
    "name", "owner", "ctype", "level", "server", "ping", "seenAt",
    "skin", "characterSprite",
    "hp", "max_hp", "mp", "max_mp", "cc", "xp", "max_xp", "gold", "map", "in", "x", "y", "rip", "lastDeath",
    "conditions", "inventorySize", "upgradeInventoryBusy", "standOpen", "target",
    "primaryStat", "attack", "frequency", "range", "speed", "unrestrictedSpeed", "armor", "resistance",
    "str", "int", "dex", "vit", "fortitude", "luck", "goldBonus", "xpBonus", "combatStats",
    "banking", "bankQueued", "stocking", "upgrading", "farmingMode", "monsterHunt", "donationXpPerGold", "donationLevelXp",
    "luckySlotTracking", "gatheringCooldowns", "monsterAchievementKills", "monsterAchievements", "tracktrix",
    "anniversaryVisit", "anniversaryState", "eventLeads", "activity",
    // The dashboard reads each add-on's `status.report` fields (its card status and what it saw),
    // so they reach the fast section with every other lean field it reads.
    "addonReports",
  ],
  inventory: ["items", "slots", "characterDollHtml"],
  /**
   * 1.5's diagnostics allow-list, unchanged; core adds combat.positioning.
   * No client reads recovery, movement, eventWalkFailure,
   * farmingNavigationDebug, activeEvent, joinedEvent, the three gathering
   * attempt fields or lootStatus from it, so the catalog marks them debug.
   */
  diagnostics: [
    "name", "recovery", "movement", "eventWalkFailure", "farmingNavigationDebug", "ctype", "server", "level",
    "seenAt", "ping", "owner", "skin", "characterSprite", "characterDollHtml", "primaryStat", "attack",
    "frequency", "range", "speed", "unrestrictedSpeed", "armor", "resistance", "str", "int", "dex", "vit",
    "fortitude", "luck", "goldBonus", "xpBonus", "combatStats", "banking", "bankQueued", "stocking",
    "upgrading", "standOpen", "farmingMode", "monsterHunt", "activeEvent", "joinedEvent", "donationXpPerGold",
    "donationLevelXp", "gatheringCooldowns", "gatheringPhase", "gatheringBlockedReason", "gatheringAttemptId",
    "monsterAchievementKills", "monsterAchievements", "tracktrix", "anniversaryVisit", "anniversaryState",
    "lootStatus", "activity",
    // Each add-on's `status.report` fields: the card reads this section while the live stream is
    // up, when the fast section stops, so a card piece gets its add-on's report either way.
    "addonReports",
  ],
  coreSummary: ["name", "ctype", "level", "server"],
  /**
   * The offline inspection snapshot (intake.ts `rememberCharacterSnapshot`), kept apart from the
   * statuses and the ownership. It never holds commands, session credentials or private bank or
   * account payloads.
   */
  snapshot: [
    "name", "ctype", "level", "xp", "max_xp", "hp", "max_hp", "mp", "max_mp", "gold", "map", "in", "x",
    "y", "rip", "banking", "seenAt", "items", "slots", "skin", "characterSprite", "characterDollHtml",
    "primaryStat", "attack", "frequency", "range", "speed", "unrestrictedSpeed", "armor", "resistance",
    "str", "int", "dex", "vit", "fortitude", "luck", "goldBonus", "xpBonus", "combatStats",
    "conditions", "standOpen",
  ],
} as const satisfies Record<string, readonly CharacterFieldName[]>;
/** The item meta keys the snapshot keeps for each copy; meta.world, the whole catalog, stays out. */
export const SNAPSHOT_META_FIELDS = ["definition", "properties", "scaling", "usage", "sprite", "maxLevel", "title", "upgradeable", "compoundable"] as const;

/**
 * One character's fast-section entry: the `fast` whitelist, the default. The whitelist
 * copies about 60 named fields and never visits the other stored keys. PARTY_STATE_FIELDS=shadow
 * is the registry's audit mode: it sends the v1.4.0 omit-list output, so an audit can see a read
 * the whitelist would drop (docs/state-field-registry.md § Rollout).
 */
export function fastProjection(status: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (globalThis.process?.env.PARTY_STATE_FIELDS !== "shadow") return pickFields(status, sectionFields.fast);
  return Object.fromEntries(Object.entries(status).filter(([key]) => !shadowOmitted.has(key)));
}
const shadowOmitted = new Set<string>(shadowFastOmitted);

/** The named fields that exist on `status`, in whitelist order. */
function pickFields(status: Readonly<Record<string, unknown>>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) if (Object.hasOwn(status, field)) result[field] = status[field];
  return result;
}

// One version per catalog shape: a character whose report names an older version is asked
// for its catalogs again (coordinator/reply.ts `needsCatalog`), so a catalog built by older CODE is
// rebuilt. The character's report names the same entries.
export const CATALOG_VERSIONS = { merchant: 'exchange-rewards-v4', monsterLocations: 3 } as const;
// A game definition as plain data, as the character's catalogs carry it and the coordinator's
// catalog check compares it: the character projects G's definitions with it and the intake projects
// the installed game's, so both sides cut at the same depth and a deep definition compares equal.
// CATALOG_DEPTH is v1.5.0's (shared.js `catalogValue`, catalog-validation.ts). Each
// side passes its runtime's `capReached` as `cut`, which counts every value the depth drops.
const CATALOG_DEPTH = 6;
export function catalogValue(value: unknown, cut?: (cap: 'CATALOG_DEPTH', owner: '12') => void, depth = 0): unknown {
  if (value === null) return null;
  if (depth > CATALOG_DEPTH) { cut?.('CATALOG_DEPTH', '12'); return undefined; }
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(entry => catalogValue(entry, cut, depth + 1)).filter(entry => entry !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, catalogValue(entry, cut, depth + 1)]).filter(([, entry]) => entry !== undefined));
}

// Interface v1: the fields today's apps (the PWA and the APK) read stay while they read them.
// Each row names a field that answers as `v1`; they go in the build step after the PWA and the APK
// release that ships two controls, and a check asks each one. The
// config rows under `farmingProfiles.<scope>.` keep that scope field in config's farmingProfiles
// (coordinator/state.ts), though core's `farmingLive` carries it for the dashboard: both
// apps read a non-leader scope's Hunt cycle and farm area there (adventureland-party-mobile
// 041e574 web/src/models/state.ts:782:787; State.kt:231-232).
export const INTERFACE_VERSIONS = [
  { version: 'v1', at: 'GET /party-api/state?sections=config', field: 'farmingProfiles.<scope>.farmingPolicy', owner: 'state.ts' },
  { version: 'v1', at: 'GET /party-api/state?sections=config', field: 'farmingProfiles.<scope>.monsterHunt', owner: 'state.ts' },
  { version: 'v1', at: 'GET /party-api/state?sections=config', field: 'farmingProfiles.<scope>.farmAreaState', owner: 'state.ts' },
  { version: 'v1', at: 'POST /party-api/farming-mode', field: 'mode', owner: 'runtime/hunting/coordinator/routes.ts `slotsOfMode`, `requestedSlots`' },
] as const;

// Table K: the app a request came from. An app key is `app:<name>` at `app`, or at `manual` while
// its "Counts as my own commands" switch is on. The status owner's gate
// (coordinator/apps.ts `requestCaller`) holds it for the request's work; the player's browser
// and the console's own calls have none.
export interface RequestCaller { by: string; tier: 'manual' | 'app' }
// The names whose values no answer, listener or log line carries. apps.ts drops a command body
// field whose whole name is one, so an ordinary field that ends in Key (itemKey, listingKey) stays
// in the notice. telemetry.ts `diagnosticText` redacts one written as `name=value` or `name: value`.
const SECRET_NAMES = 'api[_ -]?key|key|token|password|authorization|secret|session(?:[_ -]?id)?';
export const secretField = (name: string): boolean => new RegExp(`^(?:${SECRET_NAMES})$`, 'i').test(name);
export const SECRET_TEXT = new RegExp(String.raw`["']?\b(${SECRET_NAMES})\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)`, 'gi');

// One `ownedStockKey`'s sellable copies in the bank section, with the cells the count took, the
// merchant's bag first, so the stand sheet offers a counted copy and never one a claim keeps.
export interface OwnedStock {
  count: number;
  sources: { entry: { slot?: number; item: { name?: string; level?: number; p?: string; q?: number; [key: string]: unknown } }; bankPack?: string }[];
}

// The status owner's kept numbers. Each is v1.5.0's value at an earlier build,
// restored or carried, and its line cites where it stood. Nothing the game reports sets them.
// A failure bound (the two post timeouts against a coordinator that never answers, the credit
// coverage, the two clock checks) reports through boundFired under its own name. A cap on a text,
// a list, a memory or a yield counts each time it cuts through capReached under its own name
// (coordinator/bounds.ts). The two marked "display" set what the dashboard draws and change no play.
export const METRICS_POST_MS = 5000; // characters/shared.js:412, the metrics batch post
export const TELEMETRY_POST_MS = 2500; // characters/shared.js:429, the fast telemetry post
export const DIAGNOSTIC_TEXT_CHARS = 300; // characters/shared.js:3101, a failure's redacted text
export const STATUS_STACK_CHARS = 2000; // characters/shared.js:3108, a failure's stack
export const STATUS_FAILURE_CHARS = 240; // characters/shared.js:3120, the red game log line
export const STATUS_FAILURES_KEPT = 20; // characters/shared.js:3121, failures waiting for delivery
export const FIGHT_PACKETS = 12; // characters/shared.js:1062, the fight packets a report carries
export const TEXTURE_URL_CHARS = 16384; // runtime/characters/map-sprites.ts:70, an atlas url the map takes
export const METRIC_SEEN_MS = 30_000; // runtime/characters/metrics.ts:96, a kill or loot id's and a target's memory
export const CREDIT_COVERAGE_MS = 3000; // runtime/characters/metrics.ts:133, a credit's death before its frame
export const GAME_LOG_BATCH = 100; // runtime/characters/game-logs.ts:124, game log lines per post
export const MISSING_FRAMES_REPORTED = 64; // runtime/characters/game-rendering.ts:86, missing frames warned before one warns again
export const TRACE_CELL_PX = 8; // display: characters/shared.js:17618, the combat trace's position cell
export const HANDOFF_DEATHS = 128; // runtime/combat/handoff-timing.ts:23, death ids the handoff ring remembers
export const COMBAT_LOG_BATCH = 20; // runtime/coordinator/telemetry/combat-log.ts:53, the newest lines a post keeps
export const COMBAT_TYPE_CHARS = 24; // runtime/coordinator/telemetry/combat-log.ts:36, a line's type
export const GAME_LOG_SESSION_CHARS = 100; // runtime/coordinator/telemetry/game-logs.ts:9, a game log line's session
export const GAME_LOG_COLOR_CHARS = 50; // runtime/coordinator/telemetry/game-logs.ts:12, a game log line's color
export const METRIC_ID_CHARS = 500; // runtime/metrics/parse.ts:54, a kill or loot id and a loot variant
export const CHART_POINTS = 600; // display: runtime/coordinator/metrics/service.ts:349, points one metrics answer draws
export const GOLD_YIELD_BUCKETS = 64; // runtime/coordinator/metrics/gold-history.ts:32, buckets between yields
export const ERASE_YIELD_BUCKETS = 24; // runtime/coordinator/metrics/service.ts:296, buckets between yields
export const CLOCK_SKEW_MS = 60_000; // runtime/coordinator/metrics/service.ts:386, a range's end past now
// A clock fact: a daylight saving change lengthens a local calendar day to 25 hours, which the
// earlier console's 26 covers (runtime/coordinator/metrics/service.ts:401).
export const CALENDAR_DAY_MS = 26 * 3_600_000;
export const FRAME_AHEAD_MS = 5000; // runtime/coordinator/metrics/service.ts:432, a frame's last sample past now
export const BAR_NAMES = 64; // runtime/coordinator/metrics/service.ts:403, names a bars query filters by
export const HISTORY_NAMES = 32; // runtime/coordinator/metrics/service.ts:418, names a history query filters by
/** The bucket width that draws `from` to `to` in at most CHART_POINTS points, a whole number of
 *  `finest` buckets. */
export const chartWidth = (from: number, to: number, finest: number) =>
  Math.max(finest, Math.ceil((to - from) / (CHART_POINTS * finest)) * finest);

// The metrics rules (D1.1, coordinator/metrics/): the reset kinds, the character outbox's keys, the
// frame parser the coordinator's intake and the character's outbox both run, and the drop model the
// dashboard's estimator draws. A frame spans one metrics bucket (`STATUS_PICKS.metricBucketMs`).
export const METRIC_BUCKET_MS = STATUS_PICKS.metricBucketMs;
/** How long any metrics history is kept; the routes refuse a longer range, and a character's outbox
 * drops a frame older than this, which the coordinator would expire on arrival. */
export const HISTORY_KEPT_MS = STATUS_PICKS.metricHistory.keptMs;
export const METRIC_RESET_KINDS = ['kills', 'damage', 'gold', 'loot', 'ping'] as const;
/**
 * Character outbox keys in caracAL's localStorage: `party-metrics-v1:<name>` holds the
 * header and `party-metrics-v1:<name>:frame:<sequence>` one unconfirmed frame. The coordinator
 * keeps them in its journal, and only the owner's worker receives them
 * (runtime/settings/coordinator/persistence/worker-storage.ts).
 */
export const METRIC_OUTBOX_PREFIX = 'party-metrics-v1:';
/** The character that owns an outbox key, or undefined for every other key. */
export function metricOutboxOwner(key: string): string | undefined {
  if (!key.startsWith(METRIC_OUTBOX_PREFIX)) return undefined;
  const name = key.slice(METRIC_OUTBOX_PREFIX.length).split(':frame:')[0];
  return name || undefined;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}
export function metricNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
export function metricText(value: unknown, maximum = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
export function parseMetricResets(value: unknown): MetricResets | null {
  const row = object(value);
  if (!row) return null;
  const resets: MetricResets = {};
  for (const kind of METRIC_RESET_KINDS) {
    const at = row[kind];
    if (at === undefined) continue;
    if (!metricNumber(at)) return null;
    resets[kind] = at;
  }
  return resets;
}
export function parseMetricSample(value: unknown): MetricSample | null {
  const row = object(value);
  if (!row || !metricNumber(row.at) || !metricNumber(row.gold) || !metricNumber(row.luck, 0, 1000) ||
      !(row.ping === null || metricNumber(row.ping)) || !metricNumber(row.level, 1, 1000) ||
      !metricNumber(row.xp) || !metricNumber(row.maxXp) ||
      !(row.goldMovement === undefined || metricNumber(row.goldMovement, -Number.MAX_SAFE_INTEGER)) ||
      !(row.consumableCost === undefined || metricNumber(row.consumableCost)) ||
      !(row.consumablePurchases === undefined || metricNumber(row.consumablePurchases)) ||
      !(row.encouragementLuck === undefined || metricNumber(row.encouragementLuck, 1, 1000))) return null;
  return { at: row.at, gold: row.gold, luck: row.luck, ping: row.ping, level: row.level, xp: row.xp, maxXp: row.maxXp,
    ...(row.goldMovement === undefined ? {} : { goldMovement: row.goldMovement }),
    ...(row.consumableCost === undefined ? {} : {consumableCost:row.consumableCost}),
    ...(row.consumablePurchases === undefined ? {} : {consumablePurchases:row.consumablePurchases}),
    ...(row.encouragementLuck === undefined ? {} : { encouragementLuck: row.encouragementLuck }) };
}
function damage(value: unknown): MetricDamage | null {
  const row = object(value);
  if (!row || !metricText(row.monster) || !metricText(row.skill) || !metricNumber(row.amount) || !metricNumber(row.hits)) return null;
  return { monster: row.monster, skill: row.skill, amount: row.amount, hits: row.hits };
}
function credit(value: unknown): MetricCredit | null {
  const row = object(value);
  if (!row || !metricText(row.monster) || !metricNumber(row.count, 1)) return null;
  return { monster: row.monster, count: row.count };
}
function kill(value: unknown): MetricKill | null {
  const row = object(value);
  if (!row || !metricText(row.id, METRIC_ID_CHARS) || !metricNumber(row.at) || !metricText(row.monster) || !metricText(row.actor)) return null;
  return { id: row.id, at: row.at, monster: row.monster, actor: row.actor };
}
function loot(value: unknown): MetricLoot | null {
  const row = object(value);
  if (!row || !metricText(row.id, METRIC_ID_CHARS) || !metricNumber(row.at) || !metricText(row.item) ||
      !metricText(row.variant, METRIC_ID_CHARS) || !metricNumber(row.quantity, 1)) return null;
  return { id: row.id, at: row.at, item: row.item, variant: row.variant, quantity: row.quantity };
}
// A frame's lists hold what one bucket saw; the lifecycle owner's request body limit bounds what
// the route parses.
function list<T>(value: unknown, parse: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const row of value) { const parsed = parse(row); if (!parsed) return null; result.push(parsed); }
  return result;
}
export function parseMetricFrame(value: unknown): MetricFrame | null {
  const row = object(value);
  if (!row || !metricNumber(row.at) || !metricNumber(row.sequence, 1) || !Number.isSafeInteger(row.sequence) ||
      !metricNumber(row.observedMs, 0, METRIC_BUCKET_MS) || typeof row.partial !== 'boolean') return null;
  const at = row.at;
  const first = parseMetricSample(row.first), last = parseMetricSample(row.last),
    hits = list(row.damage, damage), credits = list(row.credits, credit), kills = list(row.kills, kill), items = list(row.loot, loot);
  if (!first || !last || !hits || !credits || !kills || !items || first.at < at || last.at < first.at || last.at > at + METRIC_BUCKET_MS ||
      kills.some(value => value.at < at || value.at >= at + METRIC_BUCKET_MS) ||
      items.some(value => value.at < at || value.at >= at + METRIC_BUCKET_MS)) return null;
  return { at, sequence: row.sequence, observedMs: row.observedMs, partial: row.partial,
    first, last, damage: hits, credits, kills, loot: items };
}
/** Encouragement is a separate contribution-based reward. Ordinary buffs are
 * already included in luckm and must not be added twice.
 * Native fields: node/logic/encouragement.js, encouragement_update/share/loot.
 */
export function encouragementLuck(summary: unknown, conditions: unknown): number | null {
  if (isObject(summary) && isObject(summary.totals)) {
    const luck = summary.totals.luck;
    if (typeof luck === 'number' && Number.isFinite(luck) && luck >= 1) return luck;
  }
  if (!isObject(conditions)) return null;
  let multiplier = 1;
  for (const [id, condition] of Object.entries(conditions)) {
    if (!id.startsWith('encouragement_') || !isObject(condition)) continue;
    const luck = condition.luck_multiplier;
    if (typeof luck === 'number' && Number.isFinite(luck) && luck >= 1) multiplier *= luck;
  }
  return multiplier;
}

export interface DropProjectionInputs {
  baseRate: number; luck: number; share: number; contribution: number;
  encouragement: number; level: number; modifier: number; rolls: number;
}
/** Ordinary table rolls and the native reserved Encouragement roll are
 * independent Bernoulli trials. Contribution is not the party loot share.
 */
export function projectDirectDrop(input: DropProjectionInputs) {
  const ordinary = Math.min(1, input.baseRate * input.luck * input.share * input.level * input.modifier);
  const bonus = Math.min(1, input.baseRate * input.luck * input.contribution * (input.encouragement - 1) * input.level * input.modifier);
  const probability = ordinary === 1 || bonus === 1 ? 1
    : -Math.expm1(input.rolls * Math.log1p(-ordinary) + Math.log1p(-bonus));
  return { probability, expectedRewards: input.rolls * ordinary + bonus };
}
