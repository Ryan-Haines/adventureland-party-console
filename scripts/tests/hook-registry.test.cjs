// The hook registry's load checks ("Step 9 design"; 00-overview "Conflicts show at load"). Failure list first, in
// e2e/movement-owner-failures.md "Step 9" items 1 to 3, 5 and 8, and "Step 11" items 2 and 3. Isolated because a refused
// load happens before any game run starts.
const test=require('node:test'), assert=require('node:assert/strict');
// The realm registry holds only the core registrations, so an installed add-on that answers a
// one-answer hook this file's own add-on answers leaves its rows as they are (helpers/core-hooks.cjs).
require('./helpers/core-hooks.cjs');
const {createRegistry}=require('../../runtime/hooks/registry.ts');
const {coreRegistrations}=require('../../runtime/hooks/core.ts');
const {itemsSince}=require('./helpers/items-notices.cjs');
const {testRegistry}=require('./helpers/test-registry.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {createTaskOwner}=require('../../runtime/tasks/coordinator/owner.ts'),{tasksRegistration}=require('../../runtime/tasks/coordinator/install.ts');
// The real task owner with the registry as its notice port.
const taskOwner=r=>{const o=createTaskOwner({now:()=>Date.now(),notify:(hook,payload)=>r.notify(hook,payload),snapshot(){}});
  o.sync([{id:'party:W',kind:'party',members:['W','P']}]);return o;};

// The registry builders live in the shared harness (layer 7 step 5): the console's own
// registrations, an add-on, and a character's registrations with the turns and targeting owners'.
const {loaded,addon,character,entry}=require('./fixtures/hook-registry-scenario.cjs');
const mover=(name,tier,answer=()=>({kind:'hold',reason:name}))=>({name,tier,answer});

test('item 1: a hook the table does not declare is refused and named',()=>{
  const r=loaded(),result=r.register(addon('x',{'movement.teleport':()=>{}}));
  assert.equal(result.ok,false);assert.match(result.message,/x answers the hook "movement.teleport", which the hook table does not declare/);
  assert.deepEqual(r.refusals().map(x=>x.name),['x']);
});

test('item 2: an add-on mover outside the rank table, or at or above manual, is refused',()=>{
  const r=loaded();
  assert.match(r.register(addon('a',{'movement.request':[mover('m','teleport')]})).message,/tier "teleport", which the rank table does not have/);
  for(const tier of ['manual','town','escape'])
    assert.match(r.register(addon('b-'+tier,{'movement.request':[mover('m',tier)]})).message,new RegExp(`tier "${tier}", at or above your own commands`));
  // App, idle and realm-hold are task rows that move nobody.
  for(const tier of ['app','idle'])
    assert.match(r.register(addon('d-'+tier,{'movement.request':[mover('m',tier)]})).message,new RegExp(`tier "${tier}", which moves no character`));
  assert.match(r.register(addon('d-realm-hold',{'movement.request':[mover('m','realm-hold')]})).message,/tier "realm-hold", at or above your own commands/);
  assert.deepEqual(r.register(addon('c',{'movement.request':[mover('m','hunt-turn-in')]})),{ok:true});
  // An add-on task names addon-task, and any other tier is refused at load with it.
  for(const tier of ['hunt-mission','manual',undefined])
    assert.match(r.register(addon('task-'+tier,{'task.request':()=>undefined},{taskTier:tier})).message,new RegExp(`asks for tasks at the tier "${tier??'none'}"; an add-on task names addon-task`));
  assert.deepEqual(r.register(addon('task-ok',{'task.request':()=>undefined},{taskTier:'addon-task'})),{ok:true});
});

test('item 3: a second answer to group.anchor is refused and names both while both are on',()=>{
  const r=loaded();
  r.configure({first:{enabled:true},second:{enabled:true}});
  assert.deepEqual(r.register(addon('first',{'group.anchor':()=>'A'})),{ok:true});
  assert.match(r.register(addon('second',{'group.anchor':()=>'B'})).message,/second and first both answer "group.anchor"/);
});

// An add-on switched off in the add-on manager answers nothing and holds none of its one-answer
// hooks, so another add-on can answer them (tank-hold beside a fixture that answers group.anchor).
test('item 3b: switching an add-on off releases its one-answer hooks',()=>{
  const r=loaded(),members=[{name:'W'}];
  assert.deepEqual(r.register(addon('first',{'group.anchor':()=>'A'})),{ok:true});
  assert.deepEqual(r.register(addon('second',{'group.anchor':()=>'B'})),{ok:true},'both load while off');
  r.configure({first:{enabled:true}});
  assert.equal(r.anchor(members),'A');
  r.configure({first:{enabled:false}});
  assert.equal(r.anchor(members),undefined,'the switched-off add-on answers nothing');
  r.configure({first:{enabled:false},second:{enabled:true}});
  assert.equal(r.enabled('second'),true);
  assert.equal(r.anchor(members),'B','the hook is free for the other add-on');
});

test('item 3c: switching an add-on on beside one that holds its hook keeps it off and refuses it',()=>{
  const r=loaded(),members=[{name:'W'}];
  r.register(addon('first',{'group.anchor':()=>'A'}));r.register(addon('second',{'group.anchor':()=>'B'}));
  r.configure({first:{enabled:true}});
  r.configure({first:{enabled:true},second:{enabled:true}});
  assert.equal(r.enabled('second'),false,'the add-on that was on keeps the hook');
  assert.equal(r.anchor(members),'A');
  assert.deepEqual(r.refusals().at(-1),{name:'second',message:'second and first both answer "group.anchor", a question with one answer'});
  assert.equal(r.switchProblem('second',new Set(['first'])),'second and first both answer "group.anchor", a question with one answer');
  assert.equal(r.switchProblem('second',new Set()),undefined);
});

test("item 3d: the add-on manager refuses a switch on while another add-on on holds the hook, and writes nothing",()=>{
  const was=globalThis.__partyHooks,r=loaded();
  r.register(addon('first',{'group.anchor':()=>'A'}));r.register(addon('second',{'group.anchor':()=>'B'}));
  r.configure({first:{enabled:true}});
  globalThis.__partyHooks=r;
  try{
    const writes=[],{createAddonRoutes}=require('../../runtime/hooks/http.ts');
    const routes=createAddonRoutes({write:batch=>{writes.push(batch);return {ok:true};},fighters:()=>[],persist:()=>{},now:()=>1});
    const post=body=>{const out={status:200};routes.save({body},{status(n){out.status=n;return this;},json(v){out.body=v;return this;}});return out;};
    assert.deepEqual(post({name:'second',enabled:true}),{status:409,body:{error:'second and first both answer "group.anchor", a question with one answer'}});
    assert.equal(writes.length,0);
    r.configure({first:{enabled:false}});
    assert.equal(post({name:'second',enabled:true}).status,200,'with the holder off the switch writes');
    assert.equal(writes.length,1);
  }finally{globalThis.__partyHooks=was;}
});

// The slots. addon-commands "item 4" checks that the shipped add-ons load clean.
test('item 4: a toggle beside the target mode, a second entry of one name and an add-on combat mode conflict at load',()=>{
  const r=loaded();
  const beside=addon('beside-fixture',{},{slots:[entry('target-mode','beside-mode','beside')]});
  assert.match(r.register(beside).message,/beside-fixture runs beside the target mode, and core:target-modes fills it: the target mode slot holds one selected entry/);
  const choice=addon('choice-fixture',{'target.mode':()=>undefined},{slots:[entry('target-mode','beside-mode','choice')]});
  assert.deepEqual(r.register(choice),{ok:true});
  assert.match(r.register(addon('hunt-again',{},{slots:[entry('target-mode','hunt','choice')]})).message,/both fill the target mode entry "hunt"/);
  // The combat mode is its own slot, so a combat entry never conflicts with a target
  // entry.: the groups and tasks owner opened the slot, so an add-on combat mode loads, and a
  // second entry of one name still conflicts.
  assert.deepEqual(r.entries('combat-mode').map(e=>e.mode),['auto','default','scatter']);
  assert.deepEqual(r.register(addon('swarm',{'combat.mode':()=>'scatter'},{slots:[entry('combat-mode','swarm','choice')]})),{ok:true});
  assert.match(r.register(addon('swarm-again',{},{slots:[entry('combat-mode','swarm','choice')]})).message,/both fill the combat mode entry "swarm"/);
  // An entry and its answer come together, so neither loads as a button that does nothing.
  assert.match(r.register(addon('swarm-quiet',{},{slots:[entry('combat-mode','quiet','choice')]})).message,/fills the combat mode entry "quiet" but answers no "combat.mode"/);
  assert.match(r.register(addon('swarm-loose',{'combat.mode':()=>'scatter'})).message,/answers "combat.mode" but fills no combat mode entry/);
  assert.equal(r.combatMode('swarm',[]),null,'a switched-off entry answers nothing');
  r.configure({swarm:{enabled:true}});
  assert.equal(r.combatMode('swarm',[]),'scatter');assert.equal(r.combatMode('default',[]),null,'a core entry answers in the grouped queue');
});

const {settingsWriter}=require('./helpers/settings-writer.cjs');
const {withDoor}=require('./helpers/coordinator-merchant.cjs');
// S9.5b rides on item 5: the real movement owner (movement-service-scenario.cjs) holds the
// add-on's walk when its switch turns off, and the core `addon.off` listener ends it there.
const {fixture:ownerFixture}=require('./fixtures/movement-service-scenario.cjs');
test('item 5: a switched-off add-on answers nothing, its walk ends, and switching it on needs no restart',async()=>{
  // The switch is written through the settings writer. Since the add-on system's step 1 the
  // registry hears it as any reader hears a change (core:settings' settings.changed listener), on
  // the realm's registry.
  const r=loaded(),realm=globalThis.__partyHooks;let asked=0;globalThis.__partyHooks=r;
  const addons={},writer=settingsWriter(addons,{hooks:r}),configure=value=>assert.equal(writer.write({changes:[{field:'addons',value}],by:'dashboard:addons'}).ok,true);
  r.register(addon('t',{'movement.request':[mover('m','formation',()=>{asked++;return {kind:'hold',reason:'t'};})],'group.anchor':()=>'T'},
    {settings:{tank:{label:'Tank',kind:'character',default:null}}}));
  assert.equal(r.moverAnswer({}),null);assert.equal(r.anchor([]),undefined);assert.equal(asked,0);
  configure({t:{enabled:true,settings:{tank:'P'}}});
  assert.equal(r.moverAnswer({}).registration,'t');assert.equal(r.anchor([]),'T');assert.deepEqual(r.settings('t'),{tank:'P'});
  const owner=ownerFixture();
  try{
    const walk=owner.service.move({map:'main',x:100,y:0},undefined,{request:{kind:'task-walk',owner:'addon:t:main:100:0',tier:'farming'}});walk.catch(()=>{});
    await owner.ticks(2);
    assert.equal(owner.service.live()?.owner,'addon:t:main:100:0','the add-on walks before its switch turns off');
    configure({});
    assert.equal(r.moverAnswer({}),null);assert.equal(r.anchor([]),undefined);assert.equal(r.moving(),false,'the role runner builds no mover view');
    assert.deepEqual(r.settings('t'),{tank:null});
    assert.equal(owner.service.live(),null,'the owner ends the walk a switched-off add-on still held');
    assert.equal(owner.service.records().filter(e=>e.decision==='ended').at(-1)?.code,'addon-off');
    // On again: the next call answers, from the same registration, with no reload. Another
    // holder outlives the add-on's next switch-off.
    const calls=asked;
    configure({t:{enabled:true}});
    assert.equal(r.moverAnswer({}).registration,'t');assert.equal(r.anchor([]),'T');assert.equal(asked,calls+1);
    assert.equal(owner.service.hold({kind:'task-walk',owner:'lone-walk:hunt',tier:'farming',deadline:Date.now()+60_000}),'granted');
    configure({});
    assert.equal(owner.service.live()?.owner,'lone-walk:hunt','a switch-off ends only the add-on\'s own requests');
  }finally{owner.dispose();}
  // With the real task owner, the add-on's task ends `cancelled:addon-off` when its switch
  // turns off.
  const walks=[];const tasks=taskOwner(r);r.register(tasksRegistration(tasks,{moved(){},hands(){},walk:(n,ended)=>walks.push([n.walk,n.phase??null,ended])}));
  // movement's walk notices reach the tasks owner's walk record, which `busy`
  // reads.
  r.notify('walk.formed',{group:'party:W',walk:'w1',purpose:'monster-hunt',by:'02'});r.notify('walk.phase',{group:'party:W',walk:'w1',phase:'shared-route',by:'02'});
  r.notify('walk.ended',{group:'party:W',walk:'w1',code:'arrived',by:'02'});
  assert.deepEqual(walks,[['w1',null,false],['w1','shared-route',false],['w1',null,true]]);
  {
    configure({t:{enabled:true}});
    const own=tasks.request('party:W',{kind:'addon:t',owner:'addon:t:1',tier:'addon-task',deadline:Date.now()+60_000});
    assert.equal(own.status,'granted');assert.equal(tasks.live('party:W').kind,'addon:t');
    configure({});
    assert.equal(tasks.live('party:W').kind,'idle','the switch-off ends the add-on task');
    assert.equal(tasks.ring('party:W').filter(e=>e.decision==='ended').at(-1).code,'cancelled:addon-off');
  }
  // A batch that writes the switch and the target mode sends addon.off once, after the
  // switch's own notice and before the next change's, in the writer's notice order.
  configure({t:{enabled:true}});
  const batch=settingsWriter(addons,{hooks:r});
  r.register(addon('u',{'addon.off'(){batch.notices.push({off:'u'});}}));
  configure({t:{enabled:true},u:{enabled:true}});
  batch.notices.length=0;
  assert.equal(batch.write({changes:[{field:'addons',value:{t:{enabled:true}}},{field:'targetMode',value:'hunt'}],by:'dashboard:farming'}).ok,true);
  assert.deepEqual(batch.notices.map(n=>n.off?'off '+n.off:n.field),['addons','off u','targetMode']);
  globalThis.__partyHooks=realm;
});

// Every entry declares its button, an add-on's target mode entry its status line, and a colour
// outside the slot colours is refused.
test('a slot entry with an unknown colour, no button, or an add-on target entry with no status is refused',()=>{
  const r=loaded(),e=entry('target-mode','glow');
  assert.match(r.register(addon('glow',{},{slots:[{...e,button:{...e.button,color:'magenta'}}]})).message,/colours its target mode button "glow" "magenta", which is not one of slate, cyan, emerald, violet, amber, rose, sky/);
  assert.match(r.register(addon('bare',{},{slots:[{slot:'combat-mode',mode:'bare',fills:'choice'}]})).message,/fills the combat mode entry "bare" with no button/);
  assert.match(r.register(addon('mute',{},{slots:[{...e,mode:'mute',status:undefined}]})).message,/fills the target mode entry "mute" with no status line/);
  assert.deepEqual(r.entries('combat-mode').map(x=>[x.mode,x.button.label,x.button.color]),[['auto','Auto','cyan'],['default','Default','emerald'],['scatter','Scatter','violet']]);
  assert.deepEqual(r.entries('target-mode').map(x=>[x.mode,x.button.label,x.button.color]),[['farming','Farming','sky'],['hunt','Hunt','amber']]);
});

// and: the build loads the add-on folders in code-point order of their names, so a conflict refuses
// the same add-on on every machine, and a folder's registration carries the folder's name and is an
// add-on.
test('the add-on folders load in code-point order of their names',async()=>{
  const {scratchRoot}=require('./helpers/addon-folders.cjs');
  const scratch=scratchRoot(Object.fromEntries(['zeta','alpha-2','alpha-10'].map(name=>[name,{'index.ts':true,'README.md':'#\n'}])));
  try{
    const {loadRegistry}=await import('../../runtime/hooks/cli/load.mts');
    const order=(await loadRegistry(['--root',scratch.dir])).registrations().filter(x=>x.folder==='addons').map(x=>x.name);
    assert.deepEqual(order,['alpha-10','alpha-2','zeta']);
  }finally{scratch.cleanup();}
});
test('a folder that registers under another name, or as core, is refused',()=>{
  const r=loaded();
  assert.deepEqual(r.register(addon('other',{}),'boss-zones'),{ok:false,message:"runtime/addons/boss-zones registers as other; an add-on's name is its folder's"});
  assert.deepEqual(r.register({...addon('boss-zones',{}),folder:'core'},'boss-zones'),{ok:false,message:'runtime/addons/boss-zones registers boss-zones as core; an add-on folder holds an add-on'});
  assert.deepEqual(r.register(addon('boss-zones',{}),'boss-zones'),{ok:true});
});

test('item 8: notices reach every enabled listener, and a throwing one is recorded',()=>{
  const r=loaded(),seen=[];
  r.register(addon('n',{'journey.ended':payload=>seen.push(payload)}));
  r.register(addon('bad',{'journey.ended':()=>{throw Error('listener broke');}}));
  r.configure({n:{enabled:true},bad:{enabled:true}});
  assert.deepEqual(r.notify('journey.ended',{requestId:'j1',code:'arrived'}),['bad']);
  assert.deepEqual(seen,[{requestId:'j1',code:'arrived'}]);
  assert.match(r.noticeErrors()[0].error,/listener broke/);
  // With the real owner each task has exactly one task.ended, one task.started per start or
  // resume, and the throwing listener does not stop the notice.
  const counts={};
  r.register(addon('tasks',{'task.started':p=>{counts[p.taskId+':started']=(counts[p.taskId+':started']||0)+1;},
    'task.ended':p=>{counts[p.taskId+':ended']=(counts[p.taskId+':ended']||0)+1;}}));
  r.register(addon('bad-task',{'task.started':()=>{throw Error('task listener broke');}}));
  r.configure({n:{enabled:true},bad:{enabled:true},tasks:{enabled:true},'bad-task':{enabled:true}});
  const tasks=taskOwner(r),first=tasks.request('party:W',{kind:'farming',owner:'farm:1',deadline:Date.now()+60_000});
  const second=tasks.request('party:W',{kind:'addon:x',owner:'addon:x:1',tier:'addon-task',deadline:Date.now()+60_000});
  tasks.release(second,'done');tasks.release(first,'done');
  assert.deepEqual(counts,{[first.id+':started']:2,[second.id+':started']:1,[second.id+':ended']:1,[first.id+':ended']:1},
    'the farm task starts, then resumes under the add-on task, and each task ends once');
  assert.ok(r.noticeErrors().some(e=>e.name==='bad-task'&&/task listener broke/.test(e.error)));
});

// member.assigned: a member that moves to another group is assigned that group's live task.
test('a member that leaves the party for its own group sends member.assigned',()=>{
  const r=loaded(),heard=[];r.register(addon('heard',{'member.assigned':p=>heard.push(p)}));r.configure({heard:{enabled:true}});
  const tasks=createTaskOwner({now:()=>Date.now(),notify:(hook,payload)=>r.notify(hook,payload),snapshot(){},ask:()=>undefined});
  tasks.sync([{id:'party:W',kind:'party',members:['W','P']}]);
  assert.deepEqual(heard,[],'a first sync moves no one');
  tasks.sync([{id:'party:W',kind:'party',members:['W']},{id:'solo:P',kind:'solo',members:['P']}]);
  assert.deepEqual(heard.map(p=>[p.group,p.member]),[['solo:P','P']]);
});
// task.waiting: a task a higher one suspends waits behind it, named by the task that took the group.
test('a task the event suspends sends task.waiting behind the event',()=>{
  const r=loaded(),heard=[];r.register(addon('heard',{'task.waiting':p=>heard.push(p)}));r.configure({heard:{enabled:true}});
  const tasks=taskOwner(r);
  const own=tasks.request('party:W',{kind:'addon:x',owner:'addon:x:1',tier:'addon-task',deadline:Date.now()+60_000});
  tasks.request('party:W',{kind:'event-attendance',owner:'attend:goobrawl:1',event:'goobrawl',deadline:Date.now()+60_000});
  assert.deepEqual(heard.map(p=>[p.group,p.taskId,p.by]),[['party:W',own.id,'attend:goobrawl:1']]);
});
// The tasks owner's contract section "The fixture test": the two notices the live table cannot
// reach. A live rare cannot be summoned on demand, and an invariant break needs a bug the live game
// cannot plant.
test('U: a rare against a live Hunt is refused',()=>{
  const r=loaded(),heard=[];r.register(addon('heard',{'task.refused':p=>heard.push(p)}));r.configure({heard:{enabled:true}});
  const tasks=taskOwner(r);
  assert.equal(tasks.request('party:W',{kind:'hunt-mission',owner:'hunt:1',deadline:Date.now()+60_000}).status,'granted');
  // The rare's "May interrupt Hunt" switch is off.
  assert.equal(tasks.request('party:W',{kind:'rare',owner:'rare:1',interruptsHunt:false,deadline:Date.now()+60_000}).status,'refused');
  assert.deepEqual(heard.map(p=>[p.group,p.kind,p.by]),[['party:W','rare','hunt:1']]);
});
// The add-on whose task holds the group answers the question `rare`. It refuses the goldenbat, so
// that rare waits nothing and takes nothing; a phoenix it does not refuse takes the group as before.
test("U: a rare sighting against the add-on's task is refused by its answer",()=>{
  const r=loaded(),asked=[];
  r.register(addon('own',{'task.request':()=>undefined,'group.questions':v=>{asked.push([v.question,v.rare]);return v.question==='rare'&&v.rare==='goldenbat'?false:undefined;}},{taskTier:'addon-task'}));
  r.configure({own:{enabled:true}});
  const tasks=createTaskOwner({now:()=>Date.now(),notify:(hook,payload)=>r.notify(hook,payload),snapshot(){},ask:(hook,name,view)=>r.ownTask(hook,name,view)});
  tasks.sync([{id:'party:W',kind:'party',members:['W','P']}]);
  assert.equal(tasks.request('party:W',{kind:'addon:own',owner:'addon:own'}).status,'granted');
  assert.equal(tasks.refuses('party:W',{kind:'rare',owner:'rare:ask',rare:'goldenbat'}),true);
  assert.equal(tasks.request('party:W',{kind:'rare',owner:'rare:1',rare:'goldenbat'}).status,'refused');
  assert.equal(tasks.request('party:W',{kind:'rare',owner:'rare:2',rare:'phoenix'}).status,'granted');
  assert.deepEqual(asked,[['rare','goldenbat'],['rare','goldenbat'],['rare','phoenix']]);
});
test('U: a planted live task with no deadline, walk or step',()=>{
  const r=loaded(),heard=[];r.register(addon('heard',{'task.invariant':p=>heard.push(p)}));r.configure({heard:{enabled:true}});
  const tasks=taskOwner(r);
  tasks.request('party:W',{kind:'farming',owner:'farm:planted'});
  tasks.tick();tasks.tick();
  assert.deepEqual(heard.map(p=>[p.group,p.invariant,p.by]),[['party:W',1,'farm:planted']],'one notice while the break stands');
});
// Item 9 (the owner map) is proved through the command that prints it,
// scripts/tests/addon-commands.test.cjs "addon:map prints every hook".

// (e2e/movement-owner-failures.md items 1 to 3): the hook points the add-ons of 9b need. One
// scenario table: each row loads a registration and checks what the registry answers.
test('items 1 to 3: farming hooks need a mode, settings kinds, and the new hook points',()=>{
  const rows=[
    ['a target mode hook with no target mode entry is refused',r=>
      assert.match(r.register(addon('f',{'target.mode':()=>undefined})).message,/f answers "target.mode" but fills no target mode entry/)],
    ['a choice or per-character setting needs choices, and an unknown kind is refused',r=>{
      assert.match(r.register(addon('c',{},{settings:{x:{label:'X',kind:'choice',default:null}}})).message,/setting x with no choices/);
      assert.match(r.register(addon('k',{},{settings:{x:{label:'X',kind:'colour',default:null}}})).message,/kind "colour", which the settings do not have/);}],
    ['an enabled zone refuses a step, named by its add-on, and a disabled one asks nothing',r=>{
      r.register(addon('z',{'step.safety':(_v,to)=>to.x>10?'too far':undefined}));
      assert.equal(r.guardsSteps(),false);assert.equal(r.stepRefusal({}, {x:20,y:0}),undefined);
      r.configure({z:{enabled:true}});
      assert.equal(r.guardsSteps(),true);assert.equal(r.stepRefusal({}, {x:20,y:0}),'z: too far');assert.equal(r.stepRefusal({}, {x:5,y:0}),undefined);}],
    ['a target mode add-on ticks while enabled, lists its entry, and hands its state on',r=>{
      let ticked=0;
      r.register(addon('m',{'target.mode':()=>(ticked++,{avoid:['x']}),'target.settings':()=>({ok:true,reply:{}})},{slots:[entry('target-mode','mm','choice')]}));
      assert.deepEqual(r.targetTicks(),[]);assert.deepEqual(r.targetModes(),[]);assert.equal(r.targetSettings('m'),null);
      r.configure({m:{enabled:true}});
      assert.deepEqual(r.targetModes(),[{mode:'mm',addon:'m'}]);
      assert.deepEqual(r.targetTicks()[0].tick({}),{avoid:['x']});assert.equal(ticked,1);
      // The tick's answer rides the scope store's `deliver` key down to the scope's characters.
      const down=(rev,v)=>({addons:{m:{enabled:true}},addonStores:{keys:{character:'character:W',scope:'scope:W',party:'party'},stores:{'scope:W':{m:{deliver:{v,rev,by:'coordinator'}}}}}});
      r.attach({side:'character',name:'W'});
      r.reply(down(5,{avoid:['x']}));assert.deepEqual(r.delivered('m'),{avoid:['x']});
      r.reply(down(6,null));assert.equal(r.delivered('m'),null);}],
    // The settings route's answer runs through the guarded call and its shape check.
    ['a target mode add-on whose settings throw or answer another shape refuses with 500, and the log names it',r=>{
      let answer=()=>{throw Error('broken');};
      r.register(addon('m',{'target.mode':()=>undefined,'target.settings':()=>answer()},{slots:[entry('target-mode','mm','choice')]}));r.configure({m:{enabled:true}});
      assert.deepEqual(r.targetSettings('m')({}),{ok:false,status:500,error:"m's settings threw"});
      answer=()=>'saved';const refused=r.targetSettings('m')({});
      assert.equal(refused.status,500);assert.match(refused.error,/^m's settings answered "saved"/);
      assert.deepEqual(r.noticeErrors().map(e=>[e.name,e.hook,e.count]),[['m','target.settings',2]]);
      answer=()=>({ok:false,status:409,error:'busy'});assert.deepEqual(r.targetSettings('m')({}),{ok:false,status:409,error:'busy'});}],
    ['each enabled add-on reports its own fields',r=>{
      r.register(addon('s',{'status.report':()=>({seen:1})}));r.register(addon('t',{'status.report':()=>undefined}));
      r.configure({s:{enabled:true},t:{enabled:true}});
      assert.deepEqual(r.reports({}),{s:{seen:1}});}],
    // An add-on mover answers before the core positioning step of its own tier, because it
    // answers the same question, and after a higher core mover.
    ['an add-on answer runs before a core positioning step of its tier and after a higher one',r=>{
      const answer={mover:mover('m','event-attendance')};
      assert.deepEqual(['cave-recovery','franky-approach','rare-hunting'].map(core=>r.before(answer,core)),[false,true,true]);
      assert.equal(r.before(null,'franky-approach'),false);}],
    // An add-on's count lives in its coordinator store, so a reload of the character's
    // client keeps it. The coordinator's side is the store book the status intake merges.
    ['an add-on store survives a client reload through the coordinator store',r=>{
      const {createStoreBook}=require('../../runtime/hooks/store.ts');
      const counter=addon('count',{'movement.request':[{name:'c',tier:'event-attendance',answer(view,_settings,ctx){const store=ctx.store.character;
        if(view.dead&&!store.get('seen'))store.set('deaths',Number(store.get('deaths')??0)+1);store.set('seen',!!view.dead);return undefined;}}],
        'status.report':(_view,_settings,ctx)=>({deaths:Number(ctx.store.character.get('deaths')??0)})});
      const client=()=>{const c=loaded();assert.deepEqual(c.register(counter),{ok:true});c.attach({side:'character',name:'W'});c.configure({count:{enabled:true}});return c;};
      const first=client();first.moverAnswer({dead:true});first.moverAnswer({dead:true});
      assert.equal(first.reports({}).count.deaths,1,'one death, seen on two ticks');
      const saved={},book=createStoreBook();let saves=0;book.attach(saved,()=>saves++);
      assert.equal(book.merge('W',first.stores.report()).changed,true,'the status report carries the new count');
      assert.equal(saves,1,'the merge saves');
      const old={held:{},writes:{'character:W':{count:{deaths:{v:0,rev:1,by:'character'}}}}};
      assert.equal(book.merge('W',old).changed,false,'an older report never replaces it');
      // A malformed entry, or one under another character's key, is named, so the intake records
      // it, and the saved copy stays.
      assert.deepEqual(book.merge('W',{writes:{'character:W':{count:{deaths:{v:0,rev:0,by:'character'}}},'character:X':{other:{a:{v:1,rev:9,by:'character'}}}}}),{changed:false,skipped:['count','other']});
      assert.equal(saved['character:W'].count.deaths.v,1);
      const reloaded=client();
      assert.equal(reloaded.reports({}).count.deaths,0,'a reloaded client starts empty until its first reply');
      reloaded.stores.restore(book.down('W',['count'],'W',{}));
      assert.equal(reloaded.reports({}).count.deaths,1);}],
  ];
  for(const [name,check] of rows){try{check(loaded());}catch(error){error.message=name+': '+error.message;throw error;}}
});

// X1: the lifecycle owner's start reads every declared field in one pass. The coordinator's install
// answers settings.declared from the table: one entry per declared field with its owner, a fresh
// copy of the default the initializers' declared() gives, the range, the scope and whether it is
// hidden.
test('X1: the start reads every declared default in one pass',()=>{
  const {installCoordinatorSettings}=require('../../runtime/settings/coordinator/install.ts');
  const {coordinatorSettings,declared,hiddenSettings}=require('../../runtime/settings/coordinator/table.ts');
  // Each start's state carries the hidden settings the start loads (table.ts `hiddenSettings`), which
  // the install holds for every hidden read after it.
  const r=loaded(),state={statuses:{},aldata:{},settingsChanges:[],...hiddenSettings({})};
  installCoordinatorSettings(state,{hooks:r,storage:{get(){},set(){}},timers:{setTimeout,clearTimeout},now:()=>0,log(){},owned:()=>true,monsters:()=>null,spawns:()=>null,app:()=>undefined,scope:()=>state});
  const answer=r.ask('settings.declared'),{table}=coordinatorSettings();
  assert.deepEqual(answer.map(e=>e.field).sort(),[...table.fields.keys()].sort(),'every declared field, once');
  for(const entry of answer){
    assert.deepEqual(entry.default,declared(entry.field),entry.field+': the default declared() gives');
    assert.equal(entry.owner,table.fields.get(entry.field).owner,entry.field+': its owner');
  }
  const byField=Object.fromEntries(answer.map(e=>[e.field,e]));
  assert.equal(byField.historyKept.hidden,true,'a hidden setting says so');
  assert.equal(byField.escapeResumeLockoutMs.min,0,'a number carries its range');
  assert.equal(byField.followers.scope,'character','a per-character field carries its scope');
  const fresh=byField.followers.default;fresh.planted=true;
  assert.equal(r.ask('settings.declared').find(e=>e.field==='followers').default.planted,undefined,'each answer is a fresh copy');
  // A second start in one process (a reload) installs on the same registry, and its
  // writer answers through the registry's publish, with no global holding it.
  const next={statuses:{},aldata:{},settingsChanges:[],...hiddenSettings({})};
  installCoordinatorSettings(next,{hooks:r,storage:{get(){},set(){}},timers:{setTimeout,clearTimeout},now:()=>0,log(){},owned:()=>true,monsters:()=>null,spawns:()=>null,app:()=>undefined,scope:()=>next});
  assert.equal(r.write({changes:[{field:'escapeResumeLockoutMs',value:1234}],by:'dashboard:settings'}).ok,true);
  assert.equal(next.escapeResumeLockoutMs,1234,'the latest start\'s writer holds the write');
  assert.equal(state.escapeResumeLockoutMs,undefined,'the earlier start\'s state is left alone');
  assert.equal(r.read({field:'escapeResumeLockoutMs'}),1234);
  assert.equal(globalThis.__partySettingsWriter,undefined,'11 holds no global');
});

// W-S2: one registry with one add-on that declares a setting of each add-on
// kind, at each placement, written through the real writer as addressed changes.: the switch is
// a setting the writer saves, and the add-on system hears its change itself.: a posted value its
// kind or its own check refuses is refused, naming the setting's label.: a scope placement's
// value lands in the character's own farming profile, and the target mode call reads it over the
// account value.: a monsters list names game data's monsters. U rows: the character runtime's
// answer refuses a write, naming the field.
test('W-S2: an add-on setting and switch are addressed changes the one writer checks by kind',()=>{
  const r=loaded(),offs=[];
  r.register(addon('k',{'addon.off':()=>offs.push('k'),'target.mode':(_view,settings)=>({zone:settings.zone,n:settings.n})},{
    slots:[entry('target-mode','kk','choice')],
    settings:{flag:{label:'Flag',kind:'boolean',default:false},pick:{label:'Pick',kind:'choice',choices:['a','b'],default:'a'},
      n:{label:'Count',kind:'number',min:1,max:5,default:1},who:{label:'Tank',kind:'character',default:null},
      per:{label:'Role',kind:'per-character',choices:['x','y'],default:{}},note:{label:'Note',kind:'text',default:''},
      mobs:{label:'Targets',kind:'monsters',default:[]},lo:{label:'Low',kind:'number',default:1,check:(v,own)=>Number(v)<=Number(own.hi)},
      hi:{label:'High',kind:'number',default:9},zone:{label:'Zone',kind:'choice',choices:['a','b'],default:'a',scope:'scope'},
      rows:{label:'Rows',kind:'records',default:[],fields:{mobs:{label:'Monsters',kind:'monsters'},gear:{label:'Gear',kind:'items'}}}}}));
  const profiles={P:{}},state={addons:{},statuses:{W:{ctype:'warrior'},P:{ctype:'priest'},M:{ctype:'merchant'}}};
  const w=settingsWriter(state,{hooks:r,scope:name=>profiles[name],fighters:()=>['P','W'],monsters:()=>new Set(['goo','bee']),items:()=>new Set(['coat'])});
  const put=(key,value,extra={})=>w.write({by:'dashboard:addons',changes:[{field:'addons',addon:'k',key,value,...extra}]});
  assert.equal(r.enabled('k'),false);
  assert.equal(put('enabled',true).ok,true);assert.equal(r.enabled('k'),true,'SF30: the add-on system hears its switch');
  assert.equal(put('enabled',false).ok,true);assert.equal(r.enabled('k'),false);assert.deepEqual(offs,['k']);
  put('enabled',true);
  const refused=[[put('n',9),/^Count takes a number from 1 to 5$/],[put('who','M'),/^Tank takes one of the party's fighters$/],
    [put('per','z',{character:'P'}),/^Role takes one of x, y for each character$/],[put('per','x',{character:'M'}),/^Role takes one of the party's fighters$/],
    [put('flag','yes'),/^Flag takes true or false$/],[put('mobs',['goo','nope']),/^Targets takes monsters the game has$/],
    [put('mobs',['goo','goo']),/^Targets refuses this value$/],
    // A records setting's monsters and items fields name game data's ids too.
    [put('rows',[{mobs:['goo']},{mobs:['nope']}]),/^Rows takes monsters the game has$/],[put('rows',[{gear:['nope']}]),/^Rows takes items the game has$/],[put('lo',12),/^Low refuses this value$/],[put('nope',1),/^k has no setting nope$/]];
  for(const [result,error] of refused){assert.equal(result.ok,false);assert.match(result.error,error);}
  for(const [key,value,extra] of [['n',4],['who','P'],['per','x',{character:'P'}],['per','y',{character:'W'}],['note','hi'],['mobs',['goo','bee']],['rows',[{mobs:['bee'],gear:['coat']}]],['lo',3]])
    assert.equal(put(key,value,extra).ok,true,key);
  assert.deepEqual(state.addons.k,{enabled:true,settings:{n:4,who:'P',per:{P:'x',W:'y'},note:'hi',mobs:['goo','bee'],rows:[{mobs:['bee'],gear:['coat']}],lo:3}},'every key and the switch kept');
  assert.equal(w.notices.at(-1).addon,'k');assert.equal(w.notices.at(-1).key,'lo');
  // The scope placement saves in the character's own profile and the target mode call merges it.
  assert.equal(w.write({by:'dashboard:addons',changes:[{field:'addonSettings',addon:'k',key:'zone',character:'P',value:'b'}]}).ok,true);
  assert.deepEqual(profiles.P.addonSettings,{k:{zone:'b'}});assert.equal(state.addonSettings,undefined,'the leader scope keeps its own');
  assert.equal(w.write({by:'dashboard:addons',changes:[{field:'addonSettings',addon:'k',key:'zone',character:'P',value:'c'}]}).ok,false);
  assert.deepEqual(r.targetTicks()[0].tick({},profiles.P),{zone:'b',n:4});
  assert.deepEqual(r.targetTicks()[0].tick({}),{zone:'a',n:4});
  // U: the character runtime's answer refuses a write, naming its field.
  const {characterSettings}=require('../../runtime/settings/character/install.ts');
  const c=createRegistry();for(const x of coreRegistrations)c.register(x);c.register(characterSettings);
  assert.deepEqual(c.write({by:'addon:k',changes:[{field:'threshold',value:1}]}),{ok:false,field:'threshold',error:'settings are written on the coordinator'});
});

// Settings owner step 1: the declaration table refuses each invalid declaration at load, naming
// the field and every declarer of it. Planted declarers beside the console's own, which no run
// loads.
const {buildSettingsTable}=require('../../runtime/settings/rules.ts');
const {settingsDeclarations}=require('../../runtime/settings/coordinator/declarations.ts');
test('settings declarations are refused at load, naming the field and both registrations',()=>{
  const core=[...coreRegistrations,...settingsDeclarations];
  const built=buildSettingsTable(core);
  assert.equal(built.ok,true,built.refusals&&built.refusals.join('\n'));
  const own=(name,settings,records)=>({name,settings,records});
  const rows=[
    ['a field declared twice',own('twice',{threshold:{label:'T',kind:'number',default:1}}),
      /^threshold is declared twice, by core:items \(setting\) and twice \(setting\)$/],
    ['a field declared as a setting and a record',own('both',undefined,{leader:{default:null}}),
      /^leader is declared as a setting and a record, by core:tasks \(setting\) and both \(record\)$/],
    ['an unknown kind',own('k',{plantedKind:{label:'X',kind:'colour',default:null}}),/^k declares the setting plantedKind of kind "colour", which the settings do not have$/],
    ['an unknown scope',own('s',{plantedScope:{label:'X',kind:'boolean',default:false,scope:'guild'}}),/^s declares plantedScope with the scope "guild"/],
    ['an unknown document',own('d',undefined,{plantedDocument:{default:null,document:'cloud'}}),/^d declares plantedDocument in the document "cloud", which the records do not have$/],
    ['a setting in the history document',own('h',{plantedHistory:{label:'X',kind:'boolean',default:false,document:'history'}}),/^h declares plantedHistory in the document "history", which the settings do not have$/],
    // The credentials document holds only a secret setting under party.aldata (the ALData key).
    ['a plain setting in the credentials document',own('a',{plantedCredential:{label:'X',kind:'text',default:'',document:'aldata'}}),
      /^a declares plantedCredential in the credentials document, which holds only a secret setting under party.aldata$/],
    ['a choice with no choices',own('c',{plantedChoice:{label:'X',kind:'choice',default:'a'}}),/^c declares the setting plantedChoice with no choices$/],
    // A derived record (the farmingPolicy copy) sits in a farming scope beside the fields it reads.
    ['a derived record outside a farming scope',own('z',undefined,{plantedDerived:{default:'auto',derive:()=>'auto'}}),
      /^z declares plantedDerived derived, which only a farming scope's record with a top-level copy and no import is$/],
    ['a value with no check',own('v',{plantedValue:{label:'X',kind:'value',default:{}}}),/^v declares the setting plantedValue of kind "value" with no check$/],
    ['a default the kind refuses',own('n',{plantedNumber:{label:'X',kind:'number',default:0,min:1}}),/^n declares plantedNumber with a default its own check refuses$/],
    ['a default the declared check refuses',own('r',undefined,{plantedRecord:{default:[],check:Array.isArray,importable:true},plantedRecordBad:{default:{},check:Array.isArray}}),
      /^r declares plantedRecordBad with a default its own check refuses$/],
    ['two fields under one reply name',own('y',{plantedReply:{label:'X',kind:'boolean',default:false,deliver:['characters'],reply:'threshold'}}),
      /^threshold \(core:items\) and plantedReply \(y\) reach the characters under one reply name, threshold$/],
  ];
  for(const [name,declarer,expected] of rows){
    const result=buildSettingsTable([...core,declarer]);
    assert.equal(result.ok,false,name);
    assert.equal(result.refusals.length,1,name+': '+result.refusals.join('\n'));
    assert.match(result.refusals[0],expected,name);
  }
  // An add-on keeps the 9b kinds and its state in its store; its settings save inside `addons`,
  // so the registry refuses it alone, at registration.
  const r=loaded();
  assert.match(r.register(addon('rec',{},{records:{plantedStore:{default:{}}}})).message,/^rec declares the record plantedStore; an add-on keeps its own state in its store$/);
  assert.match(r.register(addon('val',{},{settings:{x:{label:'X',kind:'value',default:{},check:()=>true}}})).message,/^val declares the setting x of kind "value", which the settings do not have$/);
  assert.match(r.register(addon('low',{},{settings:{x:{label:'X',kind:'number',default:0,min:1,max:5}}})).message,/^low declares x with a default its own check refuses$/);
  // A field that places a saved party field (a scope, a document, a delivery) does not apply to an
  // add-on setting, so naming one is refused; `importable` is an add-on setting's own.
  // An add-on setting may be placed per farming scope and carry its own
  // check; any other scope is refused.
  assert.match(r.register(addon('placed',{},{settings:{x:{label:'X',kind:'per-character',choices:['a'],default:{},document:'roster'}}})).message,
    /^placed declares document on its setting x; an add-on setting saves with the add-on's switch and takes only label, kind, default, choices, min, max, fields, importable, scope, check, fit$/);
  assert.match(r.register(addon('placed',{},{settings:{x:{label:'X',kind:'per-character',choices:['a'],default:{},scope:'character'}}})).message,
    /^placed declares its setting x with the scope "character"; an add-on setting is one value or one per farming scope/);
  assert.equal(r.register(addon('carried',{},{settings:{x:{label:'X',kind:'per-character',choices:['a'],default:{},importable:true}}})).ok,true);
  assert.deepEqual(r.refusals().map(x=>x.name),['rec','val','low','placed','placed']);
});

// Call budget step 2: `calls.band` is a question with one core answer, `core:calls`, which the
// character's budget registers at its install. A second answer and an add-on answer are refused at
// load.: a question or a margin in a realm with no budget fails with the registry's error. Planted
// registrations, which no run loads.
test('calls.band has one core answer and no add-on answer',()=>{
  const {callsRegistration}=require('../../runtime/characters/call-budget.ts');
  const r=loaded();
  assert.throws(()=>r.calls.band({band:'job',method:'players',data:{}}),/^Error: calls\.band has no answer$/,'a realm with no budget sends nothing');
  assert.throws(()=>r.calls.margin(),/^Error: calls\.margin has no answer$/);
  assert.throws(()=>r.calls.window(),/^Error: calls\.window has no answer$/);
  assert.deepEqual(r.register(callsRegistration({budget:{band:()=>'send',margin:()=>0},install:{retired:false}})),{ok:true});
  // The turns owner's family replies keep one window, the budget's one copy
  // (calls.window).
  assert.equal(r.calls.window(),require('../../runtime/characters/call-budget-limits.ts').CALL_WINDOW_MS);
  const hook=r.map().hooks.find(h=>h.name==='calls.band');
  assert.ok(hook,'the hook table declares calls.band');
  assert.equal(hook.kind,'request');assert.equal(hook.answers,'one');
  assert.deepEqual(hook.answeredBy,['core:calls']);
  assert.match(r.register({name:'core:second',folder:'core',author:'e2e',summary:'test',hooks:{'calls.band':()=>'send'}}).message,
    /^core:second and core:calls both answer "calls.band", a question with one answer$/);
  assert.match(r.register(addon('budget',{'calls.band':()=>'send'})).message,
    /^budget answers "calls.band", which takes no add-on answer: an add-on makes no game call$/);
  assert.deepEqual(r.refusals().map(x=>x.name),['core:second','budget']);
});

// The turns owner's hooks. An add-on asks for a spend at task or below; each question with one
// answer has exactly one core answer on a character. Planted registrations beside the
// console's own and the turns owner's, which no run loads.
const {turnsStub,noAddonAnswer,oneCoreAnswer}=require('./fixtures/hook-registry-scenario.cjs');
const asker=(name,rank,answer=()=>({skill:'charge',rank,category:'damage',reason:name}))=>({name,rank,answer});
test('skills.request takes add-on asks at task or below, and the turns questions have one core answer',()=>{
  const r=character();
  assert.match(r.register(addon('healer',{'skills.request':[asker('heal','survival')]})).message,
    /^healer asks for a spend at the rank "survival", above task: an add-on spend ranks at task or below, so no add-on outranks a heal or a potion$/);
  assert.match(r.register(addon('odd',{'skills.request':[asker('odd','urgent')]})).message,/^odd asks for a spend at the rank "urgent", which the rank table does not have$/);
  assert.deepEqual(r.register(addon('charger',{'skills.request':[asker('charge','task')]})),{ok:true});
  const view={character:{name:'W'}};
  assert.ok(!r.skillRequests(view).some(x=>x.registration==='charger'),'a switched-off add-on asks nothing');
  r.configure({charger:{enabled:true}});
  const asked=r.skillRequests(view).filter(x=>x.registration==='charger');
  assert.deepEqual(asked.map(x=>[x.requester.name,x.answer.skill,x.answer.rank]),[['charge','charge','task']]);
  for(const hook of ['skills.ready','targeting.target','targeting.allows']){
    const h=r.map().hooks.find(x=>x.name===hook);
    assert.equal(h?.answeredBy.length,1,`${hook} has one answer on a character: ${h?.answeredBy}`);
    oneCoreAnswer(r,hook);
  }
});

// The survival owner's hooks, declared in its step 2. The verdict and the respawn are questions
// with one core answer, so a second answer and an add-on answer are refused at load; the died
// notice takes any listener. On a character, `core:survival` asks the potion, regeneration and heal
// needs in today's chain order, before the turns owner's sources. The verdict's and the respawn's
// own answer joined it in which built them. Planted registrations, which no run loads.
test('the survival hooks take one core answer, and core:survival asks the needs on a character',()=>{
  const {survivalRegistrations}=require('../../runtime/characters/survival/registrations.ts');
  const r=loaded();
  for(const reg of survivalRegistrations)assert.deepEqual(r.register(reg),{ok:true},reg.name);
  assert.deepEqual(r.register(turnsStub()),{ok:true},'core:turns');
  const hooks=Object.fromEntries(r.map().hooks.map(h=>[h.name,h]));
  for(const hook of ['survival.verdict','survival.respawn']){
    assert.equal(hooks[hook]?.kind,'request',hook);
    // And 3b: core:survival answers it, so a second core answer is refused.
    assert.deepEqual(hooks[hook].answeredBy,['core:survival'],hook);
    oneCoreAnswer(r,hook);
  }
  assert.ok(hooks['survival.died'],'the hook table declares survival.died');
  assert.equal(hooks['survival.died'].kind,'notice');assert.equal(hooks['survival.died'].answers,'many');
  assert.deepEqual(r.register(addon('died-listener',{'survival.died':()=>{}})),{ok:true});
  const asks=hooks['skills.request'].answeredBy;
  assert.ok(asks.indexOf('core:survival')>=0&&asks.indexOf('core:survival')<asks.indexOf('core:turns'),`core:survival asks before core:turns: ${asks}`);
  const needs=survivalRegistrations.find(x=>x.name==='core:survival').hooks['skills.request'].map(q=>[q.name,q.rank]);
  // The emergency Stomp at `survival` and Scare at `task` follow the three needs (3.2).
  assert.deepEqual(needs,[['potion','survival'],['regeneration','maintenance'],['heal','survival'],['stomp','survival'],['scare','task']]);
});

// Coordinator half: an add-on with one registration and no core edit hears `survival.died` and asks
// `survival.verdict({walk})`, which core:survival answers on the coordinator with today's
// `fightWinnable`. A live row can plant an add-on only on a character's page, so this half is
// planted registrations; a live row holds the character's half.
test('an add-on hears survival.died and asks the walk verdict with one registration',()=>{
  const {registerCoordinatorSurvival}=require('../../runtime/coordinator/survival/registrations.ts');
  const {createVerdicts}=require('../../runtime/coordinator/survival/verdict.ts');
  const r=loaded(),heard=[],asked=[];
  registerCoordinatorSurvival(r,{verdicts:createVerdicts({now:()=>1000,monsters:()=>({goo:{attack:1,frequency:1}})}),fight:()=>null,
    status:name=>({name,hp:1000,attack:100,frequency:1}),refuses:ask=>r.survival.refuses(ask)});
  assert.ok(r.map().hooks.find(h=>h.name==='survival.verdict').answeredBy.includes('core:survival'));
  assert.deepEqual(r.register(addon('survival-reader',{'survival.died'(notice){heard.push(notice.name);asked.push(r.survival.verdict({walk:true,members:['W'],attackers:[{mtype:'goo',hp:10,target:'W'}]}));}})),{ok:true});
  r.configure({'survival-reader':{enabled:true}});
  r.notify('survival.died',{name:'P',at:1,cause:'Killed by Goo',map:'main',x:0,y:0,event:null});
  assert.deepEqual(heard,['P']);assert.deepEqual(asked,['fight']);
});
// survival.refuses answers the refusing registration and its reason apart, so a name with ":
// " in it is named whole (red: the recovery split the joined text at the first ": ").
test('survival.refuses names its refuser whole, apart from the reason',()=>{
  const r=loaded();
  assert.deepEqual(r.register(addon('a: b',{'survival.refuses':()=>'holding the farm'})),{ok:true});
  r.configure({'a: b':{enabled:true}});
  assert.deepEqual(r.survival.refuses({question:'recovery',survivors:[],foes:[],verdict:'finish'}),{by:'a: b',reason:'holding the farm'});
});

// The targeting owner's hooks. `core:targeting` is the one answer of `targeting.target` and
// `targeting.allows` on a character, and each core question takes one core answer and no add-on
// answer. `targeting.candidates` is open and asked once per pass, `targeting.aggroOwner` names who
// owns Taunt, Absorb and Agitate, and `targeting.refuses` only adds a refusal. Planted
// registrations, which no run loads.
scenarioTable('the targeting hooks take their answers',character,[
  ['the targeting questions take one core answer, and core:targeting answers two on a character',r=>{
  const hooks=Object.fromEntries(r.map().hooks.map(h=>[h.name,h]));
  for(const hook of ['targeting.target','targeting.allows'])assert.deepEqual(hooks[hook].answeredBy,['core:targeting'],hook);
  // Since step 3 `core:targeting` answers the threat fact too, so a second core answer is refused.
  for(const hook of ['targeting.target','targeting.allows','targeting.threat'])oneCoreAnswer(r,hook);
  // The rest have no core answer on a character, and take no add-on answer.
  for(const hook of ['targeting.passing','skills.incoming','survival.fighting']){
    assert.equal(hooks[hook]?.answers,'one',hook);noAddonAnswer(r,hook);
  }
  assert.equal(hooks['targeting.unreachable'].kind,'notice');
  assert.deepEqual(r.register(addon('heard',{'targeting.unreachable':()=>{}})),{ok:true});
  }],
// `core:targeting` answers the threat fact on a character and the passing column on the
// coordinator, and the turns owner's `core:skills` answers the damage in flight. Each asker hands
// back the one core answer: `targeting.threat` names the policy its fact counts, `skills.incoming`
// is 0 with no answer, and `targeting.passing` fails with none, since a missing answer would
// change the coordinator's travel interrupts.
  ['the threat fact, the passing column and the damage in flight each take their one core answer',r=>{
  const {skillsRegistration}=require('../../runtime/characters/turns/skills/runtime.ts');
  const {targetingRegistrations}=require('../../runtime/characters/targeting/install.ts');
  const {coordinatorTargetingRegistration}=require('../../runtime/coordinator/targeting/install.ts');
  // Each install publishes its answers with its own state in hand (turns/skills/runtime.ts:171,
  // targeting/install.ts:263), so the row publishes an installed tracker's and threat fact's answers.
  assert.deepEqual(r.publish(skillsRegistration((t,a)=>t==='goo1'&&a==='P'?120:0)),{ok:true});
  assert.deepEqual(r.publish({...targetingRegistrations[0],hooks:{'targeting.threat':()=>({attacking:true,partyTarget:false,passing:'return-only'})}}),{ok:true});
  const hooks=Object.fromEntries(r.map().hooks.map(h=>[h.name,h]));
  assert.deepEqual(hooks['targeting.threat'].answeredBy,['core:targeting']);
  assert.deepEqual(hooks['skills.incoming'].answeredBy,['core:skills']);
  assert.deepEqual(r.ask('targeting.threat',{character:'P'}),{attacking:true,partyTarget:false,passing:'return-only'});
  assert.equal(r.turns.incoming('goo1','P'),120);assert.equal(r.turns.incoming('goo1','W'),0);
  assert.equal(createRegistry().turns.incoming('goo1','P'),0,'no answer: nothing in flight');
  const c=createRegistry();assert.deepEqual(c.register(coordinatorTargetingRegistration),{ok:true});
  const walk=tier=>({purpose:'farm-relocation',requester:{kind:'group-walk',tier}});
  assert.equal(c.targeting.passing(walk('farming')),true);assert.equal(c.targeting.passing(walk('manual')),false);
  assert.throws(()=>createRegistry().targeting.passing(walk('farming')),/targeting.passing has no answer/);
  }],
  ['targeting.candidates is open, asked once per pass, and narrows nothing with no answer',r=>{
  const view={candidates:[{id:'a'},{id:'b'}],nomination:null};
  assert.equal(r.targeting.candidates(view),view.candidates,'with none registered the candidates come back unchanged');
  // shared.js asks once per monster in every eligibility check, so it builds the view only while an
  // enabled add-on answers (the target timer).
  assert.equal(r.targeting.narrows(),false,'with none registered no answer narrows');
  let asked=0;
  assert.deepEqual(r.register(addon('narrow',{'targeting.candidates':()=>{asked++;return [];}})),{ok:true});
  assert.equal(r.targeting.candidates(view),view.candidates,'a switched-off add-on asks nothing');
  assert.equal(r.targeting.narrows(),false,'a switched-off add-on narrows nothing');
  r.configure({narrow:{enabled:true}});
  assert.equal(r.targeting.narrows(),true,'an enabled answer narrows');
  assert.deepEqual(r.targeting.candidates(view),[],'an empty answer allows no candidate');
  assert.equal(asked,1,'asked once per pass');
  assert.deepEqual(r.register(addon('keepB',{'targeting.candidates':v=>v.candidates.filter(c=>c.id==='b')})),{ok:true});
  assert.deepEqual(r.register(addon('silent',{'targeting.candidates':()=>undefined})),{ok:true});
  r.configure({keepB:{enabled:true},silent:{enabled:true}});
  assert.deepEqual(r.targeting.candidates(view).map(c=>c.id),['b'],'a list keeps what it names, and nothing keeps all');
  }],
  // (part 1): `targeting.prefers` orders the candidates of one M priority; with none registered the
  // order handed in stands, a name an answer leaves out keeps its place after the named ones, and the
  // first registration's order ranks first.
  ['targeting.prefers orders the candidates, and none keeps the order',r=>{
  const a={id:'a'},b={id:'b'},c={id:'c'},view={candidates:[a,b,c],character:{name:'W'},entities:{},party:['W']};
  assert.equal(r.targeting.prefers(view),view.candidates,'with none registered the order stands');
  assert.equal(r.targeting.orders(),false);
  assert.deepEqual(r.register(addon('late',{'targeting.prefers':v=>[v.candidates.find(x=>x.id==='b')]})),{ok:true});
  assert.equal(r.targeting.orders(),false,'a switched-off add-on orders nothing');
  r.configure({late:{enabled:true}});
  assert.deepEqual(r.targeting.prefers(view).map(x=>x.id),['b','a','c'],'the named candidate first, the rest in their order');
  assert.deepEqual(r.register(addon('reverse',{'targeting.prefers':v=>[...v.candidates].reverse()})),{ok:true});
  assert.deepEqual(r.register(addon('broken',{'targeting.prefers':()=>{throw Error('no');}})),{ok:true});
  r.configure({late:{enabled:true},reverse:{enabled:true},broken:{enabled:true}});
  assert.deepEqual(r.targeting.prefers(view).map(x=>x.id),['b','c','a'],"the first registration's order ranks first, the next orders the rest; one that throws orders nothing");
  }],
  ['an aggro owner answer and a refusal answer are asked, and none changes nothing',r=>{
  const {blocked}=require('../../runtime/characters/turns/skills/eligibility.ts');
  const {fixture}=require('./helpers/skill-world.cjs');
  const {createAnswers}=require('../../runtime/characters/targeting/gates.ts');
  // Each member comes with its last report, so an answer weighs HP and place.
  const {memberView}=require('../../runtime/protocol/reports.ts');
  const party={character:'W2',leader:'W',members:[memberView('W','warrior',{hp:90,max_hp:100,map:'main',x:0,y:0}),memberView('W2','warrior',{hp:20,max_hp:100}),memberView('P','priest',null)]};
  assert.equal(r.targeting.aggroOwner(party),undefined,'with none registered the leader owns aggro');
  assert.equal(r.targeting.refuses({id:'m'},'attack'),undefined);
  assert.deepEqual(r.register(addon('tank',{'targeting.aggroOwner':p=>p.members.find(m=>m.hp>=m.max_hp/2&&m.name!==p.leader)?.name??'W2'})),{ok:true});
  assert.deepEqual(r.register(addon('pull',{'targeting.refuses':m=>m.mtype==='bscorpion'?'pull unsafe':undefined})),{ok:true});
  r.configure({tank:{enabled:true},pull:{enabled:true}});
  assert.equal(r.targeting.aggroOwner(party),'W2');
  assert.deepEqual(party.members.map(m=>[m.name,m.ctype,m.hp,m.map]),[['W','warrior',90,'main'],['W2','warrior',20,undefined],['P','priest',undefined,undefined]],"the views carry each member's report");
  assert.equal(r.targeting.aggroOwner({...party,members:party.members.filter(m=>m.name!=='W2')}),undefined,'a name outside the party is no answer');
  // The engine's aggro rule reads the answer: the non-leader warrior it names owns Taunt.
  const w=fixture('warrior');w.w.context.leader='Other';w.w.context.mode='grouped';const t=w.add('a',{target:'Ally'});
  const taunt={skill:'taunt',targets:[t],category:'survival',reason:'test'};
  assert.equal(blocked(w.w,taunt),'leader owns aggro transfers','no answer: the leader owns Taunt');
  w.w.aggroOwner='Hero';
  assert.notEqual(blocked(w.w,taunt),'leader owns aggro transfers','the named non-leader owns Taunt');
  // `allows` returns the add-on's refusal after today's gates allow, and an add-on cannot answer `allows`.
  const saved=Object.fromEntries(['G','sharedRoutine','character','parent'].map(k=>[k,global[k]]));
  global.G={skills:{}};global.character={name:'W',ctype:'warrior',range:30};global.parent={};
  global.sharedRoutine={isAllowedTarget:()=>true,consoleDrainAllows:()=>true,rareAttackAllowed:()=>true};
  try{
    const answers=createAnswers({hooks:r,passing:()=>false,equipmentBusy:()=>false,reflect:()=>({magic:[],physical:[]}),world:()=>null,pullSafe:()=>true,module:require('./helpers/targeting-module.cjs').answerModule(()=>global.sharedRoutine)});
    assert.equal(answers.allows({id:'s',type:'monster',mtype:'bscorpion'},'attack'),'pull: pull unsafe');
    assert.equal(answers.allows({id:'g',type:'monster',mtype:'goo'},'attack'),undefined);
  }finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete global[k];else global[k]=v;}
  assert.match(r.register(addon('allow',{'targeting.allows':()=>undefined})).message,/answers "targeting\.allows", which takes no add-on answer/);
  }],
]);

// Movement's published surface. One table: each row loads the rows it checks on the realm's
// registry or a fresh one, and the owner rows install the real movement owner
// (movement-service-scenario.cjs). Each add-on a row enables is switched off at its end.
const {partyHooks}=require('../../runtime/hooks/index.ts');
const {settle}=require('./fixtures/movement-service-scenario.cjs');
const told=(r,name,hooks)=>{const seen=[];r.register(addon(name,Object.fromEntries(hooks.map(h=>[h,n=>seen.push([h,n])]))));return seen;};
const enabled=async(r,state,run)=>{r.configure(state);try{return await run();}finally{r.configure({});}};
// Movement's sends ask the call budget, so the table's registry carries the planted one.
const {plantCalls}=require('./helpers/planted-calls.cjs');
scenarioTable("movement's hooks and notices",()=>plantCalls(),[
  ["each request an add-on answers declares its bound, and the add-on API reads movement's aggro geometry",()=>{
  const {HOOKS}=require('../../runtime/hooks/registry.ts'),api=require('../../runtime/hooks/addon-api.ts');
  for(const name of ['movement.request','group.anchor','step.safety','route.avoid','crossing.allows','step.point','formation.routine','walk.request','walk.departs','safe.goal','ladder.rung'])
    assert.equal(typeof HOOKS[name].bound,'string',name+': bound');
  for(const name of ['step.safety','route.avoid','crossing.allows'])assert.match(HOOKS[name].bound,/^refusal only/,name);
  assert.equal(api.AGGRO_CELL,32,'the game files idle aggressive monsters in 32-unit cells (server.js set_ghash)');
  const cell={x:0,y:0};assert.equal(api.inBlock(cell,{x:5,y:5}),true);assert.equal(api.inBlock(cell,{x:100,y:5}),false);
  assert.equal(typeof api.entersBlock,'function');
 }],
  ['X4 and X6: each movement request says whether an add-on may ask',()=>{
  const {HOOKS}=require('../../runtime/hooks/registry.ts');
  const rows=Object.entries(HOOKS).filter(([,h])=>/^(movement \(02\)|grouped combat, a movement)/.test(h.part));
  for(const [name,h] of rows){
    if(h.kind==='request')assert.equal(typeof h.addonMayAsk,'boolean',`${name}: addonMayAsk`);
  }
  for(const name of ['movement.live','reports.fresh','movement.climbing'])assert.equal(HOOKS[name].addonMayAsk,true,name);
  for(const name of ['walks.request','walks.end','movement.step','movement.followIfFar','movement.acceptMagiport','movement.reply','movement.records','movement.incidents'])
    assert.equal(HOOKS[name].addonMayAsk,false,name);
  }],
  // The owner publishes both listeners itself, so no global carries the service. The
  // fixture's owner sits on its own host, never on globalThis (red: core.ts asked
  // globalThis.__partyMovement and heard nothing).
  ["02 section 7 trigger 1 and S9.5b: survival.died and addon.off reach the character's movement owner through its own listeners",r=>{
  const owner=ownerFixture(),seen=[];
  owner.service.died=notice=>seen.push(['died',notice.name]);owner.service.endAddon=name=>seen.push(['off',name]);
  try{
    r.notify('survival.died',{name:'W',at:1,cause:'Killed by bee'});r.notify('addon.off',{name:'hw'});
    assert.deepEqual(seen,[['died','W'],['off','hw']]);
  }finally{owner.dispose();}
  }],
  ["X3: the character's requests and reads are the movement owner's own functions",r=>{
  const owner=ownerFixture();
  try{
    const runner=r.registrations().find(x=>x.name==='core:role-runner');
    for(const [hook,fn] of [['movement.step',owner.service.step],['movement.acceptMagiport',owner.service.acceptMagiport],['movement.live',owner.service.live],
      ['movement.climbing',owner.service.climbing],['movement.records',owner.service.records],['movement.incidents',owner.service.incidents]])assert.equal(runner.hooks[hook],fn,hook);
    assert.equal(runner.hooks['reports.fresh'],require('../../runtime/protocol/reports.ts').fresh);
    assert.equal(owner.service.hold({kind:'town',owner:'town:x',tier:'town',deadline:Date.now()+60_000}),'granted');
    assert.deepEqual(r.ask('movement.live'),owner.service.live());assert.equal(r.ask('movement.live').owner,'town:x');
    assert.deepEqual(r.ask('movement.records'),owner.service.records());
    assert.equal(r.ask('reports.fresh',1000,1500,'report'),require('../../runtime/protocol/reports.ts').fresh(1000,1500,'report'));
    assert.match(loaded().register(addon('stepper',{'movement.step':()=>undefined})).message,/answers "movement\.step", which takes no add-on answer/);
  }finally{owner.dispose();}
  }],
  ["X3 and the R5 correction: core:movement answers the walk request, the reply and the game data on the coordinator",()=>{
  const rt=require('../../runtime/movement/coordinator/runtime.ts'),{heartbeatMovement}=require('../../runtime/movement/coordinator/routes.ts');
  const {gameMonsters,setGameMonsters}=require('../../runtime/movement/coordinator/planner-service.ts');
  const started=[],estimate={time:async()=>0,statuses:()=>({})};
  const registration=rt.coordinatorMovementRegistration(g=>g==='party:L'?{state:{},partyConvoys:{cancel(){},start:(...a)=>{started.push(a);return true;}}}:undefined,estimate,{answersFor:()=>false});
  assert.equal(registration.hooks['movement.reply'],heartbeatMovement);assert.equal(registration.hooks['movement.gameMonsters'],gameMonsters);
  const c=loaded();assert.deepEqual(c.register(registration),{ok:true});
  assert.equal(loaded().movement.gameMonsters(),null,'with nothing answering the table reads as not loaded');
  setGameMonsters({bee:{}});
  try{
    assert.deepEqual(c.movement.gameMonsters(),{bee:{}});
    const ask={kind:'addon:hw',destination:{map:'main',x:5,y:6},members:['L'],tier:'addon-task',label:'hw'};
    assert.equal(c.ask('walks.request','party:L',ask),true);
    // An ask names no app unless an app key's trip makes it (`by`).
    assert.deepEqual(started,[[{map:'main',x:5,y:6},'hw',['L'],'addon:hw',undefined,'addon-task',undefined]]);
    assert.equal(c.ask('walks.request','party:X',ask),false,'a group with no walk service starts nothing');
  }finally{setGameMonsters(null);}
  }],
  // Each install's answers close over its own walk lookup, so a second coordinator in the process
  // leaves the first one's walks alone (red: the last install's lookup answered both).
  ["X3: two coordinators' core:movement answers each read their own install's walks",()=>{
  const rt=require('../../runtime/movement/coordinator/runtime.ts'),{createRegistry}=require('../../runtime/hooks/registry.ts');
  const install=started=>{const hooks=createRegistry();
    rt.installCoordinatorMovement(hooks,g=>g==='party:L'?{state:{},partyConvoys:{cancel(){},start:()=>{started.push(1);return true;}}}:undefined,{time:async()=>0,statuses:()=>({})});
    return hooks;};
  const first=[],second=[],a=install(first);install(second);
  assert.equal(a.walks.request('party:L',{kind:'addon:hw',destination:{map:'main',x:5,y:6},members:['L'],tier:'addon-task',label:'hw'}),true);
  assert.deepEqual([first.length,second.length],[1,0]);
  }],
  // An owner speaks for its members by naming itself as its registration's holder, so movement reads
  // a report naming any other owner (red: 07, outside the old list, was always read).
  ['X3: member.holder adds a report\x27s hold only for an owner no registration speaks for',()=>{
  const rt=require('../../runtime/movement/coordinator/runtime.ts'),{createRegistry}=require('../../runtime/hooks/registry.ts');
  const hooks=createRegistry(),state={statuses:{F:{commandHold:{owner:'07',reason:'a rare walk'}}}};
  rt.installCoordinatorMovement(hooks,()=>({state,partyConvoys:{cancel(){}}}),{time:async()=>0,statuses:()=>({})});
  const ask={group:'party:L',member:'F',at:0};
  assert.deepEqual(hooks.walks.holders(ask),[{owner:'07',reason:'a rare walk',coming:true,endsOn:'report'}],'no registration speaks for 07');
  hooks.register({name:'core:test-holder',folder:'core',author:'test',summary:'test',holder:'07',hooks:{'member.holder':()=>[]}});
  assert.deepEqual(hooks.walks.holders(ask),[],'07 answers for its members itself');
  }],
  ['crossing.allows refuses a crossing, and crossing.started and crossing.ended tell each one',async r=>{
  r.register(addon('cx',{'crossing.allows':ask=>ask.crossing==='leave'?'no leaving':undefined}));
  const seen=told(r,'cxn',['crossing.started','crossing.ended']);
  await enabled(r,{cx:{enabled:true},cxn:{enabled:true}},async()=>{
    const owner=ownerFixture();
    try{
      await assert.rejects(owner.service.leave({kind:'task-walk',owner:'t',tier:'farming'}),/cx: no leaving/);
      await owner.service.transport({kind:'task-walk',owner:'t',tier:'farming'},'bank');
      await settle();
      assert.deepEqual(seen.map(([h,n])=>[h,n.crossing,n.code]),[['crossing.ended','leave','refused'],['crossing.started','transport:bank',undefined],['crossing.ended','transport:bank','landed']]);
    }finally{owner.dispose();}
  });
  }],
  ['step.point offers the point step safety judges, and step.sent and formation.moved tell the step',async r=>{
  r.register(addon('sp',{'step.point':ask=>ask.mover==='kiting'?{x:40,y:0}:undefined}));
  const seen=told(r,'spn',['step.sent','formation.moved']);
  await enabled(r,{sp:{enabled:true},spn:{enabled:true}},()=>{
    const owner=ownerFixture();
    try{
      assert.equal(owner.service.step({x:10,y:0},'kiting').status,'sent');
      assert.equal(owner.service.step({x:20,y:0},'formation-positioning').status,'sent');
      assert.deepEqual(owner.calls.filter(c=>c[0]==='move'),[['move',40,0],['move',20,0]]);
      assert.deepEqual(seen.map(([h,n])=>[h,n.mover,n.point.x]),[['step.sent','kiting',40],['step.sent','formation-positioning',20],['formation.moved','formation-positioning',20]]);
    }finally{owner.dispose();}
  });
  }],
  ["R4: formation.routine answers only for the characters that picked its entry and whose class it lists",()=>{
  const c=loaded(),ask=(character,ctype)=>({character,ctype,target:'m',healer:'P',desiredRange:50,members:[],candidates:[],mode:'grouped'});
  assert.deepEqual(c.entries('formation').map(e=>e.mode),['built-in'],'the built-in solver is the one entry with no add-on');
  const button={label:'Behind',description:'Stand behind the priest',color:'rose'};
  // An add-on that answers the routine fills a formation entry, and two cannot fill one entry.
  assert.match(c.register(addon('bare',{'formation.routine':()=>({x:1,y:1})})).message,/fills no formation entry/);
  assert.deepEqual(c.register(addon('behind',{'formation.routine':a=>a.character==='M'?{x:7,y:8}:{hold:true}},{slots:[{slot:'formation',mode:'behind',fills:'choice',button,classes:['mage','ranger']}]})),{ok:true});
  assert.match(c.register(addon('behind2',{'formation.routine':()=>undefined},{slots:[{slot:'formation',mode:'behind',fills:'choice',button}]})).message,/both fill the formation entry/);
  assert.equal(c.movement.formationRoutine('behind',ask('M','mage')),undefined,'switched off, the solver runs its own');
  c.configure({behind:{enabled:true}});
  assert.deepEqual(c.entries('formation').map(e=>e.mode),['built-in','behind']);
  assert.deepEqual(c.movement.formationRoutine('behind',ask('M','mage')),{x:7,y:8});
  assert.deepEqual(c.movement.formationRoutine('behind',ask('R','ranger')),{hold:true});
  assert.equal(c.movement.formationRoutine('behind',ask('W','warrior')),undefined,'a class the entry does not list runs the built-in');
  assert.equal(c.movement.formationRoutine(undefined,ask('M','mage')),undefined,'no pick runs the built-in');
  assert.equal(c.movement.formationRoutine('built-in',ask('M','mage')),undefined);
  const b=loaded();b.register(addon('broken',{'formation.routine':()=>{throw Error('bad');}},{slots:[{slot:'formation',mode:'broken',fills:'choice',button}]}));b.configure({broken:{enabled:true}});
  assert.equal(b.movement.formationRoutine('broken',ask('M','mage')),undefined);
  assert.equal(b.noticeErrors().at(-1).hook,'formation.routine');
  }],
  ["R5: ladder.rung adds rungs to its add-on's own requests only, and ladder.climbed tells each rung",async r=>{
  const {taskRound}=require('../../runtime/protocol/ladder.ts');
  r.register(addon('lr',{'ladder.rung':a=>!a.holder.startsWith('addon:lr')?undefined:[{name:'lr-rung',toward:true,attempt:()=>({trying:'trying the add-on way',options:{}})}]}));
  const seen=told(r,'lrn',['ladder.climbed']);
  await enabled(r,{lr:{enabled:true},lrn:{enabled:true}},()=>{
    const owner=ownerFixture();
    try{
      const rungs=holder=>{const ladder=owner.service.climb(holder,taskRound(owner.host.G,'the farm'),'test'),names=[];
        for(let i=0;i<8;i++){const at={map:'main',x:0,y:0},a=ladder.next(at,{});names.push(a.rung);if(a.rung==='wait')break;ladder.result({arrived:false,at,remaining:{transitions:0,walking:100}});}
        owner.service.endClimb(holder);return names;};
      const own=rungs('addon:lr:main:1:2'),other=rungs('task:farm');
      assert.ok(own.indexOf('lr-rung')>=0 && own.indexOf('lr-rung')===own.indexOf('wait')-1,`its own round: ${own}`);
      assert.ok(!other.includes('lr-rung'),`another's round: ${other}`);
      assert.deepEqual(seen.filter(([,n])=>n.rung==='lr-rung').map(([,n])=>[n.owner,n.trying]),[['addon:lr:main:1:2','trying the add-on way']]);
    }finally{owner.dispose();}
  });
  }],
  ['R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',async r=>{
  const seen=told(r,'notes',['hold.started','hold.ended','request.refused','request.waiting','journey.paused','journey.resumed','click.taken']);
  await enabled(r,{notes:{enabled:true}},async()=>{
    const owner=ownerFixture();
    try{
      const s=owner.service,deadline=Date.now()+60_000;
      assert.equal(s.hold({kind:'town',owner:'town:1',tier:'town',deadline}),'granted');
      assert.equal(s.hold({kind:'task-walk',owner:'low',tier:'farming',deadline}),'refused');
      s.release('town:1');
      void s.afterCombat({kind:'task-walk',owner:'after',tier:'farming'},()=>true);
      const walk=s.move({map:'main',x:100,y:0},undefined,{request:{kind:'task-walk',owner:'walker',tier:'farming'}});walk.catch(()=>{});
      await owner.ticks(2);
      s.step({x:5,y:5},'kiting');s.letGo();
      s.setClickWaitMs(0);owner.host.on_map_click(30,0);await settle();s.audit();
      const got=seen.map(([h,n])=>[h,n.state??n.code??n.rule??'']);
      for(const [hook,detail] of [['hold.started',''],['request.refused',''],['hold.ended','released'],['request.waiting',''],['journey.paused',''],['journey.resumed',''],['click.taken','taken'],['click.taken','returned']])
        assert.ok(got.some(([h,d])=>h===hook&&(!detail||d===detail)),`${hook} ${detail} in ${JSON.stringify(got)}`);
    }finally{owner.dispose();}
  });
  }],
  // Observed on a live travel: the group walk's journey waited for its departure phase when the
  // Pause landed, and its gate returned before the owner's tick on every pass.
  ['the Pause pauses a group walk journey whose gate waits, and Play resumes it',async r=>{
  const seen=told(r,'pause-gate',['journey.paused','journey.resumed']);
  await enabled(r,{'pause-gate':{enabled:true}},async()=>{
    const owner=ownerFixture();
    try{
      const s=owner.service,gate={tick(){}};
      const walk=s.move({map:'main',x:100,y:0},undefined,{request:{kind:'group-walk',owner:'walk:test',tier:'manual'},gate});walk.catch(()=>{});
      await owner.ticks(2);
      owner.ports.pauses.held=()=>true;await owner.ticks(4);
      assert.deepEqual(s.records().filter(e=>e.cause==='context').map(e=>e.decision),['paused']);
      assert.deepEqual(seen.map(([h])=>h),['journey.paused']);
      assert.deepEqual(owner.calls.filter(c=>c[0]==='move'),[],'no movement while paused');
      owner.ports.pauses.held=()=>false;await owner.ticks(2);
      assert.deepEqual(seen.map(([h])=>h),['journey.paused','journey.resumed']);
    }finally{owner.dispose();}
  });
  }],
  // Observed in the Cave: the scheduler read the whole pause context before the gate, so the Cave's own
  // hold froze its gated walk. Only the Pause is read there.
  ["a Cave hold doesn't stop a gated walk's tick; the walk reaches its goal and ends arrived",async r=>{
  const owner=ownerFixture();
  try{
    const s=owner.service,gate={tick(){s.tick();}};let ended=false;
    const walk=s.move({map:'main',x:100,y:0},undefined,{request:{kind:'group-walk',owner:'walk:test',tier:'manual'},gate});walk.then(()=>{ended=true;},()=>{ended=true;});
    await owner.ticks(2);
    owner.ports.pauses.caveHolds=()=>true;
    Object.assign(owner.c,{x:100,y:0,real_x:100,real_y:0});
    await owner.ticks(3);
    assert.equal(ended,true,"the Cave hold leaves the gate's tick to end the walk");
  }finally{owner.dispose();}
  }],
  ['X7: records.saved tells each movement ring snapshot, and no task or call ring snapshot',()=>{
  const {store}=require('./fixtures/movement-snapshots-scenario.cjs');
  const s=store(),saved=s.service.save({character:'P',trigger:'stuck',records:[],incidents:[]});
  s.service.save({character:'party:P',trigger:'task-failed',records:[],incidents:[]});
  s.service.save({character:'P',trigger:'death',records:[],incidents:[]});
  assert.deepEqual(s.told.map(([h,n])=>[h,n.ring,n.character,n.trigger,n.by]),[['records.saved','movement','P','stuck','02'],['records.saved','movement','P','death','05']]);
  assert.equal(s.told[0][1].record,saved.id);
  }],
  ["R5: an add-on names its own task's group walk, holds its departure and names its safe point",()=>{
  const {fixture}=require('./fixtures/shared-walk-scenario.cjs');
  const c=loaded();let to={map:'main',x:300,y:40},asked=0;
  c.register(addon('hw',{'walk.request':()=>{asked++;return to==='end'?to:{destination:to};},'walk.departs':v=>v.walk==='w1','safe.goal':()=>({map:'main',x:9,y:9})}));
  c.configure({hw:{enabled:true}});
  // The walk tells and asks this row's registry (walk.ts WalkListeners).
  const f=fixture(false,c);Object.assign(f.live,{kind:'addon:hw',tier:'addon-task',owner:'addon:hw:1'});
  f.convoys.addonWalk();const first=f.state.activeConvoy;
  assert.equal(first.purpose,'addon:hw');assert.equal(first.location.x,300);assert.equal(first.requester.tier,'addon-task');
  f.convoys.addonWalk();assert.equal(f.state.activeConvoy,first,'the same point keeps the walk');
  to={map:'main',x:500,y:40};f.convoys.addonWalk();assert.notEqual(f.state.activeConvoy.id,first.id);assert.equal(f.state.activeConvoy.location.x,500);
  to='end';f.convoys.addonWalk();assert.ok(!f.state.activeConvoy||f.state.activeConvoy.phase==='failed','end ends its own walk');
  f.live.kind='farming';const before=asked;f.convoys.addonWalk();assert.equal(asked,before,'a group whose task is not an add-on\'s asks nothing');
  assert.equal(c.movement.holdsDeparture('hw',{group:null,walk:'w1',phase:'prepare',members:[]}),true);
  assert.equal(c.movement.holdsDeparture('other',{group:null,walk:'w1',phase:'prepare',members:[]}),false,'only its own walk');
  assert.deepEqual(c.movement.safeGoal('addon:hw',{group:null,walk:'w1'}),{map:'main',x:9,y:9});
  assert.equal(c.movement.safeGoal('addon:other',{group:null,walk:'w1'}),undefined,"another add-on's walk asks only its own add-on");
  }],
  // An add-on's walk has no purpose row, so it hands combat over only when its answer says so.
  // The walk carries the answer as combatHandoffAllowed, which the character's readers ask with the
  // purpose (handsCombatOver); without it the walk fights nothing on the way, as before.
  ['R5: an add-on walk that hands combat over reaches its farm fighting',()=>{
  const {fixture}=require('./fixtures/shared-walk-scenario.cjs');
  const {handsCombatOver}=require('../../runtime/movement/api/character.ts');
  const c=loaded();let hands;
  c.register(addon('hc',{'walk.request':()=>({destination:{map:'main',x:hands?300:500,y:40},...(hands===undefined?{}:{handsCombat:hands})})}));
  c.configure({hc:{enabled:true}});
  const f=fixture(false,c);Object.assign(f.live,{kind:'addon:hc',tier:'addon-task',owner:'addon:hc:1'});
  f.convoys.addonWalk();let walk=f.state.activeConvoy;
  assert.equal(walk.combatHandoffAllowed,false);assert.equal(handsCombatOver(walk.purpose,walk.combatHandoffAllowed),false);
  hands=true;f.convoys.addonWalk();walk=f.state.activeConvoy;
  assert.equal(walk.combatHandoffAllowed,true);assert.equal(handsCombatOver(walk.purpose,walk.combatHandoffAllowed),true);
  assert.equal(handsCombatOver('addon:hc'),false,'an add-on walk with no answer hands nothing over');
  }],
  // "Movement check and close": targeting's group record asks movement's coordinator decisions
  // through published reads (ledger). core:movement answers the recovery round on the
  // coordinator, and every realm answers the independent approach.
  ['CC: the group record\'s movement decisions are the module\'s own functions',r=>{
  const {coordinatorMovementRegistration}=require('../../runtime/movement/coordinator/runtime.ts');
  assert.equal(coordinatorMovementRegistration(()=>undefined,{time:async()=>0,statuses:()=>({})},{answersFor:()=>false}).hooks['movement.formationRecovery'],require('../../runtime/movement/coordinator/recovery.ts').formationRecovery);
  const runner=r.registrations().find(x=>x.name==='core:role-runner');
  const approach=require('../../runtime/movement/character/approach.ts');
  for(const name of ['independentApproach','independentReadiness','confirmIndependentApproach'])
    assert.equal(runner.hooks['movement.'+name],approach[name],name);
  assert.equal(r.movement.independentApproach([],0),false,'no members, no independent approach');
  assert.deepEqual(r.movement.independentReadiness([]),{});
  assert.deepEqual(r.movement.confirmIndependentApproach(undefined,[],null,'t',0),{revision:0,ready:false});
  }],
  // `route.avoid` names whole maps, the planner's only avoid rule. With no answer every plan request
  // goes out as before; an answer's maps travel with the request, and the search leaves them out
  // except the route's own start and end map.
  ['route.avoid takes the named maps out of every planned route, and changes nothing unanswered',async r=>{
  const {createPlannerService}=require('../../runtime/movement/coordinator/planner-service.ts');
  const {avoidedMaps}=require('../../runtime/movement/coordinator/planner-geometry.ts');
  const worker=new URL('data:text/javascript,'+encodeURIComponent(`import {parentPort} from 'node:worker_threads';parentPort.postMessage({ready:true});
    parentPort.on('message',body=>parentPort.postMessage({id:body.id,version:body.version,fingerprint:body.fingerprint,ms:1,plot:[],avoid:body.avoidMaps??null}));`));
  const service=createPlannerService(worker,require('./helpers/run-scope.cjs').testScope('02','act')),game={maps:{main:{spawns:[[0,0]],doors:[],npcs:[]}},geometry:{},npcs:{}};
  try{
    const prepared=service.prepare(game,1);await prepared.ready;
    const ask=id=>service.plan({id,version:1,fingerprint:prepared.fingerprint,from:{map:'main',x:0,y:0},to:{map:'halloween',x:0,y:0},speed:50,town:false});
    assert.equal((await ask('none')).avoid,null,'no answer, no avoid list');
    r.register(addon('av',{'route.avoid':ask=>ask.to.map==='halloween'?['desertland','winterland']:undefined}));
    r.register(addon('av2',{'route.avoid':()=>['winterland','cave']}));
    r.register(addon('avx',{'route.avoid':()=>{throw Error('broken');}}));
    await enabled(r,{av:{enabled:true},av2:{enabled:true},avx:{enabled:true}},async()=>{
      assert.deepEqual((await ask('named')).avoid,['desertland','winterland','cave'],'every map once, in load order; a broken answer names none');
    });
  }finally{service.dispose();}
  assert.equal(avoidedMaps({map:'main'},{map:'halloween'},false,undefined),undefined,'the search runs with no avoid list, as before');
  assert.deepEqual(avoidedMaps({map:'main'},{map:'halloween'},true,undefined),['cyberland','jail'],'the leave recovery as before');
  assert.deepEqual(avoidedMaps({map:'desertland'},{map:'cave'},true,['desertland','winterland','cave','jail']),['cyberland','jail','winterland'],
    'the named maps join the leave recovery, and the route keeps its own start and end map');
  }],
]);

// 01 O5: the decision hooks of an add-on's own task. The
// owner asks only the add-on whose task the group runs, and an answer only narrows what the table
// decides. One setup: the real registry and task owner, the add-on `x`'s task live on the party.
const ownTask = (hooks) => {
  const r = loaded(), notices = [];
  assert.deepEqual(r.register(addon('x', hooks)), { ok: true });
  assert.deepEqual(r.register(addon('notes', { 'slot.changed': p => notices.push(p) })), { ok: true });
  r.configure({ x: { enabled: true }, notes: { enabled: true } });
  const o = createTaskOwner({ now: () => Date.now(), notify: (hook, payload) => r.notify(hook, payload), snapshot() {},
    ask: (hook, name, view) => r.ownTask(hook, name, view) });
  o.sync([{ id: 'party:W', kind: 'party', members: ['W', 'P', 'M'] }]);
  const handle = o.request('party:W', { kind: 'addon:x', owner: 'addon:x:1', tier: 'addon-task', members: ['W', 'P'], visit: true,
    goal: { map: 'main', x: 0, y: 0 }, deadline: Date.now() + 60_000 });
  return { r, o, handle, notices };
};
scenarioTable('01 O5: the owner asks the add-on of the group\'s own task for its alternative, safe point, questions, hold and left-out member', ownTask, [
  ['task.alternative names the next goal, and task.safePoint the point the task restarts from', ({ o, handle }) => {
    assert.deepEqual(o.fail(handle, 'no-path'), { rung: 'alternative' });
    assert.deepEqual(o.assignment('W').goal, { map: 'main', x: 100, y: 0 }, 'the alternative is the task goal');
    assert.deepEqual(o.fail(handle, 'no-path'), { rung: 'regroup' });
    assert.deepEqual(o.fail(handle, 'no-path'), { rung: 'safe-point' });
    assert.deepEqual(o.assignment('P').goal, { map: 'main', x: -50, y: 20 }, 'the safe point is where the task restarts');
  }, { 'task.alternative': v => v.code === 'no-path' ? { map: 'main', x: 100, y: 0 } : undefined, 'task.safePoint': () => ({ map: 'main', x: -50, y: 20 }) }],
  ['task.alternative with no answer goes to regroup', ({ o, handle }) => {
    assert.deepEqual(o.fail(handle, 'no-path'), { rung: 'regroup' });
  }, {}],
  ['group.questions refuses a merchant visit to a member under the add-on\'s task, and never allows one', ({ o }) => {
    assert.equal(o.allows('merchant-visit', 'P'), false);
    assert.equal(o.allows('event-attendance', 'P'), true, 'a question it does not refuse keeps the table\'s answer');
  }, { 'group.questions': v => v.question === 'merchant-visit' && v.kind === 'addon:x' ? false : true }],
  ['group.hold holds the add-on\'s group, and the hold ends when it stops answering or its task ends', ({ o, handle }) => {
    const { createHolds } = require('../../runtime/tasks/coordinator/holds.ts');
    let answer = { target: 'P', reason: 'waiting for the boss' };
    const r = loaded(); r.register(addon('x', { 'group.hold': () => answer })); r.configure({ x: { enabled: true } });
    const holds = createHolds(o, { now: () => Date.now(), party: () => 'party:W', lockoutMs: () => 5000, paused: () => false,
      record: () => ({ headlessSlots: [], steamMembers: [] }), persist() {}, ask: (hook, name, view) => r.ownTask(hook, name, view) });
    const groups = [{ id: 'party:W', kind: 'party', members: ['W', 'P', 'M'] }];
    holds.tick(groups);
    assert.deepEqual(o.holds('P').map(h => [h.by, h.reason]), [['addon:x', 'waiting for the boss']]);
    answer = undefined; holds.tick(groups);
    assert.deepEqual(o.holds('P'), [], 'the hold ends when the add-on stops answering');
    answer = { target: 'party:W', reason: 'regroup' }; holds.tick(groups);
    assert.deepEqual(o.holds('party:W').map(h => h.by), ['addon:x']);
    o.release(handle, 'done'); holds.tick(groups);
    assert.deepEqual(o.holds('party:W'), [], 'the hold ends with its task');
  }, {}],
  // Observed live on the escape row: the press started the escape, and the first read after it
  // still showed Escape because the escape task takes the group only on the next task tick.
  ['the button reads Escaping from the escape that runs, before its task takes the group', ({ o }) => {
    const { createHolds } = require('../../runtime/tasks/coordinator/holds.ts');
    const record = { headlessSlots: [], steamMembers: [], escape: null };
    const holds = createHolds(o, { now: () => Date.now(), party: () => 'party:W', lockoutMs: () => 5000, paused: () => false,
      record: () => record, persist() {}, ask: () => undefined });
    assert.equal(holds.button(), 'escape');
    record.escape = { stage: 'blink' };
    assert.equal(holds.button(), 'escaping', 'a running escape reads Escaping');
    assert.equal(holds.escape('escape'), null, 'an Escape press while it runs is a kept no-op');
    assert.match(holds.resume('resume'), /shows escaping/, 'a Resume press that saw Resume is refused');
    record.escape = { stage: 'released' };
    assert.equal(holds.button(), 'escape', 'a released escape reads Escape');
  }, {}],
  ['member.apart sends a member the add-on\'s walk left out to the point it names, or to farm under the walk verdict', () => {
    const { addonApart } = require('../../runtime/tasks/coordinator/assignment.ts');
    const live = { kind: 'addon:x', owner: 'addon:x:1', members: ['W', 'P'] };
    const ask = answer => () => answer;
    assert.equal(addonApart({ ask: ask({ wait: { map: 'main', x: 5, y: 6 } }), winnable: () => true }, 'party:W', 'W', live), null, 'a member of the walk is not apart');
    assert.deepEqual(addonApart({ ask: ask({ wait: { map: 'main', x: 5, y: 6 } }), winnable: () => true }, 'party:W', 'M', live), { apart: 'wait', at: { map: 'main', x: 5, y: 6 } });
    assert.deepEqual(addonApart({ ask: ask({ farm: true }), winnable: () => true }, 'party:W', 'M', live), { apart: 'farm' });
    assert.deepEqual(addonApart({ ask: ask({ farm: true }), winnable: () => false }, 'party:W', 'M', live), { apart: 'wait' }, 'farming alone needs the walk verdict');
    assert.equal(addonApart({ ask: ask(undefined), winnable: () => true }, 'party:W', 'M', live), null, 'no answer leaves the member to its group');
  }],
  ['P6: group.questions preempt keeps the group from the Hunt mission, and the player\'s command takes it with no question', ({ o }) => {
    assert.equal(o.request('party:W', { kind: 'hunt-mission', owner: 'hunt:1' }).status, 'waiting');
    assert.equal(o.request('party:W', { kind: 'event-attendance', owner: 'event:1' }).status, 'granted',
      'a kind the add-on does not refuse takes the group');
    assert.equal(o.request('party:W', { kind: 'manual', owner: 'manual:1' }).status, 'granted');
  }, { 'group.questions': v => v.question === 'preempt' && v.kind === 'hunt-mission' && v.tier === 'hunt-mission' ? false : undefined }],
  ['P7: an add-on task that names its group kinds runs only in those, and a kind the composition never builds drops the answer', ({ o }) => {
    o.sync([{ id: 'party:W', kind: 'party', members: ['W', 'P'] }, { id: 'merchant:M', kind: 'merchant', members: ['M'] }]);
    assert.equal(o.request('party:W', { kind: 'addon:x', owner: 'addon:x:2', groups: ['merchant'] }).status, 'refused');
    assert.equal(o.request('merchant:M', { kind: 'addon:x', owner: 'addon:x:3', groups: ['merchant'] }).status, 'granted');
    const r = loaded(); let groups = ['merchant'];
    r.register(addon('g', { 'task.request': () => ({ kind: 'addon:g', owner: 'addon:g', groups }) }, { taskTier: 'addon-task' })); r.configure({ g: { enabled: true } });
    const ask = () => r.taskRequests({}).find(s => s.name === 'g').answers[0].ask;
    assert.deepEqual(ask().groups, ['merchant']);
    groups = ['guild']; const before = r.noticeErrors().length;
    assert.equal(ask(), null);
    assert.ok(r.noticeErrors().length > before);
  }, {}],
  ['an add-on\'s answer for another add-on\'s task is never asked', ({ r }) => {
    assert.deepEqual(r.register(addon('y', { 'group.questions': () => false })), { ok: true });
    r.configure({ x: { enabled: true }, notes: { enabled: true }, y: { enabled: true } });
    assert.equal(r.ownTask('group.questions', 'x', { question: 'merchant-visit' }), undefined);
    assert.equal(r.ownTask('group.questions', 'y', { question: 'merchant-visit' }), false);
  }, {}],
]);

// Declaration half: each of the 16 rows of the turns owner's surface names its fixture row, the four published reads take no add-on answer and an add-on may ask them, and
// `skills.pullSafe` answers as the skill runtime's pull check does.
test('the turns owner surface declares fixture and who may answer and ask', () => {
  const { HOOKS } = require('../../runtime/hooks/registry.ts');
  const rows = ['skills.request', 'skills.refuses', 'skills.sent', 'skills.settled', 'skills.dropped', 'skills.waiting', 'skills.readied',
    'skills.held', 'skills.released', 'skills.shot', 'skills.landed', 'skills.passed', 'skills.ready', 'skills.incoming', 'skills.allows', 'skills.pullSafe'];
  for (const name of rows) {
    const h = HOOKS[name];
    assert.ok(h, `the hook table declares ${name}`);
    // `skills.pullSafe`'s row sits in this file.
    assert.match(String(h.fixture), /^(e2e\/live-turns-hooks\.spec\.ts|scripts\/tests\/(turns-executor|hook-registry)\.test\.cjs)#/, `${name}: its fixture row`);
  }
  for (const name of ['skills.ready', 'skills.incoming', 'skills.allows', 'skills.pullSafe']) {
    assert.equal(HOOKS[name].core, true, name); assert.equal(HOOKS[name].addonMayAsk, true, name);
  }
  assert.equal(HOOKS['skills.request'].addonMayAsk, false);
  const r = character();
  assert.match(r.register(addon('a-allows', { 'skills.allows': () => undefined })).message, /answers "skills\.allows", which takes no add-on answer/);
  assert.deepEqual(r.register(addon('holder', { 'skills.refuses': () => 'holding a pull' })), { ok: true });
  r.configure({ holder: { enabled: true } });
  assert.equal(r.skills.refuses({ skill: 'cleave', rank: 'damage', category: 'damage', reason: 'test', family: 'cleave' }), 'holder: holding a pull');
});
test('skills.pullSafe: the pull check answers as the skill runtime\'s pullSafe did', () => {
  let safe = true;
  const reg = turnsStub(() => safe);
  assert.equal(reg.hooks['skills.pullSafe']('W', { id: 'g' }), true);
  safe = false;
  assert.match(reg.hooks['skills.pullSafe']('W', { id: 'g' }), /below 30% HP/);
});
// The status owner's status report asks `skills.report` through the registry's skills asks
// (shared.js `turns.report`). v1.5.0 moved each ask to its row file and left this
// one out, so every character's first status snapshot threw "skills.report is not a function" and
// no status reached the console (side-by-side run, 2026-11-16). The first report comes before the
// role runner installs the turns owner, so it carries no turns report.
test('skills.report: the status report reads none before the turns owner installs, then its report', () => {
  const r = loaded();
  assert.equal(r.skills.report(), undefined);
  const turns = require('../../runtime/characters/turns/install.ts').turnsRegistration({
    sources: { absorb: () => undefined, support: () => undefined, attack: () => undefined, offense: () => undefined, routine: () => undefined },
    ready: () => undefined, allows: () => undefined, pullSafe: () => true, report: () => ({ dpm: 3 }), records: () => [], listeners: {} });
  assert.deepEqual(r.register(turns), { ok: true });
  assert.deepEqual(r.skills.report(), { dpm: 3 });
});
// One name is one hook, event or slot across every owner's row file and both kinds, and the
// composition names both files of a repeat.
test('a name repeated across row files or kinds is refused, naming both files', () => {
  const { repeatedNames, ROW_FILES } = require('../../runtime/hooks/registry.ts');
  assert.deepEqual(repeatedNames(ROW_FILES), []);
  assert.deepEqual(repeatedNames({ 'rows/01-tasks.ts': { HOOKS: { 'a.b': {} }, SLOTS: {} }, 'rows/02-movement.ts': { HOOKS: { 'a.b': {} }, SLOTS: { s: {} } },
    'rows/14-addons.ts': { HOOKS: { s: {} }, SLOTS: {} } }), ['a.b is declared twice: in rows/01-tasks.ts (hook) and in rows/02-movement.ts (hook)',
    's is declared twice: in rows/02-movement.ts (slot) and in rows/14-addons.ts (hook)']);
});
// A switch-on tells the add-on and the core listeners once, a switch left on tells nothing, and a
// switch-off still tells addon.off once.
test('AS35: addon.on fires once per switch-on, after the switch, and never for an add-on left on', () => {
  const r = loaded(), told = [];
  r.register(addon('watcher', { 'addon.on': (n, s) => told.push(['on', n.name, s.level]), 'addon.off': n => told.push(['off', n.name]) },
    { settings: { level: { label: 'Level', kind: 'number', default: 1 } } }));
  r.register({ name: 'core:listener', folder: 'core', author: 'test', summary: 'hears every switch', hooks: { 'addon.on': n => told.push(['core on', n.name]) } });
  r.configure({ watcher: { enabled: true, settings: { level: 3 } } });
  assert.deepEqual(told, [['on', 'watcher', 3], ['core on', 'watcher']]);
  r.configure({ watcher: { enabled: true, settings: { level: 4 } } });
  assert.equal(told.length, 2, 'a switch left on tells nothing');
  r.configure({});
  assert.deepEqual(told.slice(2), [['off', 'watcher']]);
});

// to: the job owner's add-on hooks and its notices on the console's registry, with the real dispatch
// pass, slot writer and resource blocks. Separate: a refused add-on job, a planted block and a
// refused slot write need no game.
const {createCoordinatorMerchantDispatcher}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts'),{createMerchantQueue,merchantSlotCommand}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const {createMerchantCompletionRoute}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {merchantRecords}=require('../../runtime/merchant-jobs/coordinator/records.ts');
const {fixture:completionFixture}=require('./helpers/coordinator-completion.cjs');
const MERCHANT_NOTICES=['merchant.job.queued','merchant.job.started','merchant.job.paused','merchant.job.resumed','merchant.job.ended','merchant.job.blocked',
  'merchant.job.unblocked','merchant.slot.written','merchant.slot.held','merchant.slot.refused','merchant.gathering.noTool'];
const merchantHeard=[];
// A row's own registry hears the notices, so the listener ends with the row.
function merchantListener(t){
  testRegistry(t).register({name:'core:merchant-notices-fixture',folder:'core',author:'test',summary:'Hears the job owner\'s notices.',
      hooks:Object.fromEntries(MERCHANT_NOTICES.map(n=>[n,payload=>merchantHeard.push({notice:n,...payload})]))});
}
function merchantDispatch(pick,idle=()=>{}){
  // The event hold reads the tasks owner's and the events owner's answers; the real install publishes both, and
  // an earlier row of this file may already have.
  const tasksApi=require('../../runtime/tasks/api.ts'),eventsApi=require('../../runtime/events/api.ts');
  // The task owner installs once per process; its Cave reads go on the row's own registry each time.
  const taskHelper=require('./helpers/tasks-owner.cjs');
  let installed=true;try{tasksApi.tasks();}catch{installed=false;}
  if(installed)taskHelper.publishCaveReads(partyHooks());else taskHelper.installTasksOver({leader:'W',followers:{}},{hooks:partyHooks(),now:()=>100});
  try{eventsApi.eventDeferredReturn('M');}catch{eventsApi.publishEventAnswers({deferredReturn:()=>false});}
  const state={merchantQueue:[],merchantCurrent:null,nextCommandId:7,merchantCharacter:'M',bankbois:{},bankboiTransaction:null,commands:{},gatheringModes:[],
    gatheringCooldowns:{},statuses:{M:{seenAt:100,server:'USII'}},activeRealm:'SR_USII',aldata:{key:'fixture'},threshold:100,merchantCargo:{},npcSaleMarks:[],
    standListings:[],standBids:{},marked:{},upgrades:{},purchases:{},compounds:{},autoCompounds:{},withdrawals:{},statScrolls:{},merchantDeliveries:{},goldTargets:{},production:{attempts:{}}};
  require('./helpers/coordinator-merchant.cjs').itemsDoor(state);
  const ports={now:()=>100,ensureHome:()=>true,returningHome:()=>false,anniversary:()=>({}),
    routinePriority:()=>0,priority:job=>job.priorityOverride??1,capacityBlocked:()=>false,collectionReady:()=>true,
    pick:pick?(facts,run)=>pick(state,facts,run):()=>state.merchantQueue.shift(),stamp:job=>job,
    planPonty:()=>null,restock:()=>({}),idle,persist(){},log(){},realmRefuses:realm=>/PVP$/.test(realm)||realm==='SR_EUI'};
  const service=createCoordinatorMerchantDispatcher(state,withDoor(state,ports));
  // The coordinator publishes the job owner's source beside its dispatcher (application.ts), and
  // working gold asks it for the ready jobs.
  const {merchantJobSource}=require('../../runtime/merchant-jobs/coordinator/registrations.ts');
  partyHooks().publish(merchantJobSource(()=>state.merchantCurrent,name=>state.statuses[name],()=>service.ready()));
  return {state,service};
}

// C1's merchant doors (rows/08-merchant.ts ACTIONS): the stand opens and closes only while nothing
// holds the merchant or inside the add-on's own job, and a giveaway joins only in reach.
test('C1: 08 opens the stand only for a free merchant or the add-on job that holds it, and joins a giveaway only in reach',async()=>{
  const {createMerchantRunner}=require('../../runtime/merchant-jobs/character/runner.ts'),{createMerchantVisits}=require('../../runtime/merchant-jobs/character/visits.ts');
  const api=require('../../runtime/merchant-jobs/api.ts');
  // The call budget answers the job band and refuses the background band, as near the limit.
  const budget=partyHooks().calls,{band,window}=budget;
  budget.band=ask=>ask.band==='job'?'send':'not now';budget.window=()=>0;
  const root={},me={name:'M',map:'main',x:0,y:0,stand:false},calls=[];
  createMerchantRunner({root:()=>root,character:()=>me,standOpen:()=>me.stand,
    stand:()=>({open:async()=>{calls.push('open');me.stand=true;},close:async()=>{calls.push('close');me.stand=false;}})});
  root.__merchantHolder={kind:'job',jobId:'j1',commandId:1,owner:'r',label:'',startedAt:0};
  assert.deepEqual(await api.standOpen({},{id:'t1',action:'stand.open',band:'job',addon:'a',character:'M',reason:'test',holder:'job:j2'}),{outcome:'refused',by:'08',reason:'the merchant is held by job'});
  assert.deepEqual(await api.standOpen({},{id:'t1',action:'stand.open',band:'job',addon:'a',character:'M',reason:'test',holder:'job:j1'}),{outcome:'sent'});
  root.__merchantHolder=null;
  assert.deepEqual(await api.standClose({},{id:'t2',action:'stand.close',band:'background',addon:'a',character:'M',reason:'test'}),{outcome:'refused',by:'08',reason:'call budget refused the background band'});
  assert.deepEqual(await api.standClose({},{id:'t3',action:'stand.close',band:'job',addon:'a',character:'M',reason:'test'}),{outcome:'sent'});
  assert.deepEqual(calls,['open','close']);
  const host={name:'H',map:'main',x:500,y:0,slots:{trade1:{name:'wbook0',giveaway:2,rid:'r1',list:[]}}},joined=[];
  globalThis.join_giveaway=async(name,slot,rid)=>{joined.push([name,slot,rid]);};
  createMerchantVisits({character:()=>me,player:name=>name==='H'?host:null,sleep:async()=>{}});
  assert.deepEqual(await api.joinGiveaway({seller:'H',slot:'trade1'},{id:'t1',action:'giveaway.join',band:'job',addon:'a',character:'M',reason:'test'}),{outcome:'refused',by:'08',reason:'H is out of reach'});
  host.x=100;
  assert.equal((await api.joinGiveaway({seller:'H',slot:'trade1'},{id:'t1',action:'giveaway.join',band:'job',addon:'a',character:'M',reason:'test'})).outcome,'sent');
  assert.deepEqual(await api.joinGiveaway({seller:'H',slot:'trade2'},{id:'t1',action:'giveaway.join',band:'job',addon:'a',character:'M',reason:'test'}),{outcome:'refused',by:'08',reason:'H has no open giveaway in trade2'});
  assert.deepEqual(joined,[['H','trade1','r1']]);
  delete globalThis.join_giveaway;budget.band=band;budget.window=window;
});
scenarioTable("the job owner's add-on kinds, steps, routine and notices, each row on a registry of its own",()=>undefined,[
 ['an add-on kind at 90 runs at 74 with a ring entry; an undeclared kind, a PVP and a blacklisted listing are refused',(_,t)=>{
   merchantListener(t);
   const asks=[{kind:'undeclared',target:'M'},{kind:'polish',target:'M',realm:'USPVP'},{kind:'polish',target:'M',realm:'SR_EUI'},{kind:'polish',target:'M',realm:'SR_USII'}];
     assert.deepEqual(partyHooks().register({name:'kinds-fixture',folder:'addons',author:'test',summary:'Proposes jobs of its own kinds.',hooks:{
       'merchant.jobKind':()=>[{kind:'polish',command:'merchant-self-restock',realm:'listing',priority:90},{kind:'teleport',command:'teleport',realm:'here',priority:5}],
       'merchant.job':()=>asks.shift()}}),{ok:true});
   partyHooks().configure({'kinds-fixture':{enabled:true}});
   const f=merchantDispatch();
   for(let pass=0;pass<4;pass++) f.service.dispatch();
   const entries=merchantRecords('M').filter(e=>['kind-clamped','kind-refused','job-refused'].includes(e.decision));
   assert.deepEqual(entries.map(e=>[e.decision,e.code]),[['kind-refused','no core command type teleport'],['kind-clamped','90 runs at 74'],
     ['job-refused','undeclared is not a kind kinds-fixture declared'],['job-refused','the realm owner refuses USPVP'],['job-refused','the realm owner refuses SR_EUI']]);
   assert.equal(f.state.merchantCurrent.reason,'addon:kinds-fixture:polish');
   assert.equal(f.state.merchantCurrent.priorityOverride,74);
   assert.equal(f.state.commands.M.type,'merchant-self-restock');
   // A listing kind's job runs on the realm its answer named: the ready list reads it from the job.
   const admitted=f.state.merchantCurrent;
   assert.equal(admitted.realm,'SR_USII');
   f.state.merchantQueue.unshift(admitted);f.state.merchantCurrent=null;
   assert.deepEqual(f.service.ready().map(j=>[j.reason,j.realm]),[['addon:kinds-fixture:polish','SR_USII']]);
   f.state.merchantQueue.shift();f.state.merchantCurrent=admitted;
   // Job half: the admitted job is queued and started once each.
   const job='job:'+f.state.merchantCurrent.id;
   assert.deepEqual(merchantHeard.filter(h=>h.owner===job&&h.notice.startsWith('merchant.job.')).map(h=>h.notice),['merchant.job.queued','merchant.job.started']);
   // A force stand pauses it through jobs.pause, and its next claim resumes it.
   const {pauseCurrentJob}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
   assert.equal(pauseCurrentJob(f.state,'user',()=>100,j=>j),true);
   f.service.dispatch();
   assert.deepEqual(merchantHeard.filter(h=>h.owner===job&&h.notice.startsWith('merchant.job.')).map(h=>h.notice),
     ['merchant.job.queued','merchant.job.started','merchant.job.paused','merchant.job.resumed','merchant.job.started']);
 }],
 // C2: the add-on kind's fields and steps reach the command
 // whole, and the step loop runs Ron's donate-then-buy chain under the player's consent. A send step
 // reaches the dispatcher for any recipient.
 ['C2: an addon-steps job carries its fields and steps whole; a donate-then-buy chain runs with consent and a send to any recipient runs',async (_,t)=>{
   testRegistry(t);
   const {routineEnabled,addonKind}=require('../../runtime/merchant-jobs/rules.ts'),{runAddonSteps}=require('../../runtime/merchant-jobs/character/steps.ts');
   // The event hold reads the tasks owner's and the events owner's answers, as P14 below
   // publishes them.
   const eventsApi=require('../../runtime/events/api.ts');
   try{require('../../runtime/tasks/api.ts').tasks();}catch{require('./helpers/tasks-owner.cjs').installTasksOver({leader:'W',followers:{}},{hooks:partyHooks(),now:()=>100});}
   try{eventsApi.eventDeferredReturn('M');}catch{eventsApi.publishEventAnswers({deferredReturn:()=>false});}
   const donate={action:'gold.donate',args:{gold:'all above working gold'},reason:'Ron restocks'};
   const ron={kind:'ron',target:'M',fields:{item:'offering',quantity:2},steps:[donate]};
   const asks=[ron];
     assert.deepEqual(partyHooks().register({name:'steps-fixture',folder:'addons',author:'test',summary:'Buys from Ron after a donation.',hooks:{
       'merchant.jobKind':()=>[{kind:'ron',command:'addon-steps',realm:'home',priority:30,spends:true}],
       'merchant.job':()=>asks.shift()}}),{ok:true});
   partyHooks().configure({'steps-fixture':{enabled:true}});
   const f=merchantDispatch(),reason='addon:steps-fixture:ron';
   // Switched off by default, the declared kind's job leaves the queue unsent; the player's switch sends it.
   for(let pass=0;pass<2;pass++) f.service.dispatch();
   assert.equal(f.state.commands.M,undefined);
   asks.push(ron);
   f.state.merchantAutomations={[reason]:true};f.state.standBids={};
   for(let pass=0;pass<2;pass++) f.service.dispatch();
   const command=f.state.commands.M;
   assert.equal(command.type,'addon-steps');
   assert.deepEqual([command.addon,command.kind,command.fields,command.steps,command.spends],['steps-fixture','ron',{item:'offering',quantity:2},[donate],true]);
   // The player's consent: a kind that declares spends stays off until its routine switch is on.
   assert.equal(addonKind(reason).spends,true);
   assert.deepEqual([routineEnabled({reason},{}),routineEnabled({reason},{[reason]:true})],[false,true]);
   // The merchant's loop: donate, then the add-on reads the stock and buys, then sends to a player outside the account.
   const acted=[],sent=(step,i)=>({id:'t'+i,action:step.action,character:'M',addon:'steps-fixture',outcome:'sent'});
   const answers=[done=>({steps:[{action:'item.buyFromNpc',args:{npc:'ron',item:'offering'},reason:'after '+done.length}]}),()=>({steps:[{action:'item.send',args:{to:'Stranger',item:0},reason:'gift'}]})];
   const ended=[],ports={next:(addon,view)=>answers.shift()?.(view.done),act:async step=>{acted.push(step.action);return sent(step,acted.length);},
     retry:(ask,core)=>core,window:()=>0,wait:async()=>{},checkpoint:async()=>({yield:false}),holds:()=>true,complete:async(c,ok,error)=>{ended.push([ok,error]);}};
   assert.equal(await runAddonSteps(command,ports),'done');
   assert.deepEqual(acted,['gold.donate','item.buyFromNpc','item.send']);
   // Without consent the donation never reaches the dispatcher.
   acted.length=0;ended.length=0;
   assert.equal(await runAddonSteps({...command,spends:false},ports),'failed');
   assert.deepEqual([acted,ended],[[],[[false,'08: KY: gold.donate needs a kind that declares spends']]]);
 }],
 ['MJ22: each slot write, hold and refusal sends one notice with its writer',(_,t)=>{
   merchantListener(t);
   const state={merchantCharacter:'S',merchantCurrent:{id:'a'},commands:{}},from=merchantHeard.length;
   assert.equal(merchantSlotCommand(state,'job:a',{id:1,type:'merchant-service'}),'written');
   assert.equal(merchantSlotCommand(state,'gather',{id:2,type:'merchant-gather'}),'refused');
   assert.equal(merchantSlotCommand(state,'manual:equip',{id:3,type:'equip'}),'held');
   assert.deepEqual(merchantHeard.slice(from).map(h=>[h.notice,h.by]),[['merchant.slot.written','job:a'],['merchant.slot.refused','gather'],['merchant.slot.held','manual:equip']]);
 }],
 ['MJ22: a resource block and its release send one notice each',(_,t)=>{
   merchantListener(t);
   const f=completionFixture({job:{reason:'merchant commerce'}}),from=merchantHeard.length;
   createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:false,code:'short_gold',error:'insufficient gold'}},f.response);
   assert.deepEqual(merchantHeard.slice(from).filter(h=>h.notice==='merchant.job.blocked').map(h=>[h.subject,h.kind]),[['F','merchant commerce']]);
   const state={queue:[],current:null,blocks:{'F\nmerchant commerce':{bankGold:1,merchantGold:1}}};
   createMerchantQueue(state,{merchant:()=>'M',bankboi:()=>false,capacitySignature:()=>'c',gold:()=>({bank:500,merchant:1}),nextId:()=>'n',now:()=>1,
     routinePriority:()=>1,priority:()=>1,stamp:job=>job,hasPendingStandInventory:()=>false,persist(){},dispatch(){},log(){}}).queue(['F'],'merchant commerce');
   assert.deepEqual(merchantHeard.slice(from).filter(h=>h.notice==='merchant.job.unblocked').map(h=>[h.subject,h.kind,h.code]),[['F','merchant commerce','gold']]);
 }],
 // P14: the merchant routine entry names the next job through the real
 // dispatch pass and the job pick (takeCoordinatorMerchantJob).
 ["P14: the fixture routine runs its restock before the queued upgrade; a manual visit still goes first",(_,t)=>{
   testRegistry(t);
   const {takeCoordinatorMerchantJob}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
   let answer=()=>undefined,asked=0,idled=0;
     assert.deepEqual(partyHooks().register({name:'routine-fixture',folder:'addons',author:'test',summary:'Runs its restock first.',hooks:{
       'merchant.jobKind':()=>[{kind:'restock',command:'merchant-self-restock',realm:'home',priority:20}],
       'merchant.routine':view=>{asked++;return answer(view);}},
       slots:[{slot:'merchant-routine',mode:'restock-first',fills:'choice',classes:['merchant'],button:{label:'Restock first',description:'Restock before other jobs',color:'amber'}}]}),{ok:true});
   partyHooks().configure({'routine-fixture':{enabled:true}});
   assert.deepEqual(partyHooks().entries('merchant-routine').map(e=>e.mode),['built-in','restock-first'],'the built-in entry comes first');
   const picked=[];
   const f=merchantDispatch((state,facts,run)=>{const job=takeCoordinatorMerchantJob(state,facts,run);picked.push(job&&job.reason);return null;},()=>idled++);
   Object.assign(f.state,{merchantRoutinePriorities:{},standBids:{},routines:{M:{'merchant-routine':'restock-first'}}});
   const job=(id,reason,priority,fields={})=>({id,target:'M',reason,priorityOverride:priority,queuedAt:1,...fields});
   const upgrade=()=>job('up','manual upgrades',60),restock=()=>job('rs','addon:routine-fixture:restock',20);
   const pass=(queue,next)=>{f.state.merchantQueue=queue;answer=next;f.service.dispatch();return picked.at(-1);};
   // The routine names its restock, so it runs ahead of the upgrade the built-in order puts first.
   assert.equal(pass([upgrade(),restock()],view=>({run:view.queued.find(j=>j.reason.endsWith(':restock')).id})),'addon:routine-fixture:restock');
   // A name that is no ready queued job runs the built-in pick.
   assert.equal(pass([upgrade(),restock()],()=>({run:'gone'})),'manual upgrades');
   // A ready manual visit runs in the built-in order, and the routine is not asked.
   asked=0;
   assert.equal(pass([job('mv','manual visit',70,{manual:true}),upgrade(),restock()],()=>({run:'rs'})),'manual visit');
   assert.equal(asked,0);
   // Idle stands the merchant at its place.
   const before=picked.length;
   pass([upgrade()],()=>({idle:true}));
   assert.equal(picked.length,before);
   assert.equal(idled,1);
   // A queue answer joins the queue through the add-on row at its kind's priority.
   pass([],()=>({queue:{kind:'restock',target:'M'}}));
   assert.equal(picked.at(-1),'addon:routine-fixture:restock');
   // With no pick saved the merchant runs the built-in order and nothing is asked.
   f.state.routines={};asked=0;
   assert.equal(pass([upgrade(),restock()],()=>({run:'rs'})),'manual upgrades');
   assert.equal(asked,0);
 }],
 ['MJ23: with no add-on registered, the merchant hooks change no answer',()=>{
   const r=createRegistry();
   assert.deepEqual(r.merchantJobs.kinds(),[]);
   assert.deepEqual(r.merchantJobs.jobs({merchant:'M',current:null,queued:[]}),[]);
   assert.equal(r.notify('merchant.job.started',{subject:'M'}).length,0);
 }],
]);

// The job owner's registration answers `jobs.ready` from the queue's ready jobs and `task.request`
// only for the merchant group, with the current job's card line as the task's label.
test('MJ23: the merchant registration answers jobs.ready from a queued job and task.request for the merchant group',()=>{
  const {merchantJobSource}=require('../../runtime/merchant-jobs/coordinator/registrations.ts');
  const ready=[{id:'q1',reason:'restock',target:'F',priority:5,realm:null}];
  let current={id:'j9',reason:'restock',target:'F',phase:'assigned'};
  const hooks=merchantJobSource(()=>current,()=>undefined,()=>ready).hooks;
  assert.deepEqual(hooks['jobs.ready'](),ready);
  assert.deepEqual(hooks['task.request']({groupKind:'fighters'}),[]);
  const [ask]=hooks['task.request']({groupKind:'merchant'});
  assert.deepEqual([ask.slot,ask.end,ask.ask.kind,ask.ask.owner,ask.ask.phase],['job','job-done','merchant-job','job:j9','restock']);
  current=null;
  assert.equal(hooks['task.request']({groupKind:'merchant'})[0].ask,null);
});

// The items owner's unit rows: each title is the `fixture` its row in runtime/hooks/rows/10-items.ts
// names. Each row reads the ring entries the items owner's records.ts writes.
const items={fates:require('../../runtime/items/coordinator/fates.ts'),
  production:require('../../runtime/items/coordinator/production.ts'),rules:require('../../runtime/items/rules.ts'),
  owner:require('../../runtime/items/coordinator/owner.ts')};
const emptyBag=()=>Array(42).fill(null);
const itemsState=(extra={})=>({merchantCharacter:'M',statuses:{F:{items:emptyBag()},M:{items:emptyBag()}},marked:{},merchantMarked:{},upgrades:{},
  compounds:{},statScrolls:{},autoCompounds:{},autoItemMarks:{},restockPolicies:{F:{hp:{item:'hpot1',min:0,max:0},mp:{item:'mpot1',min:0,max:0}}},
  merchantQueue:[],merchantCurrent:null,orders:[],...extra});

scenarioTable("the items owner's hooks and notices, each row on a registry of its own",()=>undefined,[
 ['items.claimRefused: a claim that cannot fit its place is refused at load',(_,t)=>{
   testRegistry(t);
     assert.deepEqual(partyHooks().register({name:'claims-fixture',folder:'addons',author:'test',summary:'Claims more hpot1 than a bag holds.',hooks:{
       'items.claim':view=>view.character==='F'?[{item:{name:'hpot1'},quantity:{count:43},place:'carried:F',reason:'fixture'}]:undefined}}),{ok:true});
   partyHooks().configure({'claims-fixture':{enabled:true}});
   const refused=items.fates.refusedClaims(itemsState(),'claims-fixture',new Set());
   assert.deepEqual(refused.map(r=>[r.claim.by,r.claim.item.name,r.claim.place]),[['addon:claims-fixture','hpot1','carried:F']],
     '43 copies of an item that does not stack pass the 42 cells of the bag');
 }],
 ['items.luckySlot: lock, resume, verified, tracker',()=>{
   assert.equal(items.rules.luckySlotOf({luckyUpgradeSlots:{M:7},luckySlotLocks:{}},'M'),7,'the tracked slot names it');
   assert.equal(items.rules.luckySlotOf({luckyUpgradeSlots:{},luckySlotLocks:{}},'M'),null,'with no evidence there is none');
   // Each state below also holds every lower-precedence slot, so the winner shows the order.
   const all={luckySlotLocks:{M:3},luckySlotResume:{M:{slot:5}},luckyUpgradeSlots:{M:7}};
   assert.deepEqual(items.rules.luckySlotAnswer(all,'M'),{slot:3,locked:3,resuming:false,verified:7},'the lock wins over a resume slot and the verified slot');
   assert.equal(items.rules.luckySlotOf({...all,luckySlotLocks:{}},'M'),5,'with no lock the resume slot wins over the verified slot');
   assert.deepEqual(items.rules.luckySlotAnswer({...all,luckySlotLocks:{}},'M'),{slot:5,locked:null,resuming:true,verified:7},'an unlocked resume reports resuming');
   assert.equal(items.rules.luckySlotOf({luckySlotLocks:{},luckySlotResume:{},luckyUpgradeSlots:{M:7}},'M'),7,'the verified slot names it when nothing else does');
 }],
 ['items.claimPending: a stored copy an all claim names is fetched',()=>{
   const state=itemsState({withdrawals:{F:[{claim:'fixture|all',item:{name:'hpot1',q:20}},{claim:'other|all',item:{name:'mpot1',q:5}},{claim:'fixture|all',item:{name:'ring'}}]}});
   assert.equal(items.fates.claimPending(state,'F','fixture'),21,"the claimer's stored copies only, a single copy counting one");
   assert.equal(items.fates.claimPending(state,'M','fixture'),0,'a character with no withdrawal fetches nothing');
 }],
 ["items.standSlots: the stand's cells and the listings that use them",()=>{
   const sold={item:{name:'sword',b:true}};
   const open=items.rules.standSlotUse(itemsState({statuses:{M:{items:emptyBag(),standOpen:true,slots:{trade1:sold,trade2:null,mainhand:sold}}},
     standListings:[{tradeSlot:'trade3',state:'live'}]}));
   assert.equal(open.used,1,'a buy order the game reports in trade1 counts with no listing; an open stand reports its own cells');
   assert.equal(open.free,open.slots-open.used);
   const closed=items.rules.standSlotUse(itemsState({statuses:{M:{items:emptyBag(),standOpen:false,slots:{trade1:sold}}},
     nativeStand:{offers:{a:{slot:'trade2',phase:'live'},b:{slot:'trade1',phase:'live'},c:{slot:'trade4',phase:'placing'}}},
     standListings:[{tradeSlot:'trade3',state:'live'},{tradeSlot:'trade5',state:'paused'},{}]}));
   assert.equal(closed.used,3,'a closed stand counts its live offers and live listings once per cell');
 }],
 ['items.storagePending: a pending BankBoi transfer is named',()=>{
   const state=itemsState({bankboiTransaction:{id:'t'},production:{attempts:{}}});
   const answers=items.owner.jobAnswers(state,{storage:{busy:()=>false,start:async()=>{}},log(){}},()=>1);
   assert.equal(answers.storagePending('M'),true);
   assert.equal(answers.storagePending('F'),false,"only the merchant's storage work waits");
 }],
 ['items.productionPending: a pending intent is named',()=>{
   const state=itemsState({production:{attempts:{}}});
   const answers=items.owner.jobAnswers(state,{storage:{busy:()=>false,start:async()=>{}},log(){}},()=>1);
   assert.equal(answers.productionPending('M'),false,'an empty journal holds nothing');
   state.production.attempts.a1={name:'blade',level:2,kind:'upgrade'};
   assert.equal(answers.productionPending('M'),true,'a pending attempt holds the merchant');
   assert.equal(answers.productionPending('F'),false,"only the merchant's work waits");
   state.production.attempts.a1.completed=true;
   assert.equal(answers.productionPending('M'),false,'a completed attempt holds nothing');
 }],
 ['items.intent: an intent written and ended once each',()=>{
   const state={upgrades:{}},mark={slot:3,item:{name:'blade',level:2},tiers:1},since=itemsSince('M');
   items.production.writeIntents(state,'M',()=>[mark]);
   items.production.writeIntents(state,'M',()=>[]);
   assert.deepEqual(since().filter(e=>e.decision==='intent').map(e=>e.phase),['written','ended']);
   // Two intents on identical copies with one target; one ends while the other stays.
   const twin={...mark,slot:4},after=itemsSince('M');
   items.production.writeIntents(state,'M',()=>[mark,twin]);
   items.production.writeIntents(state,'M',()=>[mark]);
   assert.deepEqual(after().filter(e=>e.decision==='intent').map(e=>e.phase),['written','written','ended']);
 }],
 ["items.banked, .withdrawn: a bank visit's receipts, one notice per copy",()=>{
   const {recordBankReceipts}=require('../../runtime/items/coordinator/storage.ts'),since=itemsSince('M');
   recordBankReceipts('M','job:1',{banked:[{slot:2,item:{name:'ring',q:1}}],withdrawn:[{pack:'items0',slot:4,item:{name:'hpot1',q:20}}]});
   assert.deepEqual(since().map(e=>[e.decision,e.item,e.quantity]),[['banked','ring',1],['withdrawn','hpot1',20]]);
 }],
 // A fighter's bank slot receipt names the marked copies it stored as banked.
 ["items.banked: a fighter's bank slot receipt names the copies it stored",()=>{
   const {createBankReceipt}=require('../../runtime/items/coordinator/storage.ts'),since=itemsSince('F');
   const state={merchantCharacter:'M',commands:{},withdrawals:{},upgrades:{},purchases:{},compounds:{},bankCurrent:{name:'F'},bankStartedAt:1};
   const bank=createBankReceipt(state,{persist(){},persistBank(){},dispatchBank(){}});
   bank({character:'F',withdrawn:[],banked:[{item:{name:'hpot1',q:200}}]});
   assert.deepEqual(since().map(e=>[e.decision,e.item,e.quantity,e.by]),[['banked','hpot1',200,'T3']]);
 }],
 ['items.exchanged: each reward once across checkpoints',()=>{
   const {createExchangeRequests}=require('../../runtime/items/coordinator/production.ts');
   const state={merchantCharacter:'M',merchantCurrent:{id:'j',reason:'exchange',target:'M'},merchantQueue:[],autoItemMarks:{},autoUpgradeMarks:{},autoCompounds:{},autoDeconstruction:{},autoNpcSales:{},autoStandMarks:{},autoExchanges:{}};
   const requests=createExchangeRequests(state,{persist(){},write:()=>({ok:true})}),since=itemsSince('M');
   // The character posts each reward as the item copy itself (production.ts `progress`).
   requests.progress({jobId:'j',remaining:[],rewards:[{name:'coat'}]});
   requests.progress({jobId:'j',remaining:[],rewards:[{name:'coat'},{name:'ring'}]});
   assert.deepEqual(since().filter(e=>e.decision==='exchanged').map(e=>e.item),['coat','ring']);
 }],
 // 1.37's remaining rows: each reads the notices its producer sends, or the answer it gives.
 ['items.bankLayout: an add-on layout orders a floor; an out-of-floor slot is refused',(_,t)=>{
   testRegistry(t);
   const {bankLayout}=require('../../runtime/items/coordinator/storage.ts');
   let answer=cells=>[...cells].reverse();
     assert.deepEqual(partyHooks().register({name:'layout-fixture',folder:'addons',author:'test',summary:'Orders a bank floor back to front.',hooks:{
       'items.bankLayout':view=>answer(view.items.map(({pack,slot})=>({pack,slot})))}}),{ok:true});
   partyHooks().configure({'layout-fixture':{enabled:true}});
   const cells=[{pack:'items0',slot:0,item:{name:'helmet'}},{pack:'items0',slot:1,item:null}];
   assert.deepEqual(bankLayout('bank',cells),[{pack:'items0',slot:1},{pack:'items0',slot:0}]);
   answer=()=>[{pack:'items0',slot:0},{pack:'items9',slot:5}];
   assert.equal(bankLayout('bank',cells),null,'a slot outside the floor refuses the answer and the packed layout stands');
   partyHooks().configure({});
   assert.equal(bankLayout('bank',cells),null,'with no add-on the packed layout stands');
 }],
 ['items.fetch: a missing item withdrawn or not found',async ()=>{
   const {bankHarness}=require('./helpers/items-character.cjs');
   const character={name:'F',ctype:'warrior',map:'bank',items:[null,null],bank:{items0:[{name:'pickaxe'},null]}};
   const retrieved=[];
   const {bank}=bankHarness({character,ports:{walkToBank:async()=>{},
     bankRetrieve:async(pack,slot)=>{retrieved.push(slot);character.items[0]=character.bank[pack][slot];character.bank[pack][slot]=null;}}});
   assert.equal(await bank.fetch('pickaxe'),true);
   assert.equal(character.items[0].name,'pickaxe');
   assert.equal(await bank.fetch('rod'),true,'the bank was read; nothing was found');
   assert.deepEqual(retrieved,[0]);
 }],
 ['items.bag: the bag facts of the holder record',()=>{
   const {createBag}=require('../../runtime/items/character/owner.ts');
   const bag=createBag();
   bag.connect({freeCells:()=>7,lucky:()=>false,map:()=>'main'});
   bag.take('stocking');
   assert.deepEqual([bag.facts().holder,bag.facts().stocking,bag.facts().banking],['stocking',true,false]);
   bag.release('stocking');
   assert.equal(bag.facts().holder,null);
 }],
 ['items.produced: an upgrade result is reported once',()=>{
   const state={production:{attempts:{a1:{name:'blade',level:3,kind:'upgrade'}}}},since=itemsSince('merchant');
   items.production.finishProduction(state,'a1',false);
   items.production.finishProduction(state,'a1',false);
   assert.deepEqual(since().filter(e=>e.decision==='produced').map(e=>[e.item,e.level,e.result]),[['blade',3,'failure']]);
 }],
 ['items.saleBlocked: a failed sale blocks and lifts at the bag change',()=>{
   const market=require('../../runtime/items/coordinator/market.ts'),since=itemsSince('merchant');
   const mark={id:'s1',source:'merchant',slot:4,item:{name:'ring'},quantity:1,state:'queued'};
   const [blocked]=market.reconcileNpcSales([mark],[],false,0).marks;
   market.reconcileNpcSales([blocked],[],false,0);
   assert.deepEqual(since().map(e=>e.phase),['blocked'],'the same bag keeps it blocked');
   market.reconcileNpcSales([blocked],[{slot:4,item:{name:'ring'}}],false,0);
   assert.deepEqual(since().map(e=>[e.phase,e.code]),[['blocked','marked_missing'],['lifted',undefined]]);
 }],
 ['items.sortLease: a sort lease taken, retried and settled',()=>{
   const {createBankSortRoutes}=require('../../runtime/items/coordinator/storage.ts'),since=itemsSince('bank');
   const state={merchantCharacter:'M',bankSortMode:'request',bankSortRequest:{id:'q1',requestedAt:10,status:'queued'},withdrawals:{}};
   const routes=createBankSortRoutes(state,{runtime:()=>'R',persist(){},write:()=>({ok:true})});
   const res={status(){return res;},json(v){return v;}};
   const post=body=>routes.checkpoint({body:{character:'M',runtime:'R',visit:'V',...body}},res);
   post({action:'claim',enteredAt:11});
   post({action:'retry',id:'q1',message:'swap unconfirmed',code:'not_confirmed'});
   post({action:'claim',enteredAt:12});
   post({action:'complete',id:'q1'});
   assert.deepEqual(since().filter(e=>e.decision==='sortLease').map(e=>[e.phase,e.code]),
     [['taken',undefined],['retry','not_confirmed'],['taken',undefined],['settled',undefined]]);
 }],
 ['10: with no add-on registered, the items hooks change no answer',()=>{
   const r=createRegistry();
   assert.equal(r.itemRules.claiming(),false);
   assert.deepEqual(r.itemRules.claims({character:'F',bag:[],bank:null}),[]);
   assert.deepEqual(r.itemRules.actions({character:'F',slot:0,item:{name:'hpot1'},owner:'F'}),[]);
 }],
]);


test("P1: an add-on overlays the event order for play while the saved value stays the player's",()=>{
  const {overlayProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const {readOverlaysWith}=require('../../runtime/settings/api.ts'),{eventPriorityOrder}=require('../../runtime/events/rules.ts');
  const r=loaded();
  assert.deepEqual(r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',
    hooks:{'settings.accepts':(field,value)=>overlayProblem(coordinatorSettings().table,field,value)}}),{ok:true});
  let answer=['goobrawl','franky'];
  assert.deepEqual(r.register(addon('order',{'settings.overlay':ask=>ask.field==='eventPrioritiesByCharacter'?{...ask.value,[ask.character]:answer}:undefined},
    {overlays:['eventPrioritiesByCharacter']})),{ok:true});
  // One add-on per field, and an overlay names its fields.
  assert.match(r.register(addon('second',{'settings.overlay':()=>undefined},{overlays:['eventPrioritiesByCharacter']})).message,/order both overlay the setting "eventPrioritiesByCharacter"|second and order both overlay/);
  assert.match(r.register(addon('unnamed',{'settings.overlay':()=>undefined})).message,/lists no overlays/);
  const party={leader:'W',eventPrioritiesByCharacter:{W:['franky']}},saved=JSON.stringify(party);
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    // Switched off, the player's order plays.
    assert.equal(eventPriorityOrder(party,'W')[0],'franky');
    r.configure({order:{enabled:true}});
    assert.deepEqual(eventPriorityOrder(party,'W').slice(0,2),['goobrawl','franky']);
    assert.equal(JSON.stringify(party),saved);
    assert.deepEqual(r.overlays(),{eventPrioritiesByCharacter:'order'});
    // A value the field's check refuses plays the player's value and is recorded.
    answer='not a list';
    const before=r.noticeErrors().length;
    assert.equal(eventPriorityOrder(party,'W')[0],'franky');
    assert.ok(r.noticeErrors().length>before);
    // The hand controls take no add-on value.
    assert.match(overlayProblem(coordinatorSettings().table,'handControlByCharacter',{}),/takes no add-on value/);
    r.configure({order:{enabled:false}});
    answer=['goobrawl'];
    assert.equal(eventPriorityOrder(party,'W')[0],'franky');
  }finally{readOverlaysWith(undefined);}
});

test("P1: an add-on overlays the Cave's after-a-run and event choices for play while the visit record stays the player's",()=>{
  const {overlayProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const {readOverlaysWith,playedIn}=require('../../runtime/settings/api.ts');
  const r=loaded(),table=coordinatorSettings().table;
  assert.deepEqual(r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',
    hooks:{'settings.accepts':(field,value)=>overlayProblem(table,field,value)}}),{ok:true});
  let stay='stay';
  assert.deepEqual(r.register(addon('cave-stay',{'settings.overlay':ask=>ask.field==='dailyDungeons.afterRun'?stay:ask.field==='dailyDungeons.protectFromEvents'?false:undefined},
    {overlays:['dailyDungeons.afterRun','dailyDungeons.protectFromEvents']})),{ok:true});
  // The visit record itself is play's, so it takes no add-on value.
  assert.match(overlayProblem(table,'dailyDungeons',{}),/a record play writes/);
  const d={afterRun:'go-back',protectFromEvents:true},saved=JSON.stringify(d);
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    assert.equal(playedIn('dailyDungeons',d,'afterRun'),'go-back',"switched off, the player's choice plays");
    r.configure({'cave-stay':{enabled:true}});
    assert.equal(playedIn('dailyDungeons',d,'afterRun'),'stay');
    assert.equal(playedIn('dailyDungeons',d,'protectFromEvents'),false);
    assert.equal(JSON.stringify(d),saved);
    // A value the member's own check refuses plays the player's choice.
    stay='linger';
    assert.equal(playedIn('dailyDungeons',d,'afterRun'),'go-back');
  }finally{readOverlaysWith(undefined);r.configure({});}
});

