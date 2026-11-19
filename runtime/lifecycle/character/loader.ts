// The CODE frame loader: it verifies
// and installs each class bundle, replaces a native frame, and installs the Steam bridge. Moved whole
// from runtime/characters/universal-loader.ts and loader-artifact.ts.
import { requestBound } from "./run.ts";
import type { Artifact, CharacterClass } from "../../../tools/game/manifest.ts";
import type { GameManifest } from "../../../tools/game/manifest.ts";
import { hostsSteamBridge, initializeConnection, needsSteamBridge, steamBootstrap } from "../roster/connection.ts";
import { boundFired } from "../../status/api.ts";
import { CHARACTER_PICKS as picks } from "../fields.ts";
import { codeStopped } from "../rules.ts";
type ReadSource = (file: string) => Promise<string>;

async function classArtifact(read: ReadSource, name: string): Promise<Artifact> {
  return manifestClass(JSON.parse(await read("manifest.json")) as GameManifest,name);
}
function manifestClass(manifest: GameManifest, name: string): Artifact {
  const entry = manifest.classes?.[name as CharacterClass];
  if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
    throw new Error("Invalid compiled class manifest");
  return entry;
}
async function compileArtifact(read: ReadSource, entry: Artifact, baseUrl: string): Promise<() => void> {
  const bundle = await read(entry.file);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== entry.sha256) throw new Error("Compiled class checksum mismatch");
  // Native CODE must execute in its runner realm, after verifying the local build.
  // oxlint-disable-next-line typescript/no-implied-eval
  const compiled = new Function(bundle + "\n//# sourceURL=" + baseUrl + entry.file);
  return () => { compiled(); };
}
const server = initializeConnection();
const baseUrl = server + "/CODE/adventure_land/";
interface LoaderMaintenance{id:string;expires:number;mode?:'draining';loadMode?:'now'|'safe'|'main';phase?:string}
interface LoaderRoot {
  character: { ctype: string };
  parent: {
    caracAL?: unknown;
    no_html?: unknown;
    is_bot?: unknown;
    character?: { name: string };
    localStorage?: Storage;
    __partySteamBridge?: { realmProtocol: number; version?: number; server?: string };
    eval(source: string): unknown;
    start_runner(id: string, source: string): void;
    setTimeout(fn: () => void, delay: number): unknown;
    __partyConsoleMaintenance?:LoaderMaintenance|null;
    __partyConsoleMaintenanceAt?:number;
    __partyCodeLoads?: number;
  };
  __partyCodeLoader?: { dispose(): void };
  __partyLoaderGeneration?: number;
  __partyCodeHash?: string;
  __partyRuntimeGeneration?: number;
  __partyStatusSuccessAt?: number;
  __partyLoaderRuntimeStartedAt?: number;
  __partyConsoleMaintenance?:LoaderMaintenance|null;
  __partyConsoleMaintenanceAt?:number;
  sharedRoutine?: { stop(): void; canReload(): boolean };
  // The drain the shared code built (shared.js `partyLifecycle.drain`), which takes the polled lease.
  partyLifecycle?: { drain?: { receive(lease:LoaderMaintenance|null,serverNow:number):void } };
  partyRoleRunner?: { start(): void; stop(): void };
  game_log(message: string, color: string): void;
  addEventListener?(event: string, callback: () => void): void;
  removeEventListener?(event: string, callback: () => void): void;
}
const root = globalThis as unknown as LoaderRoot;
const gameHost = root.parent;
root.__partyCodeLoader?.dispose();
const generation = (root.__partyLoaderGeneration || 0) + 1;
root.__partyLoaderGeneration = generation;
const abort = new AbortController();
let lastSource: string | null = null;
let loading = false;
let bridgeLoading = false;
let timer: ReturnType<typeof setInterval> | undefined;
// The console-deployment reply names the host's activation record, or null
// when there is none. Older hosts leave it out (undefined).
let hostActivation: string | null | undefined;
// When the last activation.json request failed; 0 once a record answers.
let missingRecordAt = 0;

// A coordinator that never answers a loader request (a stalled or restarting process): the request's
// kept bound ends it, and the firing waits in this frame's bound queue for its next status report.
const loaderBound = (name: 'loaderFetchMs' | 'loaderLeaseFetchMs', what: string) =>
  requestBound(abort.signal, picks[name], () => boundFired({ bound: name, owner: '13', state: { what, ms: picks[name] } }));
