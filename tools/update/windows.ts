import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { assertUnmodified, atomic, contained, exists, readJson } from './files.ts';
import { type Release, type PublishedRelease } from './contracts.ts';
import { type Driver, Installation } from './transaction.ts';
import { type UpdateAdapter } from './service.ts';
import { type GitHubReleases } from './github.ts';
import { run } from './process.ts';

export class WindowsInstallation implements Driver, UpdateAdapter {
  readonly home: string;
  readonly data: string;
  private child?: ChildProcess;
  readonly transaction: Installation;
  constructor(home: string, data: string) { this.home = home; this.data = data; this.transaction = new Installation(this, data); }
  async current() {
    return await exists(path.join(this.home, 'active.json')) ? (await readJson<{ root: string }>(path.join(this.home, 'active.json'))).root : 'app';
  }
  async inspect() {
    const root = contained(this.home, await this.current());
    const release = await readJson<Release>(path.join(root, 'release.json'));
    await assertUnmodified(root, release.files);
  }
  async stage(release: PublishedRelease, github: GitHubReleases) {
    const stage = contained(this.home, `versions/${release.version}`);
    if (await exists(stage)) {
      const installed = await readJson<Release>(path.join(stage, 'release.json'));
      if (installed.version !== release.version) throw new Error('Staged version does not match');
      await assertUnmodified(stage, installed.files); return;
    }
    const temporary = contained(this.home, `downloads/${release.version}`);
    await mkdir(temporary, { recursive: true });
    await writeFile(path.join(temporary, 'package.zip'), await github.download(release));
    // tar validates the member list before extraction; no request-supplied archive paths are accepted.
    const members = (await run('tar.exe', ['-tf', path.join(temporary, 'package.zip')], this.home)).split(/\r?\n/).filter(Boolean);
    for (const file of members) if (/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(file)) throw new Error('Unsafe archive path');
    await run('tar.exe', ['-xf', path.join(temporary, 'package.zip'), '-C', temporary], this.home);
    const payload = path.join(temporary, 'app'), manifest = await readJson<Release>(path.join(payload, 'release.json'));
    if (manifest.version !== release.version || manifest.repository !== github.repo) throw new Error('Package identity mismatch');
    await assertUnmodified(payload, manifest.files);
    await mkdir(path.dirname(stage), { recursive: true });
    const { rename } = await import('node:fs/promises'); await rename(payload, stage);
  }
  async install(release: PublishedRelease, startup: boolean) { await this.transaction.install(`versions/${release.version}`, startup); }
  async start(target: string) {
    const root = contained(this.home, target);
    await run(process.execPath, ['--check', path.join(root, '.build/runtime/coordinator-application.cjs')], root);
    await mkdir(path.join(root, '.caracal/CODE'), { recursive: true });
    if (!(await exists(path.join(root, '.caracal/CODE/adventure_land')))) await symlink(path.join(root, 'characters'), path.join(root, '.caracal/CODE/adventure_land'), 'junction');
    await atomic(path.join(this.home, 'active.json'), { root: target });
    this.child = spawn(process.execPath, [path.join(root, 'tools/hosting/start.mts')], {
      cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, AL_DATA_DIR: this.data, AL_UPDATER_URL: 'http://127.0.0.1:925', AL_MANAGED: '1' },
    });
    this.child.on('error', error => console.error('Console startup failed:', error.message));
    await atomic(path.join(this.data, 'updates/process.json'), { pid: this.child.pid, script: path.join(root, 'tools/hosting/start.mts') });
  }
  async stop() {
    if (this.child?.pid && this.child.exitCode === null) {
      await run('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], this.home);
    } else if (await exists(path.join(this.data, 'updates/process.json'))) {
      const record = await readJson<{ pid: number; script: string }>(path.join(this.data, 'updates/process.json'));
      if (!Number.isInteger(record.pid) || record.pid <= 0) throw new Error('Invalid saved console process');
      contained(this.home, path.relative(this.home, record.script));
      const command = await run('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}').CommandLine`], this.home);
      if (command.includes(record.script)) await run('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], this.home);
    }
    this.child = undefined;
  }
  async healthy() {
    try { return (await fetch(`http://127.0.0.1:${process.env.AL_PORT || 3010}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }
  async maintenance() {
    const response = await fetch('http://127.0.0.1:924/party-api/console-maintenance', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Coordinator does not support safe updates');
    return await response.json() as { id?: string; ready?: boolean; waiting?: string[] };
  }
}
