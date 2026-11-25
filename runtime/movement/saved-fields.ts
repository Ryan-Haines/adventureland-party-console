import { mapOf, wholeFrom, type Declarations } from '../settings/api.ts';
import { REPORT_AGE_DEFAULTS } from '../protocol/reports.ts';
import type { ReturnLocation } from '../events/api.ts';
// The coordinator's revision of where the party goes, saved per character in `navigationIntents`
// and carried by each status reply (walk-client.ts `applyNavigationIntent`).
export interface NavigationIntent { revision: number; cancelled: boolean; reason?: string }
// The saved shape of movement's two location records.
export interface SavedMovementLocations {
  characterLocations?: Record<string, ReturnLocation | undefined> | null;
  navigationIntents?: Record<string, NavigationIntent | undefined> | null;
}
// The saved fields of movement, its declarations for the settings owner, which builds its table
// from them at load (`settings.declare`). Play writes each record. The player chooses the settings
// the list shows; a `hidden` setting keeps today's value and changes only with the code ("Recheck 4
// fixes" R4-3).

// A whole number of milliseconds or steps from `min` up.
const whole = (min: number, max = Infinity) => ({ kind: 'value' as const, check: wholeFrom(min, max) });

export const movementSavedFields = {
  name: 'core:movement',
  settings: {
    // How long the card's "Stuck - trying <rung>" notice lasts at most. Null leaves each
    // character at two of its own report intervals (movement's `settingsReply`).
    movementStuckNoticeMs: { label: 'Stuck notice length (ms)', kind: 'value', default: null as number | null,
      check: value => value === null || wholeFrom(1, Infinity)(value), deliver: ['characters'] },
    // Queue C1: per character, how long a click to walk stays the player's command. A character
    // with no entry waits 5 s, the user's decision of 2026-10-29, which the reply fills in
    // (runtime/status/coordinator/reply.ts).
    movementClickWaitMs: { label: 'After my click, wait before taking over (ms)', kind: 'value', default: {} as Record<string, number>,
      scope: 'character', check: mapOf(wholeFrom(0, Infinity)) },
    // The settings below areF4's, each with today's value as its default
    // (rule R2: no game fact or progress rule gives these numbers).
    // How old a member's report may be and still count as fresh: the decided 3 s.
    reportFreshMs: { label: 'A report counts as fresh for (ms)', ...whole(1), default: REPORT_AGE_DEFAULTS.reportFreshMs, deliver: ['characters'] },
    // The planner's budget for one try; a requester may set its own per request.
    movementPlanningMs: { label: 'Route planning budget per try (ms)', ...whole(1000, 120000), default: 30000, deliver: ['characters'] },
    // "Online" for presence reads (movement's walk.ts and arrivals.ts, application.ts, the call budget owner's realm reads).
    reportPresenceMs: { label: 'Report presence window (ms)', ...whole(1), default: REPORT_AGE_DEFAULTS.reportPresenceMs, hidden: true },
    // "Reported since the operation began" (application.ts; the call budget owner's realm-switch.ts, realms.ts).
    reportRecentMs: { label: 'Recent report window (ms)', ...whole(1), default: REPORT_AGE_DEFAULTS.reportRecentMs, hidden: true },
    // The merchant's pursuit target counts as reported (errands.ts `meet`, the mechanics of shared.js `pursueMerchantTarget`).
    errandTargetReportMs: { label: 'Errand target report window (ms)', ...whole(1), default: REPORT_AGE_DEFAULTS.errandTargetReportMs, hidden: true, deliver: ['characters'] },
    // The ALClient planner's budget per try and the planner worker's preparation.
    movementAlclientPlanMs: { label: 'ALClient planning budget (ms)', ...whole(1), default: 2000, hidden: true },
    movementPlannerPrepareMs: { label: 'Planner preparation budget (ms)', ...whole(1), default: 10000, hidden: true },
  },
  records: {
    activeConvoy: { default: null, scope: 'scope', deliver: ['dashboard-core'] },
    characterLocations: { default: {} satisfies SavedMovementLocations['characterLocations'], deliver: ['dashboard-core'] },
    navigationIntents: { default: {} satisfies SavedMovementLocations['navigationIntents'] },
    townCycle: { default: null },
    convoyCompletionReceipts: { default: {} },
    // A fresh install loads the clock's time at the start (settings/coordinator/initial.ts `initialCommandState`).
    navigationEpoch: { default: 0 },
  },
} satisfies Declarations;

// "After my click, wait before taking over": how long the movement owner keeps a click to walk in
// the game client as the player's command after its walk ends. The user decided 5 s, 2026-10-29,
// the same as the escape's Resume lockout. The coordinator sends each character its saved value, or
// this one when it has none (movement's saved field `movementClickWaitMs`), and the character uses
// this until a reply has.
export const CLICK_WAIT_DEFAULT_MS = 5000;
