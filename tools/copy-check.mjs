// The copy check: a rule movement's rework made one copy of fails the build when a removed copy
// comes back. Each rule holds from the rework step that removed its copies; owner:check runs it
// on every gate. The settings owner's rework adds its own rules.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The T6 mover names (runtime/movement/rules.ts `MOVERS`). A file that names more than half of
// them is a second mover list; the movement tick (runtime/movement/character/movers.ts) binds each
// name to the function that answers it and runs them in MOVERS' order, with no order of its own.
const MOVER_NAMES = ["event-return-combat", "franky", "franky-approach", "rare-hunting", "grouped-regroup", "grouped-target-formation",
  "farm-approach-recovery", "cave-recovery", "idle-formation", "target-formation", "kite-and-approach"];
const LIST_HOLDERS = new Set(["runtime/movement/rules.ts", "runtime/movement/character/movers.ts"]);
const SCANNED = (file) => /^runtime\/.+\.(ts|cjs|mjs)$|^characters\/shared\.js$|^scripts\/[^/]+\.cjs$/.test(file) && !/\.test\.|\/tests\//.test(file);
// The settings owner's persistence windows: a file in a persistence folder, or the roster
// snapshots, names no time of its own, since each window is a hidden setting. A number of three
// or more digits beside a timer, a timeout or a clock is a time; the journal's byte sizes are
// products of 1024.
const PERSISTENCE = (file) => /\/persistence\/[^/]+\.ts$|roster-snapshots\.ts$/.test(file);
const TIME = /\b\d[\d_]{2,}\b/;
const TIME_CONTEXT = /setTimeout|setInterval|timeout|interval|_MS\b|Ms\b|Date\.now\(\)\s*[+-]/i;
const CSS_COLOR = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi;
const JOURNAL_SIZE = /\*\s*1024/;

// R2: a report's age has one copy, runtime/protocol/reports.ts. The rule holds in movement's module,
// the protocol and the files R2 edited; the stand-in owners' files keep
// their own lines until their designs, and characters/shared.js keeps theirs until R3 moves
// movement's functions out of it. A line compares a report stamp (`seenAt`, `observedAt`,
// `observationAt`, `*AttackersAt`, `controlAt`) with one of the readings' ages, or a report's `at`
// with the `report` age, or defines a `FRESH_MS` constant. Other times compared with 5 s, 10 s or 15
// s (an evidence window, a log throttle, a handoff) are appendix C's rows, not ages. The
// runtime/combat/ and navigation/ names are targeting's files before its rework, which the
// self-test's pinned trees hold.
const FRESHNESS_FILES = new Set(["runtime/combat/claims.ts", "runtime/combat/composition.ts",
  "runtime/combat/grouped.ts", "runtime/combat/lost-target.ts", "runtime/combat/nomination-retention.ts",
  "runtime/combat/passing-admission.ts", "runtime/combat/pursuit.ts", "runtime/combat/queue.ts", "runtime/combat/reset-fight.ts",
  "runtime/combat/successor-grant.ts", "runtime/combat/unseen-primary.ts", "runtime/coordinator/navigation/grouped-snapshot.ts",
  "runtime/coordinator/navigation/phoenix-candidates.ts", "runtime/coordinator/targeting/queue.ts", "runtime/combat/hunt-travel.ts",
  "runtime/coordinator/targeting/unseen.ts", "runtime/characters/targeting/queue-client.ts",
  "runtime/lifecycle/roster/ownership.ts", "runtime/merchant-realm/coordinator/owner.ts", "runtime/merchant-realm/coordinator/party-switch.ts",
  "runtime/lifecycle/roster/roster-projection.ts", "runtime/hunting/coordinator/routes.ts",
  "runtime/coordinator/targeting/snapshot.ts", "runtime/coordinator/navigation/travel-defense.ts", "runtime/coordinator/targeting/hunt-travel.ts",
  "runtime/coordinator/targeting/api.ts", "runtime/movement/coordinator/hunt-travel.ts",
  "runtime/coordinator/survival/died.ts", "runtime/coordinator/survival/verdict.ts", "runtime/coordinator/survival/escape.ts",
  "runtime/coordinator/survival/recovery.ts", "runtime/coordinator/survival/install.ts"]);