test("P1: an add-on overlays Follow and the Hunt thresholds for play while the saved values stay the player's",()=>{
  const {overlayProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const {readOverlaysWith}=require('../../runtime/settings/api.ts'),{scopeOwner}=require('../../runtime/tasks/rules.ts');
  const {applyHuntThresholds}=require('../../runtime/hunting/coordinator/hunt.ts');
  const r=loaded();
  assert.deepEqual(r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',
    hooks:{'settings.accepts':(field,value)=>overlayProblem(coordinatorSettings().table,field,value)}}),{ok:true});
  assert.deepEqual(r.register(addon('solo',{'settings.overlay':ask=>ask.field==='followers'?{...ask.value,[ask.character]:false}:
    ask.field==='huntSettings'?{...ask.value,deathThreshold:3}:undefined},{overlays:['followers','huntSettings']})),{ok:true});
  const party={leader:'W',followers:{P:true}},saved=JSON.stringify(party);
  const hunt=()=>({huntSettings:{blacklistDeaths:true,deathThreshold:1},huntFailures:{bee:{deaths:2,expirations:0}}});
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    assert.equal(scopeOwner(party,'P'),'W');
    let state=hunt();applyHuntThresholds(state,1,null);
    assert.ok(state.huntBlacklist?.bee,"the player's threshold of 1 blacklists at 2 deaths");
    r.configure({solo:{enabled:true}});
    assert.equal(scopeOwner(party,'P'),'P','the add-on plays P outside the leader\'s scope');
    assert.equal(JSON.stringify(party),saved);
    state=hunt();applyHuntThresholds(state,1,null);
    assert.equal(state.huntBlacklist?.bee,undefined,"the add-on's threshold of 3 keeps the bee");
    assert.equal(state.huntSettings.deathThreshold,1);
  }finally{readOverlaysWith(undefined);}
});

