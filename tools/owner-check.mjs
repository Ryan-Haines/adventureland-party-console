// owner:check: every game call, socket emit, timer and event handler has one owner, and only that
// owner's module may make it. The check fails on a row outside its owner that tools/owner-check/listed-rows.json
// does not list, so no piece acts in the game on its own and no loop runs outside its owner.
//
// tools/owner-check/ownership-map.json holds the scanner's rows at a past commit. A row that passes
// under a placement entry must also be in that map, so a new row outside its owner fails even
// while the entry has room. `--map-out` regenerates the map from the code, so a row on the head and a
// row in the map come from the same rules.
//
// Usage: node tools/owner-check.mjs [--ref <ref>] [--map-out <file>]
// Without --ref it reads the working tree, so a change is checked before its commit.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFindings } from "./copy-check.mjs";
import { ADDON_API, addonFindings, addonRowFindings, entryFindings, publishes, testImports } from "../runtime/hooks/rules/uses.mts";

export const OWNERS = {
  "01": "groups and tasks", "02": "movement", "03": "turns and cooldowns", "04": "targeting",
  "05": "survival", "06": "events", "07": "hunts and farming", "08": "merchant jobs",
  "09": "merchant realm, hands and the call budget", "10": "inventory, bank and commerce",
  "11": "settings", "12": "dashboard and status", "13": "lifecycle", "14": "add-on system",
};

// Hand-written sources only. The generated character bundles
// (characters/*.js except shared.js) come from runtime/, which is scanned instead. Every tools/
// file MODULES gives to the status owner or 13 is a host program of theirs, so each one is read.
// The simulator and the replay and benchmark harness run an owner's own code to replay it, as
// scripts/tests does, so they are not read.
export const SCANNED = (f) =>
  (f === "characters/shared.js" ||
   /^runtime\/.*\.(ts|tsx|js|cjs|mjs)$/.test(f) ||
   /^scripts\/[^/]+\.cjs$/.test(f) ||
   /^dashboard\/.*\.(ts|tsx)$/.test(f) ||
   /^tools\/.*\.(ts|mts|js|cjs)$/.test(f) && !/^tools\/(sim\/|game\/(replay-|pathfinder-benchmark\/))/.test(f)) &&
  !/(^|\/)(tests?|fixtures|__tests__)\//.test(f) && !/\.(test|spec)\.[a-z]+$/.test(f) && !/\.d\.ts$/.test(f);

// The game functions are the ones the owners' ACTIONS tables list (runtime/hooks/rows/*.ts),
// so owner:check and addon:check rule 10 share one list; a per-thing key
// (`use_skill:blink`) names its function. A tree is scanned with its own tables. A tree from before the
// tables (the self-test's pinned trees, the committed map's ref) is scanned with LEGACY_GAME, the hand
// list of its time, as LATE_DOORS judges an older tree by the rules of its time.
const LEGACY_GAME = ["smart_move", "xmove", "move", "stop", "transport", "enter", "leave", "accept_magiport",
  "attack", "heal", "use_skill", "use", "respawn", "equip", "unequip", "equip_batch",
  "buy", "buy_with_gold", "sell", "send_item", "send_gold", "trade", "trade_buy", "upgrade", "compound",
  "exchange", "craft", "dismantle", "bank_deposit", "bank_withdraw", "bank_store", "bank_retrieve", "bank_swap",
  "open_stand", "close_stand", "loot", "send_mail", "join", "change_server", "send_cm", "say", "party_say",
  "send_party_invite", "accept_party_invite", "send_party_request", "accept_party_request", "leave_party",
  "kick_party_member", "change_target", "interact", "donate", "town", "escapeUse"];
