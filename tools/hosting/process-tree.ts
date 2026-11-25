import { spawn, type ChildProcess } from 'node:child_process';
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';
import type { HostBound } from './http.ts';

// The host's child processes start their own children (vinext, npm, the coordinator's caracAL), so
// every stop ends the whole tree. Windows has no process groups: taskkill /T walks the tree, and it
// exits 128 when the process is already gone. On POSIX the host spawns each child detached as its own
// group leader, so SIGTERM to the negative pid reaches the group.
const TASKKILL_GONE = 128;
export function stopTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGTERM'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return Promise.reject(error); }
    return Promise.resolve();
  }
  // A tree kill that fails leaves the tree holding its ports, so stopTree rejects with the pid.
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', reject);
    killer.once('exit', code => code === 0 || code === TASKKILL_GONE ? resolve() : reject(new Error(`taskkill could not stop pid ${pid}: exit code ${code}`)));
  });
}

// waitForHealthy polls a started child's URL each hostPollMs until it answers 2xx. It fails when the
// child errors or exits first, and when the caller's bound ends, which it logs. Each probe waits no
// longer than the bound has left, so a server that accepts and never answers ends at the same bound.
export async function waitForHealthy(child: ChildProcess, url: string, what: string, bound: HostBound,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<void> {
  let failure: Error | undefined;
  const onError = (error: Error) => { failure = error; };
  child.on('error', onError);
  const deadline = Date.now() + bound.ms;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${what} exited before readiness`);
      const probe = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      const response = await fetch(url, { headers: options.headers, signal: options.signal ? AbortSignal.any([options.signal, probe]) : probe })
        .catch(() => undefined);
      if (response) { await response.body?.cancel(); if (response.ok) return; }
      if (Date.now() >= deadline) {
        console.warn(`[bound] ${bound.name} (${bound.ms} ms) ended the ${what} readiness wait`);
        throw new Error(`${what} readiness timed out`);
      }
      await new Promise(resolve => setTimeout(resolve, lifecycleSavedFields.settings.hostPollMs.default));
    }
  } finally {
    child.off('error', onError);
  }
}