test("P5: an add-on counts an event death on the Hunt and rejects a yielded rare, and never undoes core's",()=>{
  const r=loaded();
  const core={wait:0,giveUp:false,counts:false};
  assert.deepEqual(r.retry.policy({owner:'07',subject:'bee',failure:'event-death',attempt:1},core),core,'no add-on keeps core\'s answer');
  r.register(addon('strict',{'retry.policy':ask=>ask.failure==='event-death'?{counts:true}:ask.failure==='yielded'?{giveUp:true,wait:5}:{counts:false,giveUp:false}}));
  r.register(addon('slow',{'retry.policy':()=>({wait:2})}));
  r.register(addon('broken',{'retry.policy':()=>{throw Error('broken');}}));
  r.configure({strict:{enabled:true},slow:{enabled:true},broken:{enabled:true}});
  assert.equal(r.retry.policy({owner:'07',subject:'bee',failure:'event-death',attempt:1},core).counts,true);
  assert.equal(r.retry.policy({owner:'07',subject:'phoenix',failure:'yielded',attempt:1},core).giveUp,true);
  // An answer only gives up sooner: core's give-up and count stay on.
  const kept=r.retry.policy({owner:'07',subject:'phoenix',failure:'released',attempt:1},{wait:0,giveUp:true,counts:true});
  assert.deepEqual([kept.giveUp,kept.counts],[true,true]);
  // The longest wait wins, and never below core's.
  assert.equal(r.retry.policy({owner:'08',subject:'job',failure:'yielded',attempt:1},{...core,wait:10}).wait,10);
  assert.equal(r.retry.policy({owner:'08',subject:'job',failure:'yielded',attempt:1},{...core,wait:1}).wait,5);
});

