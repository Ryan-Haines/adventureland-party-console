// The supervisor's manual check of its mode switch, run by hand: start the supervisor on 3020 with
// no gateway (node tools/dashboard/supervisor.mts --port=3020), then node tools/dashboard/smoke-test.mts.
// It edits dashboard/app/page.tsx to fail one build and restores it.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const origin = "http://127.0.0.1:3020";
type State = { mode: string; busy: boolean; error: string | null };
async function state(): Promise<State> {
  return (await (await fetch(`${origin}/__dashboard/state`)).json()) as State;
}
async function requestMode(mode: string): Promise<void> {
  const response = await fetch(`${origin}/__dashboard/mode`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  assert.equal(response.status, 202);
}
async function settled(): Promise<State> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const result = await state();
    if (!result.busy) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Supervisor operation timed out");
}
async function healthy(): Promise<void> {
  const response = await fetch(origin, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  await response.body?.cancel();
}

await requestMode("production");
await healthy(); // Current development server remains available during compilation.
assert.equal((await settled()).mode, "production");
await healthy();
const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dashboard/app/page.tsx",
);
const original = await readFile(sourcePath, "utf8");
const invalid = `${original}\nconst __intentional_build_failure = ;\n`;
try {
  await writeFile(sourcePath, invalid);
  await requestMode("production");
  await healthy();
  const failed = await settled();
  assert.equal(failed.mode, "production");
  assert.ok(failed.error, "The supervisor's state (/__dashboard/state) must carry the failed build's error");
  await healthy();
} finally {
  assert.equal(
    await readFile(sourcePath, "utf8"),
    invalid,
    "Source changed externally; refusing to overwrite it",
  );
  await writeFile(sourcePath, original);
}
await requestMode("development");
assert.equal((await settled()).mode, "development");
await healthy();
console.log("PASS: mode switching, failed-build continuity, and development recovery.");
