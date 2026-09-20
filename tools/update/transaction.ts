import { cp, mkdir, rm, chown, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomic, exists, readJson } from './files.ts';
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export interface Driver {
  current(): Promise<string>;
  stop(): Promise<void>;
  start(target: string): Promise<void>;
  healthy(): Promise<boolean>;
  maintenance(): Promise<{ id?: string; ready?: boolean; waiting?: string[] }>;
}
interface Journal { previous: string; target: string; backup: string; phase: 'prepared' | 'stopped' | 'backed-up' | 'started' | 'committed' }
const dataNames = ['localStorage', 'config.json', 'session.txt', 'access.json'];
export async function pause(driver: Driver, data: string) {
  const id = randomUUID(), file = path.join(data, 'updates/pause.json');
  await atomic(file, { id, expires: Date.now() + 180000 });
  let waiting: string[] = [];
  for (let i = 0; i < 60; i++) {
    const status = await driver.maintenance();
    if (status.id === id && status.ready && i >= 2) return;
    waiting = status.waiting || []; await delay(1000);
  }
  throw new Error(`Could not safely pause within 60 seconds. Try Restart now later. Waiting: ${waiting.join(', ') || 'character acknowledgements'}`);
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
  readonly healthAttempts: number;
  constructor(driver: Driver, data: string, sleep = delay, healthAttempts = 120) {
    this.driver = driver; this.data = data; this.sleep = sleep; this.healthAttempts = healthAttempts;
  }
  private get journal() { return path.join(this.data, 'updates/transaction.json'); }
  async recover() {
    if (!(await exists(this.journal))) return;
    const state = await readJson<Journal>(this.journal);
    if (state.phase === 'committed') { await this.release(); return; }
    await this.rollback(state);
  }
  async install(target: string, startup: boolean) {
    const state: Journal = { previous: await this.driver.current(), target, backup: path.join(this.data, 'updates/backups', randomUUID()), phase: 'prepared' };
    let journalWritten = false;
    try {
      if (!startup) await pause(this.driver, this.data);
      await atomic(path.join(this.data, 'updates/hold.json'), { target });
      await atomic(this.journal, state);
      journalWritten = true;
      await this.driver.stop(); state.phase = 'stopped'; await atomic(this.journal, state);
      await copyState(this.data, state.backup); state.phase = 'backed-up'; await atomic(this.journal, state);
      await this.driver.start(target); state.phase = 'started'; await atomic(this.journal, state);
      let healthy = false;
      for (let i = 0; i < this.healthAttempts; i++) { if (await this.driver.healthy()) { healthy = true; break; } await this.sleep(1000); }
      if (!healthy) throw new Error('Updated dashboard failed its startup health check');
      state.phase = 'committed'; await atomic(this.journal, state);
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
    await atomic(this.journal, { ...state, target: state.previous, phase: 'committed' });
    await this.release();
  }
  private async release() {
    await rm(path.join(this.data, 'updates/pause.json'), { force: true });
    await rm(path.join(this.data, 'updates/hold.json'), { force: true });
  }
}