const ROWS_FILE = /^runtime\/hooks\/rows\/\d\d-[\w-]+\.ts$/;
// The function names of one rows file's ACTIONS table, or null when the file has none.
function actionFunctions(text) {
  const at = text.indexOf("export const ACTIONS = {");
  if (at < 0) return null;
  const block = text.slice(at, text.indexOf("} as const satisfies Record<string, ActionRow>", at));
  return [...block.matchAll(/functions:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/['"]([\w$]+)(?::[\w$]+)?['"]/g)].map((n) => n[1]));
}
// The game functions of a tree: its ACTIONS tables' names, or LEGACY_GAME when it has no table.
export function gameOf(sources) {
  const tables = [...sources].filter(([file]) => ROWS_FILE.test(file)).map(([, text]) => actionFunctions(text)).filter(Boolean);
  return tables.length ? [...new Set(tables.flat())].sort((a, b) => b.length - a.length || a.localeCompare(b)) : LEGACY_GAME;
}
const ROWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime/hooks/rows");
// This checkout's list, for a file scanned on its own.
export const GAME = gameOf(readdirSync(ROWS_DIR).map((f) => [`runtime/hooks/rows/${f}`, readFileSync(path.join(ROWS_DIR, f), "utf8")]));
// A game call is bare, or on an object that is the game: a member call on anything else
// (`[].join`, `controller.stop`) is not a game call.
const GAME_OBJ = "(?:parent|window|root|globalThis|self|host|game|native|character)";
const gameReOf = (game) => new RegExp(`(^|[^.\\w$])(?:${GAME_OBJ}\\.)?(${game.join("|")})\\(\\s*([^)]{0,40})`, "g");
const emitRe = /\b(?:parent\.)?socket\.emit\(\s*(["'`])([\w-]+)\1/g;
// An assignment to a socket's emit wraps every game call the socket sends: the one emit layer is
// the call budget's.
const wrapRe = /\b(?:[\w$]+\.)*socket\.emit\s*=(?![=>])/g;
// The call budget's question. A game call row is admitted when the
// text from its function's start to the call asks it: `calls.band` itself, or the call budget owner's band wait
// and margin call on the same door (hooks/rows/09-calls.ts `calls.wait`, `calls.marginCall`),
// which ask it for every owner.
const askRe = /\bcalls\.(?:band|wait|marginCall)\(/;
const timerRe = /\b(setInterval|setTimeout|requestAnimationFrame|queueMicrotask)\(/g;
const handlerRe = /\b(game\.on|character\.on|(?:parent\.)?socket\.on|process\.on|addEventListener|\w+\.on)\(\s*(["'`])([\w:-]+)\2/g;
// A listener registered through a run scope handle: `handle.on(target, "event",
// listener)`, whose owner is the handle's, as a timer's is.
const scopedOnRe = /\b([\w$]+(?:\.[\w$]+)?)\.(on|once)\(\s*[^,()"'`]+(?:\([^()]*\))?\s*,\s*(["'`])([\w:-]+)\3/g;
const hookAssignRe = /\b((?:on|handle)_[a-z_]+)\s*=\s*(?:async\s*)?(?:function|\()/g;
const defRe = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(|^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)|^\s*(?:[\w$.]+\.)?([\w$]+)\s*[:=]\s*(?:async\s*)?function\b|^\s*(?:async\s+|static\s+|private\s+|public\s+)*([\w$]+)\s*\([^;]*\)\s*(?::[^{]+)?\{\s*$/;
const NOT_NAMES = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "with"]);

// Owners in the loop's order. A third field names a door of `LATE_DOORS`:
// the row holds only in a tree without it. The lifecycle owner's row is the rule of the trees before the lifecycle owner's build, which
// the self-test pins; from that build on 13 owns by path alone: the keyword
// row is a guess, so a head row outside runtime/lifecycle/ and tools/ fails.
const KEYWORDS = [
  ["13", /lifecycle|loader|reload|deploy|maintenance|lease|drain|worker|steam|shutdown|bootstrap|watchdog|activation|consoleMain|consoleDrain|codeFrame|restartRuntime|hosting|console-build|build-identity/i, "runtime/lifecycle/api.ts"],
  ["05", /\bhit\b|escape|survival|death|respawn|revive|revival|regen|potion|endanger|danger|disengag|grave/i],
  ["06", /event|anniversary|october|cipher|halloween|goobrawl|franky|kiss|pumpkin|slender|horseman|abtest|a\/b/i],
  ["07", /hunt|daisy|rare|phoenix|dungeon|cave|scatter|focus|farmArea|farm-area|farm_area|relocat/i],
  ["09", /realm|hands|gatheringTool|merchantWeapon|restoreEquipment|budget|silentTracker|emitWrapper/i],
  ["08", /merchant|job|dispatch|gather|fishing|mining|mluck|luck|giveaway/i],
  ["10", /bank|item|inventory|upgrade|compound|market|ponty|mail|trade|exchange|sell|buy|loot|deliver|stand|aldata|stock|production|deconstruct|craft|commerce|bid|wtb|secondhand|tracktrix|tracker/i],
  ["03", /skill|cooldown|attack|heal|engine|supportTick|curse|taunt|absorb|energize|stomp|dash|cast/i],
  ["04", /target|aggro|grouped|passing|threat|nominat|queue|reflect/i],
  ["02", /move|movement|convoy|walk|route|travel|navigat|follow|formation|kite|kiting|approach|journey|step|town|door|transport|rendezvous|regroup|ladder|path/i],
  ["01", /party|leader|group|task|assignment|membership|roster|follow/i],
  ["11", /setting|config|persist|journal|snapshot|store|migrat|import|export/i],
  ["12", /dashboard|status|telemetry|metric|log|report|heartbeat|render|poll|card|panel|toast|query|stream/i],
];
export const PATHS = [
  // A timer or handler in the targeting owner's module with no keyword of another owner is the targeting owner's,
  // phoenix-candidates.ts in coordinator/navigation/ included.
  ["04", { test: (file) => MODULES["04"].test(file) }],
  // A third field names the door of the build that added the row (`LATE_DOORS`): the row holds from
  // the tree with that door.
  ["12", /^dashboard\//], ["12", /^runtime\/status\//, "runtime/status/api.ts"], ["12", /^tools\/dashboard\//, "runtime/status/api.ts"], ["13", /^tools\//],
  // runtime/steam/ and runtime/coordinator/lifecycle/ are the lifecycle owner's folders before its build;
  // only the self-test's pinned trees hold them.
  ["13", /^runtime\/lifecycle\//, "runtime/lifecycle/api.ts"], ["13", /^runtime\/steam\//], ["13", /^runtime\/coordinator\/lifecycle\//],
  ["13", /^runtime\/(loader|host|hosting)\//],
  // A row in the events owner's module is the events owner's, whatever its keyword.
  ["06", /^runtime\/events\//, "runtime/events/api.ts"],
  // A row in the hunting owner's module with no keyword of another owner is the hunting owner's.
  ["07", /^runtime\/hunting\//],
  // A row in the items owner's module with no keyword of another owner is the items owner's.
  ["10", /^runtime\/items\//],
  // A row in the merchant jobs owner's module with no keyword of another owner is the merchant jobs owner's.
  ["08", /^runtime\/merchant-jobs\//],
  ["06", /^runtime\/coordinator\/(events|anniversary)\//], ["08", /^runtime\/coordinator\/merchant\//],
  ["10", /^runtime\/coordinator\/(inventory|commerce)\//], ["12", /^runtime\/coordinator\/(telemetry|status)\//],
  // The settings owner's module, and its old persistence folder, which the self-test's pinned refs still hold.
  ["11", /^runtime\/settings\/|^runtime\/coordinator\/persistence\//], ["14", /^runtime\/hooks\//],
  // Movement's paths before the rework, for the pinned trees that hold them. The
  // fix pass (f6c7a801) took runtime/coordinator/navigation/ from the movement owner's path rule, since the files
  // left there are other owners'. The planner service's two timers and its worker listener
  // stay the movement owner's by path.
  ["02", /^runtime\/navigation\//], ["02", /^runtime\/characters\/movement/], ["02", /^runtime\/coordinator\/navigation\/planner-service\.ts$/],
  ["02", /^runtime\/(movement|protocol)\//],
  ["09", /^runtime\/characters\/call-budget/], ["01", /^runtime\/coordinator\/http\/formation/],
  // The old folders of the turns owner stay on the path rule for the self-test's pinned trees, which hold them;
  // the copy check fails a file there in a tree of the rework on.
  ["03", /^runtime\/characters\/(turns|skills|classes)\/|^runtime\/characters\/roles\/attack-controller\.ts$/],
  ["05", /^runtime\/(characters|coordinator)\/survival\/|^runtime\/characters\/(roles\/death-recovery|cave-recovery)\.ts$|^scripts\/(combat-disengagement|party-escape)\.cjs$/],
  ["13", /^runtime\/coordinator\//], ["13", /^runtime\/characters\//], ["03", /^runtime\/combat\//],
];

// Each owner's module: the files where its rows pass. Movement's set is the step 9b to the status owner
// module with the hook registry; the tasks owner's folders are its design's section 1.1, and 11 is one module
// on both runtimes, runtime/settings/. The settings owner's rule also reads its folders
// from before that rework, which the self-test's pinned trees hold; the copy check fails a file
// there in a tree of the rework on. An owner the design has not placed yet has no module, and its
// rows pass only under its placement row.
export const MODULES = {
  // Groups and tasks is one module on both runtimes;
  // its public file is runtime/tasks/api.ts.
  "01": /^runtime\/tasks\//,
  "11": /^runtime\/settings\/|^runtime\/coordinator\/(settings|persistence)\//,
  // Owner 09 has two parts four layers apart: the call budget, and the
  // realm and hands owners of layer 8, each one folder with its rules.ts and api.ts
  //.
  "09": /^runtime\/characters\/call-budget[\w-]*\.ts$|^runtime\/merchant-(realm|hands)\//,
  // The merchant job owner is one folder on both runtimes.
  "08": /^runtime\/merchant-jobs\//,
  // The turns owner is one module, runtime/characters/turns/;
  // its public file is turns/api.ts. turns/classes/ still holds
  // the targeting owner's target choices until its build moves them, and turns/skills/damage.ts the survival owner's danger model
  // until the survival owner's build moves it; they make no game call, timer or handler.
  "03": /^runtime\/characters\/turns\//,
  // Movement is one module on two runtimes: runtime/movement/ and the
  // shared protocol it holds in runtime/protocol/. The hook registry is the add-on system's
  // module. The self-test's pinned trees are older than the movement rework and
  // hold the module at its old paths, which the rest of the rule reads; no head file sits there.
  "02": /^runtime\/movement\/|^runtime\/protocol\/|^runtime\/characters\/(movement|owner-ladder|native-planner|return-planner|shared-route-cache)[\w-]*\.ts$|^runtime\/navigation\/|^runtime\/coordinator\/navigation\/(walk-ladder|route-aggro)\.ts$/,
  "14": /^runtime\/hooks\//,
  // The events owner is one module on both runtimes, runtime/events/;
  // its doors are runtime/events/api.ts and runtime/events/coordinator/api.ts.
  "06": /^runtime\/events\//,
  // Hunts and farming is one module on both runtimes, runtime/hunting/;
  // its doors are runtime/hunting/api.ts and
  // runtime/hunting/coordinator/api.ts, and zones.ts and areas.ts
  // are the dashboard's imports of the area code.
  "07": /^runtime\/hunting\//,
  // Inventory, bank and commerce is one module on both runtimes, runtime/items/;
  // its doors are runtime/items/api.ts and
  // runtime/items/coordinator/api.ts. Every timer, handler and game call of its 1.3 registers there.
  "10": /^runtime\/items\//,
  // The survival owner is one module on two runtimes:
  // runtime/characters/survival/ and runtime/coordinator/survival/. A timer
  // or handler there with no keyword of another owner is the survival owner's by the path rule above.
  "05": /^runtime\/(characters|coordinator)\/survival\//,
  // The targeting owner is one module on two runtimes:
  // runtime/characters/targeting/ and
  // runtime/coordinator/targeting/. The queue client's position wake stays a placed 02 row below
  //. The rule also reads the targeting owner's files from before that rework, which the
  // self-test's pinned trees hold; the copy check fails a file there in a tree of the rework on.
  // Lifecycle is one module, runtime/lifecycle/, with the host programs in tools/, which run as
  // separate processes and import lifecycle's rules.ts.
  // The saved character inspection sits outside that folder: runtime/coordinator/characters/
  // keeps inspection.ts only, so that one file is the lifecycle owner's too.
  // The coordinator's composition root (application.ts) and its contract check are the lifecycle owner's start, so
  // crossOwnerImports reads them: they compose each owner from its door. The character bundles'
  // entries (common.ts, legacy-entry.ts, owners.ts and entries/) are the lifecycle owner's for the same reason.
  "13": /^runtime\/lifecycle\/|^tools\/(?!dashboard\/)|^runtime\/coordinator\/characters\/inspection\.ts$|^runtime\/coordinator\/(application|initialization\.contract-check)\.ts$|^runtime\/characters\/(common|legacy-entry|owners)\.ts$|^runtime\/characters\/entries\//,
  // Dashboard and status is one module, runtime/status/, with its display root dashboard/ and the
  // dashboard's host programs in tools/dashboard/.
  // Vite resolves the tsconfig per file, so the dashboard stays where it is.
  "12": /^runtime\/status\/|^dashboard\/|^tools\/dashboard\//,
  "04": /^runtime\/(characters|coordinator)\/targeting\/|^runtime\/characters\/roles\/(target-state|porcupine-equipment|porcupine-equipment-runtime|monster-attack-policy|crab-range)\.ts$|^runtime\/combat\/(claims|composition|entity-refresh|evidence|locked-pair|lost-target|nomination-retention|passing|passing-admission|passive-travel|pursuit|queue|reset-fight|successor-client|successor-grant|unseen-primary|client)\.ts$|^runtime\/coordinator\/navigation\/phoenix-candidates\.ts$/,
};
// Owner 09 is built in two parts four layers apart:
// the call budget in layer 4 and the realm and hands in layer 8. Each part has its own placement
// row, so each layer's gate reads its own count. The call budget's part is its module and the
// seven rows of the two background reads it owns, which the keyword and path
// rules give to the items owner, 12 and 13: the Tracktrix request's timer, emit and handler, the player list's
// emit and timer, and the `player` and `players` handlers. Step 3a moved them into the module,
// where the keyword rules would give the reads' emits and the `tracker` handler to the items owner and the
// `limitdcreport` listener to 12: in the module, the budget's own events are the call budget owner's.
// `budgetRead` still gives the seven rows to the call budget owner where shared.js holds them, which is only the
// committed map's ref, so the map stays the scanner's output on that ref.
const BUDGET_PART = "call budget", HANDS_PART = "realm and hands";
const BUDGET_EVENTS = /^(?:emit|socket\.on|ports\.scope\.on)\((tracker|players|player|new_map|limitdcreport|disconnect_reason)\)$/;
const BUDGET_READ_LINE = /__party(Tracker|PlayerDirectory)Timer\b/;
function budgetRead(kind, call, line) {
  if (kind === "socket-emit") return /^emit\((tracker|players)\)$/.test(call);
  if (kind === "handler") return /socket\.on\((tracker|player|players)\)$/.test(call);
  if (kind === "timer") return BUDGET_READ_LINE.test(line);
  return false;
}
// The rows the keyword and path rules put wrong for owner 03, each placed with the owner whose
// behaviour claims it: Mass Production, the gathering cast whose
// variable name hid its skill, the anniversary kiss, the queue client's
// microtask inside `nativePositionChanged` and its tick, the departure loot's
// two timers, the markers and the trace, and the role
// loop's own timer, whose body is the turns pass (3.1). Each row is its file, kind and line. The
// tick's row went in targeting's step 4, when client.ts joined the targeting owner's module.
// The survival owner's move places four more: the two `hit` registrations go to the owners whose
// code holds their listeners (`mapHitListener` 12, `combatHitListener` 07), and the Cave
// revival's heal and Revive are the survival owner's; its acknowledgement timer is the survival owner's by the module's path rule.
// The targeting owner's move places three: the two registrations of the `disappear` and
// `entities` death listeners, which the enclosing function rule gives to the events owner, are the targeting owner's, and
// `collectFromTarget`'s 250 ms wait, which the keyword rule gives to the targeting owner, is the merchant jobs owner's.
// A row's sixth field names the enclosing function, for a line whose text repeats in other functions of the file.
const PLACED = [
  ["characters/shared.js", "game-call", /Promise\.race\(\[Promise\.resolve\(use_skill\(skill\)\), sleep\(750\)\]\)/, "10", "Mass Production"],
  ["characters/shared.js", "game-call", /\bawait use_skill\(mode\)/, "08", "the gathering cast"],
  ["runtime/merchant-jobs/character/gathering.ts", "game-call", /\buse_skill\(m as any\)/, "08", "the gathering cast, in the job owner's gathering"],
  ["characters/shared.js", "game-call", /\buse_skill\("ikissyou"/, "06", "the anniversary kiss"],
  // The events owner moved the kiss and the chat adverts into anniversary.ts, which sends them through the
  // anniversary's `game` ports; the skill rule gives the port's line to 03.
  ["characters/shared.js", "game-call", /useSkill: function \(name, target\) \{ return use_skill\(name, target\); \}, say: function \(message\) \{ return say\(message\); \}/, "06", "the anniversary kiss and chat adverts"],
  ["runtime/combat/client.ts", "timer", /queueMicrotask\(\(\)=>\{wakeQueued=false/, "02", "the queue client's position wake"],
  ["runtime/characters/targeting/queue-client.ts", "timer", /queueMicrotask\(\(\)=>\{wakeQueued=false/, "02", "the queue client's position wake"],
  ["runtime/combat/departure-loot.ts", "timer", /setTimeout|setInterval/, "07", "the departure loot"],
  ["runtime/hunting/character/loot.ts", "timer", /setTimeout|setInterval/, "07", "the departure loot, in 07's character/loot.ts"],
  ["runtime/combat/markers.ts", "timer", /setInterval/, "12", "the queue markers"],
  ["runtime/combat/trace.ts", "timer", /setInterval/, "12", "the combat trace"],
    ["runtime/characters/roles/runner.ts", "timer", /\btimer = setInterval\(tick, 250\)/, "03", "the role loop, the turns pass"],
  ["characters/shared.js", "handler", /parent\.socket\.on\("hit", mapHitListener\)/, "12", "the map telemetry's hit listener"],
  ["characters/shared.js", "handler", /parent\.socket\.on\("hit", combatHitListener\)/, "07", "the combat hit listener"],
  ["characters/shared.js", "game-call", /anniversaryWithTimeout\(heal\(target\), 2000, 'Gravestone healing'\)/, "05", "the Cave revival's grave heal"],
  ["characters/shared.js", "game-call", /\buse_skill\('revive', target\.name\)/, "05", "the Cave revival's Revive"],
  ["characters/shared.js", "handler", /parent\.socket\.on\("disappear", combatDisappearListener\)/, "04", "the lethal disappear listener"],
  ["characters/shared.js", "handler", /parent\.socket\.on\("entities", combatEntitiesDeathListener\)/, "04", "the entities death listener"],
  // The targeting owner's death listeners sit in targeting's own death.ts,
  // where the keyword rule reads "death" as survival's.
  ["runtime/characters/targeting/death.ts", "handler", /socket\.on\('(disappear|entities|death)'|scope\.on\(socket, '(disappear|entities|death)'/, "04", "the death listeners"],
  // The turns executor's lost reply on its target's death or disappearance,
  // on the turns owner's handle; the keyword rule reads `death` as the survival owner's.
  ["runtime/characters/turns/executor.ts", "handler", /ports\.scope\.on\(host\.socket, 'death', onGone\)/, "03", "the executor's lost reply"],
  ["characters/shared.js", "timer", /setTimeout\(resolve, 250\)/, "08", "the merchant handoff's poll wait", "collectFromTarget"],
  // The merchant jobs owner's last three waits sit with 10, whose code holds their
  // bodies: the commerce's activity wait, the stand search's and the donation's.
  ["characters/shared.js", "timer", /setTimeout\(resolve, 750\)/, "10", "the commerce's activity wait", "liveMerchantActivity"],
  ["characters/shared.js", "timer", /setTimeout\(resolve, 1200\)/, "10", "the stand search's wait", "merchantStandSearch"],
  ["characters/shared.js", "timer", /setTimeout\(resolve, 350\)/, "10", "the donation's wait", "merchantDonate"],
  // The items owner's game calls moved into runtime/items/character/calls.ts;
  // its Mass Production cast is the items owner's, which the skill rule gives to 03.
  ["runtime/items/character/calls.ts", "game-call", /\buse_skill\(a\[0\]\)/, "10", "Mass Production"],
  // The targeting owner's passing weapon and bow swap keep their `equip` and `unequip`,
  // and the targeting owner's entity refresh sends `send_updates`,
  // which the emit rule reads as the items owner's `send`.
  ["runtime/characters/targeting/passing.ts", "game-call", /\bequip\(slot\)/, "04", "the passing attack's weapon"],
  ["runtime/characters/targeting/porcupine.ts", "game-call", /\b(un)?equip\((index, slot|slot)\)/, "04", "the bow swap"],
  ["runtime/characters/targeting/selection.ts", "socket-emit", /emit\('send_updates'/, "04", "the entity refresh's snapshot request"],
  // The lifecycle owner's Steam bridge runs in the Steam window, outside any run scope, so its poll and its logout
  // listener carry no handle; the keyword rule reads `poll` and `logout` as the status owner's.
  ["runtime/lifecycle/roster/bridge.ts", "timer", /timer = host\.setTimeout\(\(\) => void poll\(\)/, "13", "the Steam bridge's poll"],
  ["runtime/lifecycle/roster/recovery.ts", "handler", /host\.document\.addEventListener\("click", logout, true\)/, "13", "the Steam window's logout watch"],
];
// Owners whose design pass read every row it owns on its ref and moved the ones the rules put
// wrong mark those rows \`checked: true\`.
export const CHECKED = new Set(["05", "04"]);
const placed = (file, kind, line, fn) => PLACED.find(([f, k, re, , , within]) => f === file && k === kind && re.test(line) && (!within || within === fn));
export const moduleOf = (file) => Object.keys(MODULES).find((owner) => MODULES[owner].test(file)) || null;

// The nearest definition at or above line i: its name and its line. The ownership map
// (tools/owner-check/ownership-map.json) holds the names this 400-line window gives, so a
// change to the window needs a regenerated map.
function enclosingAt(lines, i) {
  for (let j = i; j >= 0 && j > i - 400; j--) {
    const m = lines[j].match(defRe);
    if (m) { const n = m[1] || m[2] || m[3] || m[4]; if (n && !NOT_NAMES.has(n)) return { name: n, line: j }; }
  }
  return { name: "", line: Math.max(0, i - 399) };
}
const enclosing = (lines, i) => enclosingAt(lines, i).name;
const byKeyword = (text, unplaced = new Set()) => (KEYWORDS.find(([, re, until]) => (!until || unplaced.has(until)) && re.test(text)) || [])[0];
const byPath = (file, unplaced = new Set()) => (PATHS.find(([, re, door]) => !unplaced.has(door) && re.test(file)) || [])[0];

function gameOwner(call, args, fn, file, unplaced) {
  const ctx = fn + " " + file;
  const skill = (args.match(/^["'`]([\w]+)/) || [])[1] || "";
  switch (call) {
    case "smart_move": case "xmove": case "move": case "stop": case "transport": case "enter": case "leave": case "accept_magiport":
      return ["02", "call"];
    case "use_skill":
      if (/^(town|use_town|blink|magiport)$/.test(skill)) return ["02", "skill moves the character"];
      if (/^(mluck|fishing|mining)$/.test(skill)) return ["08", "merchant job skill"];
      return ["03", skill ? `skill ${skill}` : "skill"];
    case "use": return skill === "town" ? ["02", "Town moves the character"] : ["03", "cooldown spend"];
    // town() and the escape's cast wrapper come from tools/check-movement-calls.mjs, whose
    // movement call list these rows replace. scanFile keeps only the wrapper's movement casts.
    case "town": return ["02", "call"];
    case "escapeUse": return ["02", "skill moves the character"];
    case "attack": case "heal": return ["03", "cooldown spend"];
    case "respawn": return ["05", "call"];
    case "equip": case "unequip": case "equip_batch":
      return /gather|tool|weapon|hands|restoreEquipment|restore_equipment|merchantIdle/i.test(ctx) ? ["09", "merchant hands"] : ["10", "item"];
    case "join": return ["06", "call"];
    // The giveaway join is the merchant jobs owner's visit (M-4, rows/08-merchant.ts ACTIONS giveaway.join).
    case "join_giveaway": return ["08", "giveaway"];
    case "change_server": return ["09", "realm"];
    case "change_target": return ["04", "call"];
    case "interact": return [byKeyword(ctx, unplaced) === "06" ? "06" : "07", "context"];
    case "send_party_invite": case "accept_party_invite": case "send_party_request": case "accept_party_request":
    case "leave_party": case "kick_party_member": return ["01", "party membership"];
    case "send_cm": case "say": case "party_say": return [byKeyword(ctx, unplaced) || byPath(file, unplaced) || "12", "context"];
    default: return ["10", "item, gold or trade"];
  }
}
function emitOwner(method, fn, file, unplaced) {
  if (/silentTracker|budget|emitWrapper/i.test(fn)) return ["09", "the emit layer"];
  const m = method.toLowerCase();
  if (/^(move|stop|transport|leave|magiport|town|blink)$/.test(m)) return ["02", `emit ${method}`];
  if (/^(attack|heal|skill|use)$/.test(m)) return ["03", `emit ${method}`];
  if (/^respawn$/.test(m)) return ["05", `emit ${method}`];
  if (/^(party|invite|request)$/.test(m)) return ["01", `emit ${method}`];
  if (/^(join)$/.test(m)) return ["06", `emit ${method}`];
  if (/^(interaction|enter)$/.test(m)) return ["07", `emit ${method}`];
  if (/^(equip|unequip)$/.test(m)) return gameOwner(m, "", fn, file, unplaced);
  if (/^(secondhands|players|tracker|merchant|trade|sbuy|buy|sell|bank|upgrade|compound|exchange|craft|mail|loot|open_chest|donate|lostandfound|send|destroy)/.test(m)) return ["10", `emit ${method}`];
  return [byKeyword(fn + " " + method, unplaced) || byPath(file, unplaced) || "12", `emit ${method}, context`];
}

// The events owner's, the status owner's and the lifecycle owner's folders held shared code before their builds made them modules,
// and the dashboard and tools/
// belonged to no owner. Each of these modules holds from the tree with its door, so an older tree is
// judged by the rules of its time.
const LATE_DOORS = { "06": "runtime/events/api.ts", "12": "runtime/status/api.ts", "13": "runtime/lifecycle/api.ts" };
// Every row of one file. `text` is the file's source; the row's `file`, `function` and `call`
// identify it and `line` is for reading.
// `unplaced` holds the doors of `LATE_DOORS` this tree lacks: the path rules their builds added do not
// apply, and the rows of their owners pass only under their placement rows, as they did then.
export function scanFile(file, text, unplaced = new Set(), game = GAME) {
  const gameRe = gameReOf(game);
  const rows = [], lines = text.split("\n");
  // The dashboard, the host tools, the scripts and the coordinator run no game code: only
  // their timers and handlers count, and the dashboard (12, with tools/dashboard/) or lifecycle (13,
  // the other tools) owns the first two.
  // runtime/events/coordinator/ is the events owner's half of the coordinator, and
  // runtime/status/coordinator/ is the status owner's.
  const noGame = /^(dashboard|tools|scripts|runtime\/coordinator|runtime\/(events|status)\/coordinator)\//.test(file);
  const fixed = /^(dashboard|tools\/dashboard)\//.test(file) ? "12" : /^tools\//.test(file) ? "13" : null;
  // A name the file defines or destructures itself is not the game's. shared.js binds the
  // game's own names, so it is read as the game.
  const local = new Set();
  if (file !== "characters/shared.js") {
    for (const l of lines) { const d = l.match(defRe); if (d) local.add(d[1] || d[2] || d[3] || d[4]); }
    for (const d of text.matchAll(/(?:\b(?:const|let|var)\s*|\(\s*)\{([^}]*)\}\s*(?:=|:|\))/g))
      for (const n of d[1].split(",")) { const name = n.trim().split(/[\s:=]/)[0]; if (game.includes(name)) local.add(name); }
  }
  const addon = (file.match(/^runtime\/addons\/([\w-]+)\//) || [])[1] || null;
  // The lifecycle owner's run scope tags each registration with its owner:
  // owner:check reads a timer's owner from the handle it registers on, `scope('NN', kind)` bound to
  // a name in this file or shared.js's `scopes.actNN` and `scopes.observeNN`, before the keyword guess.
  // The scope is the module's `scope` or a run's (`lifecycle.scope`, `run.scope`, `coordinatorRun.scope`).
  const handles = new Map([...text.matchAll(/\b([\w$]+)\s*=\s*(?:[\w$]+\.)?scope\(\s*["'](\d\d)["']/g)].map((d) => [d[1], d[2]]));
  const registered = (before) => {
    const receiver = (/([\w$]+(?:\.[\w$]+)?)\.$/.exec(before) || [])[1] || "";
    return (/^scopes\.(?:act|observe)(\d\d)$/.exec(receiver) || [])[1] || handles.get(receiver) || null;
  };
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const add = (kind, call, owner, rule, at) => {
      const fn = enclosing(lines, i);
      const place = placed(file, kind, line, fn);
      if (place) [owner, rule] = [place[3], place[4]];
      else if (file === "characters/shared.js" && budgetRead(kind, call, line)) [owner, rule] = ["09", "the call budget's background reads"];
      else if (MODULES["09"].test(file) && (kind === "socket-emit" || kind === "handler") && BUDGET_EVENTS.test(call)) [owner, rule] = ["09", "the call budget's own reads and listeners"];
      const inOwner = !!(MODULES[owner] && !unplaced.has(LATE_DOORS[owner]) && MODULES[owner].test(file));
      const part = owner !== "09" ? undefined : MODULES["09"].test(file) || rule.startsWith("the call budget") ? BUDGET_PART : HANDS_PART;
      // A game call or emit row records whether its function asks `calls.band` before it (5.2).
      const admitted = at === undefined ? undefined : askRe.test([...lines.slice(enclosingAt(lines, i).line, i), line.slice(0, at)].join("\n"));
      rows.push({ file, line: i + 1, kind, call, function: fn, owner, ...(part ? { part } : {}), inOwner, listing: inOwner ? null : owner + (part ? " " + part : ""), addon, rule, ...(admitted === undefined ? {} : { admitted }), checked: CHECKED.has(owner) });
    };
    for (const m of noGame ? [] : line.matchAll(gameRe)) {
      if (local.has(m[2])) continue;
      // A declaration, not a call: a type member (`stop(): void`) or a method body (`stop() {`).
      if (file !== "characters/shared.js") {
        let depth = 0, k = line.indexOf("(", m.index + m[1].length);
        for (; k >= 0 && k < line.length; k++) { if (line[k] === "(") depth++; else if (line[k] === ")" && --depth === 0) break; }
        if (k >= 0 && k < line.length && /^\)\s*(:|\{)/.test(line.slice(k))) continue;
      }
      if (/\bfunction\s+$/.test(line.slice(0, m.index + m[1].length)) || /^\s*(async\s+)?[\w$]+\s*\([^)]*\)\s*\{/.test(line) && line.trim().startsWith(m[2])) continue;
      // escapeUse is shared.js's own cast wrapper, whose `use_skill` is the game call row, so only
      // its movement casts are rows, kept from tools/check-movement-calls.mjs. Its Dash is no
      // second row.
      if (m[2] === "escapeUse" && !/^["'`](town|use_town|blink|magiport)["'`]/.test(m[3] || "")) continue;
      const [owner, rule] = gameOwner(m[2], m[3] || "", enclosing(lines, i), file, unplaced);
      add("game-call", m[2] + (m[3] && /^["'`]/.test(m[3]) ? `(${m[3].split(/[,)]/)[0]})` : ""), owner, rule, m.index + m[1].length);
    }
    for (const m of noGame ? [] : line.matchAll(emitRe)) { const [owner, rule] = emitOwner(m[2], enclosing(lines, i), file, unplaced); add("socket-emit", `emit(${m[2]})`, owner, rule, m.index); }
    for (const m of noGame ? [] : line.matchAll(wrapRe)) add("emit-wrapper", "socket.emit", "09", "the call budget's emit layer");
    for (const m of line.matchAll(timerRe)) {
      const fn = enclosing(lines, i), handle = registered(line.slice(0, m.index));
      add("timer", m[1], fixed || handle || byKeyword(fn, unplaced) || byPath(file, unplaced) || "12",
        fixed ? "path" : handle ? "its run scope handle" : byKeyword(fn, unplaced) ? "enclosing function" : "path");
    }
    for (const m of line.matchAll(handlerRe)) {
      const fn = enclosing(lines, i);
      add("handler", `${m[1]}(${m[3]})`, fixed || byKeyword(m[3] + " " + fn, unplaced) || byPath(file, unplaced) || "13", !fixed && byKeyword(m[3] + " " + fn, unplaced) ? "event and enclosing function" : "path");
    }
    for (const m of line.matchAll(scopedOnRe)) {
      const fn = enclosing(lines, i), handle = registered(line.slice(0, m.index + m[1].length + 1));
      if (!handle && !/^(?:scope|act|observe|[\w$]*[Ss]cope|scopes\.\w+|ports\.scope|p\.scope|parts\.scope\.\w+)$/.test(m[1])) continue;
      add("handler", `${m[1]}.${m[2]}(${m[4]})`, fixed || handle || byKeyword(m[4] + " " + fn, unplaced) || byPath(file, unplaced) || "13",
        handle ? "its run scope handle" : "event and enclosing function");
    }
    for (const m of line.matchAll(hookAssignRe)) {
      const fn = enclosing(lines, i);
      add("handler", m[1], fixed || (/^on_(done|magiport)$/.test(m[1]) ? "02" : byKeyword(m[1] + " " + fn, unplaced) || byPath(file, unplaced) || "13"), "game callback");
    }
  });
  return rows;
}

// The sources of one tree: the working tree by default, or a commit read through
// `git cat-file --batch`, so a ref is checked without a checkout and the worktree is never touched.
export function readTree(root, ref) {
  const git = (args, input) => execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { input, maxBuffer: 1 << 30 });
  const sources = new Map();
  if (!ref) {
    const names = git(["ls-files", "--cached", "--others", "--exclude-standard"]).toString("utf8").split("\n");
    for (const f of names) if (f && existsSync(path.join(root, f))) sources.set(f, readFileSync(path.join(root, f), "utf8"));
    return sources;
  }
  const names = git(["ls-tree", "-r", "--name-only", ref]).toString("utf8").split("\n").filter(Boolean);
  const out = git(["cat-file", "--batch"], names.map((f) => `${ref}:${f}`).join("\n") + "\n");
  let at = 0;
  for (const f of names) {
    const nl = out.indexOf(10, at), header = out.subarray(at, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) { at = nl + 1; continue; }
    sources.set(f, out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return sources;
}

// The rows of the tools/ host programs outside tools/hosting and tools/console-build count from the
// tree with the lifecycle owner's host door; the committed map of the trees before lists only those two folders.
const HOST_DOOR = "tools/hosting/api.ts";
const earlyTools = (file) => !file.startsWith("tools/") || /^tools\/(hosting|console-build)\//.test(file);
export function scanTree(sources) {
  const rows = [], tree = new Map(sources), allTools = tree.has(HOST_DOOR);
  const unplaced = new Set(Object.values(LATE_DOORS).filter((door) => !tree.has(door))), game = gameOf(tree);
  for (const [file, text] of tree) if (SCANNED(file) && (allTools || earlyTools(file))) rows.push(...scanFile(file, text, unplaced, game));
  return rows;
}

export function counts(rows) {
  const count = (key) => rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + 1), acc), {});
  const byKindOwner = {};
  for (const r of rows) { const k = byKindOwner[r.kind] ||= {}; k[r.owner] = (k[r.owner] || 0) + 1; }
  return { kind: count("kind"), owner: count("owner"), inOwner: count("inOwner"), byKindOwner };
}

// The listed rows, read from tools/owner-check/listed-rows.json:
// - `standIns` maps a stand-in row id to the text that names what it lists: files, or add-on keys
//   (`<file>#<binding>`). A `Stand-in <id>` comment on a row or on the line above names its row.
// - `placement` maps an owner key (`"02"`, or `"09 call budget"` for a part) to the count of rows
//   outside the owner's module that still pass, and the kinds they may have. The count caps the
//   rows, so the list only shrinks.
// - `asks` lists the stand-in rows that let an owner's game calls skip `calls.band`, each with
//   the owner keys it covers and a count cap.
export function listedRows(data) {
  const standIns = new Map(Object.entries(data.standIns || {})), placement = new Map(), asks = new Map();
  for (const [key, p] of Object.entries(data.placement || {})) placement.set(key, { count: p.count, kinds: p.kinds });
  for (const a of data.asks || []) for (const owner of a.owners) asks.set(owner, { row: a.row, count: a.count });
  return { standIns, placement, asks };
}

// The committed map's rows, matched to the head's. A row is its file, function and call
//. The scanner names a row's function after the nearest definition
// above it, so code added above a call renames its function, and the name can move the row to
// another owner by keyword. A head row left over after the exact match takes a map row with the
// same file, kind and call, then one with the same function, kind and call in another file (a
// moved file). What is left is a row the map does not have, and each placement row's count
// still caps its owner's rows.
export function matchMap(rows, map) {
  const keys = [
    (r) => [r.file, r.function, r.call].join("|"),
    (r) => [r.file, r.kind, r.call].join("|"),
    (r) => [r.function, r.kind, r.call].join("|"),
  ];
  let left = rows, spare = map;
  for (const key of keys) {
    const have = new Map();
    for (const r of spare) { const k = key(r); if (!have.has(k)) have.set(k, []); have.get(k).push(r); }
    const next = [];
    for (const r of left) { const hit = have.get(key(r)); if (hit && hit.length) hit.pop(); else next.push(r); }
    left = next;
    spare = [...have.values()].flat();
  }
  return new Set(left);
}

// Protocol modules any owner may import:
// the protocol folder runtime/protocol/ (the rank table, report freshness, the ladder, the hold
// check, the request and ring record shapes) and the hook registry, which also holds the building
// blocks of a declared setting's check. The
// request's wire types (`Point`, the destination of every movement request) sit in
// runtime/movement/geometry/contracts.ts, which survival's death recovery reads.
// An owner's API file (other owners ask movement from its door per realm,
// runtime/movement/api/character.ts or runtime/movement/api/coordinator.ts;
// 01: runtime/tasks/api.ts, and runtime/tasks/coordinator/api.ts for the coordinator values 07 calls; 03: runtime/characters/turns/api.ts; 04: runtime/coordinator/targeting/api.ts and runtime/characters/targeting/api.ts, its two doors) re-exports what other owners may import, so an import of it is no
// cross-owner read. runtime/settings/api.ts is the settings owner's public file, which every owner
// imports; the rest of runtime/settings/ is the settings owner's own code.
export const PROTOCOL_FILES = new Set(["runtime/hooks/registry.ts", "runtime/movement/geometry/contracts.ts",
  "runtime/movement/api/character.ts", "runtime/movement/api/coordinator.ts",
  // Movement's protocol files before the rework, which the self-test's pinned trees hold.
  "runtime/navigation/movement-rules.ts", "runtime/characters/movement-host.ts", "runtime/navigation/contracts.ts",
  "runtime/characters/movement-records.ts", "runtime/characters/owner-ladder.ts", "runtime/coordinator/navigation/walk-ladder.ts",
  "runtime/tasks/api.ts", "runtime/tasks/coordinator/api.ts", "runtime/settings/api.ts", "runtime/settings/coordinator/api.ts", "runtime/settings/character/api.ts", "runtime/characters/turns/api.ts", "runtime/characters/survival/api.ts",
  // The survival owner's coordinator door (d082b7160): records.ts's rules, sections and words, without the character install.
  "runtime/coordinator/survival/api.ts",
  "runtime/coordinator/targeting/api.ts", "runtime/characters/targeting/api.ts",
  // 08 and the call budget owner's realm and hands, one public file per owner folder.
  "runtime/merchant-jobs/api.ts", "runtime/merchant-jobs/coordinator/api.ts", "runtime/merchant-realm/api.ts", "runtime/merchant-hands/api.ts",
  // The hands' character door, which sends every equip and unequip outside the hands' lease.
  "runtime/merchant-hands/character/api.ts",
  // The events owner's two doors: api.ts for
  // both runtimes, coordinator/api.ts for the coordinator values that import node built-ins.
  "runtime/events/api.ts", "runtime/events/coordinator/api.ts",
  // The hunting owner's two doors, as the events owner's: api.ts for both runtimes,
  // coordinator/api.ts for the coordinator values. zones.ts and areas.ts are not listed: the
  // dashboard, which no module rule covers, is their only importer outside 07.
  "runtime/hunting/api.ts", "runtime/hunting/coordinator/api.ts",
  // The items owner's two doors, as the hunting owner's: api.ts for both runtimes,
  // coordinator/api.ts for the coordinator values.
  "runtime/items/api.ts", "runtime/items/coordinator/api.ts",
  // The status owner's and the lifecycle owner's doors, two per runtime as the events owner's:
  // api.ts on every runtime, coordinator/api.ts for the coordinator values,
  // and status's character/api.ts for the telemetry that reads the game window's DOM.
  // The host programs in tools/ reach the status owner's dashboard host through tools/dashboard/api.ts and the
  // dashboard reads the lifecycle owner's build and update contracts; addon-kit.ts is the status owner's add-on dashboard kit.
  // The status owner's host programs reach the lifecycle owner's build store, ports and process helpers through tools/hosting/api.ts.
  "runtime/status/api.ts", "runtime/status/character/api.ts", "runtime/status/coordinator/api.ts", "runtime/lifecycle/api.ts", "runtime/lifecycle/coordinator/api.ts",
  "tools/dashboard/api.ts", "tools/hosting/api.ts", "tools/console-build/contracts.ts", "tools/update/contracts.ts", "dashboard/features/party/addon-kit.ts"]);
export const isProtocol = (file) => file.startsWith("runtime/protocol/") || file.startsWith("runtime/hooks/") || PROTOCOL_FILES.has(file);

// `settings.declare` is load data, not a call: the settings owner
// builds its table at load from each owner's declarations, which the owner keeps in its own
// `saved-fields.ts`. That import is the way the declarations
// reach the settings owner, so it passes for owner 11 only. Lifecycle keeps its declarations in
// runtime/lifecycle/fields.ts and status in runtime/status/fields.ts
//. The call budget declares no settings: its read picks are
// named constants in call-budget-limits.ts (80e655b44).
const DECLARES = /(^|\/)saved-fields\.ts$|^runtime\/(lifecycle|status)\/fields\.ts$/;
// The owners' modules share no globals, so a file in one owner's module reaches another
// owner's state only through an import. An import of another owner's file that is not a
// protocol module is the cross-owner read the check refuses.
export const importRe = /\b(?:import|export)\s[^"'`;]*?from\s*["'`]([^"'`]+)["'`]|\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const placedModuleOf = (sources, file) => {
  const owner = moduleOf(file);
  return owner && (!LATE_DOORS[owner] || sources.has(LATE_DOORS[owner])) ? owner : null;
};
// A runtime file no owner holds and no protocol list names is read like an owner's file (C-7):
// its import of an owner's own code is a finding, so a type or rule another owner reads moves into
// an owner and goes out through its door. The rule holds from the tree that moved the last such
// contracts into their owners (the turns owner's role types among them); a tree from before is judged by the
// rules of its time.
const CONTRACTS_PLACED = "runtime/characters/turns/role-types.ts";
const unowned = (file) => file.startsWith("runtime/") && !moduleOf(file) && !isProtocol(file);
export function crossOwnerImports(sources) {
  const findings = [], placedContracts = sources.has(CONTRACTS_PLACED);
  for (const [file, text] of sources) {
    const from = placedModuleOf(sources, file);
    if (!(from || placedContracts && unowned(file)) || !SCANNED(file)) continue;
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(importRe)) {
        const spec = m[1] || m[2] || m[3];
        if (!spec.startsWith(".")) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        const stem = base.replace(/\.(m|c)?js$/, "");
        const target = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.js`, `${stem}.cjs`, `${stem}.mjs`, `${stem}/index.ts`].find((f) => sources.has(f));
        const to = target && placedModuleOf(sources, target);
        if (to && to !== from && !isProtocol(target) && !publishes(file) && !(from === "11" && DECLARES.test(target)))
          findings.push(from ? `${file}:${i + 1}: owner ${from} imports ${target}, owner ${to}'s own code, outside a hook or protocol module`
            : `${file}:${i + 1}: a file no owner holds imports ${target}, owner ${to}'s own code; it moves into an owner or reads the door`);
      }
    });
  }
  return findings;
}

// Movement's door per realm: a file the character bundles load imports
// movement's surface from runtime/movement/api/character.ts only. runtime/movement/api/coordinator.ts
// carries the coordinator modules, which need node:perf_hooks and
// node:worker_threads, so an import of it from character code pulls them into a browser bundle.
// Type-only imports are erased by the build and pass.
export const CHARACTER_REALM = (f) => /^runtime\/(characters|tasks\/character)\//.test(f);
export function doorImports(sources) {
  const findings = [];
  for (const [file, text] of sources) {
    if (!CHARACTER_REALM(file) || !SCANNED(file)) continue;
    text.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*(import|export)\s+type\b/.test(line)) return;
      for (const m of line.matchAll(importRe)) {
        const spec = m[1] || m[2] || m[3];
        if (!spec.startsWith(".")) continue;
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        if (base === "runtime/movement/api/coordinator.ts")
          findings.push(`${file}:${i + 1}: character code imports ${base}; it asks movement through runtime/movement/api/character.ts (X3's door per realm)`);
      }
    });
  }
  return findings;
}

// The write half of the settings rule: a setting changes only through
// The settings owner's writer, so a direct `state.<setting> =` outside the settings owner's module is a finding. The rule reads
// only the names declared as settings, from the files the coordinator's table loads: the settings owner's
// own declarations, each built owner's `saved-fields.ts` and the held blocks. Records, which
// owners write from play and in their load migrations, are never flagged.
const DECLARERS = (f) => DECLARES.test(f) || /^runtime\/settings\/held\/[^/]+\.ts$/.test(f) || f === "runtime/settings/coordinator/declarations.ts";
// The keys of each `settings: { ... }` block, read at the block's own depth.
export function declaredSettings(sources) {
  const names = new Set();
  for (const [file, text] of sources) {
    if (!DECLARERS(file)) continue;
    for (const m of text.matchAll(/\bsettings\s*:\s*\{/g)) {
      let depth = 0, expectKey = false;
      for (let k = m.index + m[0].length - 1; k < text.length; k++) {
        const c = text[k];
        if (c === "/" && text[k + 1] === "/") { k = text.indexOf("\n", k); if (k < 0) break; continue; }
        if (c === "/" && text[k + 1] === "*") { k = text.indexOf("*/", k + 2) + 1; if (k <= 0) break; continue; }
        if (c === "'" || c === '"' || c === "`") { for (k++; k < text.length && text[k] !== c; k++) if (text[k] === "\\") k++; expectKey = false; continue; }
        if ("{[(".includes(c)) { depth++; expectKey = depth === 1; continue; }
        if ("}])".includes(c)) { if (--depth === 0) break; continue; }
        if (depth === 1 && c === ",") { expectKey = true; continue; }
        if (/\s/.test(c)) continue;
        const key = depth === 1 && expectKey && text.slice(k).match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (key) { names.add(key[1]); k += key[1].length - 1; }
        expectKey = false;
      }
    }
  }
  return names;
}
// A request edits settings in a draft (runtime/settings/api.ts `settingsDraft`) and writes the
// draft's changes through the writer in one batch, so an assignment through a draft's view is a
// write through the writer. Within one file, a view is a name bound to `<draft>.view(...)`, where
// `<draft>` is bound to `settingsDraft(...)`, or the parameter of a function that some call in the
// file passes a view in that position. draftViews returns each function's view names.
function draftViews(text) {
  const views = new Map(), add = (fn, name) => {
    if (!views.has(fn)) views.set(fn, new Set());
    if (views.get(fn).has(name)) return false;
    views.get(fn).add(name);
    return true;
  };
  const drafts = new Set([...text.matchAll(/\b([\w$]+)\s*=\s*settingsDraft\(/g)].map((m) => m[1]));
  if (!drafts.size) return views;
  const lines = text.split("\n"), viewCall = new RegExp(`^(?:${[...drafts].join("|")})\\.view\\s*(?:<[^>]*>)?\\s*\\(`);
  // The top-level pieces of the parenthesised list that opens at `open`.
  const pieces = (from, open) => {
    const out = [];
    let depth = 0, start = open + 1;
    for (let k = open; k < from.length; k++) {
      const c = from[k];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (--depth === 0) { out.push(from.slice(start, k).trim()); return out; } }
      else if (c === "," && depth === 1) { out.push(from.slice(start, k).trim()); start = k + 1; }
    }
    return out;
  };
  const params = new Map();
  for (const m of text.matchAll(/\bfunction\s+([\w$]+)\s*\(/g))
    params.set(m[1], pieces(text, m.index + m[0].length - 1).map((p) => p.replace(/^\.\.\./, "").split(/[\s:=?]/)[0]));
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\b([\w$]+)\s*=\s*(?=[\w$]+\.view\b)/g)) if (viewCall.test(line.slice(m.index + m[0].length))) add(enclosing(lines, i), m[1]);
  });
  // Every call of a function the file defines, with its arguments, in its enclosing function.
  const calls = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![.\w$])([\w$]+)\s*\(/g)) if (params.has(m[1]) && !/\bfunction\s+$/.test(line.slice(0, m.index)))
      calls.push({ in: enclosing(lines, i), callee: m[1], args: pieces(line.slice(m.index), m[0].length - 1) });
  });
  for (let changed = true; changed;) {
    changed = false;
    for (const call of calls) call.args.forEach((arg, at) => {
      const name = params.get(call.callee)[at];
      if (name && (viewCall.test(arg) || views.get(call.in)?.has(arg))) changed = add(call.callee, name) || changed;
    });
  }
  return views;
}
// The member accesses after `<state|party>.<setting>` on one line: `.key`, `?.key`, `[expr]` and
// `!`. memberChain returns where the chain ends and its last `.key`, so the caller can tell an
// element write (`state.x[k] =`) and a mutating call (`state.x.push(`) from a read.
function memberChain(line, k) {
  let member = null;
  for (;;) {
    const rest = line.slice(k), dot = rest.match(/^\s*!?\s*\??\.\s*([A-Za-z_$][\w$]*)/);
    if (dot) { k += dot[0].length; member = { name: dot[1], end: k }; continue; }
    const open = rest.match(/^\s*!?\s*(?:\?\.)?\s*\[/);
    if (!open) return { end: k, member };
    let depth = 0, j = k + open[0].length - 1;
    for (; j < line.length; j++) { if (line[j] === "[") depth++; else if (line[j] === "]" && --depth === 0) break; }
    if (j >= line.length) return { end: line.length, member: null };
    k = j + 1; member = null;
  }
}
// The methods that change an array, a Map or a Set in place.
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "delete", "clear", "add"]);
// The coordinator names its state `party` (application.ts) or `state`, the two names 1.3's writer
// inventory reads; a write through an alias is not seen. The rule reads every write to a setting
// or inside it: an assignment to the field or an element (`=`, `||=`, `??=` and the other compound
// operators, `++`, `--`), a `delete` of the field or an entry, `Object.assign` into it, and a
// mutating call on it. A stand-in marker passes a write only when its listed row names the file,
// and `passed` counts the writes each row passes.
// The dashboard and the host tools run outside the coordinator and hold none of its state.
export function settingWrites(sources, standIns, passed = {}) {
  const names = declaredSettings(sources), findings = [];
  if (!names.size) return findings;
  const list = [...names].join("|");
  const headRe = new RegExp(`(?:^|[^\\w$.])(delete\\s+|\\+\\+\\s*|--\\s*)?(state|party)\\.(${list})\\b`, "g");
  const assignInto = new RegExp(`\\bObject\\.assign\\(\\s*(state|party)\\.(${list})\\b`, "g");
  const assignment = /^\s*(?:(?:[-+*/%|&?^]{0,2}|\*\*|<<|>>>?)=(?![=>])|\+\+|--)/;
  for (const [file, text] of sources) {
    if (!SCANNED(file) || moduleOf(file) === "11" || /^(dashboard|tools)\//.test(file)) continue;
    let views = null;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const writes = [];
      for (const m of line.matchAll(headRe)) {
        const after = m.index + m[0].length, { end, member } = memberChain(line, after), element = end > after;
        if (m[1]) writes.push([m[2], m[3], m[1].startsWith("delete") ? (element ? "deletes an entry" : null) : "increments it"]);
        else if (assignment.test(line.slice(end))) writes.push([m[2], m[3], element ? "writes an element" : null]);
        else if (member && member.end === end && MUTATORS.has(member.name) && /^\s*\(/.test(line.slice(end))) writes.push([m[2], m[3], `calls ${member.name}`]);
      }
      for (const m of line.matchAll(assignInto)) {
        const { end } = memberChain(line, m.index + m[0].length);
        if (/^\s*[,)]/.test(line.slice(end))) writes.push([m[1], m[2], "Object.assign into it"]);
      }
      for (const [base, field, form] of writes) {
        const fn = enclosing(lines, i);
        if ((views ??= draftViews(text)).get(fn)?.has(base)) continue;
        const named = (`${line}\n${lines[i - 1] || ""}`.match(/Stand-in (S\d+)/) || [])[1];
        if (named && standIns.get(named)?.includes(file)) { passed[named] = (passed[named] || 0) + 1; continue; }
        const say = `${file}:${i + 1}: setting-write ${base}.${field}${form ? ` (${form})` : ""} in ${fn || "(top level)"}, owner 11`;
        findings.push(!named ? `${say}: a direct write to a declared setting outside the settings writer, and no stand-in row lists it`
          : standIns.has(named) ? `${say}, names ${named}, whose listed row does not name this file`
          : `${say}, names ${named}, which no listed row has`);
      }
    });
  }
  return findings;
}

// The realm owner is the one writer of the merchant's
// realm request, `merchantRealmRequests`. A write to it, by the same forms the setting rule reads,
// in a scanned file outside runtime/merchant-realm/ is a finding. `block.realm` is every character's
// field and the merchant's block has no name of its own in the code, so the symbol search
// reads its writers.
const REALM_REQUESTS = /(?:^|[^\w$.])(delete\s+)?(state|party)\.merchantRealmRequests\b/g;
export function realmWrites(sources) {
  const findings = [];
  const assignment = /^\s*(?:(?:[-+*/%|&?^]{0,2}|\*\*|<<|>>>?)=(?![=>])|\+\+|--)/;
  for (const [file, text] of sources) {
    if (!SCANNED(file) || /^runtime\/merchant-realm\//.test(file) || /^(dashboard|tools)\//.test(file)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(REALM_REQUESTS)) {
        const after = m.index + m[0].length, { end, member } = memberChain(line, after);
        const write = !!m[1] || assignment.test(line.slice(end)) ||
          !!member && member.end === end && MUTATORS.has(member.name) && /^\s*\(/.test(line.slice(end));
        if (write) findings.push(`${file}:${i + 1}: realm-write ${m[2]}.merchantRealmRequests in ${enclosing(lines, i) || "(top level)"}: only the realm owner (runtime/merchant-realm/) writes the merchant's realm request`);
      }
    });
  }
  return findings;
}

// The movement owner's own rule, from tools/check-movement-calls.mjs (movement step 12):
// characters/shared.js binds smart_move and stop to the owner's service, so those calls are
// the owner's. The check fails when the binding goes. The binding names shared.js's local
// `bankSortMove` in the trees before the items owner's 2.4 and the bank owner's `bankOps.bankSortMove` after it.
const BINDING = /\bsmart_move = (?:bankOps\.)?bankSortMove, stop = movement\.stop\b/;
const boundToOwner = (row, shared) =>
  row.file === "characters/shared.js" && /^(smart_move|stop)\b/.test(row.call) && BINDING.test(shared || "");
// The game's smart_move only plans and stop("smart") only ends the plan: neither emits
// (runner_functions.js:2541-2546, 2646-2651 at the game pin), and the movement owner's executor
// sends each step of the plan. The native planner's `native.move` is the game's smart_move, which
// movement.ts binds; the check fails when the binding goes.
const NATIVE_BINDING = /__partyNativeMovement \|\|= \{ move: host\.smart_move,/;
function plans(row, sources) {
  if (/^smart_move\b/.test(row.call) || /^stop\(["'`]smart["'`]\)$/.test(row.call)) return true;
  if (row.call !== "move" || row.file !== "runtime/movement/character/planner.ts") return false;
  return /\bnative\.move\(/.test((sources.get(row.file) || "").split("\n")[row.line - 1] || "") && NATIVE_BINDING.test(sources.get("runtime/movement/character/owner.ts") || "");
}

// The farm return
// after a death asks the owner who holds the character. A read of a mover's own flag is the
// blocker list the rank table replaced, and no game row can tell the two apart, so the check
// reads the code. The farm return's own body, and each function of its file it calls, read none of
// the three walk flags, and one of them asks the owner. The
// callees count because beginFarmReunion, which the farm return calls, read all three walk flags
// while the check read the farm return alone (movement step 13). The farm return lives in
// characters/shared.js until the tasks owner moves it into runtime/tasks/character/assignment.ts; a
// tree with neither fails, so a rename cannot pass it.
const FARM_RETURN_FILES = ["characters/shared.js", "runtime/tasks/character/assignment.ts"];
const WALK_FLAGS = /\b(partyConvoyActive|groupWalk\.travel|__partySharedWalking)\b/g;
function body(text, name) {
  const at = text.indexOf(`function ${name}(`);
  if (at < 0) return null;
  let depth = 0, k = text.indexOf("{", at);
  for (const start = k; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}" && --depth === 0) return text.slice(start, k + 1).replace(/\/\/[^\n]*/g, "");
  }
  return null;
}
const flagsIn = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];
export function farmReturnShape(sources) {
  const file = FARM_RETURN_FILES.find((f) => body(sources.get(f) ?? "", "deathRecoveryFarmReturn"));
  if (!file) return ["characters/shared.js: deathRecoveryFarmReturn not found"];
  const text = sources.get(file), farmReturn = body(text, "deathRecoveryFarmReturn"), findings = [];
  const flags = flagsIn(farmReturn, WALK_FLAGS);
  if (flags.length) findings.push(`${file}: deathRecoveryFarmReturn reads the movers' flags ${flags.join(", ")} instead of the owner`);
  const callees = [...new Set([...farmReturn.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]))]
    .filter((name) => name !== "deathRecoveryFarmReturn" && text.includes(`function ${name}(`));
  const bodies = new Map(callees.map((name) => [name, body(text, name)]));
  for (const [name, callee] of bodies) {
    const read = flagsIn(callee ?? "", WALK_FLAGS);
    if (read.length) findings.push(`${file}: ${name}, which deathRecoveryFarmReturn calls, reads the walk flags ${read.join(", ")} instead of the owner`);
  }
  if (![farmReturn, ...bodies.values()].some((callee) => /\bmovement\.(live|ranks)\(/.test(callee ?? "")))
    findings.push(`${file}: deathRecoveryFarmReturn no longer asks the owner who holds the character`);
  return findings;
}

// The ownership rule for one tree. A row passes when it sits in its owner's
// module, or when its line or the line above names a stand-in row the listed rows include. Otherwise
// it passes only while its owner's placement row converts its kind and the committed map has
// the row. An add-on acts only through hooks, so an add-on row passes only under a stand-in
// row; a stand-in row that names the add-on's file lists it, since the file is that one
// add-on's code. A placement row's count caps the rows that pass under it, so the list only
// shrinks.
export function check({ sources, map, listed }) {
  const { standIns, placement, asks } = listed;
  const rows = scanTree(sources), fresh = matchMap(rows, map), shared = sources.get("characters/shared.js");
  const findings = [], passed = { module: 0, owner: 0, standIn: {}, placement: {}, settingWrites: {}, asks: {} };
  if (shared !== undefined && !BINDING.test(shared)) findings.push("characters/shared.js: smart_move and stop are no longer bound to the movement owner");
  // A game call that passed its owner's rule still has to ask `calls.band` before it, unless it
  // only plans, goes to the movement owner's service, or sits under its owner's stand-in row
  //. The call budget's own reads ask since step 3a moved them into
  // its module, so its part has no exception.
  const admit = (row, say) => {
    if (row.admitted !== false || plans(row, sources) || boundToOwner(row, shared)) return;
    const key = row.owner + (row.part === HANDS_PART ? " " + HANDS_PART : ""), ask = asks.get(key);
    if (ask) passed.asks[ask.row] = (passed.asks[ask.row] || 0) + 1;
    else findings.push(`${say}: it does not ask calls.band before the call, and no stand-in row lists owner ${key}`);
  };
  for (const row of rows) {
    if (row.inOwner) { passed.module++; admit(row, `${row.file}:${row.line}: ${row.kind} ${row.call} in ${row.function || "(top level)"}, owner ${row.owner}`); continue; }
    const lines = (sources.get(row.file) || "").split("\n");
    const named = (`${lines[row.line - 1] || ""}\n${lines[row.line - 2] || ""}`.match(/Stand-in (S\d+)/) || [])[1];
    const say = `${row.file}:${row.line}: ${row.kind} ${row.call} in ${row.function || "(top level)"}, owner ${row.owner}`;
    // An add-on's row is the add-on system's to judge (runtime/hooks/rules/uses.mts).
    const judged = !named && row.addon ? addonRowFindings(row, sources, standIns, say) : {};
    if (judged.finding) { findings.push(judged.finding); continue; }
    const listing = named || judged.listing;
    if (listing && standIns.has(listing)) { passed.standIn[listing] = (passed.standIn[listing] || 0) + 1; admit(row, say); continue; }
    if (named) { findings.push(`${say}, names ${named}, which no listed row has`); continue; }
    if (row.owner === "02" && boundToOwner(row, shared)) { passed.owner++; continue; }
    // An owner built in parts lists each part under "<owner> <part>", or lists the whole owner in one entry.
    const key = row.part && placement.has(`${row.owner} ${row.part}`) ? `${row.owner} ${row.part}` : row.owner, p = placement.get(key);
    if (!p || !p.count || !p.kinds.includes(row.kind)) { findings.push(`${say}${row.part ? ` (${row.part})` : ""}: outside its owner's module, and no placement entry or stand-in row lists it`); continue; }
    if (fresh.has(row)) { findings.push(`${say}: a row the ownership map does not have`); continue; }
    passed.placement[key] = (passed.placement[key] || 0) + 1;
    admit(row, say);
  }
  for (const [row, n] of Object.entries(passed.asks)) {
    const keys = [...asks].filter(([, a]) => a.row === row).map(([key]) => key), count = asks.get(keys[0]).count;
    if (n > count) findings.push(`${row}: ${n} rows of owner${keys.length > 1 ? "s" : ""} ${keys.join(" and ")} that do not ask calls.band pass, but the listed rows allow ${count}`);
  }
  for (const [key, n] of Object.entries(passed.placement))
    if (n > placement.get(key).count) findings.push(`placement ${key}: ${n} rows outside owner ${key.slice(0, 2)} pass, but the listed rows allow ${placement.get(key).count}`);
  if (shared !== undefined) findings.push(...farmReturnShape(sources));
  findings.push(...crossOwnerImports(sources));
  findings.push(...doorImports(sources));
  // The add-on rules hold from the add-on system's step 1, which built the add-on API; a tree
  // from before has no API to import, so it is judged by the rules of its time.
  if (sources.has(ADDON_API)) findings.push(...addonFindings(sources, standIns), ...testImports(sources), ...entryFindings(sources));
  findings.push(...settingWrites(sources, standIns, passed.settingWrites));
  // The realm owner's one-writer rule holds from the build that created runtime/merchant-realm/;
  // a tree from before has no realm owner, so it is judged by the rules of its time.
  if (sources.has("runtime/merchant-realm/rules.ts")) findings.push(...realmWrites(sources));
  findings.push(...feedRequesters(sources));
  findings.push(...scopeFactReads(sources));
  // The copy check: a rule movement's rework made one copy of stays one copy.
  findings.push(...copyFindings(sources));
  findings.push(...unscopedLoops(sources));
  return { rows, findings, passed, placement };
}

// The run scope's loops rule: on the character and on the
// coordinator, every timer, sleep, microtask, immediate and game socket listener goes through an
// owner's run scope handle (`lifecycle.scope` on the character, the root's `scopes` table on the
// coordinator), so table P holds it and the run's stop removes it. A bare call is a
// finding at its line. The lifecycle owner's own character files are the scope itself (run.ts) and the code outside a
// generation (the loader, the headless host), so they are not scanned. Each other exception names its
// owner's reason.
const CHARACTER_SIDE = (file) => file === "characters/shared.js" || /^runtime\/(characters|combat)\//.test(file) || /^runtime\/[\w-]+\/character\//.test(file);
// The coordinator's files, and the roster install the coordinator's web services run.
const COORDINATOR_SIDE = (file) => /^runtime\/(coordinator|[\w-]+\/coordinator)\//.test(file) || file === "runtime/lifecycle/roster/routes.ts";
const RUN_SIDE = (file) => COORDINATOR_SIDE(file) || !file.startsWith("runtime/lifecycle/") && CHARACTER_SIDE(file);
const LOOP_EXCEPTIONS = new Map([
  // the call budget owner's drain sends the game client's and the player's own held emits, which pass while held, and
  // outlives the generation that set it.
  ["runtime/characters/call-budget.ts", /const id = setTimeout\(run, ms\)/],
]);
const BARE_LOOP = /(?<![.\w$])(setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|sleep)\(/g;
const BARE_LISTENER = /\bsocket\??\.(on|once)\??\.?\(|\baddEventListener\(/g;
export function unscopedLoops(sources) {
  const findings = [];
  // The rule holds from the build of the lifecycle owner's run scope; a tree from before has no handle to
  // register on, so it is judged by the rules of its time.
  if (!sources.has("runtime/lifecycle/character/run.ts")) return findings;
  for (const [file, text] of sources) {
    if (!RUN_SIDE(file) || /\.d\.ts$/.test(file)) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (LOOP_EXCEPTIONS.get(file)?.test(line)) return;
      for (const m of line.matchAll(BARE_LOOP)) {
        // A declaration, not a call: a type member or a parameter list with types (`sleep(ms: number)`).
        const after = line.slice(m.index + m[0].length);
        if (/^\s*[\w$]+\??\s*:/.test(after) || /\bfunction\s+$/.test(line.slice(0, m.index))) continue;
        findings.push(`${file}:${i + 1}: ${m[1]}( outside a run scope handle`);
      }
      for (const m of line.matchAll(BARE_LISTENER)) findings.push(`${file}:${i + 1}: ${m[0].replace(/\W+$/, "")} outside a run scope handle`);
    });
  }
  return findings;
}

// The third part of the budget rule: the turns executor
// asks no target rule for a push whose requester is the A/B feed, so only the feed's own push may
// name that requester. Another spend that names it skips the target rule, and fails here. The
// executor's own rule reads the name, the feed (turns/ab-feed.ts) pushes
// with it and books its target reset under it, and tests plant it.
const AB_FEED = /["'`]core:turns\/ab-feed["'`]/;
const FEED_READERS = new Set(["runtime/characters/turns/executor.ts", "runtime/characters/turns/ab-feed.ts"]);
export function feedRequesters(sources) {
  const findings = [];
  for (const [file, text] of sources) {
    if (!SCANNED(file) || FEED_READERS.has(file) || !AB_FEED.test(text)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || !AB_FEED.test(line)) return;
      findings.push(`${file}:${i + 1}: names the A/B feed's requester core:turns/ab-feed outside runtime/characters/turns/ab-feed.ts`);
    });
  }
  return findings;
}

// Targeting reads the hunting owner's and the lifecycle owner's facts only
// through the ports shared.js hands its module (`targetingPorts()`), as `p.<fact>`, and the
// events owner's through runtime/events/api.ts `eventFacts()`. A read of one of those facts by any
// other name in targeting's folder fails. A closure variable counts when no `.` precedes it; a
// property of `root` counts wherever it is named.
const SCOPE_VARS = ["eventSelected", "activeCombatEvent", "joinedEvent", "eventSettings", "eventTargetTypes", "frankyCombatActive",
  "validAbtestingOpponent", "inFarmArea", "inFarmRadius", "passiveRareCandidate", "monsterFocus", "huntCombatTarget",
  "partyFarmingMonsterType", "farmingMode", "rareActive", "rareControlState", "consoleDraining"];
const SCOPE_PROPS = ["__partyAnniversaryStagingOperation", "__partyEventRecoveryCycleId", "partyLootClient", "__partyDungeonRuntime",
  "__partyConsoleMaintenance", "__partyConsoleDrainTargets"];
const scopeAny = new RegExp(`(?<![\\w$])(${[...SCOPE_VARS, ...SCOPE_PROPS].join("|")})(?![\\w$])`, "g");
// view.ts declares the facts a pass reads in `export const <NAME>_FACTS = ... as const;` lists: an
// array of names, or an object whose keys are the names. factDeclarations returns the position
// (`line:column`) of each declared name, an array entry or an object key, so the name itself passes
// while the same name anywhere else in the targeting owner's folder, view.ts's other lines included, is a read.
function factDeclarations(lines) {
  const at = new Set();
  let inside = false;
  lines.forEach((l, i) => {
    if (/^export const \w+_FACTS\b/.test(l)) inside = true;
    if (!inside) return;
    for (const m of l.matchAll(/(?<=(?:^|[[{,])\s*)(?:'(\w+)'|(\w+)\s*:)/g)) at.add(`${i}:${m.index + (m[1] ? 1 : 0)}`);
    if (/\bas const;\s*$/.test(l)) inside = false;
  });
  return at;
}
export function scopeFactReads(sources) {
  const findings = [], code = (l) => !/^\s*(\/\/|\*|\/\*)/.test(l);
  for (const [file, text] of sources) {
    if (!/^runtime\/characters\/targeting\/.+\.ts$/.test(file) || file === "runtime/characters/targeting/stand-ins.ts") continue;
    const lines = text.split("\n"), declared = file === "runtime/characters/targeting/view.ts" ? factDeclarations(lines) : new Set();
    lines.forEach((l, i) => {
      if (!code(l)) return;
      // A read through the ports (`p.`) or through the pass's view (`t.view().`, a row's `v.`) passes,
      // and so does a name view.ts declares in its fact lists.
      for (const m of l.matchAll(scopeAny)) if (!/(\b[pv]\.|\bview\(\)\.)$/.test(l.slice(0, m.index)) && !declared.has(`${i}:${m.index}`))
        findings.push(`${file}:${i + 1}: reads ${m[1]}, a fact targeting reads only through its ports or its view`);
    });
  }
  return findings.sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2), opt = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };
  const ref = opt("--ref");
  const sources = readTree(root, ref);
  const mapOut = opt("--map-out");
  if (mapOut) {
    const files = [...sources.keys()].filter(SCANNED), rows = scanTree(sources);
    writeFileSync(mapOut, JSON.stringify({
      generatedBy: "node tools/owner-check.mjs --map-out tools/owner-check/ownership-map.json",
      files: files.length, rows: rows.length, counts: counts(rows), owners: OWNERS, map: rows,
    }, null, 1) + "\n");
    console.log(`owner-check: wrote ${rows.length} rows from ${files.length} files to ${mapOut}`);
    process.exit(0);
  }
  const here = (name) => path.join(root, "tools/owner-check", name);
  const { rows, findings, passed, placement } = check({ sources, map: JSON.parse(readFileSync(here("ownership-map.json"), "utf8")).map, listed: listedRows(JSON.parse(readFileSync(here("listed-rows.json"), "utf8"))) });
  const c = counts(rows);
  console.log(`owner-check ${ref || "working tree"}: ${rows.length} rows; ${passed.module} in their owner's module, ${passed.owner} smart_move and stop calls in characters/shared.js bound to the movement owner.`);
  console.log(`  by kind: ${Object.entries(c.kind).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const owner of Object.keys(OWNERS)) {
    const keys = [...placement.keys()].filter((key) => key.slice(0, 2) === owner);
    if (!c.owner[owner] && !keys.length) continue;
    const under = (keys.length ? keys : [owner]).map((key) => `${passed.placement[key] || 0} pass under placement ${key}${placement.has(key) ? ` (allows ${placement.get(key).count})` : ""}`);
    console.log(`  ${owner} ${OWNERS[owner]}: ${c.owner[owner] || 0} rows, ${under.join("; ")}`);
  }
  for (const [row, n] of Object.entries(passed.standIn)) console.log(`  stand-in ${row}: ${n} row(s)`);
  for (const [row, n] of Object.entries(passed.asks)) console.log(`  stand-in ${row}: ${n} game call row(s) that do not ask calls.band`);
  for (const [row, n] of Object.entries(passed.settingWrites)) console.log(`  stand-in ${row}: ${n} setting write(s)`);
  if (findings.length) {
    console.log(`${findings.length} finding(s):`);
    for (const f of findings) console.log("  " + f);
    process.exit(1);
  }
  console.log("Every game call, emit, timer and handler goes out from its owner or a listed row, no owner imports another's code, and every setting write outside the settings writer sits under a listed stand-in row.");
}
