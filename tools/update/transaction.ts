import { cp, mkdir, rm, chown, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists } from './files.ts';
import { atomicJson, requiredJson } from '../build-store.ts';
import { LEASE_FILE } from '../../runtime/lifecycle/rules.ts';
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';
import { safeReload } from '../console-build/safe-reload.ts';
import type { HostBound } from '../hosting/http.ts';
const fields = lifecycleSavedFields.settings;
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// The updater's reads of the started console (both drivers and the gateway route): a console that
// accepts the connection and never answers. A health read that ends here reads as waiting.
export const HEALTH_READ: HostBound = { name: 'updateHealthReadMs', ms: 2000 };
export const DRAIN_READ: HostBound = { name: 'updateDrainReadMs', ms: 3000 };
/** The started console's health: the host gateway's /health, as b9b5c91e read it (the dashboard
 * ready, then the coordinator ready once an account is configured), with the failed start beside
 *  it. A read that does not answer, or answers neither, is still waiting. */
export async function hostHealth(response: Promise<Response>): Promise<'healthy' | 'failed' | 'waiting'> {
  try {
    const answer = await (await response).json() as { ready?: boolean; failed?: string | null };
    return answer.failed ? 'failed' : answer.ready === true ? 'healthy' : 'waiting';
  } catch { return 'waiting'; }
}
export interface Driver {
  current(): Promise<string>;
  stop(): Promise<void>;
  start(target: string): Promise<void>;
  /** The started console's start: `failed` when the host's /health reports a failed start or
   *  its process exited, `healthy` when /health reads ready, `waiting` otherwise. */
  health(): Promise<'healthy' | 'failed' | 'waiting'>;
  maintenance(): Promise<{ id?: string; ready?: boolean; waiting?: string[]; lost?: string[] }>;
}
interface Journal { previous: string; target: string; backup: string; phase: 'prepared' | 'stopped' | 'backed-up' | 'started' | 'committed' }
const dataNames = ['localStorage', 'config.json', 'session.txt', 'access.json'];
// The update writes the deploy lease through the host's one lease writer:
// a draining lease renewed at a third of its life, so the characters finish their fight and hold
// as they do for a safe deploy, and a lease whose updater died expires. The handle renews it until the
// update releases it.
// The pause ends on the drain's own progress: it succeeds when the coordinator's drain answer reads
// ready; it fails when the coordinator stops answering (`driver.maintenance()` throws), as b9b5c91e's
// pause did, or when the answer names a participant whose reports stopped (`lost`: a character that
// disconnected or crashed during the drain never acknowledges). A failed pause releases the lease, so
// the held characters play on. While a fight holds the drain the pause keeps waiting; the drain reads
// ready when it ends.
export async function pause(driver: Driver, data: string) {
  const id = randomUUID(), lease = safeReload(data, async () => {
    const status = await driver.maintenance();
    if (status.lost?.length) throw new Error(`${status.lost.join(', ')} stopped reporting during the pause`);
    return status;
  });
  try { await lease.waitUntilSafe(id, new AbortController().signal, 'safe'); }
  catch (error) {
    const waiting = lease.waiting.join(', ') || 'character acknowledgements';
    await lease.releaseSafeWait(id);
    throw new Error(`Could not safely pause: ${(error as Error).message}. Try Restart now later. Waiting: ${waiting}`);
  }
  return lease;
}
export async function copyState(from: string, to: string) {
  await mkdir(to, { recursive: true });
  for (const name of dataNames) if (await exists(path.join(from, name)))
    await cp(path.join(from, name), path.join(to, name), { recursive: true, filter: source => !source.endsWith('.writer.lock') });
}
async function restoreState(backup: string, data: string) {
  // Both roots are fixed installation directories, not request-provided paths.
  for (const name of dataNames) await rm(path.join(data, name), { recursive: true, force: true });
  await copyState(backup, data);
  if (process.env.AL_CONTAINER_UPDATER === '1') for (const name of dataNames)
    if (await exists(path.join(data, name))) await restoreOwner(path.join(data, name));
}
async function restoreOwner(file: string) {
  await chown(file, 1000, 1000);
  try { for (const entry of await readdir(file)) await restoreOwner(path.join(file, entry)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
}
export class Installation {
  readonly driver: Driver;
  readonly data: string;
  readonly sleep: typeof delay;
  // The clock port lets a test pass updateHealthMs without waiting it out.
  readonly now: () => number;
  private lease?: Awaited<ReturnType<typeof pause>>;
  constructor(driver: Driver, data: string, sleep = delay, now: () => number = Date.now) {
    this.driver = driver; this.data = data; this.sleep = sleep; this.now = now;
  }
  private get journal() { return path.join(this.data, 'updates/transaction.json'); }
  async recover() {
    if (!(await exists(this.journal))) return;
    const state = await requiredJson<Journal>(this.journal);
    if (state.phase === 'committed') { await this.release(); return; }
    await this.rollback(state);
  }
  async install(target: string, startup: boolean) {
    const state: Journal = { previous: await this.driver.current(), target, backup: path.join(this.data, 'updates/backups', randomUUID()), phase: 'prepared' };
    let journalWritten = false;
    try {
      if (!startup) this.lease = await pause(this.driver, this.data);
      await atomicJson(path.join(this.data, 'updates/hold.json'), { target });
      await atomicJson(this.journal, state);
      journalWritten = true;
      await this.driver.stop(); state.phase = 'stopped'; await atomicJson(this.journal, state);
      await copyState(this.data, state.backup); state.phase = 'backed-up'; await atomicJson(this.journal, state);
      await this.driver.start(target); state.phase = 'started'; await atomicJson(this.journal, state);
      // The started console has `updateHealthMs` to answer healthy, asked each `hostPollMs`; a failed
      // start or an exited process rolls back at once.
      let health: 'healthy' | 'failed' | 'waiting' = 'waiting';
      for (const until = this.now() + fields.updateHealthMs.default; health === 'waiting' && this.now() < until;) {
        health = await this.driver.health();
        if (health === 'waiting') await this.sleep(fields.hostPollMs.default);
      }
      if (health !== 'healthy') throw new Error(health === 'failed' ? 'Updated console failed to start' : 'Updated dashboard failed its startup health check');
      state.phase = 'committed'; await atomicJson(this.journal, state);
      await this.release();
    } catch (error) {
      if (state.phase === 'committed') throw error;
      if (journalWritten) await this.rollback(state);
      else await this.release();
      throw error;
    }
  }
  private async rollback(state: Journal) {
    await this.driver.stop();
    if (['backed-up', 'started'].includes(state.phase)) await restoreState(state.backup, this.data);
    await this.driver.start(state.previous);
    await atomicJson(this.journal, { ...state, target: state.previous, phase: 'committed' });
    await this.release();
  }
  private async release() {
    const id = this.lease?.lease?.id;
    if (id) await this.lease!.releaseSafeWait(id);
    this.lease = undefined;
    await rm(path.join(this.data, LEASE_FILE), { force: true });
    await rm(path.join(this.data, 'updates/hold.json'), { force: true });
  }
}
