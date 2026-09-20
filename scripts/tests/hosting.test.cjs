const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Access}=require('../../tools/hosting/access.ts');
const {gateway,loaderCode}=require('../../tools/hosting/gateway.ts');
const {serverAddress,steamBootstrap}=require('../../runtime/steam/connection.ts');
const {mailPostage}=require('../mail-postage.cjs');
const {scripts}=require('../client-files.cjs');
const {accountPayload,sessionValue}=require('../../tools/hosting/account.ts');
test('onboarding accepts current and legacy account payloads and normalizes quoted sessions',()=>{
 const account={characters:[{name:'UserMerchant',type:'merchant'}],servers:[{key:'SR_USII'}]};
 assert.deepEqual(accountPayload(account),account);assert.deepEqual(accountPayload([account]),account);
 assert.deepEqual(accountPayload({infs:[{...account,type:'servers_and_characters'}]}).characters,account.characters);
 assert.throws(()=>accountPayload({message:'login required'}),/not accepted/);
 assert.equal(sessionValue('"1234-private"'),'1234-private');assert.throws(()=>sessionValue('broken session'),/Invalid/);
});

test('session format accepts MongoDB and legacy account IDs without changing the credential',()=>{
 for(const session of ['US_Abc123-privateToken','US_123456-private_token.1~','123456-privateToken']) {
  for(const raw of [session,'  '+session+'\n','"'+session+'"',"'"+session+"'",'  " '+session+' "  ',"'\n"+session+"\n'"])
   assert.equal(sessionValue(raw),session);
 }
 for(const raw of ['', 'privateToken', 'US_-privateToken', 'US_Abc123-', 'US_Abc123-token\r\nCookie: injected', 'US_Abc123-token; other=value']) {
  assert.throws(()=>sessionValue(raw),/Invalid game session format.*full user ID and auth/);
 }
});

