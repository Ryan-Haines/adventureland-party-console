// The copy check's own rows for the rules whose tree reads need no owner-check run.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { nestedRecordWrites } from "./copy-check.mjs";
import { readTree } from "./owner-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Inside a part (tasks row 5): v1.5.0 wrote the Hunt cycle's fields in hunt.ts and
// the Cave visit's in cave.ts directly; the tree after the row writes them only through record.ts,
// and a write planted in hunt.ts fails again.
test("a Hunt cycle or Cave visit field written outside record.ts fails the copy check", () => {
  const before = nestedRecordWrites(readTree(root, "bf7dd8b30"));
  for (const file of ["hunt.ts", "cave.ts"])
    assert.ok(before.some((finding) => finding.startsWith(`runtime/hunting/coordinator/${file}:`)), `bf7dd8b30's ${file} writes are found`);
  const tree = readTree(root);
  assert.deepEqual(nestedRecordWrites(tree), []);
  const file = "runtime/hunting/coordinator/hunt.ts", text = tree.get(file);
  const planted = text.replace("function dropWalk(hunt: HuntCycle): void {", "function dropWalk(hunt: HuntCycle): void {\n    hunt.target = null;");
  assert.notEqual(planted, text);
  // A checkout with core.autocrlf ends each line in CRLF, so the split reads both endings.
  const line = planted.split(/\r?\n/).indexOf("    hunt.target = null;") + 1;
  assert.deepEqual(nestedRecordWrites(new Map([...tree, [file, planted]])), [`${file}:${line}: a Hunt cycle or Cave visit field written outside record.ts (copy check, HN2)`]);
});

// L3.3 by expression: a time on the line after its setTimeout and a clock sum with no timer word
// on its line both fail; LIFECYCLE_RULES' line rule passed both. v1.5.0's roster
// cutoff (`now() - 15000`) is found there and gone today.
test("L3.3: a wait's time literal fails read as one expression, across lines and beside a clock read", async () => {
  const { waitLiterals } = await import("./copy-check.mjs");
  const file = "runtime/lifecycle/planted.ts";
  const planted = ["export function wait(done: () => void, now: () => number) {", "  setTimeout(done,", "    500);",
    "  return now() - 750;", "}"].join("\n");
  assert.deepEqual(waitLiterals([[file, planted]]), [3, 4].map((line) => `${file}:${line}: a time literal in a wait outside fields.ts (copy check, L3.3)`));
  assert.deepEqual(waitLiterals([["runtime/lifecycle/fields.ts", planted]]), []);
  const roster = "runtime/lifecycle/roster/roster-projection.ts";
  assert.ok(waitLiterals(readTree(root, "bf7dd8b30")).some((finding) => finding.startsWith(`${roster}:`)));
  assert.deepEqual(waitLiterals(readTree(root)).filter((finding) => finding.startsWith(`${roster}:`)), []);
});

// U1: the source rules that were unit tests. Each planted tree breaks one rule; the working tree's
// pass is owner:check's.
test("U1: an unread hidden setting, a literal Pause log or cache size, a second dashboard id, a dashboard write and a table R state read fail", async () => {
  const { hiddenReaders, dashboardWrites, statusSections, LIFECYCLE_RULES } = await import("./copy-check.mjs");
  const lifecycle = (line, file) => LIFECYCLE_RULES.filter((rule) => rule.step === "U1" && rule.test(line, file)).length;
  assert.equal(lifecycle("if (lines.length > 20) lines.shift();", "runtime/lifecycle/coordinator/control.ts"), 1);
  assert.equal(lifecycle("const kept = 32;", "runtime/lifecycle/coordinator/code.ts"), 1);
  assert.equal(lifecycle("if (lines.length > MOVEMENT_RING_SIZE) lines.shift();", "runtime/lifecycle/coordinator/control.ts"), 0);
  const fields = "runtime/lifecycle/fields.ts";
  const declared = `export const f = { settings: {\n  waitMs: { label: 'Wait', kind: 'number', default: 500, hidden: true },\n} };`;
  assert.deepEqual(hiddenReaders(new Map([[fields, declared]])), [`${fields}:2: the hidden setting waitMs has no reader (copy check, U1)`]);
  assert.deepEqual(hiddenReaders(new Map([[fields, declared], ["runtime/lifecycle/coordinator/run.ts", "sleep(fields.waitMs.default);"]])), []);
  const card = "dashboard/features/party/card.tsx";
  assert.deepEqual(dashboardWrites(new Map([[card, "const id = crypto.randomUUID();\nawait fetch('/party-api/a', { method: 'POST', body });\nawait fetch('/party-api/b');"]])),
    [`${card}:1: an id outside dashboard/lib/request-id.ts (randomUUID) came back (copy check, DF43)`, `${card}:2: a dashboard write outside the action client (copy check, DF3)`]);
  assert.deepEqual(dashboardWrites(new Map([["dashboard/lib/request-id.ts", "crypto.randomUUID?.()"], [card, "await fetch(url, { method: 'GET' });"]])), []);
  const reply = "runtime/status/coordinator/reply.ts";
  assert.deepEqual(statusSections(new Map([[reply, "x\n  const sections: Sections = {\n    leader: () => state.leader,\n  };"]])),
    [`${reply}:2: a table R section reads state.leader itself (copy check, D9)`]);
  assert.deepEqual(statusSections(new Map([[reply, "x\n  const sections: Sections = {\n    leader: () => tasks.leader(state),\n  };"]])), []);
});
