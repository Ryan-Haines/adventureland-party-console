// Owner 12's rows of the hook table: dashboard and status. Only 12's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import type { Entity } from 'typed-adventureland';
import type { HookRow, ReadRow, SlotRow } from '../registry.ts';
import { doorOnly, readsOf, rowsFor } from './row.ts';

const SPEC = 'e2e/live-status-hooks.spec.ts', SLOT_SPEC = 'scripts/tests/dashboard-addon-slots.test.cjs', PART = 'dashboard status (12)';
const { notice, read } = rowsFor(PART, `${SPEC}#L: `);

// Core-only points (14 0.4's closed list, D4 part 1), one per line with its reason:
// - Table L's order: an add-on adds its line through `status.line`, below L's.
// - Tables I, R and A: each row is an owner's published function, and an add-on's fields ride
//  `status.report`, the stores and `deliver`.
// - Table G's rings: the player's open view leases them.
// - Table C: the command's owner decides its delivery.
// - Table K: who may act as the player is the player's own decision, IN1.
export const HOOKS = {
  // A character's own report for an add-on: fields the coordinator keeps per character.
  // Add-ons answer it, so an ask would run every answer (D4 part 3, `addonMayAsk` false).
  'status.report': { kind: 'request', side: 'character', part: 'dashboard status (12), the character report', answers: 'many', addonMayAsk: false,
    bound: "data only: fields under the add-on's own name in the report; it decides nothing",
    fixture: `${SPEC}#L: the add-on's report field reaches the card`,
    receives: "the character's view on each report", returns: 'the fields to report, or nothing' },
  // One line under table L's line on the card, under the add-on's name.
  'status.line': { kind: 'request', side: 'coordinator', part: PART, answers: 'many', addonMayAsk: false,
    bound: "data only: one line under the add-on's own name, below table L's line, never in place of it",
    fixture: `${SPEC}#L: the add-on's line shows under the card line with its name`,
    receives: '{character, line}', returns: '{label} or nothing' },
  // An add-on's own dashboard command: a card piece's `send` or a section's `save` posts it to
  // POST /party-api/addon-command, and only the add-on it names answers.
  'addon.command': { kind: 'request', side: 'both', part: 'dashboard status (12), an add-on command', answers: 'many', addonMayAsk: false,
    bound: "only the named, enabled add-on answers; it writes only its own store for the character's farming scope, which the route saves; an answer that throws or breaks the {ok, reply} shape replies 500 and is recorded",
    fixture: 'scripts/tests/hook-registry.test.cjs#addon.command: the named add-on answers its own command and writes its own scope store',
    receives: '{owner, character, store, now, body}', returns: '{ok: true, reply} or {ok: false, status, error}' },
  // Part 2: the read-only events, one notify at each change.
  'status.lineChanged': notice("the add-on task's line arrives as status.lineChanged", "character, line, task, phase; by the table L row (L1 to L9)", 'coordinator'),
  'status.received': notice('each report sends status.received', "character, seq, seenAt; by 'core:status'", 'coordinator'),
  'status.replied': notice('each reply names its sections', "character, the sections sent; by 'core:status'", 'coordinator'),
  'dashboard.command': notice('a dashboard command arrives as dashboard.command by user', "route, character or group, the body less secrets; by 'user' or 'app:<name>'", 'coordinator'),
  'dashboard.opened': notice('the dashboard opens and closes', "the stream's client count; by 'core:status'", 'coordinator'),
  'dashboard.closed': notice('the dashboard opens and closes', "the stream's client count; by 'core:status'", 'coordinator'),
  'diagnostics.leased': notice('the diagnostics view leases the rings, then releases them', "character, the rings named; by 'user'", 'coordinator'),
  'diagnostics.released': notice('the diagnostics view leases the rings, then releases them', "character, the rings ended; by 'user'", 'coordinator'),
  'app.keyIssued': notice('a key is issued, used once and revoked', "key name, scopes, tier; by 'user'", 'coordinator'),
  'app.keyRevoked': notice('a key is issued, used once and revoked', "key name, scopes, tier; by 'user'", 'coordinator'),
  'app.used': notice('a key is issued, used once and revoked', "key name, scopes, tier; by 'app:<name>'", 'coordinator'),
  // Part 3: the published reads, each from stored state (`addonMayAsk` true).
  'status.cardLine': read('the add-on reads the card line', 'character', "table L's answer with its group, or null", true, 'coordinator'),
  'status.lastReport': read("the add-on reads its character's report", 'character', 'the last stored report and its seenAt, or null', true, 'coordinator'),
  'status.connected': read('the stopped character reads not connected', 'character', 'the one connection state', true, 'coordinator'),
} as const satisfies Record<string, HookRow>;

