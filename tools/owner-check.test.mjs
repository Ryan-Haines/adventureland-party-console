// The self-test of owner:check. It scans source trees and shares no game or harness setup with any
// other test. Each fixture is the working tree with one planted finding, and the tree itself has none.
// Usage: node --test tools/owner-check.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { check, listedRows, readTree, realmWrites, scanFile, scanTree, scopeFactReads, unscopedLoops } from "./owner-check.mjs";
import { addonFindings, testImports } from "../runtime/hooks/rules/uses.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(path.join(root, "tools/owner-check", name), "utf8"));
const listedData = readJson("listed-rows.json"), committed = readJson("ownership-map.json");
const listedWith = (change) => listedRows(change(structuredClone(listedData)));
const run = (sources, listed = listedRows(listedData), map = committed.map) => check({ sources, map, listed }).findings;
// A planted bare timer or listener also trips the loops rule, which has its own test below.
const ownerFindings = (findings) => findings.filter((f) => !/ outside a run scope handle$/.test(f));

const head = readTree(root);
const plant = (edits) => {
  const tree = new Map(head);
  for (const [file, change] of Object.entries(edits)) tree.set(file, typeof change === "function" ? change(tree.get(file)) : change);
  return tree;
};

test("the working tree has no finding", () => {
  assert.deepEqual(run(head), []);
});

test("the committed files hold no planning ids, doc names or local paths", () => {
  const text = JSON.stringify(committed) + JSON.stringify(listedData);
  assert.doesNotMatch(text, /party-console-plan|-design|catalog\/|REVIEW-|\bP-\d\d/);
  assert.equal(committed.checkout, undefined);
});

test("a listed row's count caps the rows that pass under it", () => {
  const findings = run(head, listedWith((d) => { d.placement["06"].count = 4; return d; }));
  assert.deepEqual(findings, ["placement 06: 6 rows outside owner 06 pass, but the listed rows allow 4"]);
  const none = run(head, listedWith((d) => { delete d.placement["02"]; return d; }));
  assert.equal(none.length, 1);
  assert.match(none[0], /: timer queueMicrotask in nativePositionChanged, owner 02: outside its owner's module, and no placement entry or stand-in row lists it$/);
});

test("a row under a listed count must be in the ownership map", () => {
  const planted = plant({ "characters/shared.js": (text) => text + "\nfunction plantedClock() {\n  setTimeout(function () {}, 5);\n}\n" });
  const row = scanTree(planted).find((r) => r.function === "plantedClock");
  const loose = listedWith((d) => { d.placement[row.owner] = { count: 9, kinds: ["timer"] }; return d; });
  const findings = ownerFindings(run(planted, loose));
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /plantedClock, owner \d\d: a row the ownership map does not have$/);
  assert.deepEqual(ownerFindings(run(planted, loose, scanTree(planted))), []);
});