test('ALData preparation opens a mail draft and makes no paid send request',async()=>{
 const vm=require('node:vm'),ts=require('typescript');
 const file=await fs.readFile(path.join(__dirname,'../../dashboard/features/party/use-party-console.tsx'),'utf8');
 const ast=ts.createSourceFile('console.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='aldataAction')declaration=node;ts.forEachChild(node,visit);}visit(ast);
 const source=declaration.getText(ast);
 const calls=[],drafts=[],opened=[];
 const context={API:'/party-api',fetch:async(url,options)=>{calls.push([url,options]);return{ok:true,json:async()=>({key:'unique-key'})}},
  setALDataBusy(){},setActionError(error){assert.equal(error,null)},setMailDraft:draft=>drafts.push(draft),setSettingsOpen(){},setMailOpen:open=>opened.push(open)};
 vm.createContext(context);vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 await context.aldataAction('send');
 assert.deepEqual(calls,[['/party-api/aldata/key',undefined]]);assert.deepEqual(JSON.parse(JSON.stringify(drafts)),[{recipient:'earthiverse',subject:'aldata_auth',message:'unique-key'}]);
 assert.deepEqual(opened,[true]);
});
test('pairing is single-use, credentials survive restart, and Steam can be revoked',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'party-access-'));
 try {
  const file=path.join(dir,'access.json'),a=new Access(file);await a.load();
  const invitation=await a.invitation(),browser=await a.pair(invitation);
  await assert.rejects(a.pair(invitation),/already used/);
  const steam=await a.steam(),b=new Access(file);await b.load();
  assert.ok(b.valid('browsers',browser));assert.ok(b.valid('steam',steam));
  assert.ok(!(await fs.readFile(file,'utf8')).includes(browser));
  await b.revokeSteam();assert.equal(b.valid('steam',steam),false);assert.ok(b.valid('browsers',browser));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('gateway requires pairing and rejects foreign origins and revoked Steam tokens',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'party-gateway-')),a=new Access(path.join(dir,'access.json'));
 await a.load();await a.setRequired(true);const invitation=await a.invitation();
 const server=gateway({access:a,configured:()=>false,configure:async()=>{},dashboardPort:1});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try {
  assert.equal((await fetch(base+'/setup/state')).status,401);
  assert.equal((await fetch(base+'/setup/pair',{method:'POST',headers:{Origin:'https://foreign.example'},body:JSON.stringify({token:invitation})})).status,403);
  const paired=await fetch(base+'/setup/pair',{method:'POST',headers:{Origin:base},body:JSON.stringify({token:invitation})});
  assert.equal(paired.status,200);const cookie=paired.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/setup/state',{headers:{Cookie:cookie}})).status,200);
  const token=await a.steam();
  assert.equal((await fetch(base+'/bridge/'+token+'/party-api/state',{headers:{Origin:'https://foreign.example'}})).status,403);
  const preflight=await fetch(base+'/bridge/'+token+'/party-api/state',{method:'OPTIONS',headers:{Origin:'https://adventure.land'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://adventure.land');
  await a.revokeSteam();assert.equal((await fetch(base+'/bridge/'+token+'/party-api/state')).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
test('remote bootstrap preserves server in both runner and parent without changing bundle bytes',()=>{
 const base='http://pi:3010/bridge/abc';assert.equal(serverAddress({parent:{__partyServer:base}}),base);
 assert.equal(loaderCode(base),steamBootstrap(base));assert.equal(loaderCode(base),'$.getScript("http://pi:3010/bridge/abc/CODE/adventure_land/universal-loader.js");');
});
test('official manifest finds future helpers in order and excludes foreign vendors',()=>{
 const html='<script src="/js/game.js?v=123"></script><script src="/js/new_helper.js"></script><script src="https://evil.example/evil.js"></script><script src="/data.js?v=123"></script>';
 const files=scripts(html);assert.ok(files.indexOf('/js/new_helper.js')>files.indexOf('/js/game.js'));
 assert.ok(!files.some(file=>file.includes('evil')));assert.throws(()=>scripts('<html>offline</html>'),/required/);
 assert.deepEqual(scripts('<script src="/js/runner_functions.js"></script><script src="/js/runner_compat.js"></script>',true),['/js/runner_functions.js','/js/runner_compat.js']);
});
test('postage uses official client amount and gracefully handles changed markup',()=>{
 assert.equal(mailPostage('Send Mail <span>Cost:</span> <span style=\'color: gold\'>48,000</span>'),48000);
 assert.equal(mailPostage('Send Mail <span>Cost:</span> <span style=\'color: gold\'>52,000</span>'),52000);
 assert.equal(mailPostage('Changed game UI'),null);
 assert.equal(mailPostage('phrase.html("interface.load_mail.cost") + "</span> <span style=\'color: gold\'>48,000</span>"'),48000);
});

test('client update failure retains a complete manifest; simultaneous refreshes share one download',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'party-client-')),previous=process.cwd(),originalFetch=global.fetch;
 const files=require('../client-files.cjs');let missing=false,calls=0;
 process.chdir(dir);
 global.fetch=async url=>{
  calls++;
  if(url==='https://adventure.land')return new Response('<script src="/js/game.js?v=123"></script><script src="/data.js"></script>'+ (missing?'<script src="/js/future.js"></script>':''));
  if(url==='https://adventure.land/runner')return new Response('<script src="/js/runner_functions.js"></script><script src="/js/runner_compat.js"></script>');
  return missing && url.includes('future.js')?new Response('',{status:503}):new Response(url.includes('/data.js')?'var G={geometry:{},maps:{},items:{}};':'var fixture=1;');
 };
 try {
  const a=files.ensure_latest(),b=files.ensure_latest();assert.equal(a,b);assert.equal(await a,123);
  const manifest=await fs.readFile('game_files/123/client_scripts.json','utf8');assert.ok(calls>2);
  missing=true;assert.equal(await files.ensure_latest(),123);
  assert.equal(await fs.readFile('game_files/123/client_scripts.json','utf8'),manifest);
  assert.ok(!files.get_game_files(123).includes('/js/future.js'));
  assert.deepEqual(await fs.readdir('game_files'),['123']);
 }finally{process.chdir(previous);global.fetch=originalFetch;await fs.rm(dir,{recursive:true,force:true});}
});
