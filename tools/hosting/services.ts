import { spawn, type ChildProcess } from "node:child_process";
export class Services {
  private children = new Set<ChildProcess>();
  private stopping = false;
  launch(file: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    if (this.stopping) return;
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.children.add(child);
    let finished = false;
    const exited = () => {
      if (finished) return;
      finished = true;
      this.children.delete(child);
      this.stopTree(child);
      if (!this.stopping) setTimeout(() => this.launch(file, cwd, env, args), 3000);
    };
    child.once("exit", exited);
    child.on("error", (error) => { console.error("Service startup failed:", error.message); exited(); });
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
