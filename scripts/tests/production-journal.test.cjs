const {productionHarness}=require('./helpers/items-character.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {beginProduction,finishProduction,inspectProduction,resolveUnknownProduction,pendingProduction,checkpointProduction}=require('../../runtime/items/coordinator/production.ts');
// The journal keeps every unfinished attempt and each item's newest finished one, which a
// resent receipt names; v1.5.0's 2,048-attempt window is gone. The row reads the
// coordinator's journal alone, so it builds no character context.
test('the journal keeps unfinished attempts and each newest finished one, and latest retries survive',()=>{
 const state={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{M:{'cap@+0':{tiers:1,quantity:2}}},autoCompounds:{}};
 for(let i=0;i<3000;i++)state.production.attempts['old'+i]={name:'cap',level:1,kind:'upgrade',rules:[],completed:true,completedAt:i};
 state.production.attempts.ring={name:'ring',level:1,kind:'upgrade',rules:[],completed:true,completedAt:1};
 const body={id:'latest',item:{name:'cap',level:0},kind:'upgrade'};
 beginProduction(state,body);
 assert.deepEqual(Object.keys(state.production.attempts).sort(),['latest','old2999','ring']);
 finishProduction(state,'latest',false);
 assert.equal(beginProduction(state,body).completed,true);
 assert.deepEqual(Object.keys(state.production.attempts).sort(),['latest','ring']);
 state.production.attempts.pending={name:'cap',level:1,kind:'upgrade',rules:[],journal:{id:'pending',item:{name:'cap',level:0},slots:[0],phase:'running'}};
 assert.throws(()=>beginProduction(state,{...body,id:'next'}),/recovery pending/);
 assert.equal(state.production.attempts.pending.journal.phase,'running');
});
// The character's production journal (production.ts) over productionHarness, with the coordinator's
// receipts from items/coordinator/production.ts. An upgrade runs in the lucky slot it starts in, so
// `operation` is the game's upgrade call; `journal` reads the saved journal as a restart sees it.
function fixture({state=null,stored={}}={}){
 state??={merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{M:{'cap@+0':{tiers:1,quantity:2}}},autoCompounds:{}};
 const f={state,lost:false,job:null,operation:async()=>{}};
 f.answer=async(_path,{body})=>{if(body.action==='pending')return {pending:pendingProduction(f.state.production,true)};if(body.action==='checkpoint')return checkpointProduction(f.state,body);if(body.action==='inspect')return inspectProduction(f.state,body);if(body.action==='complete'){finishProduction(f.state,body.id,body.success);if(f.lost){f.lost=false;throw Error('response lost')}}else beginProduction(f.state,body);};
 const character={name:'M',ctype:'merchant',map:'main',q:{},items:[{name:'cap',level:0},{name:'scroll0',q:5}]};
 const h=productionHarness({character,ports:{request:async(path,options)=>path==='/merchant/production'?f.answer(path,options):undefined,
  job:()=>f.job,upgrade:()=>f.operation()}});
 Object.assign(h.stored,stored);h.production.setLuckySlot(0);
 return Object.assign(f,{h,character,stored:h.stored,journal:()=>h.stored['party-production']??null,
  recover:()=>h.production.recover(),upgrade:operation=>{f.operation=operation;return h.production.upgradeConfirmed(0,1);},
  loseReply:()=>f.lost=true});
}
test('lost completion reply retries its durable receipt without executing the game operation again',async()=>{
 const f=fixture();f.loseReply();let calls=0;
 await assert.rejects(f.upgrade(async()=>{calls++;f.character.items[0].level=1;}),/response lost/);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);assert.ok(f.journal());
 await f.recover();assert.equal(calls,1);assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);assert.equal(f.journal(),null);
});
test('restart resolves an observed completed operation once before allowing more inventory work',async()=>{
 const body={id:'restart',item:{name:'cap',level:0},kind:'upgrade'},f=fixture({stored:{'party-production':{id:body.id,item:body.item,slots:[0],phase:'running',request:body}}});
 beginProduction(f.state,body);f.character.items[0].level=1;
 await f.recover();assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);await f.recover();assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,1);
});
test('prepared attempt after restart is abandoned without decrementing or issuing an operation',async()=>{
 const body={id:'prepared',item:{name:'cap',level:0},kind:'upgrade'},f=fixture({stored:{'party-production':{id:body.id,item:body.item,slots:[0],phase:'prepared',request:body}}});
 await f.recover();
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.equal(f.state.production.attempts.prepared,undefined);assert.equal(f.journal(),null);
});
test('a still-running game operation blocks recovery; an unrelated replacement item requires review',async()=>{
 const body={id:'pending',item:{name:'cap',level:0},kind:'upgrade'},f=fixture({stored:{'party-production':{id:body.id,item:body.item,slots:[0],phase:'running',request:body}}});
 beginProduction(f.state,body);f.character.q={upgrade:{}};
 await assert.rejects(f.recover(),/waiting/);f.character.q={};f.character.items[0]={name:'sword',level:0};
 await assert.rejects(f.recover(),/needs review/);assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);assert.ok(f.journal());
});

