import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, symlink, rename, readdir} from 'node:fs/promises';
import {readFileSync, unlinkSync} from 'node:fs';
import {migrateHostingData, preparePartyStorage} from '../../tools/hosting/windows-party-storage.ts';
import {CoordinatorJsonlStore} from '../../runtime/coordinator/persistence/jsonl-store.ts';
import {initializeCoordinatorEnvironment} from '../../runtime/coordinator/environment.ts';
import {Installation} from '../../tools/update/transaction.ts';

// Each invocation runs in a new container. Only /data survives replacement.
const root = '/tmp/party', legacy = root + '/.caracal/localStorage', storage = '/data/localStorage';
const roster = ['bankboi0', 'bankboi1'];
await mkdir(root + '/.caracal', {recursive:true});
if (process.argv[2] === 'legacy') {
  const checkout = '/tmp/native', old = checkout + '/.build/hosting-data', instance = '/tmp/xdg/instance';
  await mkdir(old + '/localStorage', {recursive:true});
  await mkdir(checkout + '/.caracal', {recursive:true});
  await symlink(old + '/localStorage', checkout + '/.caracal/localStorage');
  await writeFile(old + '/localStorage/caraGarage.jsonl', '{"native":true}\n');
  const external = await migrateHostingData(checkout, instance);
  const migrated = await preparePartyStorage(checkout, external);
  await rename(checkout + '/.build', checkout + '/retired-build');
  assert.equal(await readFile(migrated + '/caraGarage.jsonl', 'utf8'), '{"native":true}\n');
  await mkdir(legacy);
  await writeFile(legacy + '/storage.json', JSON.stringify({roster}));
  await writeFile(legacy + '/caraGarage.jsonl.metrics.jsonl', '{"metric":42}\n');
  await mkdir(storage, {recursive:true});
  await writeFile(storage + '/storage.json', '{"roster":[]}');
  await assert.rejects(preparePartyStorage(root,'/data'), /Conflicting party storage/);
  assert.equal(await readFile(legacy + '/storage.json','utf8'), JSON.stringify({roster}));
  await rename(storage + '/storage.json','/data/conflict-fixture.saved');
} else {
  await symlink(storage, legacy);
}
assert.equal(await preparePartyStorage(root, '/data'), storage);
process.env.AL_PARTY_STORAGE_DIR = storage;
const journal = storage + '/caraGarage.jsonl';
const {localStorage} = await initializeCoordinatorEnvironment({
  createStorage: () => new CoordinatorJsonlStore(journal, storage + '/caraGarage.other.jsonl'),
  migration:{read:file=>readFileSync(file,'utf8'), remove:unlinkSync, info(){}},
  ensureLatest:async()=>1, configuration:()=>({characters:{}}), environmentSession:()=>'', account:async()=>({}),
  cullVersions:async()=>{},
});
assert.deepEqual(localStorage.get('roster'), roster);
localStorage.close();
assert.equal(await readFile(storage + '/caraGarage.jsonl.metrics.jsonl', 'utf8'), '{"metric":42}\n');
if (process.argv[2] === 'replacement') {
  const before = await readFile(journal);
  const starts = [];
  const update = new Installation({
    current:async()=>'old', stop:async()=>{}, healthy:async()=>false,
    start:async version=>{starts.push(version); if(version==='new') await writeFile(journal, '{"changed":true}\n');},
  }, '/data', async()=>{}, 1);
  await assert.rejects(update.install('new', true), /health/);
  assert.deepEqual(starts, ['new','old']);
  assert.deepEqual(await readFile(journal), before);
  const transaction = '/data/updates/transaction.json';
  const recorded = JSON.parse(await readFile(transaction, 'utf8'));
  await writeFile(recorded.backup + '/localStorage/caraGarage.jsonl', '{"corrupt":true}\n');
  await writeFile(transaction, JSON.stringify({...recorded, phase:'started'}));
  await assert.rejects(update.recover(), /missing or changed/);
  assert.deepEqual(await readFile(journal), before);
  await rename(journal, journal + '.saved');
  await assert.rejects(preparePartyStorage(root, '/data'), /missing or empty/);
  assert.ok(!(await readdir(storage)).includes('caraGarage.jsonl'));
}
console.log(JSON.stringify({phase:process.argv[2], roster, metric:42, journal}));