const freshnessScope = (file) => (FRESHNESS_FILES.has(file) || /^runtime\/(movement|protocol)\//.test(file)) && file !== "runtime/protocol/reports.ts";
const REPORT_STAMP = /(seenAt|observedAt|observationAt|AttackersAt|controlAt)\b/;
const REPORT_AT = /(\.|\b)at\b(?!\()/;
const READING_AGE = /\b(3_?000|5_?000|10_?000|15_?000)\b|\bFRESH(_MS)?\b/;
const REPORT_AGE = /\b3_?000\b|\bFRESH(_MS)?\b/;
const reportAge = (line) => /\bFRESH(_MS)?\s*=\s*\d/.test(line) || /[<>]=?/.test(line) &&
  (REPORT_STAMP.test(line) && READING_AGE.test(line) || REPORT_AT.test(line) && REPORT_AGE.test(line));

export const COPY_RULES = [
  // R1: T1's band column decides the band of every send.
  { step: "R1", what: "a band rule outside T1 (bandOf)", test: (line) => /\bbandOf\b/.test(line) },
  // R1: sends follow the owner's state; the call budget's held queue is the only queue.
  { step: "R1", what: "a send queue outside the call budget (owe, payOwed, sendOrOwe)", test: (line) => /\b(owe|payOwed|sendOrOwe)\(/.test(line) },
  // W-S1: the history bound is the hidden setting historyKept, named once.
  { step: "W-S1", what: "a second history bound (SETTINGS_LINES)", test: (line) => /\bSETTINGS_LINES\b/.test(line) },
  // It reads the settings owner's module, and the persistence's old folder for older trees. The
  // history load (runtime/status/coordinator/logs.ts) reads `historyKept`, and the stand listing
  // cache's 500 is no history bound.
  { step: "W-S1", what: "a literal history bound of 500 beside slice(-", test: (line, file) => /^runtime\/(settings|coordinator\/persistence)\//.test(file) && /slice\(-\s*500\b/.test(line) },
  // W-S2: one settings answer per realm, registered by its install, and the add-on
  // switch read only by the add-on system's own listener (runtime/hooks/core.ts).
  { step: "W-S2", what: "the settings owner's global lookup (__partySettings)", test: (line) => /\b__partySettings\b/.test(line) },
  { step: "W-S2", what: "a fallback settings answer (noSettingsOwner)", test: (line) => /\bnoSettingsOwner\b/.test(line) },
  { step: "W-S2", what: "the settings owner feeding the registry its switches (configure)", test: (line, file) => file.startsWith("runtime/settings/") && /\bconfigure\(/.test(line) },
  { step: "W-S2", what: "a special case of the add-on switch's field", test: (line, file) => file !== "runtime/hooks/core.ts" && /\.field\s*===\s*["']addons["']/.test(line) },
  // W-S3: a route of the settings owner checks a value only through its declaration, which the
  // writer runs. The formation route's event limits line is the events owner's stand-in
  //, which stays unedited.
  { step: "W-S3", what: "a route's own copy of a declared check (valid*)", test: (line, file) => file.startsWith("runtime/settings/coordinator/routes/") && /\bvalid(?!EventLimits\b)[A-Z]\w*\(/.test(line) },
  // W-S1: a time literal in the persistence.
  { step: "W-S1", what: "a time literal in the persistence", test: (line, file) => PERSISTENCE(file) && TIME.test(line) && TIME_CONTEXT.test(line) && !JOURNAL_SIZE.test(line) },
  // R4: the rally range has one copy, protocol/ladder.ts's `RENDEZVOUS_RANGE`,
  // which moved from route-store.ts to the protocol. The rule holds in movement's module, the protocol
  // and characters/shared.js, whose reunion asks movement's `reunionArrived`.
  { step: "R4", what: "a rally range outside protocol/ladder.ts (55)", test: (line, file) => /^runtime\/(movement|protocol)\/|^characters\/shared\.js$/.test(file) &&
    file !== "runtime/protocol/ladder.ts" && /[<>]=?\s*55\b|\b55\s*[<>]|\?\s*55\s*:/.test(line) },
  // R7: a walk's interruptibility is T1's: movement
  // reads `nonPreemptible` and `navigationExempt` only in rules.ts's T1 rules. A builder that sets
  // them, an object field that carries them and a type that declares them are no reads.
  { step: "R7", what: "a walk flag read outside T1 (nonPreemptible, navigationExempt)", test: (line, file) => /^runtime\/movement\//.test(file) &&
    file !== "runtime/movement/rules.ts" && /\.(nonPreemptible|navigationExempt)\b(?!\s*=[^=])/.test(line) &&
    !/^\s*(nonPreemptible|navigationExempt)\s*[?:]/.test(line) && !/\.(nonPreemptible|navigationExempt)\s*=[^=]/.test(line) && !/(nonPreemptible|navigationExempt)\s*:\s*[!\w]*\s*\w+\.(nonPreemptible|navigationExempt)/.test(line) },
  // R7: one climber, protocol/ladder.ts: no retry machine of its
  // own in movement's module.
  { step: "R7", what: "a retry machine outside protocol/ladder.ts (retry()", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\bfunction\s+retry\s*\(|\bretry\s*=\s*(async\s*)?(\(|function)|\bTRY_WITHOUT_PROGRESS_MS\b/.test(line) },
  // R7: a geometry failure ends through T5 and the climber; `retryExhausted` is the walk's record
  // of it, which only walk.ts's T5 lookup reads.
  { step: "R7", what: "a retryExhausted read outside walk.ts", test: (line, file) => /^runtime\/movement\//.test(file) &&
    file !== "runtime/movement/coordinator/walk.ts" && /\bretryExhausted\b(?!\s*=[^=])/.test(line) && !/^\s*retryExhausted\s*[?:]/.test(line) },
  // R4: every walk runs on the current protocol, so movement's module never tests a
  // member's protocol number; a member that has not reported from its runtime waits on T5 `runtime-lost`.
  { step: "R4", what: "a protocol test on a member's report (convoyProtocol)", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\bconvoyProtocol\s*[!=]==?|[!=]==?\s*\w+\.convoyProtocol\b/.test(line) },
  // R4: every walk command comes from walk.ts `sharedCommand`, the one walk machine, so no
  // command or walk carries a route protocol marker and nothing reads one.
  { step: "R4", what: "a route protocol marker (routeProtocol)", test: (line) => /\brouteProtocol\b/.test(line) },
  // R4: movement's module tells an event walk by the activity it serves, never by its label
  // Every event walk asks `task.windDown`, and no clock of its own ends the wait for the
  // members still to ask (item 6).
  { step: "R4", what: "a walk label test", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\blabel\s*[!=]==?\s*["'`]/.test(line) },
  { step: "R4", what: "an optional task.windDown port or the event start grace", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\bwindDown\?\s*[(:]|!ports\.windDown\b(?!\()|\bEVENT_RENDEZVOUS_GRACE_MS\b/.test(line) },
  // (movement's site 10): an event walk reads the tasks owner's wind-down as its `member.holder`
  // answer, so movement's module holds no wind-down port or grace flag of its own.
  { step: "E02-01h", what: "a wind-down port in runtime/movement/", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\bwindDown\b|\bgraceOver\b/.test(line) },
  // R4: no walk judges a member from a round of reports. A rally, a barrier row, a hold and the event
  // start end on arrivals, acknowledgements and holder answers.
  { step: "R4", what: "a report round", test: (line, file) => /^runtime\/movement\//.test(file) &&
    /\b(roundReported|reportRound|ReportRound|noProgressRound|readyRound|ackRound|stallRound|startRound)\b/.test(line) },
  // The call budget's rework. The budget answers `calls.band` and `calls.margin` from its own
  // install, and `__partyCalls` is a published view that only the status report reads.
  { step: "C-S3", what: "a read of __partyCalls outside the call budget and the status report",
    test: (line, file) => /__partyCalls\b/.test(line) && !BUDGET.test(file) && !(file === STATUS_REPORT && STATUS_CALLS.test(line)) },
  { step: "C-S3", what: "a call budget lookup in the hook registry (callBudget)", test: (line, file) => file.startsWith("runtime/hooks/") && /\bcallBudget\(/.test(line) },
  { step: "C-S3", what: "a fallback answer for calls.band or calls.margin", test: (line, file) => file.startsWith("runtime/hooks/") &&
    (/\?\?\s*["'`]send["'`]/.test(line) || /answering\(["'`]calls\.(band|margin)["'`]\)\[0\]\?\./.test(line)) },
  { step: "C-S3", what: "a second call ring bound (CALL_RING_SIZE)", test: (line) => /\bCALL_RING_SIZE\b/.test(line) },
  // Every wait of the reads is the margin or a hidden setting's declaration.
  { step: "C-S3", what: "a time literal in the call budget's reads", test: (line, file) => file === "runtime/characters/call-budget-reads.ts" && /\b\d{2,}\b|\d_\d/.test(line.replace(/\/\/.*$/, "")) },
  // The lifecycle owner's run gate holds a due `act` one-shot while table P holds the character and
  // fires it at release: the second hold queue by design.
  { step: "C-S3", what: "a hold queue outside the call budget (held.push)", test: (line, file) => !BUDGET.test(file) &&
    file !== "runtime/lifecycle/character/run.ts" && /\bheld\.push\(/.test(line) },
  { step: "C-S3", what: "a margin read through the status sample (sample().margin)", test: (line, file) => !BUDGET.test(file) && /sample\(\)\.margin/.test(line) },
];
const BUDGET = /^runtime\/characters\/call-budget[\w-]*\.ts$/;
// The status report's `calls` field, the status owner's reader, where the status owner's build
// moved shared.js's `statusReport`.
const STATUS_REPORT = "runtime/status/character/report.ts";
const STATUS_CALLS = /^\s*calls: root\.__partyCalls && root\.__partyCalls\.sample \? root\.__partyCalls\.sample\(\) : null,\s*$/;

// The tasks owner's rework: the task table has one copy, runtime/tasks/rules.ts. In the module and the
// coordinator's wiring a Cave visit is read only through the hunting owner's `cave.state` (closed), and
// the table's `judge` is applied only by the owner. The visit reads of the targeting owner, 07, 08 and 13 are their own
// stand-ins'.
const TASK_AREA = (file) => /^runtime\/tasks\//.test(file) || file === "runtime/coordinator/application.ts";
// A file that imports the task table: runtime/tasks/rules.ts by its path (task-rules.ts before the
// tasks owner's rework), or rules.ts from inside runtime/tasks/. runtime/movement/rules.ts is
// movement's own table.
const tasksRules = (file, text) => /from ["'][./]*tasks\/(task-)?rules\.ts["']/.test(text) || /^runtime\/tasks\//.test(file) && /from ["'][./]*rules\.ts["']/.test(text);
const FILE_RULES = [
  { step: "O1", what: "a Cave visit gate outside `cave.state` (dungeonOwns)", test: (file, line) => /\bdungeonOwns\(/.test(line) && TASK_AREA(file) },
  // RA-01a: the hand control's default and its check have one copy, runtime/tasks/rules.ts, which
  // api.ts exports to the dashboard and the formation route.
  { step: "RA", what: "a hand control default or check outside rules.ts (HAND_CONTROL_DEFAULT, validHandControl)", test: (file, line) =>
    /\b(const HAND_CONTROL_DEFAULT|function validHandControl)\b/.test(line) && file !== "runtime/tasks/rules.ts" },
  { step: "O1", what: "a judge of the task table outside rules.ts and the owner (judge)", test: (file, line, text) => /(^|[^.\w])judge\(/.test(line) &&
    tasksRules(file, text) && file !== "runtime/tasks/rules.ts" && file !== "runtime/tasks/coordinator/owner.ts" },
];
// The lifecycle owner's rules, from its build on: the Pause's three mechanisms, the combat socket
// registry and the convoy runner flag are gone; each lifecycle file name has one holder; a lease
// carries no `immediate`; and every lifecycle wait reads fields.ts.
const LIFECYCLE = (file) => /^runtime\/lifecycle\//.test(file);
export const LIFECYCLE_RULES = [
  { step: "L11", what: "a Pause mechanism the run scope replaced (consoleHeld, consolePauseHolds, userPauseLease, withUserPause)",
    test: (line) => /\b(consoleHeld|consolePauseHolds|userPauseLease|withUserPause)\b/.test(line) },
  { step: "L11", what: "the combat socket registry or the convoy runner flag (__partyCombatSocketSubscriptions, migratePartyCombatSockets, __partyFreshConvoyRunnerV3)",
    test: (line) => /\b(__partyCombatSocketSubscriptions|migratePartyCombatSockets|__partyFreshConvoyRunnerV3)\b/.test(line) },
  { step: "RN1", what: "the Pause file's name outside rules.ts and control.ts (console-pause.json)", test: (line, file) =>
    /console-pause\.json/.test(line) && file !== "runtime/lifecycle/rules.ts" && file !== "runtime/lifecycle/coordinator/control.ts" },
  { step: "RN1", what: "the deploy lease's file name outside rules.ts (updates/pause.json)", test: (line, file) =>
    /updates\/pause\.json/.test(line) && file !== "runtime/lifecycle/rules.ts" },
  { step: "RN1", what: "an `immediate` lease (the Pause rides no lease)", test: (line, file) =>
    /\bimmediate\s*:/.test(line) && (LIFECYCLE(file) || /[Ll]ease|Maintenance/.test(line)) },
  // A CSS hex color (#555, #171717) is no time: on a style line the context reads `align-items` as
  // `Ms`, so the colors leave the line before the time test (roster/switcher.ts's styles). `saved`
  // marks a line of `previousSteamBootstrap`'s text: an older build's saved CODE slot, which the
  // slot migration compares whole, and no wait this console runs.
  { step: "L3.3", what: "a time literal in runtime/lifecycle/ outside fields.ts", test: (line, file, saved) =>
    LIFECYCLE(file) && file !== "runtime/lifecycle/fields.ts" && !saved && TIME.test(line.replace(CSS_COLOR, "")) && TIME_CONTEXT.test(line) },
];
export const TASK_RULES = [
  // O2: T1 `dueYields` answers the hand-in's yield to a due event.
  { step: "O2", what: "the hand-in's own yield check (huntYieldsToEvent)", test: (line) => /\bhuntYieldsToEvent\b/.test(line) },
  // O2: a source's task ends on the tick it describes none.
  { step: "O2", what: "a renewal deadline for source tasks (RECORD_RENEWAL_MS)", test: (line) => /\bRECORD_RENEWAL_MS\b/.test(line) },
  // O2: sources.ts holds the one ask per source; the owner holds the handles.
  { step: "O2", what: "a provider seat (createSeat)", test: (line) => /\bcreateSeat\(/.test(line) },
  // O2: T3 `runs` decides what a source's tick may do.
  { step: "O2", what: "a rank gate beside the table (holdsAbove)", test: (line) => /\bholdsAbove\(/.test(line) },
  // O4: T1 `reunion` decides which tasks allow a reunion.
  { step: "O4", what: "a reunion task list (REUNION_TASKS)", test: (line) => /\bREUNION_(COMMAND_)?TASKS\b/.test(line) },
  // O2: the entry's task end gives the add-on its one `release` call.
  { step: "O2", what: "a target mode entry's selected flag (store.selected)", test: (line) => /\bstore\.selected\b/.test(line) },
  // O1: T5 names the rungs.
  { step: "O1", what: "a task ladder step number (WAIT_STEP, SAFE_POINT_STEP, FALL_BACK_STEP)", test: (line) => /\b(WAIT_STEP|SAFE_POINT_STEP|FALL_BACK_STEP)\b/.test(line) },
];

// The turns owner's rework: T1 is the one hold, read through `skills.allows`; the Cave revival's hold
// is survival's verdict; the attack edge is armed by the turns owner's own events, never nudged;
// targeting adopts the crab distance; and "Heal first below" has one default, in
// turns/saved-fields.ts.
const TURNS_RULES = [
  { step: "T-S2", what: "the A/B mode read in the turns owner outside its stand-in port (getAbtestingMode)", test: (line, file) => file.startsWith("runtime/characters/turns/") && /\bgetAbtestingMode\b/.test(line) },
  { step: "T-S2", what: "the Cave revival's own hold read (caveRecoveryReserved)", test: (line) => /\bcaveRecoveryReserved\b/.test(line) },
  { step: "T-S2", what: "a nudge of the turns owner's attack edge (turns.edge())", test: (line) => /\bturns\??\.edge\(/.test(line) },
  { step: "T-S3", what: "an assignment of the crab distance onto the routine (correctedCombatDistance =)", test: (line) => /\bcorrectedCombatDistance\s*=[^=]/.test(line) },
  { step: "T-S2", what: "a second Heal first below default (80)", test: (line, file) => /^runtime\/characters\/(turns|roles|survival)\//.test(file) &&
    file !== "runtime/characters/turns/saved-fields.ts" && /healFirstBelow/i.test(line) && /\b80\b/.test(line) },
];
// survival's rework (the character half): the 90% healthy share has one source, lines.ts
// `HEALTHY_SHARE`; the survival globals are the module's own published views, read only inside it;
// and the escape's record lives in escape.ts. The share's rule reads the files that held its copies
// (the survival module, shared.js and the turns owner, whose A/B feed read its own 0.9 until the
// turns owner's correction 14).
const SURVIVAL_MODULE = /^runtime\/(characters|coordinator)\/survival\//;
const SURVIVAL_RULES = [
  { step: "SRV-S1", what: "a 90% share of max_hp outside survival's lines.ts (0.9)", test: (line, file) =>
    /^runtime\/characters\/(survival|turns)\/|^characters\/shared\.js$/.test(file) && file !== "runtime/characters/survival/lines.ts" && /\b0\.9\b/.test(line) && /max_hp/.test(line) },
  { step: "SRV-S1", what: "a survival global read outside its module (__partySurvival. or __partyCombatRecovery)", test: (line, file) =>
    !SURVIVAL_MODULE.test(file) && /__partySurvival\.|__partyCombatRecovery/.test(line) },
  { step: "SRV-S1", what: "the character's escape record outside escape.ts (escapeState, escapeLocal)", test: (line, file) =>
    /^runtime\/characters\/|^characters\/shared\.js$/.test(file) && file !== "runtime/characters/survival/escape.ts" && /\b(escapeState|escapeLocal)\b/.test(line) },
  // The coordinator half: survival writes none of targeting's grouped fight fields, survival's two
  // old scripts stay gone, and survival's coordinator log has one append, install.ts `survivalLog`.
  { step: "SRV-S2", what: "a write of 04's grouped fight fields in survival's code (groupedCombat, groupedCombatResetAt, combatResetByCharacter)", test: (line, file) =>
    SURVIVAL_MODULE.test(file) && /\b(groupedCombat|groupedCombatResetAt)\s*=[^=]|combatResetByCharacter\[[^\]]+\]\s*=[^=]/.test(line) },
  { step: "SRV-S2", what: "survival's old coordinator scripts required (combat-disengagement.cjs, party-escape.cjs)", test: (line) =>
    /(require\(|from\s+)["'][^"']*(combat-disengagement|party-escape)\.cjs["']/.test(line) },
  { step: "SRV-S2", what: "a coordinator log cap of 200 in survival's code outside install.ts", test: (line, file) =>
    /^runtime\/coordinator\/survival\//.test(file) && file !== "runtime/coordinator/survival/install.ts" && /\b200\b/.test(line) && /splice|length/.test(line) },
];
// W-S1: the settings owner is one module, runtime/settings/, so a file in its old folders
// is a second copy.
const OLD_SETTINGS_FOLDERS = /^runtime\/coordinator\/(settings|persistence)\//;
// T-S1: the turns owner is one module, runtime/characters/turns/, so a file in its old folders
// is a second copy in a tree that holds its public file.
const OLD_TURNS_FILES = /^runtime\/characters\/(skills|classes)\/|^runtime\/characters\/roles\/attack-controller\.ts$/;
// targeting's rework: targeting is runtime/characters/targeting/ and runtime/coordinator/targeting/,
// so a file at one of targeting's old paths is a second copy in a tree that holds the coordinator
// half's public file.
const OLD_TARGETING_FILES = /^runtime\/characters\/roles\/(target-state|porcupine-equipment|porcupine-equipment-runtime|monster-attack-policy|crab-range)\.ts$|^runtime\/combat\/(claims|composition|entity-refresh|evidence|locked-pair|lost-target|nomination-retention|passing|passing-admission|passive-travel|pursuit|queue|reset-fight|successor-client|successor-grant|unseen-primary|client)\.ts$|^runtime\/coordinator\/navigation\/phoenix-candidates\.ts$/;

// targeting's rules, from its rework on: the cascade, the facts port, the movement owner's old failed-approach marks and the installed module's global are read
// only inside the two targeting folders; neither folder reads shared.js's routine, and turns/ reads only its targeting module and survival half
// (its facts come on `partyTurns`); each time value has its one declaration, so its old literal at a listed site is a second copy.
const TARGETING = /^runtime\/(characters|coordinator)\/targeting\//;
const TARGETING_RULES = [
  { step: "V9", what: "a read of targeting's cascade, facts port, failed-approach marks or installed global outside its folders",
    test: (line, file) => file.startsWith("runtime/") && !TARGETING.test(file) && /\bisAllowedTarget\(|\btargetingFacts\b|farmApproach\.failed|__partyTargeting\b/.test(line) },
  { step: "V9", what: "a read of shared.js's routine inside the targeting folders",
    test: (line, file) => TARGETING.test(file) && /\bsharedRoutine\./.test(line) },
  { step: "E03-t4", what: "a read of shared.js's routine in turns/ outside its targeting and survival",
    test: (line, file) => file.startsWith("runtime/characters/turns/") && /\bsharedRoutine\.(?!targeting\b|survival\b)/.test(line) },
  { step: "V9", what: "a V3.3 time value written at its old site",
    test: (line, file) => TARGETING.test(file) && !/saved-fields\.ts$/.test(file) &&
      /lastAttackAt<5000|idleMs < 5000|>= ?8000\b|until: ?now\+10000|expiresAt=now\+3000|setInterval\(tick, ?100\)|<=180\)|startedAt < 5000|now-readySince >= 500/.test(line) },
];
// The events owner's rules: K1 is the one event catalog, K2 to K6 the one copy of each event rule,
// and every time value of the module a declaration in saved-fields.ts. The coordinator rules
// hold from EVT-S1, the tree with the module's coordinator door. characters/shared.js and the
// character files of other owners keep their lines until EVT-S2 moves the events owner's character
// code into runtime/events/character/, the tree with its install; the rules of
// EVENTS_CHARACTER_RULES hold from then in every file (the same staging as movement's report-age rule,
// SHARED_KEEPS below).
const EVENT_NAMES = "anniversary|abtesting|goobrawl|crabxx|franky|icegolem|snowman|slenderman|mrgreen|mrpumpkin|horseman|graveyard|trickortreat|witchcipher";
// A list whose every entry is an event name, with two or more entries.
const EVENT_LIST = new RegExp(`\\[\\s*["'](?:${EVENT_NAMES})["'](?:\\s*,\\s*["'](?:${EVENT_NAMES})["'])+\\s*\\]`);
const EVENTS_MODULE = /^runtime\/events\//;
// The declarations of 06: its saved fields.
const EVENTS_DECLARATIONS = new Set(["runtime/events/saved-fields.ts"]);
const EVENTS_CHARACTER = (file) => file === "characters/shared.js" || /^runtime\/(movement\/character|characters)\//.test(file);
const EVENTS_RULES = [
  { step: "EVT-S1", what: "an event name list outside runtime/events/rules.ts (K1)", test: (line, file) => file !== "runtime/events/rules.ts" && EVENT_LIST.test(line) },
  { step: "EVT-S1", what: "a 120000 in the events module outside saved-fields.ts (K2, E3.3)", test: (line, file) => EVENTS_MODULE.test(file) && !EVENTS_DECLARATIONS.has(file) && /\b120_?000\b/.test(line) },
  // The October runtime's own waits are EVT-S2's (october/ports.ts), so the rule holds in the
  // coordinator now and in the whole module once the character install exists.
  { step: "EVT-S1", what: "a 3000 or 10000 freshness literal in the events module (reports.fresh, E3.2)", test: (line, file, character) => (character ? EVENTS_MODULE : /^runtime\/events\/coordinator\//).test(file) &&
    !EVENTS_DECLARATIONS.has(file) && /\b(3_?000|10_?000)\b/.test(line) },
  { step: "EVT-S1", what: "an E3.3 time or the Town radius as a literal in the events coordinator", test: (line, file) => /^runtime\/events\/coordinator\//.test(file) &&
    // A limit in minutes times 60000 is a unit, not a time value.
    /\b(15_?000|20_?000|30_?000|60_?000|180_?000)\b|<=\s*90\b/.test(line.replace(/Minutes\s*\*\s*60_?000\b/, "")) },
  { step: "EVT-S1", what: "a joinedEvent write outside runtime/events/ (K7's derived marker)", test: (line, file) => !EVENTS_MODULE.test(file) && /\bjoinedEvent\s*=[^=]/.test(line) },
  { step: "EVT-S1", what: "the manual skip (skipManualEventOccurrences; K3 `left`, A10)", test: (line) => /\bskipManualEventOccurrences\b/.test(line) },
  { step: "EVT-S1", what: "the manual travel string outside runtime/events/ (K3 `left`)", test: (line, file) => !EVENTS_MODULE.test(file) && /["']manual travel["']/.test(line) },
  { step: "EVT-S1", what: "the return's command restore (restoreCommands; K6 owned commands and re-issue)", test: (line) => /\brestoreCommands\b/.test(line) },
  { step: "EVT-S1", what: "a deferredEventReturns write outside runtime/events/ (K6)", test: (line, file) => !EVENTS_MODULE.test(file) &&
    /\bdeferredEventReturns\[[^\]]*\]\s*=[^=]|\bdelete\s+[\w.]*deferredEventReturns\[/.test(line) },
];
const EVENTS_CHARACTER_RULES = [
  { step: "EVT-S2", what: "the shared event travel flag (eventTraveling; the assignment, E3.1 row 3)", test: (line, file) => !EVENTS_MODULE.test(file) && /\beventTraveling\b/.test(line) },
  { step: "EVT-S2", what: "the permission POST (/hunt-event-permission; K4)", test: (line) => /\/hunt-event-permission\b/.test(line) },
];
// The hunting owner's rules.: record.ts is the only code that assigns a field of the group's farming
// record (2.3); the settings writer applies the settings half by field name, so its folder is outside
// the rule. `location` counts only on the party or a scope's state, since commands and walks carry
// their own.: H8's labels are the status line's only writer.: H5's table (rules.ts
// `combatModeAnswer`) is the only scatter or default answer.: the area code loads from
// runtime/hunting/ only.
const RECORD_FIELDS = "monsterHunt|huntSettings|huntBlacklist|huntFailures|monsterHunterLocation|monsterFocus|monsterFocusByCharacter|" +
  "monsterPrioritiesByCharacter|monsterSearchRadiusByCharacter|farmAreaState|scatterMonsterTypes|scatterPartySignature|scatterEpoch|" +
  "scatterBreakTarget|partyFarmingMode|passiveHunting|passiveRareHunts|phoenixRouteOrder|phoenixPatrolActive|rareRetryEvidence|rareHuntState|dailyDungeons";
const RECORD_WRITE = new RegExp(`\\.(${RECORD_FIELDS})\\s*(\\|\\||\\?\\?|&&)?=(?!=)|\\b(party|state)\\.location\\s*=(?!=)`);
const RARE_WRITE = /\.(huntTravel|partyFarmingMode|scatterBreakTarget|location|groupedCombat|rareRejections)\s*(\|\||\?\?|&&)?=(?!=)|\bmonsterHunt\??\.\w+\s*=(?!=)|\b(travel|g)\.(rejected|released|committed|primary|reason|evidence|fights|queue|target|selection)\s*(\|\||\?\?|&&)?=(?!=)/;
const HUNTING_RULES = [
  { step: "H-S2", what: "a farming record field assigned outside record.ts (HN2)", test: (line, file) =>
    file !== "runtime/hunting/coordinator/record.ts" && !file.startsWith("runtime/settings/") && RECORD_WRITE.test(line) },
  { step: "H-S2", what: "a Hunt label written outside record.ts (hunt.message =, HN6)", test: (line, file) =>
    file !== "runtime/hunting/coordinator/record.ts" && /\b(monsterHunt|hunt)\.message\s*=(?!=)/.test(line) },
  { step: "H-S2", what: "a combat mode answer outside rules.ts ('scatter' : 'default', HN12)", test: (line, file) =>
    file !== "runtime/hunting/rules.ts" && /["']scatter["']\s*:\s*["']default["']/.test(line) },
  { step: "H-S1", what: "the area code imported from dashboard/lib (dashboard/lib/farming-, HN36)", test: (line) =>
    /(from\s+|require\(|import\()["'][^"']*dashboard\/lib\/farming-/.test(line) },
  // The rare encounter writes nothing of the Hunt record, the walk's Hunt travel, the combat mode,
  // the farm spot or targeting's grouped record; the tasks owner's rare row and H5 answer
  // for it.
  { step: "H-S2", what: "a rare writing the Hunt, the walk, the mode, the spot or 04's record (HN19)", test: (line, file) =>
    file === "runtime/hunting/coordinator/rares.ts" && RARE_WRITE.test(line) },
];
// Inside a part (tasks row 5): the Hunt cycle's fields change only through record.ts `huntStep`
// and `huntNote`, and the Cave visit's through `caveStep`, `caveCommand`, `caveReport` and
// `caveNote`. HUNTING_RULES reads the record's top-level fields by line; a part's own field is
// known only by its type, so this rule asks the TypeScript checker. It fails an assignment, a
// delete, an increment, an Object.assign or an array mutator whose target is reached through a
// value of the cycle's or the visit's type, outside record.ts.
const NESTED_RECORDS = new Map([["HuntCycle", "runtime/hunting/api.ts"], ["Hunt", "runtime/hunting/coordinator/hunt.ts"],
  ["DungeonState", "runtime/hunting/api.ts"]]);
// Other owners' files that still write the cycle, each left to the lane that edits the file: the
// tasks owner's roster pass (groups.ts), movement's Daisy checkpoint and route arrival (walk.ts,
// routes.ts), and the hunting owner's farm spot and install (farm.ts, install.ts).
const NESTED_PENDING = new Set(["runtime/tasks/coordinator/groups.ts", "runtime/movement/coordinator/walk.ts",
  "runtime/movement/coordinator/routes.ts", "runtime/hunting/coordinator/farm.ts", "runtime/hunting/coordinator/install.ts"]);
const NESTED_CANDIDATE = /\b(monsterHunt|HuntCycle|Hunt|dailyDungeons|DungeonState)\b/;
const MUTATORS = new Set(["push", "unshift", "splice", "pop", "shift", "sort", "reverse"]);
const requireTs = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("..", import.meta.url));
export function nestedRecordWrites(sources) {
  const ts = requireTs("typescript"), tree = new Map(sources);
  const files = [...tree.keys()].filter((file) => /^runtime\/.+\.ts$/.test(file) && file !== "runtime/hunting/coordinator/record.ts" &&
    !NESTED_PENDING.has(file) && !/\/tests\//.test(file) && NESTED_CANDIDATE.test(tree.get(file)));
  if (!files.length) return [];
  // The tree's runtime/ files come from `sources`, so a commit's tree is checked as it was; the
  // packages come from this checkout's node_modules.
  const relative = (name) => path.relative(REPO, name).replace(/\\/g, "/");
  const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: ["node"] };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists, readFile = host.readFile, getSourceFile = host.getSourceFile;
  const own = (name) => relative(name).startsWith("runtime/");
  host.fileExists = (name) => tree.has(relative(name)) || (!own(name) && fileExists(name));
  host.readFile = (name) => tree.get(relative(name)) ?? (own(name) ? undefined : readFile(name));
  host.getSourceFile = (name, version) => tree.has(relative(name)) ? ts.createSourceFile(name, tree.get(relative(name)), version, true)
    : getSourceFile(name, version);
  const program = ts.createProgram(files.map((file) => path.join(REPO, file)), options, host), checker = program.getTypeChecker();
  const recordType = (type) => type.isUnion() ? type.types.some(recordType) : [type.aliasSymbol, type.getSymbol()].some((symbol) =>
    !!symbol && NESTED_RECORDS.get(symbol.getName()) === relative(symbol.declarations?.[0]?.getSourceFile().fileName ?? ""));
  const strip = (node) => ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) ? strip(node.expression) : node;
  const access = (node) => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
  // A target reached through the record: some object on its access chain, or an Object.assign
  // target itself, has the record's type.
  const throughRecord = (node, self) => {
    let at = strip(node);
    if (self && recordType(checker.getTypeAtLocation(at))) return true;
    while (access(at)) {
      at = strip(at.expression);
      if (recordType(checker.getTypeAtLocation(at))) return true;
    }
    return false;
  };
  const findings = [];
  for (const file of files) {
    const source = program.getSourceFile(path.join(REPO, file));
    const visit = (node) => {
      let target = null, self = false;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = node.left;
      else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) target = node.operand;
      else if (ts.isDeleteExpression(node)) target = node.expression;
      else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text, receiver = node.expression.expression;
        if (name === "assign" && receiver.getText(source) === "Object" && node.arguments.length) { target = node.arguments[0]; self = true; }
        else if (MUTATORS.has(name) && access(strip(receiver))) target = receiver;
      }
      if (target && (self || access(strip(target))) && throughRecord(target, self))
        findings.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: a Hunt cycle or Cave visit field written outside record.ts (copy check, HN2)`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

// L3.3 by expression: LIFECYCLE_RULES' L3.3 reads one line, so a time split from its setTimeout
// over two lines, or a `now() - 15000` on a line with no timer word, passed. This rule reads each
// timer call's delay and each sum or comparison with a clock read (`now()`, `Date.now()`,
// `performance.now()`, a port's `now()`) as one expression, in runtime/lifecycle/ and in the
// lifecycle owner's host programs (tools/hosting/, tools/debug/). A number of three or more digits
// there is a time of its own; a wait reads fields.ts or a protocol reading instead.
const HOST_WAITS = (file) => /^runtime\/lifecycle\/.+\.(ts|mts)$|^tools\/(hosting|debug)\/.+\.(ts|mts|js|mjs|cjs)$/.test(file) &&
  file !== "runtime/lifecycle/fields.ts" && !/\.test\./.test(file);
// The lifecycle owner's host programs that still wait a time of their own, each left to the lane
// that edits the file: lane D's debug instance and service, and the debug desktop, setup page, smoke
// run and HTTPS check no wave 1 lane holds.
const HOST_WAITS_PENDING = new Set(["tools/debug/desktop.ts", "tools/debug/instance.mts", "tools/debug/service.ts",
  "tools/hosting/setup-client.js", "tools/hosting/smoke.mts", "tools/hosting/verify-https.mts"]);
const TIME_LITERAL = /^\d[\d_]{2,}$/;
export function waitLiterals(sources) {
  const ts = requireTs("typescript"), findings = [];
  const SUMS = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken]);
  const callee = (node) => ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
  const clock = (node) => ts.isCallExpression(node) && callee(node) === "now" || !!ts.forEachChild(node, clock);
  const literal = (node) => ts.isNumericLiteral(node) && TIME_LITERAL.test(node.getText()) ? node : ts.forEachChild(node, literal);
  for (const [file, text] of sources) {
    if (!HOST_WAITS(file) || HOST_WAITS_PENDING.has(file)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.m?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const visit = (node) => {
      let time;
      // The delay is the argument that is no callback: second for the global timers, first for a
      // request's or a socket's own setTimeout.
      if (ts.isCallExpression(node) && (callee(node) === "setTimeout" || callee(node) === "setInterval"))
        time = node.arguments.filter((arg) => !ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)).slice(-1).map(literal)[0];
      else if (ts.isBinaryExpression(node) && SUMS.has(node.operatorToken.kind) && (clock(node.left) || clock(node.right)))
        time = literal(clock(node.left) ? node.right : node.left);
      if (time) findings.push(`${file}:${source.getLineAndCharacterOfPosition(time.getStart(source)).line + 1}: a time literal in a wait outside fields.ts (copy check, L3.3)`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

// The lines of connection.ts's `previousSteamBootstrap`, from its declaration to its closing brace.
function savedBootstrap(file, lines) {
  const start = file === "runtime/lifecycle/roster/connection.ts" ? lines.findIndex((l) => /^export function previousSteamBootstrap\(/.test(l)) : -1;
  if (start < 0) return new Set();
  const end = lines.findIndex((l, k) => k > start && /^\}/.test(l));
  return new Set(Array.from({ length: (end < 0 ? lines.length : end) - start + 1 }, (_, k) => start + k));
}
export function copyFindings(sources) {
  const findings = [];
  // The tasks owner's rules hold from its rework on, the tree with the module's
  // public file.
  const tasksReworked = [...sources].some(([file]) => file === "runtime/tasks/api.ts");
  // The turns owner's rules hold from its rework on, the tree with the module's
  // public file.
  const turnsReworked = [...sources].some(([file]) => file === "runtime/characters/turns/api.ts");
  // survival's character rules hold from its rework on, the tree with the character module's public
  // file.
  const survivalReworked = [...sources].some(([file]) => file === "runtime/characters/survival/api.ts");
  // targeting's rules hold from its rework on, the tree with the coordinator half's
  // public file.
  const targetingReworked = [...sources].some(([file]) => file === "runtime/coordinator/targeting/api.ts");
  // The events owner's coordinator rules hold from EVT-S1, the tree with its coordinator door; its
  // character rules from EVT-S2, the tree with its character install.
  const eventsReworked = [...sources].some(([file]) => file === "runtime/events/coordinator/api.ts");
  const eventsCharacter = [...sources].some(([file]) => file === "runtime/events/character/install.ts");
  // The hunting owner's rules hold from its rework on, the tree with its rule
  // table.
  const huntingReworked = [...sources].some(([file]) => file === "runtime/hunting/rules.ts");
  const lifecycleBuilt = [...sources].some(([file]) => file === "runtime/lifecycle/rules.ts");
  for (const [file, text] of sources) {
    if (OLD_SETTINGS_FOLDERS.test(file)) findings.push(`${file}: a file in the settings owner's old folders came back (copy check, W-S1)`);
    if (turnsReworked && OLD_TURNS_FILES.test(file)) findings.push(`${file}: a file in the turns owner's old folders came back (copy check, T-S1)`);
    if (targetingReworked && (OLD_TARGETING_FILES.test(file) || file === "runtime/coordinator/navigation/grouped-snapshot.ts"))
      findings.push(`${file}: a file at the targeting owner's old paths came back (copy check, V-S2)`);
    if (!SCANNED(file)) continue;
    const lines = text.split("\n"), saved = savedBootstrap(file, lines);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const rule of COPY_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (freshnessScope(file) && reportAge(line)) findings.push(`${file}:${i + 1}: a report age outside runtime/protocol/reports.ts came back (copy check, R2)`);
      if (tasksReworked) for (const rule of TASK_RULES) if (rule.test(line)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (turnsReworked) for (const rule of TURNS_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (targetingReworked) for (const rule of TARGETING_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (survivalReworked) for (const rule of SURVIVAL_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (tasksReworked) for (const rule of FILE_RULES) if (rule.test(file, line, text)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (eventsReworked && (eventsCharacter || !EVENTS_CHARACTER(file)))
        for (const rule of EVENTS_RULES) if (rule.test(line, file, eventsCharacter)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (lifecycleBuilt) for (const rule of LIFECYCLE_RULES) if (rule.test(line, file, saved.has(i))) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (huntingReworked) for (const rule of HUNTING_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
      if (eventsCharacter) for (const rule of EVENTS_CHARACTER_RULES) if (rule.test(line, file)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, ${rule.step})`);
    });
    // R1: the mover order has one copy, T6.
    if (!LIST_HOLDERS.has(file)) {
      const named = MOVER_NAMES.filter((name) => new RegExp(`["'\`]${name}["'\`]`).test(text));
      if (named.length * 2 > MOVER_NAMES.length) findings.push(`${file}: a second mover list (${named.join(", ")}) came back (copy check, R1)`);
    }
  }
  findings.push(...sharedFreshness(sources));
  findings.push(...composeSwitches(sources));
  if (huntingReworked) findings.push(...nestedRecordWrites(sources));
  if (lifecycleBuilt) findings.push(...waitLiterals(sources));
  // Holds from the lifecycle owner's build and D9 from the status owner's, each the tree with its
  // owner's door, so an older tree is judged by the rules of its time.
  const tree = new Map(sources);
  if (lifecycleBuilt) findings.push(...nodeFloor(tree));
  if (tree.has("runtime/status/api.ts")) findings.push(...dashboardCopies(tree));
  return findings;
}

//, a dashboard copy of an owner's rule came back: a name D2 deleted, the stand's `>= 16`, a
// 400 search radius or a 1e12 time guess; a dashboard file names an add-on, which reaches the
// dashboard only through its slots.
const DASHBOARD = (file) => /^dashboard\/(features|lib|app)\/.+\.(ts|tsx)$/.test(file) && !/\.test\./.test(file);
const DASHBOARD_COPIES = [
  { what: "a dashboard copy of 10's upgrade odds", test: (line) => /\bconst\s+UPGRADE_CHANCES\b/.test(line) },
  { what: "the dashboard's own bank stock sum", test: (line) => /\bbankOwned\b/.test(line) },
  { what: "the dashboard's own gold sum", test: (line) => /\bpartyGoldNames\b|\bgoldTotals\b/.test(line) },
  { what: "a stand size guess in place of 10's count", test: (line) => />=\s*16\b/.test(line) },
  // D2 deleted the dashboard's own stand counts; the items owner's standSlotUse answers both the header and
  // the full check.
  { what: "a dashboard stand count in place of 10's standSlots", test: (line) => /\b(standOccupancy|occupiedStandSlots)\b/.test(line) },
  { what: "a search radius in place of 07's default", test: (line) => /[Rr]adius[^\n]*\b400\b/.test(line) },
  { what: "a 1e12 time guess in place of 06's milliseconds", test: (line) => /\b1e12\b/.test(line) },
  // RA: the hand control's shape and default have one copy, runtime/tasks/rules.ts.
  { what: "a dashboard copy of 01's hand control shape or default (RA)", test: (line) => /\binterface\s+HandControl\b|:\s*HandControl\s*=\s*\{/.test(line) },
];
function dashboardCopies(sources) {
  const addons = new Set([...sources.keys()].flatMap((file) => /^runtime\/addons\/([^/]+)\//.exec(file)?.[1] ?? []));
  const findings = [];
  for (const [file, text] of sources) {
    if (!DASHBOARD(file)) continue;
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const rule of DASHBOARD_COPIES) if (rule.test(line)) findings.push(`${file}:${i + 1}: ${rule.what} came back (copy check, DF15)`);
      for (const name of addons) if (new RegExp(`["'\`/]${name}["'\`/]`).test(line)) findings.push(`${file}:${i + 1}: the dashboard names the add-on ${name} (copy check, DF27)`);
    });
  }
  return findings;
}

// The Node floor is package.json's engines.node. The Dockerfile's base image and.node-version
// cannot read JSON, so each names the same version or is a second copy. dashboard/package.json is a
// separate npm package with its own engines.node, so it names the root's floor too.
function nodeFloor(sources) {
  const floor = /^>=(\d+\.\d+\.\d+)$/.exec(JSON.parse(sources.get("package.json") ?? "{}").engines?.node ?? "")?.[1];
  if (!floor) return [];
  const findings = [];
  for (const [i, line] of (sources.get("Dockerfile") ?? "").split("\n").entries()) {
    const image = /^FROM\s+(?:--\S+\s+)?node:(\d+\.\d+\.\d+)/.exec(line);
    if (image && image[1] !== floor) findings.push(`Dockerfile:${i + 1}: node:${image[1]} is not package.json's engines.node ${floor} (copy check, R13-2)`);
  }
  const pinned = sources.get(".node-version")?.trim();
  if (pinned !== undefined && pinned.replace(/^v/, "") !== floor) findings.push(`.node-version: ${pinned} is not package.json's engines.node ${floor} (copy check, R13-2)`);
  const dashboard = sources.get("dashboard/package.json");
  const dashboardFloor = dashboard === undefined ? undefined : JSON.parse(dashboard).engines?.node;
  if (dashboard !== undefined && dashboardFloor !== `>=${floor}`) findings.push(`dashboard/package.json: engines.node ${dashboardFloor} is not package.json's engines.node >=${floor} (copy check, R13-2)`);
  return findings;
}

// The one combat group composition reads T2 `groups` (runtime/tasks/rules.ts `GROUPS`) where a
// party and a solo group differ, so a `solo ?` switch inside it is a second copy of that column.
function composeSwitches(sources) {
  const file = "runtime/coordinator/application.ts", text = new Map(sources).get(file);
  const start = text?.indexOf("function composeCombatGroup(") ?? -1;
  if (start < 0) return [];
  const end = text.indexOf("\n    function ", start + 1), first = text.slice(0, start).split("\n").length;
  return text.slice(start, end < 0 ? undefined : end).split("\n").flatMap((line, i) =>
    /^\s*\/\//.test(line) || !/(!!?solo\b|\bsolo \?)/.test(line) ? [] : [`${file}:${first + i}: a solo switch in composeCombatGroup outside T2 groups came back (copy check, E01-q11)`]);
}

// R3: the report-age rule also holds in characters/shared.js, except inside the functions of
// owners not yet built, which keep their own lines: the events owner's event readers, the hunting owner's
// departure loot ports, and the status owner's snapshot and markers.
const SHARED_KEEPS = new Set(["snapshot", "freshSlendermanSighting", "runAnniversaryHandoff",
  "freshPartyEventDestination", "queueMarkersUnfiltered", "departureLootPorts"]);
function sharedFreshness(sources) {
  const text = new Map(sources).get("characters/shared.js");
  if (text === undefined) return [];
  const lines = text.split("\n"), kept = new Set();
  // A kept function's lines run from its declaration to the line where its braces close.
  lines.forEach((line, start) => {
    const named = /^\s*(?:async\s+)?function\s+(\w+)\s*\(|^\s*(\w+)\s*:\s*function\b|^\s*var\s+(\w+)\s*=\s*function\b/.exec(line);
    if (!named || !SHARED_KEEPS.has(named[1] || named[2] || named[3])) return;
    let depth = 0, opened = false;
    for (let i = start; i < lines.length && !(opened && depth <= 0); i++) {
      kept.add(i);
      for (const ch of lines[i]) if (ch === "{") { depth++; opened = true; } else if (ch === "}") depth--;
    }
  });
  return lines.flatMap((line, i) => !kept.has(i) && !/^\s*(\/\/|\*|\/\*)/.test(line) && reportAge(line)
    ? [`characters/shared.js:${i + 1}: a report age outside runtime/protocol/reports.ts came back (copy check, R3)`] : []);
}