test('slots: a target mode entry returns to its returnsTo, writes only what it reads, and its scoped hooks are asked only for its own characters',()=>{
  const {createSlots}=require('../../runtime/tasks/coordinator/slots.ts');
  const r=loaded();
  assert.match(r.register(addon('loop',{'target.mode':()=>undefined},{slots:[{...entry('target-mode','loop'),returnsTo:'loop'}]})).message,/returns to itself/);
  assert.match(r.register(addon('ghost',{'target.mode':()=>undefined},{slots:[{...entry('target-mode','ghost'),scoped:['step.safety']}]})).message,/answers no "step.safety"/);
  let ports;
  assert.deepEqual(r.register(addon('boss',{'target.mode':v=>{ports=v.ports;return {avoid:[]};},'step.safety':()=>'too close'},
    {slots:[{...entry('target-mode','boss'),returnsTo:'hunt',reads:['monsterPrioritiesByCharacter'],scoped:['step.safety']}]})),{ok:true});
  r.configure({boss:{enabled:true}});
  const writes=[],state={targetMode:'boss',leader:'W'};
  const slots=createSlots({hooks:r,now:()=>1,busy:()=>null,scopePorts:()=>({members:()=>['W'],destination:()=>null,select:()=>null,focus(){},radius:()=>100,persist(){},
    write:(changes,by)=>{writes.push([changes,by]);return {ok:true,changed:changes.map(c=>c.field)};}})});
  slots.tick(state,'W');
  // Another scope that never selected the entry keeps no store of the add-on's.
  const other={targetMode:'farming',leader:'P'};slots.tick(other,'P');
  assert.equal(other.addonFarming?.boss,undefined,'a scope that did not select the entry gets no store');
  assert.deepEqual(state.addonFarming.boss,{deliver:{avoid:[]}});
  assert.deepEqual(ports.write([{field:'followers',value:{}}]).ok,false,'a setting the entry does not read is refused');
  assert.equal(ports.write([{field:'monsterPrioritiesByCharacter',character:'W',value:{}}]).ok,true);
  ports.leave();
  assert.deepEqual(writes.at(-1),[[{field:'targetMode',value:'hunt',character:'W'}],'addon:boss']);
  // The scoped hook: a character whose reply names no entry, or another, asks nothing.
  assert.equal(r.stepRefusal({},{x:0,y:0}),undefined);
  r.reply({addons:{boss:{enabled:true}},slotEntries:{'target-mode':'boss'}});
  assert.equal(r.stepRefusal({},{x:0,y:0}),'boss: too close');
  r.reply({addons:{boss:{enabled:true}},slotEntries:{'target-mode':'farming'}});
  assert.equal(r.stepRefusal({},{x:0,y:0}),undefined);
});