test('mismatched prepared journal recovers only after explicit unknown resolution of the orphan',async()=>{
 const old={id:'orphan',item:{name:'cap',level:0},kind:'upgrade'};
 const body={id:'rejected-compound',item:{name:'strring',level:0},kind:'compound'};
 const f=fixture({stored:{'party-production':{id:body.id,item:body.item,slots:[0,1,2],phase:'prepared',request:body}}});
 beginProduction(f.state,old);
 await assert.rejects(f.recover(),/needs review: orphan/);
 assert.ok(f.journal());assert.equal(f.state.production.attempts[body.id],undefined);
 resolveUnknownProduction(f.state,{...old,reason:'Mismatched saved journal; outcome unavailable'},123);
 const retired=JSON.stringify(f.state.production.attempts.orphan);
 f.state=JSON.parse(JSON.stringify(f.state)); // Verify persisted resolution and late receipt behavior.
 finishProduction(f.state,'orphan',true);
 resolveUnknownProduction(f.state,{...old,reason:'Repeated review'},456);
 assert.equal(JSON.stringify(f.state.production.attempts.orphan),retired);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);
 assert.equal(beginProduction(f.state,old).completed,true);
 await f.recover();assert.equal(f.journal(),null);
 let calls=0;await f.upgrade(async()=>{calls++;f.character.items[0].level=1;});
 assert.equal(calls,1);
});

test('prepared admitted attempt finishes without replay, while unknown running identity stays blocked',async()=>{
 const body={id:'admitted',item:{name:'cap',level:0},kind:'upgrade'},f=fixture({stored:{'party-production':{id:body.id,item:body.item,slots:[0],phase:'prepared',request:body}}});
 beginProduction(f.state,body);
 await f.recover();assert.equal(f.state.production.attempts.admitted.success,false);
 // A restart finds a running journal the coordinator never admitted.
 const missing={...body,id:'missing'},restarted=fixture({state:f.state,stored:{'party-production':{id:missing.id,item:missing.item,slots:[0],phase:'running',request:missing}}});
 await assert.rejects(restarted.recover(),/missing admitted attempt/);assert.ok(restarted.journal());
});

test('overlapping production and recovery cannot overwrite the active journal',async()=>{
 // The running journal's checkpoint is held open, so the attempt stays in flight.
 const f=fixture(),answer=f.answer;let release,started;
 const ready=new Promise(resolve=>started=resolve);
 f.answer=async(path,options)=>{if(options.body.action==='checkpoint'&&options.body.journal.phase==='running'){started();await new Promise(resolve=>release=resolve);}return answer(path,options);};
 const operation=f.upgrade(async()=>{f.character.items[0].level=1;});
 await ready;const saved=JSON.stringify(f.journal());
 await assert.rejects(f.h.production.upgradeConfirmed(0,1),/waiting for game operation/);
 await assert.rejects(f.recover(),/waiting for held:producing/);
 assert.equal(JSON.stringify(f.journal()),saved);
 release();await operation;assert.equal(f.journal(),null);
});

test('rejected admission clears only the unstarted journal and leaves the blocking attempt intact',async()=>{
 const f=fixture();beginProduction(f.state,{id:'orphan',item:{name:'cap',level:0},kind:'upgrade'});
 // Simulate the orphan appearing after the read-only preflight, at admission.
 f.answer=async(_path,{body})=>{if(body.action==='pending')return {pending:[]};if(body.action==='inspect')return inspectProduction(f.state,body);try{return {attempt:beginProduction(f.state,body)}}catch(error){error.partyRequest={status:409};throw error}};
 await assert.rejects(f.upgrade(async()=>{throw Error('must not execute')}),/Production recovery pending/);
 assert.equal(f.journal(),null);assert.equal(f.state.production.attempts.orphan.completed,undefined);
});

