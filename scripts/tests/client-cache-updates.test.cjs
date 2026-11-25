const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const files=require('../../runtime/lifecycle/coordinator/client-files.cjs');
test('live refresh stages complete candidates, retains old cache on failure and detects same-version changes',async()=>{
 const cwd=process.cwd(),fetch=global.fetch,dir=await fs.mkdtemp(path.join(os.tmpdir(),'client-refresh-'));
 let version=10,bad='',body='var fixture=1;';process.chdir(dir);
 global.fetch=async(url,init)=>{
  if(url==='https://adventure.land')return new Response(`<script src="/js/game.js?v=${version}"></script><script src="/data.js"></script><script src="/js/new_helper.js"></script>`);
  if(url==='https://adventure.land/runner')return new Response('<script src="/js/runner_functions.js"></script><script src="/js/runner_compat.js"></script>');
  if(bad==='download'&&url.includes('new_helper'))return new Response('',{status:503});
  // `hang`: the game's site never answers; only the download's signal ends it.
  if(bad==='hang'&&url.includes('new_helper'))return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));
  if(url.includes('/data.js'))return new Response(bad==='data'?'var G={};':bad==='loop'?'while(true){}':'var G={geometry:{},maps:{},items:{}};');
  return new Response(bad==='syntax'?'const =':body);
 };
 try {
  const initial=await files.refresh_latest();assert.equal(initial.version,10);
  version=11;bad='download';await assert.rejects(files.refresh_latest(),/HTTP 503/);assert.deepEqual(await files.available_versions(),[10]);
  bad='';const second=await files.refresh_latest();assert.equal(second.version,11);
  const manifest=await fs.readFile('game_files/11/client_scripts.json','utf8'),oldGame=await fs.readFile('game_files/11/game.js','utf8');
  for(bad of ['syntax','data']){await assert.rejects(files.refresh_latest(true));assert.equal(await fs.readFile('game_files/11/game.js','utf8'),oldGame);assert.equal(await fs.readFile('game_files/11/client_scripts.json','utf8'),manifest);}
  bad='';body='var fixture=2;';const third=await files.refresh_latest(true);assert.equal(third.version,11);assert.notEqual(third.revision,second.revision);assert.equal(await files.get_revision(11),third.revision);
  assert.deepEqual((await fs.readdir('game_files')).sort(),['10','11']);
  // clientDownloadMs and clientDataCheckMs (lifecycle/fields.ts, bigcheck/bounds.md): a download the
  // site never answers and a data.js that never ends fail the refresh at their kept bounds and tell
  // the bound record lifecycle's start.ts hands in.
  const picks=require('../../runtime/lifecycle/fields.ts').lifecycleSavedFields.settings,saved=[picks.clientDownloadMs.default,picks.clientDataCheckMs.default];
  const fired=[];files.reportBounds(firing=>fired.push([firing.bound,firing.owner]));
  picks.clientDownloadMs.default=20;picks.clientDataCheckMs.default=20;
  try { for(bad of ['hang','loop'])await assert.rejects(files.refresh_latest(true)); }
  finally { [picks.clientDownloadMs.default,picks.clientDataCheckMs.default]=saved;files.reportBounds(()=>{}); }
  assert.deepEqual(fired,[['clientDownloadMs','13'],['clientDataCheckMs','13']]);
  assert.equal(await fs.readFile('game_files/11/game.js','utf8'),'var fixture=2;','a failed refresh keeps the cached files');
 } finally {global.fetch=fetch;process.chdir(cwd);await fs.rm(dir,{recursive:true,force:true});}
});
