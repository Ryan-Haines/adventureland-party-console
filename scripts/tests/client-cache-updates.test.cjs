const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const files=require('../client-files.cjs');
test('live refresh stages complete candidates, retains old cache on failure and detects same-version changes',async()=>{
 const cwd=process.cwd(),fetch=global.fetch,dir=await fs.mkdtemp(path.join(os.tmpdir(),'client-refresh-'));
 let version=10,bad='',body='var fixture=1;';process.chdir(dir);
 global.fetch=async url=>{
  if(url==='https://adventure.land')return new Response(`<script src="/js/game.js?v=${version}"></script><script src="/data.js"></script><script src="/js/new_helper.js"></script>`);
  if(url==='https://adventure.land/runner')return new Response('<script src="/js/runner_functions.js"></script><script src="/js/runner_compat.js"></script>');
  if(bad==='download'&&url.includes('new_helper'))return new Response('',{status:503});
  if(url.includes('/data.js'))return new Response(bad==='data'?'var G={};':'var G={geometry:{},maps:{},items:{}};');
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
 } finally {global.fetch=fetch;process.chdir(cwd);await fs.rm(dir,{recursive:true,force:true});}
});
