import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, readdir, lstat, realpath, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readJson, inspectRemoval, applyRemovals } from '../build-store.ts';
import type { Candidate, CandidateManifest, DeploymentJournal, References } from './contracts.ts';

const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);
async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function directoryStale(directory: string): Promise<boolean> {
  const owner = await readJson<{pid: number}>(path.join(directory, 'owner.json')).catch(() => undefined);
  if (owner) {
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
  const info = await lstat(directory).catch(() => undefined);
  return !!info && Date.now() - info.birthtimeMs >= 30_000;
}
async function removeOwnedClaim(claim: string, token: string) {
  const owner = await readJson<{token: string}>(path.join(claim, 'owner.json')).catch(() => undefined);
  if (owner?.token === token) await rm(claim, {recursive: true}).catch(() => {});
}
function validateManifest(manifest: CandidateManifest) {
  if (manifest.schema !== 1 || !validId(manifest.id) || !validId(manifest.sourceHash) ||
    !['dashboard', 'coordinator', 'characters'].every(name => validId(manifest.components[name as keyof typeof manifest.components])))
    throw new Error('Invalid console candidate manifest');
  if (!Number.isFinite(Date.parse(manifest.createdAt)) || !Object.keys(manifest.files).length) throw new Error('Empty or invalid console candidate');
}
async function observedFiles(directory: string, link?: (name: string) => Promise<void>, skip?: string): Promise<Set<string>> {
  const observed = new Set<string>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(directory, relative), {withFileTypes: true})) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (name === skip) continue;
      if (entry.isSymbolicLink()) {
        if (!link) throw new Error('Artifact refuses links: ' + name);
        await link(name);
      } else if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) observed.add(name);
      else throw new Error('Unsupported artifact entry: ' + name);
    }
  };
  await walk('');
  return observed;
}
function validFile(name: string, hash: string, observed: Set<string>) {
  return observed.delete(name) && !name.includes('\\') && !name.split('/').some(part => !part || part === '.' || part === '..') && validId(hash);
}
async function verifyFiles(directory: string, files: Record<string, string>, observed: Set<string>) {
  const entries = Object.entries(files);
  for (const [name, expected] of entries) {
    if (!validFile(name, expected, observed)) throw new Error('Invalid artifact file: ' + name);
  }
  if (observed.size) throw new Error('Unlisted artifact files: ' + [...observed].join(', '));
  // Bound open descriptors and memory while overlapping slow Windows file I/O.
  // Inspect every result in deterministic manifest order after all peers settle.
  for (let index = 0; index < entries.length; index += 32) {
    const results = await Promise.allSettled(entries.slice(index, index + 32).map(async ([name, expected]) => {
      if (await fileHash(path.join(directory, name)) !== expected) throw new Error('Artifact file changed: ' + name);
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
export class ConsoleBuildStore {
  readonly directory: string;
  constructor(root: string) { this.directory = path.resolve(root, '.build/console'); }
  async locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, {recursive: true});
    const lock = path.join(this.directory, 'operation.lock');
    const token = randomUUID();
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await this.reclaim(lock, token)) continue;
        if (attempt >= 600) throw new Error('Console candidate store is busy');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    await atomicJson(path.join(lock, 'owner.json'), {pid: process.pid, token});
    try { return await action(); }
    finally {
      const owner = await readJson<{token: string}>(path.join(lock, 'owner.json'));
      if (owner?.token === token) await rm(lock, {recursive: true});
    }
  }
  private async reclaim(lock: string, token: string): Promise<boolean> {
    // Only one stale-owner auditor may inspect/rename a given lock generation.
    const claim = path.join(lock, 'recovery');
    try { await mkdir(claim); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') { await this.reclaimAuditor(claim, token); return false; }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    let renamed = false;
    try {
      await atomicJson(path.join(claim, 'owner.json'), {pid: process.pid, token});
      if (!await directoryStale(lock)) return false;
      const abandoned = lock + '.abandoned-' + token;
      await rename(lock, abandoned);
      renamed = true;
      await rm(abandoned, {recursive: true});
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    } finally {
      if (!renamed) await removeOwnedClaim(claim, token);
    }
  }
  private async reclaimAuditor(claim: string, token: string) {
    const owner = await readJson<{pid: number; token: string}>(path.join(claim, 'owner.json')).catch(() => undefined);
    if (!await directoryStale(claim)) return;
    const current = await readJson<{token: string}>(path.join(claim, 'owner.json')).catch(() => undefined);
    if (current?.token !== owner?.token) return;
    const abandoned = claim + '.abandoned-' + token;
    try { await rename(claim, abandoned); await rm(abandoned, {recursive: true}); }
    catch (error) { if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
  }
  private release(id: string) {
    if (!validId(id)) throw new Error('Invalid console candidate ID');
    return path.join(this.directory, 'releases', id);
  }
  async verify(id: string): Promise<Candidate> {
    const manifest = await this.metadata(id);
    await this.verifyDirectory(path.join(this.release(id), 'app'), manifest);
    return {manifest, directory: path.join(this.release(id), 'app')};
  }
  private async metadata(id: string): Promise<CandidateManifest> {
    const release = this.release(id);
    const complete = await readJson<{id: string; manifestHash: string}>(path.join(release, 'complete.json'));
    const manifest = await readJson<CandidateManifest>(path.join(release, 'manifest.json'));
    if (complete?.id !== id || manifest?.id !== id) throw new Error('Console candidate is incomplete: ' + id);
    if (complete.manifestHash !== createHash('sha256').update(JSON.stringify(manifest)).digest('hex')) throw new Error('Candidate manifest changed: ' + id);
    return manifest;
  }
  private async verifyDirectory(directory: string, manifest: CandidateManifest) {
    validateManifest(manifest);
    if (await realpath(directory) !== path.resolve(directory)) throw new Error('Candidate directory is redirected');
    if (manifest.dependencyId) await this.verifyDependencies(manifest.dependencyId);
    const observed = await observedFiles(directory, name => this.verifyDependencyLink(directory, manifest, name));
    await verifyFiles(directory, manifest.files, observed);
  }
  private async verifyDependencyLink(directory: string, manifest: CandidateManifest, name: string) {
    const dependency = {'node_modules': 'root', 'dashboard/node_modules': 'dashboard', '.caracal/node_modules': 'caracal'}[name];
    if (!dependency || !manifest.dependencyId || !validId(manifest.dependencyId)) throw new Error('Candidate refuses links: ' + name);
    const cache = path.join(this.directory, 'dependencies', manifest.dependencyId);
    const complete = await readJson<{id: string}>(path.join(cache, 'complete.json'));
    const expected = path.join(cache, dependency, 'node_modules');
    if (complete?.id !== manifest.dependencyId || await realpath(path.join(directory, name)) !== expected || await realpath(cache) !== cache)
      throw new Error('Invalid candidate dependency cache: ' + name);
  }
  private async verifyDependencies(id: string) {
    if (!validId(id)) throw new Error('Invalid dependency cache ID');
    const cache = path.join(this.directory, 'dependencies', id);
    if (await realpath(cache) !== cache) throw new Error('Dependency cache is redirected');
    const complete = await readJson<{id: string; files: Record<string, string>; manifestHash: string}>(path.join(cache, 'complete.json'));
    if (complete?.id !== id || !complete.files || !Object.keys(complete.files).length ||
      complete.manifestHash !== createHash('sha256').update(JSON.stringify({id, files: complete.files})).digest('hex'))
      throw new Error('Dependency cache is incomplete or changed');
    await verifyFiles(cache, complete.files, await observedFiles(cache, undefined, 'complete.json'));
  }
  /** stage contains app/. Caller must finish all writes before this method. */
  async complete(stage: string, manifest: CandidateManifest): Promise<Candidate> {
    return this.locked(async () => {
      await this.verifyDirectory(path.join(stage, 'app'), manifest);
      await atomicJson(path.join(stage, 'manifest.json'), manifest);
      await atomicJson(path.join(stage, 'complete.json'), {id: manifest.id, manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex')});
      await mkdir(path.join(this.directory, 'releases'), {recursive: true});
      try { await rename(stage, this.release(manifest.id)); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        await this.verify(manifest.id);
      }
      const refs = await this.references();
      const current = refs.latest ? await this.metadata(refs.latest) : undefined;
      if (!current || manifest.createdAt >= current.createdAt) await this.setReferences({...refs, latest: manifest.id});
      return {manifest: await this.metadata(manifest.id), directory: path.join(this.release(manifest.id), 'app')};
    });
  }
  references() { return readJson<References>(path.join(this.directory, 'references.json')).then(value => value || {}); }
  async setReferences(refs: References) {
    for (const id of Object.values(refs)) if (id) await this.metadata(id);
    await atomicJson(path.join(this.directory, 'references.json'), refs);
  }
  journal() { return readJson<DeploymentJournal>(path.join(this.directory, 'deployment.json')); }
  setJournal(value: DeploymentJournal) { return atomicJson(path.join(this.directory, 'deployment.json'), value); }
  async history(): Promise<CandidateManifest[]> {
    const names = await readdir(path.join(this.directory, 'releases')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    const result: CandidateManifest[] = [];
    for (const id of names.filter(validId)) result.push(await this.metadata(id));
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async pin(ids: string[]) {
    await this.locked(async () => {
      for (const id of ids) await this.metadata(id);
      await atomicJson(path.join(this.directory, `live-${process.pid}.json`), {pid: process.pid, ids});
    });
  }
  /** Builder pins a cache before completing a candidate; caches are shared across history. */
  async pinDependencies(ids: string[]) {
    await this.locked(async () => {
      if (ids.some(id => !validId(id))) throw new Error('Invalid dependency cache pin');
      await atomicJson(path.join(this.directory, `dependency-live-${process.pid}.json`), {pid: process.pid, ids});
    });
  }
  async cleanup(): Promise<void> {
    await this.locked(async () => {
      const history = await this.history(), refs = await this.references(), journal = await this.journal();
      const keep = new Set([...history.slice(-20).map(item => item.id), ...Object.values(refs)]);
      if (journal && ['activating', 'rolling-back'].includes(journal.phase)) { keep.add(journal.target); keep.add(journal.previous); }
      for (const id of await this.livePins(/^live-\d+\.json$/)) keep.add(id);
      for (const item of history) if (!keep.has(item.id)) await this.removeCandidate(item.id);
      const dependencies = new Set(history.filter(item => keep.has(item.id)).map(item => item.dependencyId).filter((id): id is string => !!id));
      for (const id of await this.livePins(/^dependency-live-\d+\.json$/)) dependencies.add(id);
      await this.removeUnusedDependencies(dependencies);
    });
  }
  private async livePins(pattern: RegExp): Promise<string[]> {
    const pins: string[] = [];
    for (const name of await readdir(this.directory)) {
      if (!pattern.test(name)) continue;
      const lease = await readJson<{pid: number; ids: string[]}>(path.join(this.directory, name));
      if (!lease) continue;
      try { process.kill(lease.pid, 0); pins.push(...lease.ids); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    return pins;
  }
  private async removeCandidate(id: string) {
    // Verify known links, then unlink references without following dependency caches.
    const candidate = await this.verify(id);
    for (const name of ['node_modules', 'dashboard/node_modules', '.caracal/node_modules']) {
      const link = path.join(candidate.directory, name);
      const info = await lstat(link).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (info?.isSymbolicLink()) await unlink(link);
    }
    await applyRemovals(this.directory, [await inspectRemoval(this.directory, 'releases/' + id)]);
  }
  private async removeUnusedDependencies(keep: Set<string>) {
    const caches = await readdir(path.join(this.directory, 'dependencies')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const id of caches.filter(validId)) if (!keep.has(id))
      await applyRemovals(this.directory, [await inspectRemoval(this.directory, 'dependencies/' + id)]);
  }
}