const fixtures = [
  ["a movement call outside the movement module",
    { "runtime/combat/planted-step.ts": "export function plantedStep(): void {\n  smart_move(\"main\");\n}\n" },
    /runtime\/combat\/planted-step\.ts:2: game-call smart_move\("main"\) in plantedStep, owner 02: outside its owner's module/],
  ["a game call outside its owner",
    { "runtime/characters/planted-swing.ts": "export function plantedSwing(target: unknown): void {\n  attack(target);\n}\n" },
    /planted-swing\.ts:2: game-call attack in plantedSwing, owner 03: outside its owner's module, and no placement entry or stand-in row lists it/],
  ["a timer outside its owner",
    { "runtime/characters/planted-wait.ts": "export function plantedWait(done: () => void): void {\n  setTimeout(done, 100);\n}\n" },
    /planted-wait\.ts:2: timer setTimeout in plantedWait, owner 13: outside its owner's module/],
  ["an interval outside its owner",
    { "runtime/coordinator/planted-poll.ts": "export function plantedPoll(run: () => void): void {\n  setInterval(run, 1000);\n}\n" },
    /planted-poll\.ts:2: timer setInterval in plantedPoll, owner 12: outside its owner's module/],
  ["a game event handler outside its owner",
    { "runtime/characters/planted-ear.ts": "export function plantedEar(game: { on(e: string, f: () => void): void }): void {\n  game.on(\"plantedcue\", () => {});\n}\n" },
    /planted-ear\.ts:2: handler game\.on\(plantedcue\) in plantedEar, owner 13: outside its owner's module/],
  ["a socket listener outside its owner",
    { "characters/shared.js": (text) => text + "\nfunction plantedListener() {\n  parent.socket.on(\"plantedcue\", function () {});\n}\n" },
    /characters\/shared\.js:\d+: handler parent\.socket\.on\(plantedcue\) in plantedListener, owner 13: outside its owner's module/],
  ["an add-on loop with no stand-in row",
    { "runtime/addons/planted/index.ts": "export function plantedAddon(run: () => void): void {\n  setTimeout(run, 50);\n}\n" },
    /runtime\/addons\/planted\/index\.ts:2: timer setTimeout in plantedAddon, owner 12: an add-on acts only through hooks/],
  ["a stand-in marker no listed row has",
    { "runtime/combat/planted-marker.ts": "export function plantedMarker(): void {\n  // Stand-in S99: not listed.\n  use_skill(\"town\");\n}\n" },
    /planted-marker\.ts:3: game-call use_skill\("town"\) in plantedMarker, owner 02, names S99, which no listed row has/],
  ["an import of another owner's own code",
    { "runtime/tasks/planted-owner.ts": "import { movementRanks } from \"../navigation/movement-rules.ts\";\nimport { crossingsPlanted } from \"../movement/character/crossings.ts\";\nexport const planted = [movementRanks, crossingsPlanted];\n" },
    /runtime\/tasks\/planted-owner\.ts:2: owner 01 imports runtime\/movement\/character\/crossings\.ts, owner 02's own code/],
  ["character code that imports movement's coordinator door",
    { "runtime/tasks/character/planted-door.ts": "import { canStand } from \"../../movement/api/coordinator.ts\";\nexport const planted = canStand;\n" },
    /runtime\/tasks\/character\/planted-door\.ts:1: character code imports runtime\/movement\/api\/coordinator\.ts/],
  ["shared.js's smart_move and stop no longer bound to the movement owner",
    { "characters/shared.js": (text) => text.replace("smart_move = bankOps.bankSortMove, stop = movement.stop", "smart_move = bankOps.bankSortMove, stop = parent.stop") },
    /smart_move and stop are no longer bound to the movement owner/],
];
for (const [name, edits, expected] of fixtures) {
  test(`fixture: ${name}`, () => {
    const findings = ownerFindings(run(plant(edits)));
    assert.ok(findings.some((f) => expected.test(f)), findings.join("\n"));
    // Losing the binding makes every shared.js smart_move and stop a finding too; every other
    // fixture plants exactly one.
    if (!/no longer bound/.test(name)) assert.equal(findings.length, 1, findings.join("\n"));
  });
}

// A held block declares one setting and one record, and the tree declares neither, so every
// finding is the planted one.
const plantedHeld = "export const plantedHeld = {\n  name: 'held:planted',\n  settings: {\n    plantedChoice: { label: 'Planted', kind: 'value', default: { on: true }, check: (value: unknown) => typeof value === 'object' },\n  },\n  records: {\n    plantedRecord: { default: 0 },\n  },\n};\n";
const writeFinding = (file, what, fn = "plantedSetting") => `${file}:2: setting-write ${what} in ${fn}, owner 11: a direct write to a declared setting outside the settings writer, and no stand-in row lists it`;
test("a direct write to a declared setting fails outside the settings module", () => {
  const write = "export function plantedSetting(state: { plantedChoice: unknown }): void {\n  state.plantedChoice = { on: false };\n}\n";
  const findings = run(plant({
    "runtime/settings/held/planted.ts": plantedHeld,
    "runtime/coordinator/merchant/planted-setting.ts": write,
    "runtime/settings/coordinator/planted-load.ts": write,
  }));
  assert.deepEqual(findings, [writeFinding("runtime/coordinator/merchant/planted-setting.ts", "state.plantedChoice")]);
});

// A request's draft (runtime/settings/api.ts `settingsDraft`) reaches the writer in one batch, so
// a write through its view, passed on to a helper, is no finding either.
test("a record write and a write through a request's draft pass", () => {
  const findings = run(plant({
    "runtime/settings/held/planted.ts": plantedHeld,
    "runtime/coordinator/merchant/planted-record.ts": "import { settingsDraft } from \"../../hooks/registry.ts\";\n" +
      "export function plantedRecordWrite(state: { plantedRecord: number }): void {\n  state.plantedRecord = 1;\n}\n" +
      "function plantedClear(state: { plantedChoice: unknown }): void {\n  state.plantedChoice = null;\n}\n" +
      "export function plantedRoute(state: object): void {\n  const draft = settingsDraft(state), view = draft.view<{ plantedChoice: unknown }>([\"plantedChoice\"]);\n  plantedClear(view);\n}\n",
  }));
  assert.deepEqual(findings, []);
});

// Each form plants one write into a declared setting outside the settings module, and each is one
// finding that names its form.
const writeForms = [
  ["an element write", "state.plantedChoice[key] = true;", "writes an element"],
  ["an element write with ||=", "state.plantedChoice[key] ||= true;", "writes an element"],
  ["an element write with ??=", "state.plantedChoice.on ??= true;", "writes an element"],
  ["a delete of an entry", "delete state.plantedChoice[key];", "deletes an entry"],
  ["Object.assign into the setting", "Object.assign(state.plantedChoice, { on: false });", "Object.assign into it"],
  ["a mutating call on the setting", "party.plantedChoice.list.push(key);", "calls push"],
];
for (const [name, write, form] of writeForms) {
  test(`${name} fails outside the settings module`, () => {
    const file = "runtime/coordinator/merchant/planted-form.ts", base = write.match(/(state|party)\./)[1];
    const findings = run(plant({ "runtime/settings/held/planted.ts": plantedHeld, [file]: `export function plantedForm(${base}: any, key: string): void {\n  ${write}\n}\n` }));
    assert.deepEqual(findings, [writeFinding(file, `${base}.plantedChoice (${form})`, "plantedForm")]);
  });
}

test("reads and copies of a setting pass", () => {
  const findings = run(plant({
    "runtime/settings/held/planted.ts": plantedHeld,
    "runtime/coordinator/merchant/planted-read.ts": "export function plantedRead(state: any, key: string): unknown {\n" +
      "  const on = state.plantedChoice[key] === true || state.plantedChoice.on !== false;\n" +
      "  return [on, state.plantedChoice.list.slice().sort(), Object.assign({}, state.plantedChoice), { ...state.plantedChoice }];\n}\n",
  }));
  assert.deepEqual(findings, []);
});

// A stand-in marker passes a setting write only under a listed row whose text names the file.
const migration = "runtime/coordinator/merchant/planted-migration.ts";
const migrationListed = listedWith((d) => { d.standIns.S90 = `the planted load migration (${migration})`; return d; });
const marked = (row) => ({ "runtime/settings/held/planted.ts": plantedHeld,
  [migration]: `export function plantedMigration(state: any): void {\n  // Stand-in ${row}\n  state.plantedChoice = { on: false };\n}\n` });
test("a setting write passes under a stand-in row that names its file", () => {
  assert.deepEqual(run(plant(marked("S90")), migrationListed), []);
});
test("a setting write under a stand-in row that names another file fails", () => {
  assert.deepEqual(run(plant(marked("S74")), migrationListed),
    [`${migration}:3: setting-write state.plantedChoice in plantedMigration, owner 11, names S74, whose listed row does not name this file`]);
});

// The settings owner builds its table from each owner's `saved-fields.ts`. It is one module,
// runtime/settings/, and every other owner imports only its public file, api.ts, where the check
// building blocks sit. Any other import across owners stays a finding.
test("the settings owner imports an owner's saved fields and nothing else of its", () => {
  const tree = plant({
    "runtime/settings/checks.ts": "export const whole = (value: unknown) => Number.isSafeInteger(value);\n",
    "runtime/settings/api.ts": "export const object = (value: unknown) => !!value && typeof value === 'object';\n",
    "runtime/tasks/coordinator/saved-fields.ts": "import { type Setting } from \"../../settings/api.ts\";\nexport const planted = { name: \"core:tasks\", settings: { n: { kind: \"number\", default: 1 } satisfies Partial<Setting> } };\n",
    "runtime/tasks/coordinator/planted-hold.ts": "export const plantedHold = 1;\n",
    "runtime/settings/coordinator/planted-declarers.ts": "import { planted } from \"../../tasks/coordinator/saved-fields.ts\";\nimport { plantedHold } from \"../../tasks/coordinator/planted-hold.ts\";\nexport const declarers = [planted, plantedHold];\n",
    "runtime/navigation/planted-reader.ts": "import { planted } from \"../tasks/coordinator/saved-fields.ts\";\nexport const read = planted;\n",
    "runtime/navigation/planted-checks.ts": "import { whole } from \"../settings/checks.ts\";\nimport { object } from \"../settings/api.ts\";\nexport const check = whole || object;\n",
  });
  assert.deepEqual(run(tree), [
    "runtime/settings/coordinator/planted-declarers.ts:2: owner 11 imports runtime/tasks/coordinator/planted-hold.ts, owner 01's own code, outside a hook or protocol module",
    "runtime/navigation/planted-reader.ts:1: owner 02 imports runtime/tasks/coordinator/saved-fields.ts, owner 01's own code, outside a hook or protocol module",
    "runtime/navigation/planted-checks.ts:1: owner 02 imports runtime/settings/checks.ts, owner 11's own code, outside a hook or protocol module",
  ]);
});

// The coordinator's composition root is the lifecycle owner's, so crossOwnerImports reads it. It
// composes an owner from its coordinator door; an import of the owner's own file fails.
test("application.ts imports an owner's door and none of its own files", () => {
  const tree = plant({
    "runtime/lifecycle/api.ts": "export const lifecycle = 1;\n",
    "runtime/items/coordinator/planted.ts": "export const planted = 1;\n",
    "runtime/items/coordinator/api.ts": "export { planted } from \"./planted.ts\";\n",
    "runtime/coordinator/application.ts": "import { planted } from \"../items/coordinator/planted.ts\";\nimport { planted as door } from \"../items/coordinator/api.ts\";\nexport const both = [planted, door];\n",
  });
  assert.deepEqual(run(tree).filter((f) => f.startsWith("runtime/coordinator/application.ts")), [
    "runtime/coordinator/application.ts:1: owner 13 imports runtime/items/coordinator/planted.ts, owner 10's own code, outside a hook or protocol module",
  ]);
});

// A runtime file no owner holds is read like an owner's file, so its import of an owner's own code
// fails and its import of the owner's door passes.
test("a file no owner holds imports an owner's door and none of its own files", () => {
  const tree = plant({
    "runtime/characters/turns/role-types.ts": "export type Target = unknown;\n",
    "runtime/items/coordinator/planted.ts": "export interface Planted { a: number }\n",
    "runtime/items/coordinator/api.ts": "export type { Planted } from \"./planted.ts\";\n",
    "runtime/coordinator/contracts/planted.ts": "import type { Planted } from \"../../items/coordinator/planted.ts\";\nimport type { Planted as Door } from \"../../items/coordinator/api.ts\";\nexport type Both = [Planted, Door];\n",
  });
  assert.deepEqual(run(tree).filter((f) => f.startsWith("runtime/coordinator/contracts/planted.ts")), [
    "runtime/coordinator/contracts/planted.ts:1: a file no owner holds imports runtime/items/coordinator/planted.ts, owner 10's own code; it moves into an owner or reads the door",
  ]);
});

// Every tools/ host program is read, so a tools/update timer is a row and a tools/dashboard import
// of the lifecycle owner's build store fails.
test("a tools/update timer is a row, and a tools/dashboard import of tools/build-store.ts fails", () => {
  const tree = plant({
    "runtime/lifecycle/api.ts": "export const lifecycle = 1;\n",
    "runtime/status/api.ts": "export const status = 1;\n",
    "tools/hosting/api.ts": "export { readJson } from \"../build-store.ts\";\n",
    "tools/build-store.ts": "export const readJson = 1;\n",
    "tools/dashboard/planted.ts": "import { readJson } from \"../build-store.ts\";\nexport const read = readJson;\n",
    "tools/update/planted.ts": "export function plantedCheck(ms) {\n  setInterval(() => undefined, ms);\n}\n",
  });
  assert.deepEqual(scanTree(tree).filter((r) => r.file === "tools/update/planted.ts").map((r) => [r.kind, r.line]), [["timer", 2]]);
  assert.deepEqual(run(tree).filter((f) => f.startsWith("tools/dashboard/planted.ts")), [
    "tools/dashboard/planted.ts:1: owner 12 imports tools/build-store.ts, owner 13's own code, outside a hook or protocol module",
  ]);
});

// An emit wrapper or a cost listener passes only in the call budget owner's module, and a game call
// passes only when its function asks `calls.band` before it, or under the stand-in row of its
// owner, up to that row's count. These fixtures carry their own listed rows and plant a tree of
// their own files; `mapped` puts the tree's rows in the map, so only the admission rule judges them.
const budgetListed = listedRows({
  standIns: { S67: "owner 03's game call and emit rows that do not ask calls.band" },
  placement: { "03": { count: 5, kinds: ["game-call", "socket-emit", "timer", "handler"] }, "09 call budget": { count: 3, kinds: ["emit-wrapper", "handler"] } },
  asks: [{ row: "S67", owners: ["03"], count: 1 }],
});
const budgetRun = (files, mapped = false) => {
  const sources = new Map(Object.entries(files));
  return check({ sources, map: mapped ? scanTree(sources) : [], listed: budgetListed }).findings;
};
const wrap = (fn) => `export function ${fn}(socket: { emit: unknown }, next: unknown): void {\n  socket.emit = next;\n}\n`;
const ear = (fn) => `export function ${fn}(socket: { on(e: string, f: (d: unknown) => void): void }): void {\n  socket.on("player", () => {});\n}\n`;
const call = "  send_party_invite(name);\n", ask = "  if (partyHooks().calls.band({ band: 'job', method: 'party', data: { event: 'invite', name } }) !== 'send') return;\n";
const party = (body) => ({ "runtime/tasks/character/planted-party.ts": `export function plantedInvite(name: string): void {\n${body}}\n` });
const swing = (n) => ({ "runtime/combat/planted-swing.ts": `export function plantedSwing(target: unknown): void {\n${"  attack(target);\n".repeat(n)}}\n` });
const budgetRows = [
  ["a game call that does not ask calls.band fails",
    party(call),
    ["runtime/tasks/character/planted-party.ts:2: game-call send_party_invite in plantedInvite, owner 01: it does not ask calls.band before the call, and no stand-in row lists owner 01"], true],
  ["a game call passes when its function asks calls.band before it", party(ask + call), [], true],
  ["a question after the call does not admit it", party(call + ask), [/does not ask calls\.band before the call/], true],
  ["a game call passes when its function waits on the band wait", party("  await partyHooks().calls.wait({ band: 'job', method: 'party' }, act);\n" + call), [], true],
  ["a game call that does not ask passes under its owner's stand-in row", swing(1), [], true],
  ["more such calls than the stand-in row's count fail", swing(2), ["S67: 2 rows of owner 03 that do not ask calls.band pass, but the listed rows allow 1"], true],
  ["an emit wrapper outside the call budget's module fails",
    { "runtime/characters/planted-wrap.ts": wrap("plantedWrap") },
    [/^runtime\/characters\/planted-wrap\.ts:2: emit-wrapper socket\.emit in plantedWrap, owner 09: a row the ownership map does not have$/]],
  ["an emit wrapper and a cost listener in the call budget's module pass",
    { "runtime/characters/call-budget-planted.ts": wrap("plantedWrap") + ear("plantedCost") }, []],
  ["the settings owner's import of a call budget file fails as any owner's does",
    { "runtime/characters/call-budget-fields.ts": "export const plantedFields = { name: 'core:calls', settings: {} };\n",
      "runtime/settings/coordinator/planted-declarations.ts": "import { plantedFields } from '../../characters/call-budget-fields.ts';\nexport const planted = [plantedFields];\n" },
    ["runtime/settings/coordinator/planted-declarations.ts:1: owner 11 imports runtime/characters/call-budget-fields.ts, owner 09's own code, outside a hook or protocol module"]],
];
for (const [name, files, expected, mapped = false] of budgetRows) {
  test(`call budget: ${name}`, () => {
    const findings = budgetRun(files, mapped);
    assert.equal(findings.length, expected.length, findings.join("\n"));
    expected.forEach((line, i) => typeof line === "string" ? assert.equal(findings[i], line) : assert.match(findings[i], line));
  });
}

// Targeting reads the events, hunting and lifecycle owners' facts only through its ports and view.
test("a direct read of a port fact in targeting's code fails", () => {
  const sources = new Map(Object.entries({
    "runtime/characters/targeting/planted-gate.ts": "export const plantedGate = (): boolean => !!sharedRoutine.frankyCombatActive?.();\n",
    "runtime/characters/targeting/stand-ins.ts": "export const read = (facts: { frankyCombatActive(): boolean }) => facts.frankyCombatActive();\n",
    // The pass's view reads the facts once (view.ts's lists, an array of names or an object's keys),
    // and the rows read the view. A declared name read on another line of view.ts is a read.
    "runtime/characters/targeting/view.ts": "export const PORT_FACTS = ['frankyCombatActive', 'rareActive'] as const;\n" +
      "export const EVENT_FACTS = {\n  frankyCombatActive: (f: any) => f.frankyActive(),\n} as const;\n" +
      "export const late = () => sharedRoutine.frankyCombatActive?.();\n",
    "runtime/characters/targeting/planted-row.ts": "export const row = (t: any, v: any) => t.view().frankyCombatActive || v.rareActive;\n",
  }));
  const said = "a fact targeting reads only through its ports or its view";
  assert.deepEqual(scopeFactReads(sources), [
    `runtime/characters/targeting/planted-gate.ts:1: reads frankyCombatActive, ${said}`,
    `runtime/characters/targeting/view.ts:5: reads frankyCombatActive, ${said}`,
  ]);
});
test("the tree reads no port fact outside targeting's ports and view", () => {
  assert.deepEqual(scopeFactReads(head), []);
});

// The add-on rules. A planted add-on beside the two published modules; the stand-in rows admit one
// use each, by key.
const plantedAddon = (files) => new Map(Object.entries({
  "runtime/hooks/addon-api.ts": "export const delivered = (name: string): unknown => name;\n",
  "runtime/movement/geometry/step-safety.ts": "export const inBlock = () => false;\nexport const entersBlock = () => false;\n",
  "runtime/addons/planted/README.md": "# planted\n",
  ...files,
}));
const standInOf = (cell) => new Map([["S1", cell]]);
test("an add-on's internal import fails; a listed use passes, and a second use from the same file still fails", () => {
  const sources = plantedAddon({
    "runtime/addons/planted/index.ts": "import { delivered, type MoverView } from '../../hooks/addon-api.ts';\n" +
      "import { inBlock, type entersBlock } from '../../navigation/step-safety.ts';\nimport { own } from './own.ts';\nimport { useState } from 'react';\n",
    "runtime/addons/planted/own.ts": "export const own = 1;\n",
  });
  const said = (findings) => findings.map((f) => f.replace(/:.*imports (\S+) from (\S+);.*/, " $1 $2"));
  assert.deepEqual(said(addonFindings(sources, new Map())), ["runtime/addons/planted/index.ts inBlock ../../navigation/step-safety.ts",
    "runtime/addons/planted/index.ts entersBlock ../../navigation/step-safety.ts", "runtime/addons/planted/index.ts useState react"]);
  assert.deepEqual(said(addonFindings(sources, standInOf("runtime/addons/planted/index.ts#inBlock; runtime/addons/planted/index.ts#useState"))),
    ["runtime/addons/planted/index.ts entersBlock ../../navigation/step-safety.ts"], "the type-only import of the admitted file still fails");
});
test("an add-on that reads a global fails; listed as a stand-in row it passes", () => {
  const sources = plantedAddon({
    "runtime/addons/planted/index.ts": "export const read = (character: { name: string }) => character.name + (globalThis as { x?: number }).x;\n" +
      "const game = globalThis as unknown as { parent: { entities: object } };\nexport const seen = () => [game.parent.entities, parent.party_list, G.maps];\n",
  });
  const keys = (findings) => findings.map((f) => f.match(/no stand-in row lists (\S+)$/)[1]);
  assert.deepEqual(keys(addonFindings(sources, new Map())), ["runtime/addons/planted/index.ts#globalThis.x",
    "runtime/addons/planted/index.ts#globalThis.parent.entities", "runtime/addons/planted/index.ts#parent.party_list", "runtime/addons/planted/index.ts#G.maps"]);
  assert.deepEqual(keys(addonFindings(sources, standInOf("runtime/addons/planted/index.ts#globalThis.x, runtime/addons/planted/index.ts#parent.party_list, " +
    "runtime/addons/planted/index.ts#G.maps"))), ["runtime/addons/planted/index.ts#globalThis.parent.entities"]);
  // A local `character` binds only in its own scope, so a read of the global elsewhere in the file still fails.
  const scoped = plantedAddon({ "runtime/addons/planted/index.ts":
    "export const names = (rows: [string, number][]) => rows.map(([character]) => character);\nexport const own = () => character.name;\n" });
  assert.deepEqual(keys(addonFindings(scoped, new Map())), ["runtime/addons/planted/index.ts#character.name"]);
});
test("a runtime or dashboard file that imports an add-on's test fails, and the generated runtime module lists no test", async () => {
  const sources = plantedAddon({
    "runtime/addons/planted/tests/rows.ts": "export const rows = {};\n",
    "runtime/addons/planted/index.ts": "export const registration = {};\n",
    "runtime/coordinator/planted.ts": "import { rows } from '../addons/planted/tests/rows.ts';\n",
    "dashboard/features/party/planted.tsx": "import { rows } from '../../../runtime/addons/planted/tests/rows.ts';\n",
  });
  assert.deepEqual(testImports(sources), ["runtime/coordinator/planted.ts:1: imports the test file runtime/addons/planted/tests/rows.ts; no bundle holds a test",
    "dashboard/features/party/planted.tsx:1: imports the test file runtime/addons/planted/tests/rows.ts; no bundle holds a test"]);
  const { installedModules } = await import("../runtime/hooks/build/installed.mts");
  const modules = installedModules([{ folder: "planted", dashboard: false, rows: true }]);
  assert.doesNotMatch(modules["runtime.ts"] + modules["dashboard.ts"], /tests\//);
  assert.match(modules["tests.ts"], /runtime\/addons\/planted\/tests\/rows\.ts/);
});
test("a section's JSX pragma must reach the dashboard's JSX runtime from its own file", () => {
  const sources = plantedAddon({
    "runtime/addons/planted/index.ts": "export const registration = {};\n",
    "runtime/addons/planted/dashboard.tsx": "/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */\nexport const a = <b />;\n",
    "runtime/addons/planted/parts/list.tsx": "/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */\nexport const c = <d />;\n",
    "runtime/addons/planted/parts/row.tsx": "/** @jsxImportSource ../../../../dashboard/features/party/addon-jsx */\nexport const e = <f />;\n",
    "runtime/addons/planted/bare.tsx": "export const g = <h />;\n",
  });
  assert.deepEqual(addonFindings(sources, new Map()).map((f) => f.split(":")[0]), ["runtime/addons/planted/parts/list.tsx", "runtime/addons/planted/bare.tsx"]);
});

test("the keyword row for the lifecycle owner holds only in a tree without its door", () => {
  const owner = (unplaced) => scanFile("runtime/hunting/planted.ts", "export function plantedReload() {\n  setTimeout(go, 1);\n}\n", unplaced)[0].owner;
  assert.equal(owner(new Set()), "07", "a row passed as the lifecycle owner's by its function name");
  assert.equal(owner(new Set(["runtime/lifecycle/api.ts"])), "13", "a tree without the lifecycle door lost its keyword rule");
});

// A write to the merchant's realm request outside the realm owner fails, in each form the rule
// reads; the realm owner's own write and a read elsewhere pass.
test("a write to merchantRealmRequests outside runtime/merchant-realm/ fails", () => {
  assert.deepEqual(realmWrites(head), []);
  const planted = new Map(head);
  planted.set("runtime/coordinator/merchant-jobs-planted.ts", [
    "export function planted(state, party, merchant) {",
    "  state.merchantRealmRequests[merchant] = { realm: 'SR_EUI' };",
    "  delete party.merchantRealmRequests[merchant];",
    "  (state.merchantRealmRequests ||= {});",
    "  const read = state.merchantRealmRequests?.[merchant];",
    "}",
  ].join("\n"));
  planted.set("runtime/merchant-realm/coordinator/planted.ts", "export const own = (state) => { state.merchantRealmRequests = {}; };");
  const findings = realmWrites(planted);
  assert.deepEqual(findings.map((f) => f.split(": ")[0]), ["runtime/coordinator/merchant-jobs-planted.ts:2", "runtime/coordinator/merchant-jobs-planted.ts:3", "runtime/coordinator/merchant-jobs-planted.ts:4"]);
  assert.ok(findings.every((f) => /realm-write .*in planted: only the realm owner/.test(f)), findings.join("\n"));
});

// The loops rule: a bare timer, sleep, microtask or game socket listener on the character or the
// coordinator fails; one through a scope handle, a type member, and the lifecycle owner's own
// character files pass.
test("a timer, sleep or socket listener outside a run scope handle is a finding", () => {
  const planted = new Map([
    ["runtime/lifecycle/character/run.ts", "const handle = setTimeout(fire, ms);"],
    ["runtime/hunting/character/planted.ts", ["const t = setInterval(tick, 100);", "await sleep(250);", "socket.on('drop', dropped);",
      "act.setInterval(tick, 100);", "await ports.scope.sleep(250);", "observe.on(socket, 'drop', dropped);", "  setTimeout(callback: () => void, ms: number): number;"].join("\n")],
    ["runtime/coordinator/planted.ts", ["setTimeout(retry, 1000);", "setImmediate(resolve);", "scopes.act13.setTimeout(retry, 1000);"].join("\n")],
    ["runtime/lifecycle/coordinator/planted.ts", "const restore = setTimeout(restoreSlots, delay);"],
    ["runtime/status/coordinator/planted.ts", "const yieldTurn = () => scopes.observe12.setImmediate(resolve);"],
  ]);
  assert.deepEqual(unscopedLoops(planted).map((f) => f.split(": ")[0]), ["runtime/hunting/character/planted.ts:1", "runtime/hunting/character/planted.ts:2",
    "runtime/hunting/character/planted.ts:3", "runtime/coordinator/planted.ts:1", "runtime/coordinator/planted.ts:2", "runtime/lifecycle/coordinator/planted.ts:1"]);
});