// C3: the view each add-on's `status.report` answer gets on the character (status/character/report.ts
// `addonReports`). `G` is the game data the client loaded.
export interface StatusReportView { character: unknown; entities: Readonly<Record<string, Entity>>; G: unknown; now: number; joinedEvent: string | null }
// The add-on capability tables: 12 makes no game call, and its reads
// are hook rows marked addonMayAsk.
// C3's tables (addon-capabilities.md "The completeness rule"): each export of the status owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const STATUS = 'runtime/status/api.ts', STATUS_COORDINATOR = 'runtime/status/coordinator/api.ts';
export const READS = {
  ...readsOf('status', 'both', STATUS, { statusSavedFields: "string[]", CATALOG_VERSIONS: "the catalog versions", catalogValue: "the catalog value", characterFields: "table F's report fields", sectionFields: "table R's reply sections", streamFields: "the stream's fields", reportedStats: "string[]", TABLE_G: "table G's rings", navigational: "boolean", classifyGameLog: "GameLog", defaultLogFilters: "the default log filters", logFilters: "the log filters", showGameLog: "boolean", boundsPending: "boolean", METRIC_BUCKET_MS: "number", HISTORY_KEPT_MS: "number", METRIC_RESET_KINDS: "string[]", metricOutboxOwner: "string", metricNumber: "number | undefined", metricText: "string | undefined", parseMetricResets: "the metric resets", parseMetricSample: "the metric sample", parseMetricFrame: "the metric frame", encouragementLuck: "number", projectDirectDrop: "number", inventoryCounts: "the account inventory counts" }),
  ...readsOf('status', 'coordinator', STATUS_COORDINATOR, { transportTiming: "the reply's transport timing", initialCoordinatorHistory: "the coordinator's initial history", boundFirings: "the bounds' firings", online: "boolean", accountGoldSnapshot: "the account's gold", requestCaller: "the request's caller" }),
  ...readsOf('status', 'both', 'runtime/status/rules.ts', { retained: "boolean", secretField: "boolean" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(STATUS, 'write', ['writeSlot', 'boundFired', 'boundsSent', 'capReached']),
  ...doorOnly('runtime/status/character/api.ts', 'port', ['installHostGameLogs', 'installGameRendering', 'installGameLogEcho', 'createPlanningScheduleMetrics', 'installQueueMarkers']),
  ...doorOnly(STATUS_COORDINATOR, 'port', ['createInstalledCatalogValidation', 'createCoordinatorActivity', 'createDashboardStream', 'createCoordinatorTelemetry', 'createStatusIntake', 'createReply', 'installStatusNotices', 'createHeartbeatReply', 'createCardLines', 'createCoordinatorPublicOverview', 'openMetricsService', 'createDiagnostics', 'installStatusRoutes', 'createApps']),
  ...doorOnly(STATUS_COORDINATOR, 'write', ['appendCombatLog', 'boundFired', 'boundsReported', 'capReached', 'resetCatalogs']),
};

export const SLOTS = {
  // Part 4: each add-on's `status.line` answer, drawn under table L's line on the card.
  'card-line': { owner: '12', data: '{character, label} from status.line answers', section: false, 
    fixture: `${SPEC}#L: the add-on's line shows under the card line with its name` },
  // Part 4: an add-on's own ring (Registration `rings`), posted through table G's lease and drawn
  // as a tab of the diagnostics view by the add-on's own records component.
  'diagnostics-ring': { owner: '12', data: "{ring, label, records} for an add-on's own ring, posted through table G's lease", section: true, 
    fixture: `${SPEC}#L: the add-on's ring shows as a tab of the diagnostics view` },
  // The general slots (decisions.md 2026-11-16): each draws an add-on's piece through `<AddonSlot
  // name part>` after its place's core content (runtime/hooks/dashboard/slots.tsx, addon-kit.ts
  // ADDON_PLACES).
  'top-bar': { owner: '12', data: '{part: views, actions or status, state (PartyState), settings}', section: true, 
    bound: 'adds one piece per add-on per part after the core ones: a button after Logs or Bank, an indicator after the hand count; Settings, the core buttons and the gold stay as they are, in their order',
    fixture: `${SLOT_SPEC}#top-bar: the add-on's button follows Bank, its view follows Logs and its status follows the hand count` },
  'card-section': { owner: '12', data: "{part: one of the card's ten parts, character, report: the character's addonReports[addon], members: the party's character names, send(body): the add-on's own addon.command, settings}", section: true, 
    bound: "adds one block per add-on per part after that part's core content; the core blocks, the Leader and Follow controls, the meters and the inventory stay as they are, in their order",
    fixture: `${SLOT_SPEC}#card-section: the add-on's block shows after the mode rows of the Farming settings line, with its own report` },
  'dialog-section': { owner: '12', data: '{part: one of the 25 dialogs, subject: the character, item, monster, status effect or event the dialog shows, settings}', section: true, 
    bound: "appends one section per add-on after the dialog's core content and above its footer; core content and footer buttons stay as they are, in their order; no confirmation dialog offers it",
    fixture: `${SLOT_SPEC}#dialog-section: the add-on's section closes the status effect dialog, with the condition as its subject` },
  // The one slot that may hide or sort rows (decisions.md 2026-11-16): only list rows, only while its control is set.
  'list-view': { owner: '12', data: "{part: market:wts, market:wtb, market:classifieds or market:ponty, rows: the tab's own rows (addon-kit.ts AddonListRows: item, level, grade, price, seen, realm and every field the tab draws), value, set, search: the tab draws its own search box, settings, stores, save, send, reload, read, open}; the add-on also declares keep(row, value) and order(a, b, value)", section: true, 
    bound: "adds one control per add-on at the end of the tab's filter row; narrows that tab's rows and sorts them by the add-on's order only while the player has set its control, ties keeping the tab's order, and clearing it restores every row in the tab's order; the control the player set last sorts; it cannot relabel rows, change their actions or buy buttons, or touch the core filters",
    fixture: `${SLOT_SPEC}#list-view: the add-on's server choice narrows the Live WTS tab, its order sorts it, and clearing it restores every row in the tab's order` },
  // An add-on's own dialogs, mounted once beside the page's other dialogs.
  'addon-dialog': { owner: '12', data: "{subject: what the add-on's piece opened it for, close(), and the piece base: send, save, reload, read, open, settings}", section: false, 
    bound: "draws only the dialogs the add-on's own pieces open, with kit components inside an AddonPieceBoundary; never inside a core confirmation step",
    fixture: `${SLOT_SPEC}#addon-dialogs: a piece opens its add-on's own dialog with a subject, close removes it, and an undeclared id opens nothing` },
  'page-section': { owner: '12', data: '{part: banner, party-actions, cave, metrics or logs, state (PartyState; the metrics view hands none), settings}', section: true, 
    bound: 'adds one block or button per add-on after the core ones of its part; core panels, Escape and the metrics filters stay as they are, in their order',
    fixture: `${SLOT_SPEC}#page-section: the add-on's block closes the live logs sidebar, after the log entries` },
  'map-layer': { owner: '12', data: '{part: card, native or cave, map, character on the character maps, settings}; the add-on returns markers [{x, y, label, color}]', section: false, 
    bound: "draws its markers after the map's core pins, so above the core layers; core entities, pins and the map controls stay as they are",
    fixture: `${SLOT_SPEC}#map-layer: the add-on's marker shows on the card map above the core layers` },
} as const satisfies Record<string, SlotRow>;

// The slot coverage (addon:check rule 9): each dashboard area's `data-area` id with the slot that
// extends it, or the reason only core draws there with a citation. An area drawn inside another area
// takes that area's decision. The core-only reasons (slot-coverage.md "Core-only reasons used"): An
// area's row: the slot that extends it (with the part when the area draws one), a core-only reason
// with its citation, or the area it is drawn within, whose decision it takes.
export type AreaRow = { file: string; slot: string; part?: string } | { file: string; core: string; cite: string } | { file: string; within: string };
export const AREA_CORE_REASONS = ['security', 'add-on manager', 'save-restore', 'confirmation', 'run control', 'login integrity', 'game truth', 'safety',
  'fixed element', 'frame'] as const;
const P = 'dashboard/features/party/';
export const AREAS = {
  'top-bar': { file: P + 'party-header.tsx', slot: 'top-bar' },
  'character-card': { file: P + 'connected-character-card.tsx', slot: 'card-section' },
  'farming-line': { file: P + 'farming-mode-control.tsx', slot: 'card-section', part: 'farming-line' },
  'merchant-controls': { file: P + 'merchant-card-controls.tsx', slot: 'card-section', part: 'merchant' },
  'interface-settings': { file: P + 'party-inventory-panels.tsx', slot: 'dialog-section', part: 'interface-settings' },
  'bank': { file: P + 'bank-sheet.tsx', slot: 'dialog-section', part: 'bank' },
  'stand': { file: P + 'stand-sheet.tsx', slot: 'dialog-section', part: 'stand' },
  'market-settings': { file: P + 'stand-sheet.tsx', slot: 'dialog-section', part: 'market-settings' },
  'wtb-orders': { file: P + 'stand-sheet.tsx', slot: 'dialog-section', part: 'wtb-orders' },
  'mail': { file: P + 'send-mail-dialog.tsx', slot: 'dialog-section', part: 'mail' },
  'catalog': { file: P + 'equipment-catalog-dialog.tsx', slot: 'dialog-section', part: 'catalog' },
  'bestiary': { file: P + 'bestiary-dialog.tsx', slot: 'dialog-section', part: 'bestiary' },
  'monster': { file: P + 'monster-details-dialog.tsx', slot: 'dialog-section', part: 'monster' },
  'skills': { file: P + 'skills-dialog.tsx', slot: 'dialog-section', part: 'skills' },
  'item': { file: P + 'item-details.tsx', slot: 'dialog-section', part: 'item' },
  'gear-comparison': { file: P + 'gear-comparison-dialog.tsx', slot: 'dialog-section', part: 'gear-comparison' },
  'character-stats': { file: P + 'character-stats-dialog.tsx', slot: 'dialog-section', part: 'character-stats' },
  'condition': { file: P + 'condition-details.tsx', slot: 'dialog-section', part: 'condition' },
  'commerce': { file: P + 'merchant-commerce-dialog.tsx', slot: 'dialog-section', part: 'commerce' },
  'wtb-order': { file: P + 'wtborder-dialog.tsx', slot: 'dialog-section', part: 'wtb-order' },
  'travel': { file: P + 'character-travel-dialog.tsx', slot: 'dialog-section', part: 'travel' },
  'farming-area': { file: P + 'farming-area-picker.tsx', slot: 'dialog-section', part: 'farming-area' },
  'event-settings': { file: P + 'event-limits-dialog.tsx', slot: 'dialog-section', part: 'event-settings' },
  'cave-settings': { file: P + 'dungeon-settings.tsx', slot: 'dialog-section', part: 'cave-settings' },
  'anniversary': { file: P + 'anniversary-dialog.tsx', slot: 'dialog-section', part: 'anniversary' },
  'giveaway': { file: P + 'party-management-panels.tsx', slot: 'dialog-section', part: 'giveaway' },
  'stand-item': { file: P + 'party-management-panels.tsx', slot: 'dialog-section', part: 'stand-item' },
  'lucky-slots': { file: P + 'lucky-slot-tracker.tsx', slot: 'dialog-section', part: 'lucky-slots' },
  'offline-character': { file: P + 'offline-character-view.tsx', slot: 'dialog-section', part: 'offline-character' },
  'apps': { file: P + 'app-keys-settings.tsx', core: 'security', cite: 'questions/design/slot-coverage.md D6' },
  'bank-create': { file: P + 'bank-sheet.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D13' },
  'bank-unlock': { file: P + 'bank-sheet.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D13' },
  'bank-mark-removal': { file: P + 'bank-withdrawal.tsx', core: 'confirmation', cite: 'bank-withdrawal.tsx:40, the confirm step of removing an automatic bank mark' },
  'bestiary-tracktrix': { file: P + 'bestiary-dialog.tsx', within: 'bestiary' },
  'cave-map': { file: P + 'cave-map.tsx', slot: 'map-layer', part: 'cave' },
  'native-map': { file: P + 'character-map-section.tsx', slot: 'map-layer', part: 'native' },
  'session-controls': { file: P + 'character-session-controls.tsx', core: 'login integrity', cite: 'questions/design/slot-coverage.md C3' },
  'cipher': { file: P + 'cipher-controls.tsx', within: 'event-settings' },
  'cipher-dialog': { file: P + 'cipher-controls.tsx', within: 'event-settings' },
  'card-monster': { file: P + 'connected-character-card.tsx', within: 'character-card' },
  'card-awaiting': { file: P + 'connected-character-card.tsx', core: 'frame', cite: 'questions/design/slot-coverage.md P8' },
  'combat-log': { file: P + 'connected-combat-log.tsx', within: 'character-card' },
  'build-load': { file: P + 'console-build-control.tsx', core: 'run control', cite: 'questions/design/slot-coverage.md T1' },
  'build-confirm': { file: P + 'console-build-control.tsx', core: 'run control', cite: 'questions/design/slot-coverage.md T1' },
  'clean-shutdown': { file: P + 'console-controls.tsx', core: 'run control', cite: 'questions/design/slot-coverage.md D43' },
  'console-updates': { file: P + 'console-updates.tsx', core: 'run control', cite: 'questions/design/slot-coverage.md D9' },
  'create-character': { file: P + 'create-character.tsx', core: 'login integrity', cite: 'questions/design/slot-coverage.md D45' },
  'state-import': { file: P + 'dashboard-state-import.tsx', core: 'save-restore', cite: 'questions/design/slot-coverage.md D3' },
  'deconstruction': { file: P + 'deconstruction-confirmation.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md C31' },
  'diagnostics': { file: P + 'diagnostics-dialog.tsx', slot: 'diagnostics-ring' },
  'cave-panel': { file: P + 'dungeon-panel.tsx', slot: 'page-section', part: 'cave' },
  'cave-exit': { file: P + 'dungeon-panel.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md P7' },
  'cave-choice': { file: P + 'dungeon-panel.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md P7' },
  'equipment': { file: P + 'equipment.tsx', within: 'character-card' },
  'events-menu': { file: P + 'event-selection-control.tsx', slot: 'event-list' },
  'farming-area-map': { file: P + 'farming-area-picker.tsx', within: 'farming-area' },
  'farming-settings': { file: P + 'farming-mode-control.tsx', slot: 'settings-section' },
  'clear-blacklist': { file: P + 'farming-mode-control.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md C19' },
  'gear-comparison-side': { file: P + 'gear-comparison-dialog.tsx', within: 'gear-comparison' },
  'hosting': { file: P + 'hosting-settings.tsx', core: 'run control', cite: 'questions/design/slot-coverage.md D8' },
  'hunt-blacklist-picker': { file: P + 'hunt-blacklist-picker.tsx', within: 'farming-settings' },
  'hunt-settings': { file: P + 'hunt-settings-control.tsx', within: 'farming-settings' },
  'hunt-thresholds': { file: P + 'hunt-settings-control.tsx', within: 'farming-settings' },
  'hunt-spawns': { file: P + 'hunt-spawn-settings.tsx', within: 'farming-settings' },
  'inventory-rules': { file: P + 'inventory-panel.tsx', within: 'character-card' },
  'inventory': { file: P + 'inventory-panel.tsx', within: 'character-card' },
  'item-card': { file: P + 'item-card.tsx', within: 'item' },
  'item-information': { file: P + 'item-card.tsx', within: 'item' },
  'item-skill': { file: P + 'item-details.tsx', within: 'item' },
  'item-monster': { file: P + 'item-details.tsx', within: 'item' },
  'item-popover': { file: P + 'item-details.tsx', within: 'item' },
  'item-exchange': { file: P + 'item-exchange-details.tsx', within: 'item' },
  'item-exchange-rewards': { file: P + 'item-exchange-details.tsx', within: 'item' },
  'item-exchange-sources': { file: P + 'item-exchange-details.tsx', within: 'item' },
  'logs': { file: P + 'log-sidebar.tsx', slot: 'page-section', part: 'logs' },
  'mail-sent': { file: P + 'mailbox-controls.tsx', within: 'mail' },
  'market-preferences': { file: P + 'market-preferences.tsx', within: 'market-settings' },
  'cancel-job': { file: P + 'merchant-cancel-job-control.tsx', core: 'confirmation', cite: 'merchant-cancel-job-control.tsx:45, the confirm step of cancelling a merchant job' },
  'collection-settings': { file: P + 'merchant-collection-settings.tsx', within: 'merchant-controls' },
  'collection-settings-body': { file: P + 'merchant-collection-settings.tsx', within: 'merchant-controls' },
  'commerce-estimate': { file: P + 'merchant-commerce-dialog.tsx', within: 'commerce' },
  'merchant-visit': { file: P + 'merchant-visit-control.tsx', within: 'character-card' },
  'metrics-chart': { file: P + 'metrics-chart.tsx', within: 'metrics' },
  'metrics-controls': { file: P + 'metrics-controls.tsx', within: 'metrics' },
  'metrics-filter': { file: P + 'metrics-filter.tsx', within: 'metrics' },
  'metrics-item-picker': { file: P + 'metrics-item-picker.tsx', within: 'metrics' },
  'metrics': { file: P + 'metrics-view.tsx', slot: 'page-section', part: 'metrics' },
  'monster-achievement': { file: P + 'monster-achievement-progress.tsx', within: 'monster' },
  'monster-focus': { file: P + 'monster-focus-picker.tsx', within: 'character-card' },
  'monster-spawns': { file: P + 'monster-spawns.tsx', within: 'monster' },
  'offline-stats': { file: P + 'offline-character-view.tsx', within: 'offline-character' },
  'offline-saved-stats': { file: P + 'offline-character-view.tsx', within: 'offline-character' },
  'catalog-compare': { file: P + 'party-equipment-catalog-dialog.tsx', within: 'catalog' },
  'realm-confirm': { file: P + 'party-inventory-panels.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D4' },
  'giveaway-popover': { file: P + 'party-management-panels.tsx', within: 'giveaway' },
  'npc-sale-automatic': { file: P + 'party-management-panels.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D39' },
  'npc-sale': { file: P + 'party-management-panels.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D39' },
  'action-error': { file: P + 'party-reference-panels.tsx', core: 'frame', cite: 'questions/design/slot-coverage.md D41' },
  'donate': { file: P + 'party-reference-panels.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D40' },
  'workspace': { file: P + 'party-workspace.tsx', slot: 'page-section', part: 'party-actions' },
  'passive-hunting': { file: P + 'passive-hunting-menu.tsx', slot: 'rare-list', part: 'passive-hunting' },
  'passive-hunting-help': { file: P + 'passive-hunting-menu.tsx', within: 'passive-hunting' },
  'pending-card': { file: P + 'pending-character-cards.tsx', core: 'login integrity', cite: 'questions/design/slot-coverage.md P9' },
  'display': { file: P + 'pin-top-bar.tsx', within: 'interface-settings' },
  'restock': { file: P + 'restock-controls.tsx', within: 'character-card' },
  'roster-picker': { file: P + 'roster-picker.tsx', core: 'login integrity', cite: 'questions/design/slot-coverage.md D44' },
  'routines': { file: P + 'routine-priorities-dialog.tsx', slot: 'merchant-routines', part: 'routines' },
  'send-to-party': { file: P + 'send-to-party-control.tsx', within: 'character-card' },
  'rule-conflicts': { file: P + 'shared-rule-conflicts.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md C30' },
  'market': { file: P + 'stand-sheet.tsx', slot: 'list-view' },
  'addon-dialogs': { file: 'runtime/hooks/dashboard/slots.tsx', slot: 'addon-dialog' },
  'market-purchase': { file: P + 'stand-sheet.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D19' },
  'market-sale': { file: P + 'stand-sheet.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D19' },
  'ponty-purchase': { file: P + 'stand-sheet.tsx', core: 'confirmation', cite: 'questions/design/slot-coverage.md D19' },
  'tracktrix': { file: P + 'tracktrix-bonuses.tsx', within: 'bestiary' },
  'upgrade-offerings': { file: P + 'upgrade-offering-controls.tsx', within: 'character-card' },
  'upgrade-offering-rules': { file: P + 'upgrade-offering-controls.tsx', within: 'character-card' },
  'upgrade-preview': { file: P + 'upgrade-preview-panel.tsx', within: 'item' },
  'wtb-preferences-help': { file: P + 'wtb-preferences.tsx', within: 'wtb-order' },
  'wtb-preferences': { file: P + 'wtb-preferences.tsx', within: 'wtb-order' },
  'wtb-order-help': { file: P + 'wtborder-dialog.tsx', within: 'wtb-order' },
  'addon-manager': { file: 'runtime/hooks/dashboard/settings-page.tsx', core: 'add-on manager', cite: 'questions/design/slot-coverage.md D7' },
} satisfies Record<string, AreaRow>;

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/status/rules.ts'] as const;
export const DECISIONS = {
  'the card line': { site: 'runtime/status/rules.ts:75', hook: 'status.line' },
  "an add-on's own command": { site: 'runtime/hooks/http.ts:63', hook: 'addon.command' },
  'the fields a character report carries': { at: 'runtime/status/rules.ts#reportedStats', hook: 'status.report' },
  'the command slot write (table C6)': { at: 'runtime/status/rules.ts#writeSlot', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:11, the rank table ranks a write over a retained command' },
  'combat log limit': { site: 'runtime/status/coordinator/logs.ts:17', hook: 'settings.overlay' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  retained: 'read', navigational: 'read', secretField: 'read', metricOutboxOwner: 'read', encouragementLuck: 'read',
  projectDirectDrop: 'read',
  fastProjection: 'format', catalogValue: 'format', chartWidth: 'format',
  metricNumber: 'validator', metricText: 'validator', parseMetricResets: 'validator', parseMetricSample: 'validator',
  parseMetricFrame: 'validator',
} satisfies Record<string, PlainKind>;
