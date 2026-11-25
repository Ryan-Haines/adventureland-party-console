import { spawn, type ChildProcess } from "node:child_process";
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';
import { stopTree } from './process-tree.ts';
// A service (the dashboard or the coordinator) that exits relaunches this long after, logged with
// its exit code, so a crash loop shows in the host log once per relaunch.
const RELAUNCH_MS = 3000;
/** The host's stop (start.mts and local.mts): each part stops and the managed console's stop is
 *  awaited, its failure logged. A stop that hangs ends at hostExitGraceMs, a bound against a process
 *  that does not stop: the host logs it and exits 1. */
export function stopHost(parts: { steam: { stop(): void }; tls: { stop(): void }; server: { close(): unknown }; services: Services; managed?: { stop(): Promise<unknown> } }): void {
  parts.steam.stop();
  parts.tls.stop();
  parts.server.close();
  parts.services.stop();
  void parts.managed?.stop().catch(error => console.error('Managed console stop failed:', error));
  const grace = lifecycleSavedFields.settings.hostExitGraceMs.default;
  setTimeout(() => {
    console.error(`[bound] hostExitGraceMs (${grace} ms) ended a host stop that did not finish`);
    process.exit(1);
  }, grace).unref();
}
export class Services {
  private children = new Set<ChildProcess>();
  private stopping = false;
  private named = new Map<string, ChildProcess>();
  private suppressed = new WeakSet<ChildProcess>();
  private versions = new Map<string, number>();
  launch(file: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    return this.launchBinary(process.execPath, [file, ...args], cwd, env);
  }
  launchBinary(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, name?: string, version?: number) {
    if (this.stopping) return;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.children.add(child);
    if(name)this.named.set(name,child);
    let finished = false;
    const exited = () => {
      if (finished) return;
      finished = true;
      this.children.delete(child);
      this.stopTree(child);
      if (!this.stopping&&!this.suppressed.has(child)) setTimeout(() => {
        if(this.stopping||this.suppressed.has(child)||name&&this.versions.get(name)!==version)return;
        console.warn(`Service ${name || command} exited (code ${child.exitCode}, signal ${child.signalCode}); relaunching`);
        this.launchBinary(command, args, cwd, env,name,version);
      }, RELAUNCH_MS);
    };
    child.once("exit", exited);
    child.on("error", (error) => { console.error("Service startup failed:", error.message); exited(); });
    return child;
  }
  async stopService(name:string,signal?:AbortSignal):Promise<void>{
    signal?.throwIfAborted();
    this.versions.set(name,(this.versions.get(name)||0)+1);
    const child=this.named.get(name);this.named.delete(name);
    if(!child)return;
    this.suppressed.add(child);
    const exited=new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});
    this.stopTree(child);
    await exited;signal?.throwIfAborted();
  }
  async replace(name:string,file:string,cwd:string,env:NodeJS.ProcessEnv,args:string[]=[],signal?:AbortSignal):Promise<ChildProcess>{
    await this.stopService(name,signal);signal?.throwIfAborted();
    if(this.stopping)throw new Error('Services are stopping');
    const version=this.versions.get(name)||0;
    const child=this.launchBinary(process.execPath,[file,...args],cwd,env,name,version);
    if(!child)throw new Error('Service was not started');
    return child;
  }
  private stopTree(child: ChildProcess) {
    const pid = child.pid;
    if (pid) void stopTree(pid).catch(error => console.error(`Could not stop service pid ${pid}:`, error));
  }
  stop() {
    this.stopping = true;
    for (const child of this.children) this.stopTree(child);
  }
}
