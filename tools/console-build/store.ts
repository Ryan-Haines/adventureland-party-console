import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, readdir, lstat, realpath, rm, unlink, readlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readJson, inspectRemoval, applyRemovals } from '../build-store.ts';
import {deploymentPending, type Candidate, type CandidateManifest, type CandidateSummary, type DeploymentJournal, type References} from './contracts.ts';

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
    finally { await this.releaseLock(lock, token); }
  }
  private async releaseLock(lock: string, token: string): Promise<void> {
    // Fence the ownership check and rename with the same auditor mutex used by
    // stale recovery. Never remove owner.json from the admission pathname.
    const claim = path.join(lock, 'recovery');
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(claim); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        if (code !== 'EEXIST') throw error;
        await this.reclaimAuditor(claim, token);
        if (attempt >= 600) throw new Error('Console candidate release auditor is busy');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    let detached = false;
    try {
      await atomicJson(path.join(claim, 'owner.json'), {pid: process.pid, token});
      const released = lock + '.released-' + token;
      if (!await this.detachOwnedLock(lock, released, token)) return;
      detached = true;
      await this.removeReleased(released);
    } finally {
      if (!detached) await removeOwnedClaim(claim, token);
    }
  }
  private async detachOwnedLock(lock: string, released: string, token: string): Promise<boolean> {
    // The caller holds the recovery auditor claim through every bounded retry.
    for (let attempt = 0; ; attempt++) {
      const owner = await readJson<{token: string}>(path.join(lock, 'owner.json')).catch(() => undefined);
      if (owner?.token !== token) return false;
      try { await rename(lock, released); return true; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EBUSY', 'EPERM'].includes(code || '') || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  private async removeReleased(released: string): Promise<void> {
    // Retry only the detached generation; a successor may already own lock.
    for (let attempt = 0; ; attempt++) {
      try {
        const verified = await inspectRemoval(this.directory, path.relative(this.directory, released));
        await rm(verified.path, {recursive: true});
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(code || '') || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
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
  async verify(id: string, dependencies = new Set<string>()): Promise<Candidate> {
    const manifest = await this.metadata(id);
    await this.verifyDirectory(path.join(this.release(id), 'app'), manifest, dependencies);
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
  describe(id: string) { return this.metadata(id); }
  private async verifyDirectory(directory: string, manifest: CandidateManifest, dependencies = new Set<string>()) {
    validateManifest(manifest);
    if (await realpath(directory) !== path.resolve(directory)) throw new Error('Candidate directory is redirected');
    if (manifest.dependencyId && !dependencies.has(manifest.dependencyId)) {
      await this.verifyDependencies(manifest.dependencyId);
      dependencies.add(manifest.dependencyId);
    }
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
    // The builder owns this unpublished stage. Hashing must not hold admission.
    await this.verifyDirectory(path.join(stage, 'app'), manifest);
    return this.locked(async () => {
      await atomicJson(path.join(stage, 'manifest.json'), manifest);
      await atomicJson(path.join(stage, 'complete.json'), {id: manifest.id, manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex')});
      await mkdir(path.join(this.directory, 'releases'), {recursive: true});
      await this.publishStage(stage,manifest.id);
      const refs = await this.references();
      const countsFile = path.join(this.directory, 'completion-counts.json');
      const counts = await readJson<{total: number; numbers: Record<string, number>}>(countsFile) || {total: 0, numbers: {}};
      // Seed legacy history once; retain ordinals when release directories are pruned.
      for (const item of await this.history()) if (counts.numbers[item.id] === undefined) counts.numbers[item.id] = ++counts.total;
      await atomicJson(countsFile, counts);
      const current = refs.latest ? await this.metadata(refs.latest) : undefined;
      if (!current || manifest.createdAt >= current.createdAt) await this.setReferences({...refs, latest: manifest.id});
      const summaries = Object.fromEntries((await this.history()).map(({files: _files, ...summary}) => [summary.id, summary]));
      await atomicJson(path.join(this.directory, 'summaries.json'), summaries);
      return {manifest: await this.metadata(manifest.id), directory: path.join(this.release(manifest.id), 'app')};
    });
  }
  references() { return readJson<References>(path.join(this.directory, 'references.json')).then(value => value || {}); }
  private async publishStage(stage:string,id:string):Promise<void>{
    // Retain the operation lock and verified stage through transient Windows
    // sharing violations. Permanent/unrelated failures still leave it unpublished.
    for(let attempt=0;;attempt++){
      try{await rename(stage,this.release(id));return;}
      catch(error){
        const code=(error as NodeJS.ErrnoException).code;
        if(['EEXIST','ENOTEMPTY'].includes(code||'')){await this.verify(id);return;}
        if(!['EBUSY','EPERM'].includes(code||'')||attempt>=5)throw error;
        await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
      }
    }
  }
  async setReferences(refs: References) {
    for (const id of Object.values(refs)) if (id) await this.metadata(id);
    await atomicJson(path.join(this.directory, 'references.json'), refs);
  }
  journal() { return readJson<DeploymentJournal>(path.join(this.directory, 'deployment.json')); }
  setJournal(value: DeploymentJournal) { return atomicJson(path.join(this.directory, 'deployment.json'), value); }
  async completedSince(active: string | undefined, history: CandidateSummary[]): Promise<number> {
    const counts = await readJson<{total: number; numbers: Record<string, number>}>(path.join(this.directory, 'completion-counts.json'));
    if (counts && active && counts.numbers[active] !== undefined) return Math.max(0, counts.total - counts.numbers[active]);
    const baseline = history.find(item => item.id === active);
    return history.filter(item => item.id !== active && (!baseline || item.createdAt > baseline.createdAt)).length;
  }
  async history(): Promise<CandidateManifest[]> {
    const names = await readdir(path.join(this.directory, 'releases')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    const result: CandidateManifest[] = [];
    for (const id of names.filter(validId)) result.push(await this.metadata(id));
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async summaries(): Promise<CandidateSummary[]> {
    const names = await readdir(path.join(this.directory, 'releases')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    const index = await readJson<Record<string, CandidateSummary>>(path.join(this.directory, 'summaries.json')) || {};
    const result: CandidateSummary[] = [];
    for (const id of names.filter(validId)) {
      if (index[id]?.id === id) result.push(index[id]);
      else { const {files: _files, ...summary} = await this.metadata(id); result.push(summary); }
    }
    return result.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
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
      if (journal && deploymentPending(journal.phase)) { keep.add(journal.target); keep.add(journal.previous); }
      for (const id of await this.livePins(/^live-\d+\.json$/)) keep.add(id);
      const trash=path.join(this.directory,'trash');await mkdir(trash,{recursive:true});
      if(await realpath(trash)!==trash)throw Error('Cleanup trash is redirected');
      for (const item of history) if (!keep.has(item.id)) {
        const source=this.release(item.id);if((await lstat(source)).isSymbolicLink())throw Error('Cleanup refuses redirected release');
        await rename(source,path.join(trash,'release-'+item.id+'-'+randomUUID()));
      }
      const dependencies = new Set(history.filter(item => keep.has(item.id)).map(item => item.dependencyId).filter((id): id is string => !!id));
      for (const id of await this.livePins(/^dependency-live-\d+\.json$/)) dependencies.add(id);
      const caches=await readdir(path.join(this.directory,'dependencies')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
      for(const id of caches.filter(validId))if(!dependencies.has(id)){
        const source=path.join(this.directory,'dependencies',id);if((await lstat(source)).isSymbolicLink())throw Error('Cleanup refuses redirected dependency');
        await rename(source,path.join(trash,'dependencies-'+id+'-'+randomUUID()));
      }
    });
    // Only selection/quarantine uses the operation lock. Slow tree inspection
    // and deletion never block a new deployment or its completion journal.
    const trash=path.join(this.directory,'trash');
    for(const name of await readdir(trash)){
      if(!/^(release|dependencies)-[a-f0-9]{64}-[a-f0-9-]+$/.test(name))continue;
      const directory=path.join(trash,name);
      try{
        if(name.startsWith('release-')){
          const manifest=await readJson<CandidateManifest>(path.join(directory,'manifest.json'));
          for(const [link,component] of Object.entries({'node_modules':'root','dashboard/node_modules':'dashboard','.caracal/node_modules':'caracal'})){
            const file=path.join(directory,'app',link),info=await lstat(file).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
            if(info?.isSymbolicLink()){
              const target=path.resolve(path.dirname(file),await readlink(file));
              const expected=manifest?.dependencyId&&validId(manifest.dependencyId)?path.join(this.directory,'dependencies',manifest.dependencyId,component,'node_modules'):null;
              if(target!==expected)throw Error('Cleanup refuses unexpected dependency link');await unlink(file);
            }
          }
        }
        await applyRemovals(this.directory,[await inspectRemoval(this.directory,'trash/'+name)]);
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
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
}
