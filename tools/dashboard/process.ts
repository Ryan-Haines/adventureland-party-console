import { spawn, type ChildProcess } from "node:child_process";
import { gatewayHeaders } from './gateway-access.ts';
import { stopTree, waitForHealthy as healthy } from '../hosting/api.ts';
import type { HostBound } from '../hosting/api.ts';

export function launch(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

export function completed(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)),
    );
  });
}

// The supervisor stops a dashboard child through the host's one tree stop (hosting/process-tree.ts),
// which logs here with the child's pid; a child that exited meanwhile needed no stop.
export async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null) return;
  const pid = child.pid;
  await stopTree(pid).catch(error => console.error(`Could not stop dashboard pid ${pid}:`, error));
}

// The dashboard's first start compiles it (vinext dev, or a production server loading its build), and
// DASHBOARD_START bounds that compile. The supervisor runs apart from the coordinator, so the host log
// is its report.
const DASHBOARD_START: HostBound = { name: 'dashboardStartMs', ms: 120_000 };
export function waitForHealthy(child: ChildProcess, port: number): Promise<void> {
  return healthy(child, `http://127.0.0.1:${port}/`, 'Dashboard', DASHBOARD_START, { headers: gatewayHeaders() });
}
