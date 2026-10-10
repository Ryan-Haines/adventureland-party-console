import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicJson, readJson } from '../build-store.ts';
import type { Candidate, ConsoleBuildStatus, DeploymentDriver, DeploymentJournal } from './contracts.ts';
import { ConsoleBuildStore } from './store.ts';

export class DeploymentConflict extends Error {}
export class ConsoleBuildController {
  private busy = false;
  readonly store: ConsoleBuildStore;
  private driver: DeploymentDriver;
  private timeoutMs: number;
  constructor(store: ConsoleBuildStore, driver: DeploymentDriver, timeoutMs = 120_000) {
    this.store = store; this.driver = driver; this.timeoutMs = timeoutMs;
  }
  async setBuildState(value: {building: boolean; error?: string}) {
    await atomicJson(path.join(this.store.directory, 'builder.json'), value);
  }
  async status(): Promise<ConsoleBuildStatus> {
    const refs = await this.store.references();
    const builder = await readJson<{building: boolean; error?: string}>(path.join(this.store.directory, 'builder.json'));
    const builds = await this.store.history();
    const latest = builds.find(item => item.id === refs.latest), active = builds.find(item => item.id === refs.active);
    return {...refs, builds, operation: await this.store.journal(), building: builder?.building || false,
      buildError: builder?.error, available: latest && latest.id !== refs.active && (!active || latest.createdAt >= active.createdAt) ? latest.id : undefined};
  }
  /** Accepted operation runs asynchronously; its exact target is durably pinned first. */
  async deploy(id: string): Promise<DeploymentJournal> {
    if (this.busy) throw new DeploymentConflict('A console deployment is already in progress');
    this.busy = true;
    try {
      const operation = await this.store.locked(async () => {
        const pending = await this.store.journal();
        if (pending && ['activating', 'rolling-back'].includes(pending.phase)) throw new DeploymentConflict('An incomplete deployment requires recovery');
        await this.store.verify(id);
        const refs = await this.store.references();
        const journal: DeploymentJournal = {id: randomUUID(), target: id, previous: refs.active,
          startedAt: new Date().toISOString(), phase: 'activating'};
        await this.store.setJournal(journal);
        return journal;
      });
      void this.run(operation).catch(error => console.error('Console deployment journal failure:', error)).finally(() => { this.busy = false; });
      return operation;
    } catch (error) { this.busy = false; throw error; }
  }
  private async timed(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Console deployment readiness timed out')); }, this.timeoutMs);
    });
    try { await Promise.race([action(controller.signal), expired]); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  private async prior(operation: DeploymentJournal): Promise<Candidate | undefined> {
    return operation.previous ? this.store.verify(operation.previous) : undefined;
  }
  private async rollback(operation: DeploymentJournal, error: unknown) {
    operation.phase = 'rolling-back';
    operation.error = error instanceof Error ? error.message : String(error);
    await this.store.setJournal(operation);
    try {
      const prior = await this.prior(operation);
      await this.timed(signal => this.driver.restore(prior, signal));
      await this.store.locked(async () => {
        const refs = await this.store.references();
        await this.store.setReferences({...refs, active: operation.previous});
        operation.phase = 'failed';
        await this.store.setJournal(operation);
      });
    } catch (cause) {
      operation.error += '; rollback failed: ' + (cause instanceof Error ? cause.message : String(cause));
      // Keep rolling-back durable: next startup must retry, never claim healthy activation.
      await this.store.setJournal(operation);
    }
  }
  private async run(operation: DeploymentJournal) {
    try {
      const target = await this.store.verify(operation.target), previous = await this.prior(operation);
      await this.timed(signal => this.driver.activate(target, previous, signal));
      await this.store.locked(async () => {
        const refs = await this.store.references();
        await this.store.setReferences({...refs, active: operation.target, previous: operation.previous});
        operation.phase = 'complete';
        await this.store.setJournal(operation);
      });
      await this.store.cleanup();
    } catch (error) {
      if (operation.phase !== 'complete') await this.rollback(operation, error);
      else console.error('Console candidate cleanup deferred:', error);
    }
  }
  async recover(): Promise<void> {
    if (this.busy) throw new DeploymentConflict('A console deployment is already in progress');
    this.busy = true;
    try {
      const journal = await this.store.journal();
      if (journal && ['activating', 'rolling-back'].includes(journal.phase))
        await this.rollback(journal, journal.error || 'Interrupted console deployment');
    } finally { this.busy = false; }
  }
}