test('P4: the add-on lifts the Graveyard exclusion and raises tinyp; the drain row still refuses',()=>{
  const r=loaded();
  // With no add-on, nothing is asked and core's answers stand.
  assert.equal(r.targeting.rules(),false);
  assert.equal(r.targeting.admits({row:'A1',target:{mtype:'ghost'},character:'W',core:'excluded Graveyard monster'}),false);
  const asked=[];
  assert.deepEqual(r.register(addon('rule',{'targeting.rule':ask=>{asked.push(ask.row);
    return ask.row==='A1'||ask.row==='A2'?{admit:true}:ask.row==='P2'?250:ask.row==='P1'?7:undefined;}})),{ok:true});
  r.configure({rule:{enabled:true}});
  assert.equal(r.targeting.rules(),true);
  assert.equal(r.targeting.admits({row:'A1',target:{mtype:'ghost'},character:'W',core:'excluded Graveyard monster'}),true);
  // The drain row and the player's own priorities are never asked.
  assert.equal(r.targeting.admits({row:'A2',target:{mtype:'goo'},character:'W',core:'waiting for safe console reload'}),false);
  assert.equal(r.targeting.priority({row:'P1',target:{mtype:'goo'},character:'W',core:3}),3);
  assert.deepEqual(asked,['A1']);
  // A priority is held to 0 to 100; with no answer core's value stands.
  assert.equal(r.targeting.priority({row:'P2',target:{mtype:'tinyp'},character:'W',core:101}),100);
  assert.equal(r.targeting.priority({row:'P5',target:{mtype:'goo'},character:'W',core:0}),0);
});

