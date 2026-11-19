import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { redirectInternal, fromGateway, dashboardReadyMessage, DASHBOARD_PORT } from './gateway-access.ts';
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { fingerprint } from "./fingerprint.ts";
import { completed, launch, stop, waitForHealthy } from "./process.ts";
import { readJson, withBuildLock } from '../hosting/api.ts';
import { dashboardHistory, rememberDashboard, releasePath, cleanDashboard, pinDashboard } from './history.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");
const vinext = path.join(root, "node_modules/vinext/dist/cli.js");
const publicPort =
  Number(
    process.argv.find((argument) => argument.startsWith("--port="))?.split("=")[1] ||
      process.env.AL_DASHBOARD_PUBLIC_PORT,
  ) || DASHBOARD_PORT;
const stateFile = path.join(
  root,
  process.env.AL_DASHBOARD_MODE_FILE || (publicPort === DASHBOARD_PORT ? ".build/mode.json" : `.build/mode-${publicPort}.json`),
);
const localOrigins = [`http://localhost:${publicPort}`, `http://127.0.0.1:${publicPort}`];
type Mode = "development" | "production";
type Running = { mode: Mode; port: number; process: ChildProcess; generation?: string; id: string };
let active: Running | undefined;
let previous: Running | undefined;
let pending: ChildProcess | undefined;
let busy = false;
let failure: string | null = null;
let nextPort = publicPort + 1;
let rollbackSelection: string | undefined;
async function pin(extra?: string) {
  if (process.env.AL_DASHBOARD_PREBUILT) return;
  await pinDashboard(root, publicPort, [active?.generation, previous?.generation, extra].filter((id): id is string => !!id));
}

async function cleanup(apply: boolean) {
  return withBuildLock(path.join(root, '.build'), () => cleanDashboard(root,
    [active?.generation, previous?.generation].filter((id): id is string => !!id), apply));
}

async function productionBuild(): Promise<string> {
  if (process.env.AL_DASHBOARD_PREBUILT) {
    const output = path.resolve(root, process.env.AL_DASHBOARD_PREBUILT);
    await readFile(path.join(output, "server/index.js"));
    return output;
  }
  const generation = await fingerprint(root);
  await pin(generation);
  const output = path.join(root, ".build/releases", generation);
  try {
    await readFile(path.join(output, "complete.json"));
    return output;
  } catch {
    /* Build cache miss. */
  }
  pending = launch(path.resolve(root, "../tools/dashboard/build.mts"), [], root, {
    ...process.env,
    AL_DASHBOARD_OUT_DIR: output,
  });
  await completed(pending);
  pending = undefined;
  await readFile(path.join(output, "server/index.js"));
  await writeFile(path.join(output, "complete.json"), JSON.stringify({ generation }));
  return output;
}

