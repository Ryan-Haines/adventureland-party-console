const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {versionLabel,consoleVersion}=require('../../tools/update/version-label.ts');
test('console version distinguishes packaged releases, release tags, branches and source archives',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'party-version-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
 try{
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));
  assert.equal(await versionLabel(root),'1.0.0 + development');
  assert.equal((await consoleVersion(root)).current,'1.0.0');
  assert.equal(await versionLabel(root,{version:'1.2.3'}),'1.2.3');
  git('init');git('add','package.json');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','initial');git('tag','v1.0.1');
  assert.equal(await versionLabel(root),'1.0.1');
  git('checkout','-b','fix/solo-farming');await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.1'}));
  assert.equal(await versionLabel(root),'1.0.1 + fix/solo-farming');
  assert.equal((await consoleVersion(root)).current,'1.0.1');
  git('add','package.json');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','change');
  assert.equal(await versionLabel(root),'1.0.1 + fix/solo-farming');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('hosting compares the tagged source version while retaining notification-only update permissions',async()=>{
 const {updateHosting}=require('../../tools/update/hosting.ts');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'party-version-host-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
 const originalFetch=global.fetch;
 let latest='1.0.2',manifestCalls=0;
 global.fetch=async url=>{
  if(String(url).endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v'+latest,html_url:'https://example.invalid/release',draft:false,prerelease:false}));
  manifestCalls++;
  return new Response(JSON.stringify({version:latest,protocol:1,dataFormat:1,windows:{asset:'adventureland-party-console-'+latest+'-windows-x64.zip',sha256:'a'.repeat(64)},image:'ghcr.io/example/console@sha256:'+'b'.repeat(64)}));
 };
 try {
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));
  await fs.writeFile(path.join(root,'distribution.json'),JSON.stringify({repository:'example/console'}));
  git('init','-b','main');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','initial');git('tag','v1.0.2');
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0',dirty:true}));
  const hosting=await updateHosting(root,path.join(root,'data'));
  async function status() {
   let value;await hosting.route({method:'GET'},{writeHead(){},end(body){value=JSON.parse(body);}},'/console-update');return value;
  }
  let state;
  for(let i=0;i<50;i++){state=await status();if(state.phase!=='checking')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(state.current,'1.0.2');assert.equal(state.displayVersion,'1.0.2 + main');
  assert.equal(state.phase,'idle');assert.equal(state.available,undefined);assert.equal(state.managed,false);assert.equal(manifestCalls,0);
  latest='1.0.3';
  const {Readable}=require('node:stream');const request=Readable.from(['{}']);request.method='POST';request.headers={};
  await hosting.route(request,{writeHead(){},end(){}},'/console-update/check');
  for(let i=0;i<50 && !manifestCalls;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(manifestCalls,1,'a genuinely newer release still requests its manifest');
  state=await status();assert.equal(state.available,'1.0.3');assert.equal(state.phase,'available');assert.equal(state.managed,false);
 }finally{global.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}
});
