import { spawn, type ChildProcess } from "node:child_process";
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
        this.launchBinary(command, args, cwd, env,name,version);
      }, 3000);
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
    if (!child.pid) return;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => {});
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already stopped. */
      }
    }
  }
  stop() {
    this.stopping = true;
    for (const child of this.children) this.stopTree(child);
  }
}
