// The add-on context, actions, ticks, forwarded commands and the one store model
// Each row names the HOOKS fixture it backs.
const test=require('node:test'),assert=require('node:assert/strict');
const {loaded,addon}=require('./fixtures/hook-registry-scenario.cjs');
const {createStoreBook}=require('../../runtime/hooks/store.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const down=(scope,stores={})=>({keys:{character:'character:W',scope:'scope:'+scope,party:'party'},stores});

test('C3: every add-on answer gets its context after its settings, with the scope values on every hook',()=>{
  const r=loaded(),seen=[];
  r.register(addon('t',{'group.anchor':(members,settings,ctx)=>{seen.push({settings,ctx});return undefined;},
    'status.report':(_view,settings,ctx)=>({side:ctx.side,character:ctx.character,scope:ctx.scope,radius:settings.radius})},
    {settings:{radius:{label:'Radius',kind:'number',default:10}}}));
  r.configure({t:{enabled:true,settings:{radius:20}}});
  // Coordinator: the caller names the scope, whose own value replaces the account's (tank-hold gap 2).
  r.attach({side:'coordinator'});
  r.within({owner:'L',character:'W',scope:{addonSettings:{t:{radius:30}}}},()=>r.anchor([]));
  assert.equal(seen[0].settings.radius,30);assert.equal(seen[0].ctx.side,'coordinator');assert.equal(seen[0].ctx.scope,'L');
  assert.equal(seen[0].ctx.character,'W');assert.equal(seen[0].ctx.settings.radius,30);
  r.anchor([]);assert.equal(seen[1].settings.radius,20,'a call with no scope reads the account value');
  // Character: the reply's addonScope names the owner and the scope's values.
  const c=loaded();c.register(addon('t',{'status.report':(_view,settings,ctx)=>({side:ctx.side,character:ctx.character,scope:ctx.scope,radius:settings.radius})},
    {settings:{radius:{label:'Radius',kind:'number',default:10}}}));
  c.attach({side:'character',name:'W'});
  c.reply({addons:{t:{enabled:true}},addonScope:{owner:'L',settings:{t:{radius:40}}},addonStores:down('L')});
  assert.deepEqual(c.reports({}),{t:{side:'character',character:'W',scope:'L',radius:40}});
});

test('C3: ctx.read reaches a hook row on its own side and fails naming the other side',()=>{
  const r=loaded();let answer;
  r.register(addon('t',{'status.report':(_v,_s,ctx)=>{answer=name=>ctx.read(name);return undefined;}}));
  r.configure({t:{enabled:true}});r.attach({side:'character',name:'W'});r.reports({});
  assert.throws(()=>answer('addon.commanded'),/addon\.commanded answers on the coordinator; this is the character/);
  assert.throws(()=>answer('addon.acted'),/addon\.acted is a notice/);
  r.register({name:'core:life',folder:'core',author:'t',summary:'t',hooks:{'lifecycle.held':()=>false}});
  assert.equal(answer('lifecycle.held'),false,'a row with no side answers on either');
  assert.throws(()=>r.askRow('no.such.read',[]),/neither a hook row nor a READS row/);
  assert.deepEqual(r.publishReads({'no.such.read':()=>1}).ok,false);
});

test('addon.tick: each enabled add-on ticks once per report with its context, on both sides',()=>{
  const r=loaded(),ticks=[];
  r.register(addon('t',{'addon.tick':(view,_s,ctx)=>{ticks.push([view.character,ctx.side,ctx.scope]);ctx.store.party.set('n',ticks.length);}}));
  r.tick('W');assert.deepEqual(ticks,[],'an add-on that is off never ticks');
  r.configure({t:{enabled:true}});r.attach({side:'coordinator'});
  r.tick('W',{owner:'L',state:{}});
  const c=loaded();c.register(addon('t',{'addon.tick':(view,_s,ctx)=>{ticks.push([view.character,ctx.side,ctx.scope]);}}));
  c.attach({side:'character',name:'W'});c.reply({addons:{t:{enabled:true}},addonScope:{owner:'L',settings:{}},addonStores:down('L')});c.tick('W');
  assert.deepEqual(ticks,[['W','coordinator','L'],['W','character','L']]);
  assert.equal(r.stores.book.values().t.party.n,1,"the coordinator's tick wrote the party store");
});

test('addon.acted: a refused, a replaced and a sent action reach the asking add-on',async()=>{
  const r=loaded(),acted=[],other=[],emitted=[];let ask;
  r.register(addon('a',{'addon.tick':(_v,_s,ctx)=>{for(const x of ask())ctx.act(x);},'addon.acted':p=>acted.push(p)}));
  r.register(addon('b',{'addon.acted':p=>other.push(p)}));
  r.configure({a:{enabled:true},b:{enabled:true}});r.attach({side:'character',name:'W'});
  assert.equal(r.publishDoors({nowhere:()=>undefined}).ok,false,'a door no ACTIONS row names is refused');
  let band='send';
  const {gameEvent}=require('../../runtime/hooks/actions/door.ts');
  r.publishDoors({gameEvent:gameEvent({emit:(e,d)=>emitted.push([e,d]),band:()=>band})});
  // A closed row refuses with its code; a second ask replaces the first while it is pending.
  ask=()=>[{action:'gm',args:{},reason:'x'}];r.tick('W');await settle();
  ask=()=>[{action:'poke',args:{name:'P'},reason:'1'},{action:'set_home',args:{},reason:'2'}];r.tick('W');await settle();
  band='not-now';ask=()=>[{action:'click',args:{},reason:'3'}];r.tick('W');await settle();
  assert.deepEqual(acted.map(o=>[o.action,o.outcome,o.by??null]),[['gm','refused','FW'],['poke','refused','14'],['set_home','sent',null],['click','refused','09']]);
  assert.equal(acted[1].reason,'replaced');
  assert.deepEqual(emitted,[['set_home',{}]],'only the sent ask reached the game');
  assert.deepEqual(other,[],"another add-on never hears this add-on's outcomes");
  // The common holds go first: an escape that owns the character refuses before the door.
  r.register({name:'core:escape',folder:'core',author:'t',summary:'t',hooks:{'survival.escaping':()=>({id:'e',stage:'run'})}});
  band='send';ask=()=>[{action:'poke',args:{},reason:'4'}];r.tick('W');await settle();
  assert.deepEqual(acted.at(-1).by,'05');assert.equal(emitted.length,1);
  // A notice stays read-only.
  const n=loaded();let thrown;
  n.register(addon('a',{'addon.acted':(_p,_s,ctx)=>{try{ctx.act({action:'poke',args:{},reason:'x'});}catch(e){thrown=String(e);}}}));
  n.configure({a:{enabled:true}});n.attach({side:'character',name:'W'});n.notify('addon.acted',{addon:'a'});
  assert.match(thrown,/a notice stays read-only/);
});

test("C1: a coordinator ask rides the reply, runs on the character, and its outcome comes back in the report",async()=>{
  const coord=loaded(),acted=[];let asked=false;
  coord.register(addon('a',{'addon.tick':(_v,_s,ctx)=>{if(!asked){asked=true;ctx.act({action:'poke',args:{},reason:'r',character:'W'});}},'addon.acted':p=>acted.push(p)}));
  coord.configure({a:{enabled:true}});coord.attach({side:'coordinator'});
  coord.tick('W',{owner:'L',state:{}});
  const carried=coord.carriedAsks('W');assert.equal(carried.length,1);assert.equal(carried[0].action,'poke');
  assert.equal(coord.carriedAsks('W').length,1,'an ask in flight rides each reply until its outcome');
  const ch=loaded(),emitted=[];ch.register(addon('a',{}));ch.attach({side:'character',name:'W'});
  ch.publishDoors({gameEvent:require('../../runtime/hooks/actions/door.ts').gameEvent({emit:e=>emitted.push(e),band:()=>'send'})});
  const reply={addons:{a:{enabled:true}},addonScope:{owner:'L',settings:{}},addonStores:down('L'),addonActions:carried,addonInbox:[]};
  ch.reply(reply);await settle();ch.reply(reply);await settle();
  assert.deepEqual(emitted,['poke'],'a carried ask runs once');
  const report={addonActionResults:ch.carriedResults(),addonCommandReplies:ch.carriedReplies()};
  assert.deepEqual(report.addonActionResults.map(o=>[o.id,o.outcome]),[[carried[0].id,'sent']]);
  coord.reported('W',report);
  assert.deepEqual(acted.map(o=>o.outcome),['sent']);assert.deepEqual(coord.carriedAsks('W'),[]);
  assert.equal(coord.reported('W',report),undefined);assert.equal(acted.length,1,'an outcome settles once');
});

test("addon.commanded: a forwarded command reaches the character's addon.command and its reply comes back",()=>{
  const coord=loaded(),heard=[];
  coord.register(addon('c',{'addon.command':view=>view.body.here?{ok:true,reply:{done:true}}:{forward:true},'addon.commanded':p=>heard.push(p)}));
  coord.configure({c:{enabled:true}});coord.attach({side:'coordinator'});
  const send=coord.addonCommand('c');
  assert.deepEqual(send({owner:'L',character:'W',store:{},now:0,body:{here:true}},{}),{ok:true,reply:{done:true}});
  const forwarded=send({owner:'L',character:'W',store:{},now:0,body:{emote:'wave'}},{});
  assert.equal(forwarded.ok,true);assert.match(forwarded.reply.forwarded,/^c:/);
  assert.equal(send({owner:'L',store:{},now:0,body:{}},{}).status,400,'a forward names its character');
  const ch=loaded();
  ch.register(addon('c',{'addon.command':(view,_s,ctx)=>({ok:true,reply:{got:view.body.emote,side:ctx.side,character:view.character}})}));
  ch.attach({side:'character',name:'W'});
  ch.reply({addons:{c:{enabled:true}},addonScope:{owner:'L',settings:{}},addonStores:down('L'),addonActions:[],addonInbox:coord.inbox('W')});
  const report={addonActionResults:ch.carriedResults(),addonCommandReplies:ch.carriedReplies()};
  coord.reported('W',report);
  assert.deepEqual(heard.map(p=>[p.id,p.character,p.reply]),[[forwarded.reply.forwarded,'W',{ok:true,reply:{got:'wave',side:'character',character:'W'}}]]);
  assert.deepEqual(coord.inbox('W'),[]);
});

test('C4: per-key revisions keep a character write and a coordinator write to different keys',()=>{
  let now=7;const book=createStoreBook(()=>now),saved={W:{old:{rev:3,values:{deaths:2}}}};book.attach(saved,()=>{});
  assert.deepEqual(saved['character:W'].old.deaths,{v:2,rev:3,by:'character'},'a save from before the per-key model migrates');
  const scope={addonFarming:{t:{role:'tank'}}};
  const ch=loaded();ch.register(addon('t',{}));ch.attach({side:'character',name:'W'});ch.configure({t:{enabled:true}});
  ch.stores.restore(book.down('W',['t'],'L',scope));
  const handles=ch.stores.handles('t',()=>{});
  assert.equal(handles.scope.get('role'),'tank','the scope store reaches the character');
  handles.party.set('a',1);handles.scope.set('role','healer');
  now=9;assert.equal(book.patch('t','party',{b:2}),undefined,'a dashboard write to another key');
  assert.match(book.patch('t','scope:L',{x:1}),/not a character or party store/);
  const up=ch.stores.report();book.merge('W',up);
  const back=book.down('W',['t'],'L',scope);
  assert.equal(scope.addonFarming.t.role,'healer',"the character's scope write lands in the scope's addonFarming");
  ch.stores.restore(back);
  assert.deepEqual([handles.party.get('a'),handles.party.get('b'),handles.scope.get('role')],[1,2,'healer']);
  assert.ok(handles.party.rev()>=9,"the dashboard write carries the coordinator clock");
  // A value that is not JSON is refused at set.
  const refusals=[];const h2=ch.stores.handles('t',m=>refusals.push(m));h2.party.set('f',()=>1);
  assert.match(refusals[0],/not JSON/);
});