test("P2: the add-on picks the larger potion and the priest's heal target; an answer outside the options keeps core's",()=>{
  const r=loaded(),W={name:'W'},M={name:'M'};
  const ask=(question,options,core)=>r.survival.choice({question,member:'P',options,core});
  // With no add-on, core's pick stands.
  assert.equal(ask('potion',['use_hp','use_mp'],'use_mp'),'use_mp');
  const answers={potion:'use_hp',heal:M,regen:'regen_xp',danger:false,transfer:false,respawn:5,ports:['P','W'],stomp:true};
  assert.deepEqual(r.register(addon('picks',{'survival.choice':a=>answers[a.question]})),{ok:true});
  r.configure({picks:{enabled:true}});
  assert.equal(ask('potion',['use_hp','use_mp'],'use_mp'),'use_hp');
  assert.equal(ask('heal',[W,M],W),M);
  // An answer outside the options keeps core's and is recorded.
  const before=r.noticeErrors().length;
  assert.equal(ask('regen',['regen_hp','regen_mp'],'regen_mp'),'regen_mp');
  assert.ok(r.noticeErrors().length>before);
  // danger only raises, transfer only refuses, respawn only waits longer.
  assert.equal(ask('danger',[true],true),true);
  assert.equal(ask('transfer',[true,false],true),false);
  assert.equal(ask('respawn',[],10),10);
  answers.respawn=20;assert.equal(ask('respawn',[],10),20);
  // The port order is an order of core's own members.
  assert.deepEqual(ask('ports',[['W','P']],['W','P']),['P','W']);
  answers.ports=['P','X'];assert.deepEqual(ask('ports',[['W','P']],['W','P']),['W','P']);
  // A Stomp core does not offer stays off.
  assert.equal(ask('stomp',[false],false),false);
});

