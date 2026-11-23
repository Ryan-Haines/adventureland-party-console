import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

if (process.env.RUN_DOCKER_STORAGE_UPGRADE === '1') test('Docker replacement retains the migrated party and rolls back a failed upgrade', async ({}, info) => {
  test.setTimeout(180_000);
  const volume = 'party-storage-e2e-' + randomUUID();
  const image = process.env.E2E_STORAGE_IMAGE || 'node:26.12.1-bookworm-slim';
  const docker = (args:string[]) => execFileSync('docker', args, {encoding:'utf8', windowsHide:true, timeout:90_000});
  docker(['volume','create',volume]);
  try {
    for (const phase of ['legacy','replacement']) {
      const evidence = docker(['run','--rm','--network','none','--entrypoint','node','--mount','type=volume,src='+volume+',dst=/data',
        '--mount','type=bind,src='+process.cwd()+',dst=/source,readonly',image,'/source/e2e/fixtures/docker-storage-upgrade.mjs',phase]);
      expect(JSON.parse(evidence)).toMatchObject({roster:['bankboi0','bankboi1'], metric:42});
      await info.attach(phase, {body:evidence, contentType:'application/json'});
    }
  } finally { docker(['volume','rm',volume]); }
});

// Optional Docker journeys are not selected by the default console suite.
if(process.env.RUN_DOCKER_DEPENDENCY_UPDATE==='1')test('Docker Linux install recovers a linked dependency cache and explicitly loads an update',async({},info)=>{
  test.setTimeout(30*60_000);
  const root=path.resolve('.build/issue102',randomUUID()),context=path.join(root,'context');
  await mkdir(context,{recursive:true});
  const image='party-issue102:'+path.basename(root),container='party-issue102-'+path.basename(root),log:string[]=[];
  async function run(command:string,args:string[]){
    log.push(JSON.stringify({command,args}));
    return new Promise<string>((resolve,reject)=>{
      const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';
      for(const stream of [child.stdout!,child.stderr!])stream.on('data',chunk=>{text+=String(chunk);});
      child.once('error',reject);child.once('exit',code=>{log.push(text);code===0?resolve(text):reject(Error(command+' failed: '+text.slice(-5000)));});
    });
  }
  let created=false;
  try{
    const archive=path.join(root,'baseline.tar');
    await run('git',['archive','--format=tar','--output='+archive,'HEAD']);
    await run('tar',['-xf',archive,'-C',context]);
    // Exercise committed source only; substitute the reported legacy builder to
    // reproduce linked-cache failure before applying the current builder.
    await writeFile(path.join(context,'tools/console-build/builder.ts'),await run('git',['show','c372335:tools/console-build/builder.ts']));
    await run('docker',['build','--target','development','--tag',image,context]);
    await run('docker',['run','-d','--name',container,'--entrypoint','node',image,'-e','setInterval(()=>{},100000)']);created=true;
    await run('docker',['cp','e2e/fixtures/console-dependency-update.mjs',container+':/tmp/dependency-update.mjs']);
    await run('docker',['exec',container,'node','/tmp/dependency-update.mjs','legacy']);
    await run('docker',['cp','tools/console-build/builder.ts',container+':/opt/party-seed/tools/console-build/builder.ts']);
    await run('docker',['exec',container,'node','/tmp/dependency-update.mjs','update']);
    await run('docker',['cp',container+':/tmp/dependency-update-evidence',root]);
    const evidence=path.join(root,'dependency-update-evidence');
    for(const file of ['legacy.json','update.json','security.json','before.html','after.html'])await info.attach(file,{path:path.join(evidence,file),contentType:file.endsWith('.json')?'application/json':'text/html'});
    const result=JSON.parse(await readFile(path.join(evidence,'update.json'),'utf8'));
    expect(result.journal.phase).toBe('complete');expect(result.references.active).toBe(result.next.id);
  }finally{
    if(created){
      await run('docker',['cp',container+':/tmp/dependency-update-evidence',root]).catch(()=>{});
      await run('docker',['rm','--force','--volumes',container]);
    }
    await run('docker',['image','rm',image]).catch(()=>{});
    await info.attach('docker-install-update-log',{body:log.join('\n'),contentType:'text/plain'});
  }
});