test('error after coordinator admission retains the prepared journal until reconciliation',async()=>{
 const f=fixture(),original=f.answer;
 f.answer=async(path,{body})=>{
  if(body.action)return original(path,{body});
  beginProduction(f.state,body);const error=Error('storage failed after admission');error.partyRequest={status:409};throw error;
 };
 await assert.rejects(f.upgrade(async()=>{throw Error('must not execute')}),/storage failed/);
 assert.ok(f.journal());assert.equal(Object.values(f.state.production.attempts)[0].completed,undefined);
 f.answer=original;await f.recover();
 assert.equal(f.journal(),null);assert.equal(Object.values(f.state.production.attempts)[0].success,false);
 assert.equal(f.state.autoUpgradeMarks.M['cap@+0'].quantity,2);
});

test('failed admission inspection preserves the journal for a later recovery',async()=>{
 const f=fixture();
 f.answer=async(_path,{body})=>{if(body.action==='pending')return {pending:[]};const error=Error(body.action==='inspect'?'inspection unavailable':'admission rejected');error.partyRequest={status:409};throw error};
 await assert.rejects(f.upgrade(async()=>{}),/admission rejected/);
 assert.ok(f.journal());
});

test('commerce production failure with empty old slot retains journal and never writes a poof receipt',async()=>{
 const f=fixture({stored:{commerce:{sequence:4,pendingUpgrade:{level:1}}}});f.job={commerceJournalKey:'commerce',commerceSequence:4};
 await assert.rejects(f.upgrade(async()=>{
  f.character.items[5]=f.character.items[0];f.character.items[0]=null;
  throw Error('item or scroll unavailable');
 }),/uncertain|unavailable/);
 assert.ok(f.journal());
 assert.equal(f.stored.commerce.pendingUpgrade.outcome,undefined);
});

// A commerce upgrade's power-loss journal: `body`'s production journal running at slot 0 for the
// commerce order at sequence 4, which the coordinator admitted. `pending` adds the order's pending
// upgrade at that sequence; `lucky` adds the lucky swap's journal, which the production journal names.
function commerceRecovery(body,{pending=true,lucky}={}){
 const stored={'party-production':{id:body.id,item:body.item,slots:[0],phase:'running',request:body,...(lucky?{lucky}:{}),commerce:{key:'commerce',sequence:4}}};
 if(pending)stored.commerce={sequence:4,pendingUpgrade:{level:1}};
 if(lucky)stored['party-lucky-upgrade']=lucky;
 const f=fixture({stored});
 beginProduction(f.state,body);
 return f;
}
test('commerce recovery cannot infer destruction from an empty original slot',async()=>{
 const body={id:'commerce-restart',item:{name:'cap',level:0},kind:'upgrade'};
 const f=commerceRecovery(body,{pending:false});
 f.character.items[0]=null;
 await assert.rejects(f.recover(),/needs review/);
 assert.ok(f.journal());
 assert.equal(f.state.production.attempts[body.id].completed,undefined);
});

test('commerce recovery locates one relocated survivor and preserves its receipt',async()=>{
 const body={id:'relocated',item:{name:'cap',level:0},kind:'upgrade'};
 const f=commerceRecovery(body);
 f.character.items[5]={name:'cap',level:1};f.character.items[0]=null;
 await f.recover();
 assert.deepEqual(f.stored.commerce.pendingUpgrade.outcome,{item:{name:'cap',level:1},destroyed:false});
});

// These rows plant power loss journals: the game's random burn cannot be timed to land at this
// checkpoint. The failure modes: an empty source alone implies destruction, an unrelated or
// duplicate survivor loses an item, null metadata fences an old receipt, and a confirmed empty
// lucky result never settles and keeps commerce blocked.
test('commerce recovery settles destruction only after empty lucky result reconciliation',async()=>{
 const body={id:'burned',item:{name:'cap',level:0},kind:'upgrade'};
 const lucky={from:0,to:7,item:body.item,displaced:null,phase:'running'};
 const f=commerceRecovery(body,{lucky});
 f.character.items[0]=null;f.character.items[7]=null;
 await f.recover();
 assert.deepEqual(f.stored.commerce.pendingUpgrade.outcome,{item:null,destroyed:true});
 assert.equal(f.state.production.attempts.burned.success,false);
 assert.equal(f.journal(),null);
});

