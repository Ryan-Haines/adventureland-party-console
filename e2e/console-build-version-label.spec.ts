import {test,expect} from './fixtures';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {updateHosting} from '../tools/update/hosting';

test('running header follows the release base and development branch without restarting',async({page},info)=>{
  // Failure inventory: cached version/branch survives a checkout change;
  // updating labels installs code or switches the developer's branch.
  const root=info.outputPath('checkout'),data=info.outputPath('data');
  await mkdir(root,{recursive:true});
  const execute=promisify(execFile);
  const git=(...args:string[])=>execute('git',['-C',root,...args],{windowsHide:true});
  const commit=async(value:string)=>{
    await writeFile(path.join(root,'source.txt'),value);
    await git('add','.');
    await git('-c','user.name=Console E2E','-c','user.email=console@example.test','commit','-m',value);
  };
  await git('init','-b','main');
  await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));
  await writeFile(path.join(root,'distribution.json'),JSON.stringify({repository:'fixture/party-console'}));
  await commit('baseline');await git('tag','v1.4.0');
  await git('switch','-c','1.5-feature-branch');await commit('release changes');
  const nativeFetch=globalThis.fetch;
  // Declared external release feed: no update is published during this label test.
  globalThis.fetch=((input:any,init:any)=>String(input)==='https://api.github.com/repos/fixture/party-console/releases/latest'
    ?Promise.resolve(new Response('{}',{status:404})):nativeFetch(input,init)) as typeof fetch;
  const actions:string[]=[];
  let server:ReturnType<typeof createServer>|undefined;
  try{
    const updates=await updateHosting(root,data);
    server=createServer((req,res)=>{if(req.method==='POST')actions.push(req.url||'');void updates.route(req,res,req.url||'/console-update');});
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw Error('Missing test update port');
    const url=`http://127.0.0.1:${address.port}/console-update`;
    await page.route('**/console-update',async route=>route.fulfill({json:await(await nativeFetch(url)).json()}));
    await page.goto('/');
    const header=page.locator('header');
    await expect(header).toContainText('Console v1.4.0 + 1.5-feature-branch');
    await git('tag','v1.5.0');await git('switch','-c','codex/1.6-release');await commit('new development');
    await expect(header).toContainText('Console v1.5.0 + codex/1.6-release',{timeout:15_000});
    expect((await git('branch','--show-current')).stdout.trim()).toBe('codex/1.6-release');
    expect(actions).toEqual([]);
    await info.attach('release-base-and-branch-header',{body:await page.screenshot(),contentType:'image/png'});
    await info.attach('running-version-label-evidence',{body:JSON.stringify({state:await(await nativeFetch(url)).json(),actions,branch:(await git('branch','--show-current')).stdout.trim()}),contentType:'application/json'});
  }finally{
    globalThis.fetch=nativeFetch;
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
  }
});