async function source(file: string): Promise<string> {
  // picks.loaderFetchMs bounds each CODE file request.
  const bound = loaderBound('loaderFetchMs', file);
  try {
    const response = await fetch(baseUrl + file + "?t=" + Date.now(), { cache: "no-store", signal: bound.signal });
    if (!response.ok) throw new Error(`CODE ${file}: HTTP ${response.status}`);
    return await response.text();
  } catch (error) { bound.ended(); throw error; }
}
function current(): boolean {
  return !abort.signal.aborted && root.__partyLoaderGeneration === generation && root.parent === gameHost;
}
// The lifecycle owner's drain says whether a reload would cut work (character/drain.ts `canReload`, N3).
function occupied(): boolean {
  return !!root.sharedRoutine && !root.sharedRoutine.canReload();
}
function needsNewFrame(): boolean { return lastSource !== null && !root.parent.caracAL; }
function replaceFrame(): void {
  dispose();
  const bootstrap = steamBootstrap(server);
  // Capture the game window before native start_runner detaches this CODE frame.
  gameHost.setTimeout(() => gameHost.start_runner("maincode", bootstrap), 0);
}
function install(signature: string, compiled: () => void): void {
  root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
  root.partyRoleRunner?.stop();
  root.sharedRoutine?.stop();
  if (!current()) return;
  root.__partyCodeHash = signature;
  root.__partyConsoleMaintenance=gameHost.__partyConsoleMaintenance;
  root.__partyConsoleMaintenanceAt=gameHost.__partyConsoleMaintenanceAt;
  compiled();
  if (!current()) return;
  lastSource = signature;
  root.__partyLoaderRuntimeStartedAt = Date.now();
  // The game window outlives a replaced CODE frame, so its count tells a CODE reload from the first
  // load (coordinator/code.ts `nativeReloaded`).
  gameHost.__partyCodeLoads = (gameHost.__partyCodeLoads || 0) + 1;
  root.partyRoleRunner?.start();
  root.game_log("Loaded party CODE generation " + generation, "#51D2E1");
}
function report(error: unknown): void {
  if (current()) root.game_log("Party loader failed: " + String(error), "red");
}
async function refresh(force = false): Promise<void> {
  if (loading || !current()) return;
  loading = true;
  try {
    // Subsequent generations require the host's explicit activation record.
    // Standalone startup can still load a manifest; periodic polling cannot.
    let activation: {id: string; manifest: GameManifest;maintenance?:LoaderMaintenance|null;serverNow?:number} | null = null;
    // While the host reports no record, refresh asks for activation.json every
    // `loaderRecordRecheckMs` instead of every tick, and refreshControl asks at
    // once when the host reports one. The record stays the contract, so a record
    // the control reply does not name (live-console-explicit-activation.spec.ts
    // serves one) is adopted within 10 s.
    if (lastSource !== null && hostActivation === null && Date.now() - missingRecordAt < picks.loaderRecordRecheckMs) return;
    try { activation = JSON.parse(await source("activation.json")); missingRecordAt = 0; }
    catch (error) { if (lastSource !== null) { missingRecordAt = Date.now(); return; } }
    if (activation && (typeof activation.id !== 'string' || !activation.id)) throw Error('Invalid CODE activation');
    if(activation?.maintenance&&(activation.serverNow||0)>=(gameHost.__partyConsoleMaintenanceAt||0)){
      gameHost.__partyConsoleMaintenance=activation.maintenance;gameHost.__partyConsoleMaintenanceAt=activation.serverNow;
    }
    await refreshControl();
    const entry = activation ? manifestClass(activation.manifest,root.character.ctype) : await classArtifact(source, root.character.ctype);
    if (entry.sha256 === lastSource && !force) return;
    const compiled = await compileArtifact(source, entry, baseUrl);
    if (!current()) return;
    if(lastSource!==null&&occupied())return;
    if (needsNewFrame()) {
      replaceFrame();
      return;
    }
    install(entry.sha256, compiled);
  } catch (error) {
    report(error);
  } finally { loading = false; }
}
let disposed = false;
function dispose(): void {
  if (disposed) return;
  disposed = true;
  abort.abort();
  clearInterval(timer);
  root.removeEventListener?.("pagehide", dispose);
  // Invalidating ownership also fences already pending status/native promises.
  root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
  root.partyRoleRunner?.stop();
  if (root.parent === gameHost) root.sharedRoutine?.stop();
}
let controlLoading=false;
function observeActivation(value:{activation?:string|null}):void{
  const published=hostActivation===null&&typeof value.activation==='string';
  hostActivation='activation' in value?value.activation??null:undefined;
  if(published&&!deliberatelyStopped())void refresh();
}
async function refreshControl(){
  if(controlLoading||!current())return;controlLoading=true;
  // picks.loaderLeaseFetchMs bounds the deployment reply.
  const bound=loaderBound('loaderLeaseFetchMs','console-deployment');
  try{
    const response=await fetch(server+'/party-api/console-deployment',{cache:'no-store',signal:bound.signal});
    if(!response.ok)return;
    const value=await response.json() as {serverNow:number;consoleMaintenance:LoaderMaintenance|null;activation?:string|null};
    if(!current()||value.serverNow<(gameHost.__partyConsoleMaintenanceAt||0))return;
    observeActivation(value);
    gameHost.__partyConsoleMaintenance=value.consoleMaintenance;gameHost.__partyConsoleMaintenanceAt=value.serverNow;
    root.partyLifecycle?.drain?.receive(value.consoleMaintenance,value.serverNow);
    if(value.consoleMaintenance)root.__partyStatusSuccessAt=Date.now();
  }catch{bound.ended();/* Keep the last hold until a fresh control reply can order its release. */}finally{controlLoading=false;}
}
root.__partyCodeLoader = { dispose };
root.addEventListener?.("pagehide", dispose);
async function refreshBridge(): Promise<void> {
  if (bridgeLoading || !current() || !needsSteamBridge(gameHost.__partySteamBridge, server)) return;
  bridgeLoading = true;
  try {
    const text = await source("steam-bridge.js");
    // Evaluate in the game window: the bridge survives a CODE iframe replacement.
    if (current() && needsSteamBridge(gameHost.__partySteamBridge, server)) gameHost.eval(text);
  } catch (error) {
    if (current()) root.game_log("Steam bridge unavailable; retrying: " + String(error), "red");
  } finally { bridgeLoading = false; }
}
// A host that never installs the bridge would otherwise download and evaluate it again on every poll.
const bridgeHost = hostsSteamBridge(gameHost);
if (bridgeHost) {
  void refreshBridge();
}
timer=setInterval(()=>{void refreshControl();if(bridgeHost)void refreshBridge();if(!deliberatelyStopped())void refresh();},picks.loaderPollMs);
function deliberatelyStopped(): boolean {
  return !!gameHost.localStorage && codeStopped(gameHost.localStorage, gameHost.character?.name);
}
if (!deliberatelyStopped()) void refresh();
