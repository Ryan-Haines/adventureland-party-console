import {test,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ConsoleBuildStore} from '../tools/console-build/store';

test('console lock cleanup retries its detached generation without deleting the successor',async({},info)=>{
  const root=info.outputPath('real-store'),script=info.outputPath('cleanup-race.mts'),report=info.outputPath('cleanup-race.json');
  await mkdir(root,{recursive:true});
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools/console-build/store.ts');
  await writeFile(script,`
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    const nativeRm=fs.rm,root=${JSON.stringify(root)},report=${JSON.stringify(report)};
    const lock=path.join(root,'.build/console/operation.lock');
    let injected=false,original,successor,successorTask,releaseSuccessor,ownedSuccessor;
    const successorHeld=new Promise(resolve=>{releaseSuccessor=resolve;});
    const acquired=new Promise(resolve=>{ownedSuccessor=resolve;});
    const attempts=[];
    fs.rm=async(file,options)=>{
      const target=path.resolve(String(file));
      if(path.basename(target).startsWith('operation.lock'))attempts.push(target);
      if(!injected&&path.basename(target).startsWith('operation.lock')&&!path.basename(target).includes('.abandoned-')){
        injected=true;
        // Declared Windows partial-cleanup fault: owner disappeared, then an
        // auditor/successor advanced. Keep all actual filesystem identities.
        if(target===lock)await fs.rename(lock,lock+'.partial-old');
        else await fs.unlink(path.join(target,'owner.json'));
        successorTask=store.locked(async()=>{
          successor=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));
          await fs.writeFile(path.join(lock,'successor.txt'),'must survive previous cleanup');
          ownedSuccessor();await successorHeld;
        });
        await acquired;
        await fs.writeFile(path.join(target,'partial-cleanup.txt'),'contending filesystem entry');
        throw Object.assign(Error('Declared transient directory-not-empty cleanup'),{code:'ENOTEMPTY'});
      }
      return nativeRm(file,options);
    };
    syncBuiltinESMExports();
    const {ConsoleBuildStore}=await import(${JSON.stringify(pathToFileURL(source).href)});
    const store=new ConsoleBuildStore(root);
    let result,error,observed,marker;
    try{result=await store.locked(async()=>{original=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));return 'completed';});}
    catch(value){error=String(value);}
    if(successor){observed=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));marker=await fs.readFile(path.join(lock,'successor.txt'),'utf8');}
    releaseSuccessor();if(successorTask)await successorTask;
    await fs.writeFile(report,JSON.stringify({result,error,original,successor,observed,marker,attempts},null,2));
  `);
  await promisify(execFile)(process.execPath,[script],{windowsHide:true,timeout:30_000});
  const evidence=JSON.parse(await readFile(report,'utf8'));
  await info.attach('real-filesystem-detached-lock-cleanup',{body:JSON.stringify(evidence),contentType:'application/json'});
  expect(evidence.error).toBeUndefined();expect(evidence.result).toBe('completed');
  expect(evidence.successor.token).not.toBe(evidence.original.token);
  expect(evidence.observed).toEqual(evidence.successor);
  expect(evidence.marker).toBe('must survive previous cleanup');
});

test('console lock release preserves a live recovery auditor until its inspection finishes',async({},info)=>{
  const store=new ConsoleBuildStore(info.outputPath('auditor-store'));
  const lock=path.join(store.directory,'operation.lock'),claim=path.join(lock,'recovery');
  let audit!:Promise<unknown>,owner:unknown;
  const result=await store.locked(async()=>{
    owner=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
    await mkdir(claim);await writeFile(path.join(claim,'owner.json'),JSON.stringify({pid:process.pid,token:'live-auditor'}));
    audit=(async()=>{await new Promise(resolve=>setTimeout(resolve,100));
      const observed=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
      const {rm}=await import('node:fs/promises');await rm(claim,{recursive:true});return observed;})().catch(error=>({error:String(error)}));
    return 'audited';
  });
  const observed=await audit;
  await info.attach('real-filesystem-auditor-generation',{body:JSON.stringify({owner,observed,result}),contentType:'application/json'});
  expect(observed).toEqual(owner);expect(result).toBe('audited');
});

