import { newer, type Release, type PublishedRelease, type UpdateStatus } from './contracts.ts';
import { atomic, exists, readJson } from './files.ts';
import { GitHubReleases } from './github.ts';
export interface UpdateAdapter {
  inspect(): Promise<void>;
  stage(release: PublishedRelease, github: GitHubReleases): Promise<void>;
  install(release: PublishedRelease, startup: boolean): Promise<void>;
}
export class Updates {
  readonly installed: Release | undefined;
  readonly file: string;
  readonly adapter?: UpdateAdapter;
  readonly state: UpdateStatus;
  private selected?: PublishedRelease;
  private busy = false;
  private failedVersion?: string;
  private github?: GitHubReleases;
  constructor(installed: Release | undefined, file: string, adapter?: UpdateAdapter, repo = installed?.repository) {
    this.installed = installed; this.file = file; this.adapter = adapter;
    this.state = { current: installed?.version || 'development', automatic: false, managed: !!adapter, phase: 'idle' };
    if (repo) this.github = new GitHubReleases(repo);
  }
  async load() {
    if (await exists(this.file)) {
      const saved = await readJson<{ automatic?: boolean; failedVersion?: string }>(this.file);
      this.state.automatic = saved.automatic === true;
      this.failedVersion = saved.failedVersion;
    }
  }
  async preference(automatic: unknown) {
    if (typeof automatic !== 'boolean') throw new Error('automatic must be a boolean');
    if (!this.adapter) throw new Error('Development checkouts are notification-only; use a managed installation for updates');
    await atomic(this.file, { automatic, failedVersion: this.failedVersion }); this.state.automatic = automatic;
  }
  private async operation(work: () => Promise<void>) {
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true; delete this.state.error;
    try { await work(); } catch (error) { this.state.phase = 'failed'; this.state.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  async check() {
    await this.operation(async () => {
      if (!this.github) throw new Error('GitHub release repository has not been configured');
      const before = this.state.phase; this.state.phase = 'checking';
      const latest = await this.github.latest(); this.state.checkedAt = Date.now();
      if (!latest || (this.state.current !== 'development' && !newer(latest.version, this.state.current))) {
        this.selected = undefined; delete this.state.available; this.state.phase = 'idle'; return;
      }
      const same = this.selected?.version === latest.version;
      this.selected = await this.github.manifest(latest.version);
      this.state.available = latest.version; this.state.notes = latest.notes;
      this.state.phase = same && before === 'ready' ? 'ready' : 'available';
    });
  }
  async download() {
    await this.operation(async () => {
      if (!this.selected || !this.github || !this.adapter) throw new Error('No installable update; development checkouts must update their source manually');
      this.state.phase = 'downloading';
      await this.adapter.stage(this.selected, this.github);
      this.state.phase = 'ready';
      try { await this.adapter.inspect(); } catch (error) { this.state.phase = 'blocked'; this.state.error = (error as Error).message; }
    });
  }
  async restart(startup = false) {
    await this.operation(async () => {
      if (!this.adapter || !this.selected || !['ready', 'blocked'].includes(this.state.phase)) throw new Error('Download an update before restarting');
      await this.adapter.inspect(); this.state.phase = 'restarting';
      try { await this.adapter.install(this.selected, startup); }
      catch (error) {
        this.failedVersion = this.selected.version;
        await atomic(this.file, { automatic: this.state.automatic, failedVersion: this.failedVersion });
        throw error;
      }
      this.state.current = this.selected.version; delete this.state.available; this.state.phase = 'idle';
      this.failedVersion = undefined;
      await atomic(this.file, { automatic: this.state.automatic });
    });
  }
  async poll(startup = false) {
    if (this.busy) return;
    await this.check();
    if (this.failedVersion && this.state.available === this.failedVersion) { this.state.error = 'This version failed to install previously. Review the release and retry manually.'; return; }
    if (this.state.automatic && this.state.phase === 'available') await this.download();
    if (startup && this.state.automatic && this.state.phase === 'ready') await this.restart(true);
  }
}