async function saveMode(mode: Mode): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile + ".tmp", JSON.stringify({ mode, rollback: rollbackSelection }));
  await rename(stateFile + ".tmp", stateFile);
}
async function restoreDevelopment(mode: Mode): Promise<boolean> {
  if (mode !== "development" || previous?.mode !== mode || previous.process.exitCode !== null) return false;
  const restored = previous;
  await waitForHealthy(restored.process, restored.port);
  await saveMode(mode);
  previous = active;
  active = restored;
  return true;
}
async function createCandidate(mode: Mode, selected?: string): Promise<Running | undefined> {
  if (selected) await pin(selected);
  const port = nextPort++;
  const output = mode === "production" ? selected ? await releasePath(root, selected) : await productionBuild() : undefined;
  if (output && active?.mode === mode && active.generation === path.basename(output)) return;
  const child = output
    ? launch(fileURLToPath(new URL('./node-server.mts', import.meta.url)), [String(port), output], root, { ...process.env, NODE_ENV: "production" })
    : launch(vinext, ["dev", "--hostname", "127.0.0.1", "--port", String(port)], root, { ...process.env, AL_DASHBOARD_PORT: String(port) });
  pending = child;
  return { mode, port, process: child, generation: output && path.basename(output), id: randomUUID() };
}
async function activate(candidate: Running): Promise<void> {
  const child = candidate.process;
  await waitForHealthy(child, candidate.port);
  if (candidate.generation && !process.env.AL_DASHBOARD_PREBUILT)
    await withBuildLock(path.join(root, '.build'), () => rememberDashboard(root, candidate.generation!));
  await saveMode(candidate.mode);
  const retired = previous;
  previous = active;
  active = candidate;
  child.once("exit", () => {
    if (active?.process !== child) return;
    failure = "Dashboard stopped unexpectedly";
    active = previous?.process.exitCode === null ? previous : undefined;
    previous = undefined;
    rollbackSelection = active?.generation;
    void saveMode(active?.mode || 'production').then(() => pin()).catch(error => console.error('Could not persist dashboard fallback:', error));
  });
  pending = undefined;
  // Retain one prior server for assets requested by tabs opened before switching.
  await stop(retired?.process);
  if (!process.env.AL_DASHBOARD_PREBUILT) {
    try { await pin(); await cleanup(true); }
    catch (error) { console.error('Dashboard cleanup deferred:', error); }
  }
  console.log(dashboardReadyMessage(candidate.mode, publicPort));
}
async function rejectCandidate(candidate: Running | undefined, error: unknown): Promise<void> {
  await stop(candidate?.process || pending);
  pending = undefined;
  failure = error instanceof Error ? error.message : String(error);
  await pin();
}
// One operation at a time: claim() refuses while one runs, and the routes answer that refusal 409.
class Busy extends Error {}
function claim(): void {
  if (busy) throw new Busy("A dashboard operation is in progress");
  busy = true;
}
// The claim is taken before the first await, so a route knows at once whether its change runs.
function changeMode(mode: Mode, selected?: string): Promise<void> {
  claim();
  return switchMode(mode, selected).finally(() => { busy = false; });
}
async function switchMode(mode: Mode, selected?: string): Promise<void> {
  if (active?.mode === mode && mode === "development") return;
  failure = null;
  let candidate: Running | undefined;
  const priorSelection = rollbackSelection;
  try {
    rollbackSelection = selected;
    if (await restoreDevelopment(mode)) return;
    candidate = await createCandidate(mode, selected);
    if (candidate) await activate(candidate);
    else { await saveMode(mode); await pin(); }
  } catch (error) {
    rollbackSelection = priorSelection;
    await rejectCandidate(candidate, error);
    throw error;
  }
}

// The gate of the routes that change the supervisor: a container build is immutable, a change comes
// from this dashboard's own origin, and its body is read under the route's cap. It answers the
// refusal and returns undefined, or returns the parsed body.
async function changingRequest(req: IncomingMessage, res: ServerResponse, cap: number): Promise<unknown> {
  if (process.env.AL_DASHBOARD_PREBUILT) {
    json(res, 409, { error: "Container builds are immutable. Rebuild the Docker image to update." });
    return;
  }
  if (!localOrigins.includes(req.headers.origin || "")) {
    json(res, 403, { error: "Local dashboard origin required" });
    return;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > cap) throw new Error("Request too large");
  }
  return JSON.parse(body);
}
function refused(res: ServerResponse, error: unknown): void {
  json(res, error instanceof Busy ? 409 : 400, { error: error instanceof Error ? error.message : String(error) });
}