for(const legacy of [false,true])test('commerce legacy null metadata matches relocated survivor '+legacy,async()=>{
 const body={id:'null-survivor',item:{name:'cap',level:0,...(legacy?{p:null}:{})},kind:'upgrade'};
 const f=commerceRecovery(body);
 f.character.items[0]=null;f.character.items[5]={name:'cap',level:1,...(!legacy?{p:null}:{})};
 await f.recover();
 assert.deepEqual(f.stored.commerce.pendingUpgrade.outcome,{item:{name:'cap',level:1},destroyed:false});
});

for(const variant of ['preparing','changed-identity','duplicate'])test('commerce destruction recovery preserves ambiguous evidence '+variant,async()=>{
 const body={id:'ambiguous',item:{name:'cap',level:0,rid:'owned'},kind:'upgrade'};
 const lucky={from:0,to:7,item:body.item,displaced:null,phase:variant==='preparing'?'preparing':'running'};
 const f=commerceRecovery(body,{pending:false,lucky});
 f.character.items[0]=null;f.character.items[7]=null;
 if(variant==='changed-identity')f.character.items[5]={name:'cap',level:1,rid:'different'};
 if(variant==='duplicate'){f.character.items[5]={...body.item};f.character.items[6]={...body.item};}
 await assert.rejects(f.recover(),/needs review/);
 assert.equal(f.state.production.attempts.ambiguous.completed,undefined);
 assert.ok(f.journal());
});
// The production journal stays for recovery on the failure's code, never on its text. An
// interrupted failure with any message keeps it; a codeless failure whose text says "recovery"
// closes it.
test('the journal stays on an open I7 class, whatever the failure text says',async()=>{
 const {itemFailure}=require('../../runtime/items/rules.ts');
 const run=async failure=>{
  const character={name:'M',ctype:'merchant',map:'main',q:{},items:[{name:'ring',level:0},{name:'ring',level:0},{name:'ring',level:0},{name:'cscroll0',q:1}]};
  const h=productionHarness({character,ports:{request:async(_path,{body})=>body.action==='pending'?{pending:[]}:{},compound:async()=>{throw failure;}}});
  await assert.rejects(h.production.compoundConfirmed(0,1,2,3));
  return h.stored['party-production']?.phase ?? null;
 };
 assert.equal(await run(itemFailure('interrupted','the game said no')),'running');
 assert.equal(await run(Error('compound recovery interrupted')),null);
});
// I-13: a commerce order marks the merchant job owner's running job through the runner's `commerce`
// port, so the job a reload recovers carries the journal key and sequence, and the events owner's merchant reads
// the cycle flag. A mark under another command lands on no job.
test('commerce marks reach the running job through the runner, only under its own command',async()=>{
 const {installRunner}=require('./helpers/merchant-runner.cjs');require('./helpers/run-scope.cjs').processScope();
 const context={root:{},character:{ctype:'merchant',stand:false},partyItems:{stand:{close:async()=>{}}},recoverProductionJournal:async()=>{},recoverLuckyUpgrade:async()=>{},restoreUpgradePreviewSupplies:async()=>{},tidyLuckySlot:async()=>{},freeInventorySlots:()=>42,request:async()=>({}),game_log(){},setTimeout:fn=>fn(),setInterval:()=>1,clearInterval(){}};
 const runner=installRunner(context,{sleep:async()=>{}}),command={id:8,jobId:'buy',type:'merchant-commerce',commerceProgressVersion:2};
 assert.equal(await runner.accept(command),true);
 await runner.runJob(command,'buy',async()=>{
  runner.commerce(9,{commerceCycle:true});
  runner.commerce(8,{commerceCycle:true,commerceJournalKey:'party-commerce:buy',commerceSequence:3});
  const held=runner.job();
  assert.deepEqual([held.commerceCycle,held.commerceJournalKey,held.commerceSequence],[true,'party-commerce:buy',3]);
 });
});
