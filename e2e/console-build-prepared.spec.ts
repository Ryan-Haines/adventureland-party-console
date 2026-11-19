import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {stage} from './console-build-helpers';
import {safeReload} from '../tools/console-build/safe-reload';
import {readJson} from '../tools/build-store';

test('candidate preparation keeps gameplay unpaused and failure preserves the selected build',async({},info)=>{
  const root=info.outputPath('host'),store=new ConsoleBuildStore(root),pause=path.join(root,'updates/pause.json');
  const a=await stage(store,'old'),b=await stage(store,'new');await store.setReferences({active:a.manifest.id,latest:b.manifest.id});
  const drain=safeReload(root,async()=>({id:(await readJson<{id:string}>(pause))?.id,ready:true}),{clearMs:100,pollMs:25});
  let finish!:()=>void,preparing=false,fail=false,activations=0;
  const controller=new ConsoleBuildController(store,{
    async prepare(){preparing=true;await new Promise<void>(resolve=>{finish=resolve;});if(fail)throw Error('Declared preparation failure');},
    beginMaintenance:async operation=>drain.begin(operation.id,operation.mode),
    waitUntilSafe:(id,signal,mode)=>drain.waitUntilSafe(id,signal,mode),
    releaseSafeWait:id=>drain.releaseSafeWait(id),
    async activate(){expect(await readJson(pause)).toBeTruthy();activations++;},restore:async()=>{},
  });
  const samples=[];
  for(const failed of [true,false]){
    fail=failed;preparing=false;const request=await controller.deploy(b.manifest.id,'safe');
    await expect.poll(()=>preparing).toBe(true);
    for(let i=0;i<5;i++){await new Promise(resolve=>setTimeout(resolve,100));const lease=await readJson(pause);expect(lease).toBeUndefined();expect((await store.references()).active).toBe(a.manifest.id);samples.push({id:request.id,at:Date.now(),lease:lease||null,failed});}
    finish();await expect.poll(async()=>(await store.journal())?.phase).toBe(failed?'failed':'complete');
    expect(await readJson(pause)).toBeUndefined();expect((await store.references()).active).toBe(failed?a.manifest.id:b.manifest.id);
  }
  expect(activations).toBe(1);
  await info.attach('uninterrupted-preparation',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
});

test('prepared native publication matches validated legacy installation and measures its cost',async({},info)=>{
  test.setTimeout(180000);
  const source=process.env.E2E_PREPARED_ARTIFACT||process.cwd();
  const root=info.outputPath('runtime'),app=path.join(root,'artifact');await mkdir(app,{recursive:true});
  await cp(path.resolve('tools/caracal'),path.join(app,'tools/caracal'),{recursive:true});
  const native=path.join(app,'.caracal');await mkdir(native,{recursive:true});
  for(const entry of await readdir(path.join(source!,'.caracal'),{withFileTypes:true})){
    // Read executable inputs only; never copy account config, sessions or storage.
    const allowed=entry.isDirectory()?['src','standalones','presentation'].includes(entry.name):
      ['package.json','package-lock.json','account_info.js','game_files.js','html_vars.js','ipcStorage.js','main.js','monitoring_util.js'].includes(entry.name);
    if(!allowed)continue;
    await cp(path.join(source!,'.caracal',entry.name),path.join(native,entry.name),{recursive:true});
  }
  async function run(args:string[]){const start=performance.now();let output='';await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(app,'tools/caracal/install.mts'),...args],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(output)));
  });return {ms:performance.now()-start,output};}
  const buildPreparation=await run([native]);
  const runs=[];
  for(let round=0;round<3;round++){
    const targets=[path.join(root,'legacy-'+round),path.join(root,'prepared-'+round)];
    for(const target of targets){await mkdir(target,{recursive:true});await writeFile(path.join(target,'config.json'),'account sentinel');await mkdir(path.join(target,'localStorage'));await writeFile(path.join(target,'localStorage/state.json'),'state sentinel');}
    const legacy=await run([targets[0],'--artifact-native',native]);
    const prepared=await run([targets[1],'--artifact-native',native,'--prepared-native']);
    async function hashes(target:string,relative=''):Promise<Record<string,string>>{const result:Record<string,string>={};for(const entry of await readdir(path.join(target,relative),{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())Object.assign(result,await hashes(target,name));else result[name]=createHash('sha256').update(await readFile(path.join(target,name))).digest('hex');}return result;}
    const actual=await hashes(targets[1]);expect(actual).toEqual(await hashes(targets[0]));
    for(const target of targets){expect(await readFile(path.join(target,'config.json'),'utf8')).toBe('account sentinel');expect(await readFile(path.join(target,'localStorage/state.json'),'utf8')).toBe('state sentinel');}
    runs.push({round,legacy,prepared,savedMs:legacy.ms-prepared.ms,files:actual});
  }
  await info.attach('prepared-native-benchmark',{body:JSON.stringify({buildPreparation,runs},null,2),contentType:'application/json'});
});