async function handleBuilds(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      json(res, 200, await buildList()); return;
    }
    if (req.method !== 'POST') { json(res, 405, {error: 'Use GET or POST'}); return; }
    const input = await changingRequest(req, res, 1024) as BuildRequest | undefined;
    if (input) await performBuildAction(input, res);
  } catch (error) { refused(res, error); }
}
async function buildList() {
  return {active: active?.generation, previous: previous?.generation,
    pinned: rollbackSelection, builds: await dashboardHistory(root)};
}
interface BuildRequest {action: string; id?: string; apply?: boolean}
async function performBuildAction(input: BuildRequest, res: ServerResponse): Promise<void> {
    if (input.action === 'clean') {
      claim();
      try { json(res, 200, await cleanup(input.apply === true)); } finally { busy = false; }
      return;
    }
    if (input.action === 'rollback') {
      if (!(await dashboardHistory(root)).some(entry => entry.id === input.id)) throw new Error('Unknown dashboard build');
      await changeMode('production', input.id);
    } else if (input.action === 'resume') await changeMode('production');
    else throw new Error('Unknown build action');
    json(res, 200, {active: active?.generation, pinned: rollbackSelection});
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function proxy(req: IncomingMessage, res: ServerResponse, port: number, fallback = true): void {
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (response) => {
      if (
        response.statusCode === 404 &&
        fallback &&
        previous &&
        req.method === "GET" &&
        /\.(js|css|woff2?)(\?|$)/.test(req.url || "")
      ) {
        response.resume();
        proxy(req, res, previous.port, false);
        return;
      }
      res.writeHead(response.statusCode || 502, response.headers);
      res.flushHeaders();
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) json(res, 502, { error: "Dashboard temporarily unavailable" });
    else res.end();
  });
  res.on("close", () => upstream.destroy());
  if (fallback) req.pipe(upstream);
  else upstream.end();
}

async function handleMode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const input = await changingRequest(req, res, 128) as { mode?: Mode } | undefined;
      if (!input) return;
      if (input.mode !== "development" && input.mode !== "production") throw new Error("Invalid dashboard mode");
      const change = changeMode(input.mode);
      json(res, 202, { pending: true });
      void change.catch((error) => console.error(error.message));
    } catch (error) {
      refused(res, error);
    }
}

function supervisorState() {
  return {mode: active?.mode || null, busy, error: failure, immutable: !!process.env.AL_DASHBOARD_PREBUILT,
    instance: active?.id || null, ready: !!active && active.process.exitCode === null && !busy && !failure};
}
const server = createServer(async (req, res) => {
  if (req.url !== '/__dashboard/state' && redirectInternal(req, res)) return;
  if (req.url === '/__dashboard/builds') { await handleBuilds(req, res); return; }
  if (req.url?.startsWith("/party-api/")) {
    proxy(req, res, Number(process.env.AL_INTERNAL_API_PORT) || 924);
    return;
  }
  if (req.url === "/__dashboard/state" && req.method === "GET") {
    json(res, 200, supervisorState());
    return;
  }
  if (req.url === "/__dashboard/mode" && req.method === "POST") {
    await handleMode(req, res);
    return;
  }
  if (!active) {
    json(res, 503, { error: failure || "Dashboard is starting" });
    return;
  }
  proxy(req, res, active.port);
});

server.on("upgrade", (req, socket, head) => {
  if (!fromGateway(req)) { socket.destroy(); return; }
  if (!active) {
    socket.destroy();
    return;
  }
  const target = connect(active.port, "127.0.0.1", () => {
    target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        target.write(`${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
    }
    target.write("\r\n");
    target.write(head);
    socket.pipe(target).pipe(socket);
  });
  target.on("error", () => socket.destroy());
  socket.on("error", () => target.destroy());
  socket.on("close", () => target.destroy());
});

async function shutdown(): Promise<void> {
  server.close();
  await Promise.all([stop(active?.process), stop(previous?.process), stop(pending)]);
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
server.listen(publicPort, "127.0.0.1", async () => {
  let mode: Mode = process.argv.includes("--production") || process.env.AL_DASHBOARD_PREBUILT ? "production" : "development";
  // One read of the mode file: a missing file is a first launch, which uses HMR; a bad file is named
  // and the supervisor starts in the mode the flags give.
  let saved: { mode?: Mode; rollback?: string } | undefined;
  try { saved = await readJson<{ mode?: Mode; rollback?: string }>(stateFile); }
  catch (error) { console.error(`Could not read the dashboard mode file ${stateFile}:`, error); }
  if (!process.argv.includes("--development") && !process.argv.includes("--production") && saved?.mode === "production") mode = "production";
  // A pinned rollback survives ordinary restarts, including --production.
  rollbackSelection = saved?.rollback;
  await changeMode(mode, rollbackSelection).catch((error) => console.error(error.message));
});