test('P13: the warrior on the fixture routine casts its Charge then attacks; the priest beside it heals on the built-in',()=>{
  const r=loaded(),button={label:'Charge first',description:'Charge, then attack',color:'rose'};
  const asks=[{skill:'charge',rank:'task',category:'damage',reason:'fixture: Charge'},{skill:'attack',rank:'task',category:'damage',reason:'fixture: attack'}];
  let answer=()=>asks;
  // An entry for a class the game does not have is refused, and turns.routine needs its entry.
  assert.match(r.register(addon('bard',{'turns.routine':()=>[]},{slots:[{slot:'combat-routine',mode:'song',fills:'choice',button,classes:['bard']}]})).message,/class "bard", which the game does not have/);
  assert.match(r.register(addon('loose',{'turns.routine':()=>[]})).message,/fills no combat routine entry/);
  assert.deepEqual(r.register(addon('fixture',{'turns.routine':()=>answer()},{slots:[{slot:'combat-routine',mode:'charge-first',fills:'choice',button,classes:['warrior']}]})),{ok:true});
  const ask=(entry,ctype)=>r.turns.routine({entry,ctype,view:{},ready:()=>({ready:true})});
  // Switched off, the built-in runs; the dashboard lists only the built-in, so no picker shows.
  assert.equal(ask('charge-first','warrior'),undefined);
  assert.deepEqual(r.entries('combat-routine').map(e=>e.mode),['built-in']);
  r.configure({fixture:{enabled:true}});
  assert.deepEqual(r.entries('combat-routine').map(e=>e.mode),['built-in','charge-first']);
  assert.deepEqual(ask('charge-first','warrior'),asks);
  assert.equal(r.turns.routineServes('charge-first','warrior'),true);
  // The priest's class is not listed, and the built-in entry asks no add-on.
  assert.equal(ask('charge-first','priest'),undefined);
  assert.equal(r.turns.routineServes('charge-first','priest'),false);
  assert.equal(ask('built-in','warrior'),undefined);
  // An answer that throws or breaks the shape runs the built-in and is recorded; nothing spends nothing.
  answer=()=>{throw Error('broken');};assert.equal(ask('charge-first','warrior'),undefined);
  answer=()=>[{skill:3}];assert.equal(ask('charge-first','warrior'),undefined);
  assert.equal(r.noticeErrors().find(e=>e.name==='fixture'&&e.hook==='turns.routine').count,2);
  answer=()=>undefined;assert.deepEqual(ask('charge-first','warrior'),[]);
  // In the turns sources, a picked routine replaces the attack, the offense and the buffs; the
  // survival casts stay, and the routine asks at most task.
  const {createCoreSources}=require('../../runtime/characters/turns/sources.ts');
  const decisions=[{skill:'partyheal',category:'survival',reason:'heal'},{skill:'hardshell',category:'maintenance',reason:'buff'}];
  const engine={choices:{absorb:()=>null,support:()=>decisions,offense:()=>[{skill:'cleave',category:'damage',reason:'hit'}]},book:()=>({})};
  const attack={request:()=>({skill:'attack',rank:'damage',category:'damage',reason:'attack'})};
  const view=()=>({roleLoop:true,combat:true,attack:true,target:{target:{id:'m'},support:true,passing:false},world:()=>({actor:{ctype:'warrior'}})});
  let routine=()=>undefined;
  const sources=createCoreSources(engine,attack,v=>routine(v));
  let v=view();
  assert.deepEqual(sources.support(v).map(a=>a.skill),['partyheal','hardshell']);
  assert.equal(sources.attack(v).skill,'attack');
  assert.equal(sources.offense(v).length,1);
  routine=()=>asks;v=view();
  assert.deepEqual(sources.support(v).map(a=>a.skill),['partyheal']);
  assert.equal(sources.attack(v),undefined);
  assert.equal(sources.offense(v),undefined);
  assert.deepEqual(sources.routine(v),asks);
  const {turnsRegistration}=require('../../runtime/characters/turns/install.ts');
  const requesters=turnsRegistration({sources,ready:()=>({}),allows:()=>undefined,pullSafe:()=>true,report:()=>({}),records:()=>[],listeners:{}}).hooks['skills.request'];
  assert.equal(requesters.find(q=>q.name==='routine').rank,'task');
});

