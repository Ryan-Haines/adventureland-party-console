const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {versionLabel}=require('../../tools/update/version-label.ts');
test('console version distinguishes packaged releases, release tags, branches and source archives',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'party-version-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
 try{
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));
  assert.equal(await versionLabel(root),'1.0.0 + development');
  assert.equal(await versionLabel(root,{version:'1.2.3'}),'1.2.3');
  git('init');git('add','package.json');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','initial');git('tag','v1.0.1');
  assert.equal(await versionLabel(root),'1.0.1');
  git('checkout','-b','fix/solo-farming');await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.1'}));
  assert.equal(await versionLabel(root),'1.0.1 + fix/solo-farming');
  git('add','package.json');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','change');
  assert.equal(await versionLabel(root),'1.0.1 + fix/solo-farming');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
