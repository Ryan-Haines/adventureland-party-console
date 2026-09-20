const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {installQueueClient}=require('../../runtime/combat/client.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const target={id:'rat',mtype:'rat',type:'monster',visible:true,map:'mansion',in:'mansion',x:80,y:0};
const death={id:'rat',map:'mansion',in:'mansion',server:'USII',at:1000};
function fixture(run,retained=[],deaths=[]){
 const saved=Object.fromEntries(['parent','character','get_entity','setInterval','clearInterval'].map(k=>[k,global[k]]));
 let grouped=true,server='USII',client;
 const root={__partyFightDeaths:deaths};
 Object.assign(global,{parent:{__partyQueueEvidence:retained},character:{name:'P',map:'mansion',in:'mansion',x:0,y:0},
  get_entity:()=>target,setInterval:()=>1,clearInterval(){}});
 const shared={usesGroupedCombat:()=>grouped,getFarmingMode:()=>grouped?'default':'scatter',queueClockOffset:()=>0,
  sharedTargetId:()=>null,queueMembers:()=>['P'],queueRequest:()=>new Promise(()=>{}),
  queueReport:()=>({server,groupedCombat:{epoch:1,deaths:root.__partyFightDeaths,evidence:client?.reportEvidence()||[]}})};
 try{client=installQueueClient(root,shared);run({client,root,shared,scatter(){grouped=false;},move(){server='EUI';character.map='main';character.in='main';}});}
 finally{client?.stop();Object.assign(global,saved);}
}
test('scatter accepts rejection of an existing action and preserves its original identity after travel',()=>fixture(f=>{
 const action=f.client.evidence(target,'pending'),before={...f.client.events[0]};f.scatter();f.move();
 assert.equal(f.client.evidence(target,'rejected',action),action);
 assert.deepEqual({...f.client.events[0],at:before.at},{...before,state:'rejected'});
 assert.equal(f.client.evidence(target,'pending'),null,'scatter cannot create new grouped actions');
 assert.equal(f.shared.queueReport().groupedCombat.evidence[0].state,'rejected');
 assert.equal(f.root.__partyQueueEvidenceTrace.at(-1).mode,'scatter');
}));
test('hit settles a pending action in scatter after the grouped target was cleared',()=>fixture(f=>{
 f.client.evidence(target,'pending');f.scatter();f.client.hit({hid:'P',id:'rat'});
 assert.equal(f.client.events[0].state,'engaged');
}));
test('local death removes pending evidence during scatter and rejects its late completion',()=>fixture(f=>{
 const action=f.client.evidence(target,'pending');f.scatter();f.root.__partyFightDeaths.push(death);
 assert.deepEqual(f.shared.queueReport().groupedCombat.evidence,[]);
 assert.equal(f.client.evidence(target,'engaged',action),null);
 assert.equal(f.root.__partyQueueEvidenceTrace.at(-1).reason,'confirmed local death');
}));
test('client replacement reconciles retained evidence before any grouped polling',()=>{
 const event={...target,server:'USII',action:'old',state:'pending',at:900,startedAt:900};
 fixture(f=>assert.deepEqual(f.client.events,[]),[event],[death]);
});
test('a late new action cannot recreate a locally confirmed dead target',()=>fixture(f=>{
 f.root.__partyFightDeaths.push(death);
 assert.equal(f.client.evidence(target,'pending'),null);
 assert.deepEqual(f.client.events,[]);
}));
test('wrong realm or instance death preserves a real pending projectile',()=>fixture(f=>{
 f.client.evidence(target,'pending');f.scatter();
 f.client.reportEvidence([{...death,server:'EUI'},{...death,in:'other'}]);
 assert.equal(f.client.events[0].state,'pending');
 f.client.reportEvidence([{...death,id:String(target.id)}]);assert.equal(f.client.events.length,0);
}));
test('confirmed death hook cleans evidence before flushing even outside grouped mode',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8'),start=source.indexOf('  function reportFightDeath('),end=source.indexOf('  function groupedEntityReport(',start);
 const calls=[],context=vm.createContext({root:{partyQueueClient:{reportEvidence:deaths=>calls.push(['cleanup',deaths.length]),flush:()=>calls.push(['flush'])}},
  groupedCombat:null,fightDeaths:[],character:{map:'mansion',in:'mansion'},reunionRealm:()=> 'USII',coordinatorClockOffset:0,Date});
 vm.runInContext(source.slice(start,end),context);context.reportFightDeath('rat');
 assert.deepEqual(calls,[['cleanup',1],['flush']]);
});
test('death and rejection both promote the visible successor instead of restoring the invisible head',()=>{
 for(const outcome of ['death','rejected'])fixture(f=>{
  const action=f.client.evidence(target,'pending');f.scatter();
  const next={...target,id:'next'},third={...target,id:'third',x:100};
  const members=[{name:'P',ctype:'priest',status:{seenAt:Date.now(),hp:100,map:'mansion',in:'mansion',server:'USII',x:0,y:0,
   groupedCombat:{candidates:[next,third],evidence:f.client.events,deaths:[]}}}];
  let group=reconcileQueue(null,members,'P',Date.now(),'key');assert.equal(group.target.id,'rat');
  if(outcome==='death'){f.root.__partyFightDeaths.push({...death,at:Date.now()});f.client.reportEvidence();}
  else f.client.evidence(target,'rejected',action);
  members[0].status.seenAt=Date.now();members[0].status.groupedCombat.deaths=f.root.__partyFightDeaths;
  group=reconcileQueue(group,members,'P',Date.now(),'key');assert.equal(group.target.id,'next');
  group=reconcileQueue(null,members,'P',Date.now(),'key');assert.equal(group.target.id,'next');
 });
});
test('evidence diagnostics stay bounded',()=>fixture(f=>{
 const action=f.client.evidence(target,'pending');f.scatter();
 for(let i=0;i<40;i++)f.client.evidence(target,'engaged',action);
 assert.equal(f.root.__partyQueueEvidenceTrace.length,32);
}));