test("P1 (02): an add-on's Follow overlay reaches the follow while the saved followers stay the player's",()=>{
  const {readOverlaysWith}=require('../../runtime/settings/api.ts'),{createEventReply}=require('../../runtime/events/coordinator/reply.ts');
  const r=loaded();
  assert.deepEqual(r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',hooks:{'settings.accepts':()=>undefined}}),{ok:true});
  assert.deepEqual(r.register(addon('follow',{'settings.overlay':ask=>({...ask.value,[ask.character]:true})},{overlays:['followers']})),{ok:true});
  const state={leader:'W',followers:{P:false},merchantCharacter:null,statuses:{}},saved=JSON.stringify(state);
  const reply=createEventReply(state,{now:()=>0,activeNames:()=>['W','P'],enabled:()=>true,selectedEvents:()=>[],setting:({field})=>state[field],anniversary:()=>null});
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    assert.equal(reply.eventReply('P').followLeader,false,"switched off, the player's Follow plays");
    r.configure({follow:{enabled:true}});
    assert.equal(reply.eventReply('P').followLeader,true);
    assert.equal(JSON.stringify(state),saved);
  }finally{readOverlaysWith(undefined);}
});

test('P3: an add-on lets the Hunt walk leave its chests and walk on through a defence',()=>{
  const {walkDeparture,defensePauses,exemptWalk,departureWaitsFight,departureWaitsLoot}=require('../../runtime/movement/rules.ts');
  const r=loaded(),view={group:'party',walk:{purpose:'monster-hunt',phase:'assemble',flags:{departure:'loot',defencePauses:true,handsCombat:false}}};
  assert.deepEqual(r.movement.walkFlags(view),{},'with no add-on the walk keeps its own flags');
  assert.deepEqual(r.register(addon('go',{'walk.flags':()=>({depart:'go',defence:'walk-on',handsCombat:true})})),{ok:true});
  r.configure({go:{enabled:true}});
  const flags=r.movement.walkFlags(view);
  assert.deepEqual(flags,{depart:'go',defence:'walk-on',handsCombat:true});
  const hunt={purpose:'monster-hunt',huntTarget:'goo',addonFlags:{depart:flags.depart,defence:flags.defence}};
  // `go` leaves the chests and still waits for the member's fight.
  assert.equal(walkDeparture(hunt),'fight');
  assert.deepEqual([departureWaitsFight('fight'),departureWaitsLoot('fight')],[true,false]);
  assert.equal(walkDeparture({purpose:'monster-hunt',huntTarget:'goo'}),'loot');
  assert.equal(defensePauses(hunt),false);assert.equal(exemptWalk(hunt),true);
  assert.equal(defensePauses({purpose:'monster-hunt'}),true);
  // A second answer merges the safer way, and an escape's walk departs at once.
  assert.deepEqual(r.register(addon('hold',{'walk.flags':()=>({depart:'hold',defence:'pause',handsCombat:false})})),{ok:true});
  r.configure({go:{enabled:true},hold:{enabled:true}});
  assert.deepEqual(r.movement.walkFlags(view),{depart:'hold',defence:'pause',handsCombat:false});
  assert.equal(walkDeparture({purpose:'monster-hunt',addonFlags:{depart:'hold'}}),'after-loot');
  assert.equal(walkDeparture({purpose:'escape-recovery',addonFlags:{depart:'hold'}}),'now');
});

test("P8: a core walk's safe point moves to the add-on's point",()=>{
  const c=loaded(),view={group:'party',walk:'w1'};
  assert.equal(c.movement.safeGoal('monster-hunt',view),undefined,'with no add-on the walk keeps its own');
  assert.deepEqual(c.register(addon('safe',{'safe.goal':v=>v.purpose==='monster-hunt'?{map:'main',x:-50,y:20}:{map:'main',x:'bad'}})),{ok:true});
  c.configure({safe:{enabled:true}});
  assert.deepEqual(c.movement.safeGoal('monster-hunt',view),{map:'main',x:-50,y:20});
  assert.equal(c.movement.safeGoal('farm-recovery',view),undefined,'a point without finite x and y counts as none');
  assert.equal(c.movement.safeGoal('escape-recovery',view),undefined,"the escape's walk is not asked");
  assert.equal(c.movement.safeGoal('addon:other',view),undefined,"another add-on's walk asks only its own add-on");
});

test("P9: an add-on's rung comes first on a core climb, and the core rungs stay last",()=>{
  const {createOwnerLadder,taskRound}=require('../../runtime/protocol/ladder.ts');
  const c=loaded(),rung={name:'first',toward:true,attempt:()=>({trying:'the add-on way',options:{}})};
  assert.deepEqual(c.movement.rungs('task:farm','x'),{own:[],ahead:[]});
  assert.deepEqual(c.register(addon('ahead',{'ladder.rung':a=>a.holder==='event-exit'?[rung,{name:'broken'}]:undefined})),{ok:true});
  c.configure({ahead:{enabled:true}});
  const added=c.movement.rungs('event-exit','Leaving the event');
  assert.deepEqual(added.ahead.map(g=>g.name),['first'],'a rung without a direction and an attempt counts as none');
  assert.deepEqual(c.movement.rungs('task:farm','x').ahead,[]);
  const G={maps:{main:{spawns:[[0,0]],doors:[]}}},round=taskRound(G,'the farm'),names=[];
  const ladder=createOwnerLadder([...added.ahead,...round],()=>0);
  for(let i=0;i<round.length+1;i++){const at={map:'main',x:0,y:0},a=ladder.next(at,{});names.push(a.rung);if(a.rung==='wait')break;ladder.result({arrived:false,at,remaining:{transitions:0,walking:100}});}
  assert.equal(names[0],'first');assert.equal(names.at(-1),'wait','the core round still ends at its wait');
});

test("P1: an add-on overlays historyKept and the combat log keeps its count",()=>{
  const {overlayProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const {readOverlaysWith}=require('../../runtime/settings/api.ts'),{appendCombatLog}=require('../../runtime/status/coordinator/logs.ts');
  const r=loaded();
  r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',hooks:{'settings.accepts':(field,value)=>overlayProblem(coordinatorSettings().table,field,value)}});
  assert.deepEqual(r.register(addon('short',{'settings.overlay':()=>2},{overlays:['historyKept']})),{ok:true});
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    r.configure({short:{enabled:true}});
    const logs={};
    for(let i=0;i<5;i++) appendCombatLog(logs,'W',i);
    assert.deepEqual(logs.W,[3,4]);
    r.configure({short:{enabled:false}});
    for(let i=5;i<8;i++) appendCombatLog(logs,'W',i);
    assert.deepEqual(logs.W,[3,4,5,6,7]);
  }finally{readOverlaysWith(undefined);}
});

test("P1: an add-on that overlays a noOverlay field is refused at load",()=>{
  const {overlayFieldProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const r=loaded();
  assert.deepEqual(r.register(addon('hands',{'settings.overlay':()=>({})},{overlays:['handControlByCharacter']})),{ok:true});
  assert.deepEqual(r.register(addon('order',{'settings.overlay':()=>undefined},{overlays:['eventPrioritiesByCharacter']})),{ok:true});
  r.guardOverlays(field=>overlayFieldProblem(coordinatorSettings().table,field));
  assert.ok(!r.registrations().some(x=>x.name==='hands'));
  assert.ok(r.registrations().some(x=>x.name==='order'));
  assert.match(r.refusals().find(x=>x.name==='hands').message,/hands overlays "handControlByCharacter": Hand control takes no add-on value/);
  // A later registration meets the same check.
  assert.match(r.register(addon('switches',{'settings.overlay':()=>undefined},{overlays:['addons']})).message,/takes no add-on value/);
});

test("addon.command: the named add-on answers its own command and writes its own scope store",()=>{
  const r=loaded(),was=globalThis.__partyHooks;
  assert.deepEqual(r.register(addon('roles',{'addon.command':view=>{view.store.tank=view.body.tank;return {ok:true,reply:{tank:view.store.tank,owner:view.owner,character:view.character}};}})),{ok:true});
  assert.deepEqual(r.register(addon('broken',{'addon.command':()=>'yes'})),{ok:true});
  globalThis.__partyHooks=r;
  try{
    let saved=0;
    const {createAddonRoutes}=require('../../runtime/hooks/http.ts');
    const routes=createAddonRoutes({write:()=>({ok:true}),fighters:()=>[],persist:()=>{saved++;},now:()=>1});
    const scope={leader:'W'},post=(body)=>{const out={status:200};routes.command(scope,()=>'W')({body},{status(n){out.status=n;return this;},json(v){out.body=v;return this;}});return out;};
    // Switched off, no add-on takes the command.
    assert.equal(post({name:'roles',character:'P',body:{tank:'P'}}).status,404);
    r.configure({roles:{enabled:true},broken:{enabled:true}});
    assert.deepEqual(post({name:'roles',character:'P',body:{tank:'P'}}),{status:200,body:{ok:true,tank:'P',owner:'W',character:'P'}});
    assert.deepEqual(scope.addonFarming,{roles:{tank:'P'}});
    assert.equal(saved,1);
    // A broken answer replies 500, is recorded and saves nothing.
    assert.equal(post({name:'broken',body:{}}).status,500);
    assert.ok(r.noticeErrors().some(e=>e.name==='broken'&&e.hook==='addon.command'));
    assert.equal(saved,1);
  }finally{globalThis.__partyHooks=was;}
});

test("P1: an add-on's gathering modes make the merchant's candidates while the saved list stays the player's",()=>{
  const {overlayProblem}=require('../../runtime/settings/rules.ts'),{coordinatorSettings}=require('../../runtime/settings/coordinator/api.ts');
  const {readOverlaysWith}=require('../../runtime/settings/api.ts'),{gatheringReady}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
  const r=loaded();
  assert.deepEqual(r.register({name:'core:settings-check',folder:'core',author:'e2e',summary:'test',
    hooks:{'settings.accepts':(field,value)=>overlayProblem(coordinatorSettings().table,field,value)}}),{ok:true});
  assert.deepEqual(r.register(addon('gather',{'settings.overlay':ask=>ask.field==='gatheringModes'?['mining']:undefined},{overlays:['gatheringModes']})),{ok:true});
  const party={merchantCharacter:'M',gatheringModes:['fishing'],statuses:{}},saved=JSON.stringify(party);
  readOverlaysWith((field,value,character)=>r.overlay(field,value,character));
  try{
    assert.deepEqual(gatheringReady(party,0),['fishing']);
    r.configure({gather:{enabled:true}});
    assert.deepEqual(gatheringReady(party,0),['mining']);
    assert.equal(JSON.stringify(party),saved);
  }finally{readOverlaysWith(undefined);}
});

// movement.npcPlace: an add-on walks to an NPC by its id, from the coordinator's game data or the
// character's own G.
test('movement.npcPlace: the first map that lists the NPC, from the loaded maps or the game G, and null for none',()=>{
  const {npcPlace}=require('../../runtime/movement/api/character.ts'),{setGameMaps}=require('../../runtime/protocol/game-npcs.ts');
  const saved=globalThis.G;
  try{
    globalThis.G={maps:{main:{npcs:[{id:'secondhands',position:[10,20]}]}}};
    assert.deepEqual(npcPlace('secondhands'),{map:'main',x:10,y:20});
    setGameMaps({old:{ignore:true,npcs:[{id:'lostandfound',position:[0,0]}]},woffice:{npcs:[{id:'lostandfound',positions:[[-24,-178]]}]}});
    assert.deepEqual(npcPlace('lostandfound'),{map:'woffice',x:-24,y:-178});
    assert.equal(npcPlace('secondhands'),null,'the loaded maps answer over the G');
  }finally{setGameMaps(null);globalThis.G=saved;}
});
