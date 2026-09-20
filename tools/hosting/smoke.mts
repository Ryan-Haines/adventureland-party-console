import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const image = process.argv[2] || "adventure-land:headless-test";
const name = "party-smoke-" + randomUUID();
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function until<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Container readiness timed out");
}
try {
  docker("run", "-d", "--name", name, "-p", "127.0.0.1::3010", image);
  const port = docker("port", name, "3010").split(":").at(-1);
  let origin = "http://127.0.0.1:" + port;
  await until(async () => {
    assert.equal((await fetch(origin + "/health")).status, 200);
  });
  const post = (route: string, input: unknown, cookie = "") => fetch(origin + "/setup/" + route, {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const state = await fetch(origin + "/setup/state");
  assert.deepEqual(await state.json(), { configured: false, requirePairing: false, canConfigureAccount: true });
  assert.equal((await fetch(origin + "/setup")).status, 200);
  const direct = await (await post("steam", { origin })).json() as { code: string };
  assert.equal(direct.code, `$.getScript("${origin}/CODE/adventure_land/universal-loader.js");`);
  const paired = await post("pairing", { requirePairing: true });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(origin + "/setup/state")).status, 401);
  assert.equal((await post("pairing", { requirePairing: false })).status, 401);
  const privateLoader = await (await post("steam", { origin }, cookie)).json() as { code: string };
  assert.ok(privateLoader.code.includes("/bridge/"));
  await until(async () => {
    const status = docker(
      "exec",
      name,
      "node",
      "-e",
      "fetch('http://127.0.0.1:3030/__dashboard/state').then(r=>r.json()).then(s=>{if(!s.ready)process.exit(1);console.log('ready')})",
    );
    assert.equal(status, "ready");
  });
  const page = docker(
    "exec",
    name,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3030/').then(async r=>{if(!r.ok)process.exit(1);console.log((await r.text()).includes('<html')?'html':'invalid')})",
  );
  assert.equal(page, "html");
  docker("restart", name);
  origin = "http://127.0.0.1:" + docker("port", name, "3010").split(":").at(-1);
  await until(async () => {
    assert.equal(
      (await fetch(origin + "/setup/state", { headers: { Cookie: cookie } })).status,
      200,
    );
  });
  const persisted = await (await fetch(origin + "/setup/state", { headers: { Cookie: cookie } })).json() as { requirePairing: boolean };
  assert.equal(persisted.requirePairing, true);
  assert.equal((await post("pairing", { requirePairing: false }, cookie)).status, 200);
  assert.equal((await post("revoke", {})).status, 200);
  const bridge = privateLoader.code.match(/bridge\/([a-f0-9]{64})/)![1];
  assert.equal((await fetch(origin + "/bridge/" + bridge + "/party-api/state")).status, 401);
  docker("restart", name);
  origin = "http://127.0.0.1:" + docker("port", name, "3010").split(":").at(-1);
  await until(async () => {
    const state = await (await fetch(origin + "/setup/state")).json() as { requirePairing: boolean };
    assert.equal(state.requirePairing, false);
  });
  console.log(`${image}: setup, production dashboard, both pairing modes, revocation, and restart persistence passed (no game account used).`);
} finally {
  docker("rm", "-f", "-v", name);
}