for(const mode of ['transient','permanent','unrelated','replacement'] as const){
  test(`console lock release handles ${mode} rename failures without losing ownership`,async({},info)=>{
    const root=info.outputPath('rename-store'),script=info.outputPath('rename-fault.mts'),report=info.outputPath('rename-fault.json');
    await mkdir(root,{recursive:true});
    const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools/console-build/store.ts');
    await writeFile(script,`
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import {syncBuiltinESMExports} from 'node:module';
      const root=${JSON.stringify(root)},report=${JSON.stringify(report)},mode=${JSON.stringify(mode)};
      const lock=path.join(root,'.build/console/operation.lock'),nativeRename=fs.rename,attempts=[],warnings=[];
      console.warn=(...values)=>{warnings.push(values.join(' '));};
      fs.rename=async(from,to)=>{
        if(String(from)===lock&&String(to).startsWith(lock+'.released-')){
          attempts.push({owner:JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8')),
            auditor:JSON.parse(await fs.readFile(path.join(lock,'recovery/owner.json'),'utf8'))});
          if(mode==='replacement')await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token:'replacement-generation'}));
          if(mode!=='transient'||attempts.length===1)
            throw Object.assign(Error('Declared rename boundary fault'),{code:mode==='unrelated'?'EACCES':'EPERM'});
        }
        return nativeRename(from,to);
      };
      syncBuiltinESMExports();
      const {ConsoleBuildStore}=await import(${JSON.stringify(pathToFileURL(source).href)});
      const store=new ConsoleBuildStore(root);let original,result,error;
      try{result=await store.locked(async()=>{original=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));return 'completed';});}
      catch(value){error={message:String(value),code:value.code};}
      const remainingOwner=await fs.readFile(path.join(lock,'owner.json'),'utf8').then(JSON.parse).catch(()=>null);
      const entries=await fs.readdir(store.directory);
      await fs.writeFile(report,JSON.stringify({mode,original,result,error,attempts,warnings,remainingOwner,entries},null,2));
    `);
    await promisify(execFile)(process.execPath,[script],{windowsHide:true,timeout:30_000});
    const evidence=JSON.parse(await readFile(report,'utf8'));
    await info.attach('real-filesystem-rename-boundary',{body:JSON.stringify(evidence),contentType:'application/json'});
    expect(evidence.attempts.every((attempt:any)=>attempt.owner.token===evidence.original.token&&attempt.auditor.token===evidence.original.token)).toBe(true);
    if(mode==='transient'){
      expect(evidence.error).toBeUndefined();expect(evidence.result).toBe('completed');
      expect(evidence.attempts).toHaveLength(2);expect(evidence.remainingOwner).toBeNull();expect(evidence.entries).toEqual([]);
    }else if(mode==='replacement'){
      expect(evidence.error).toBeUndefined();expect(evidence.result).toBe('completed');
      expect(evidence.attempts).toHaveLength(1);expect(evidence.remainingOwner.token).toBe('replacement-generation');
      expect(evidence.entries).toEqual(['operation.lock']);
    }else{
      expect(evidence.error.code).toBe(mode==='permanent'?'EPERM':'EACCES');
      expect(evidence.result).toBeUndefined();
      // whileShared retries a sharing violation until its bound ends (tools/build-store.ts
      // SHARING_VIOLATION) and logs that end; an unrelated code fails on the first attempt.
      if(mode==='permanent'){
        expect(evidence.attempts.length).toBeGreaterThan(1);
        expect(evidence.warnings.filter((line:string)=>line.startsWith('[bound] sharingViolationMs'))).toHaveLength(1);
      }else{expect(evidence.attempts).toHaveLength(1);expect(evidence.warnings).toEqual([]);}
      expect(evidence.remainingOwner).toEqual(evidence.original);expect(evidence.entries).toEqual(['operation.lock']);
    }
  });
}
