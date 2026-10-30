const test=require('node:test');
const assert=require('node:assert/strict');
const {collectPassing}=require('../../runtime/combat/passing.ts');

// collectPassing runs twice for every status and combat report response (passingAdmission and
// passingReports). Failure lines:
// - a death at or after an encounter's start stops removing it
// - a death before the encounter's start (an earlier kill of a reused id) removes it
// - a death of the same id on another server, map or instance removes it
// - the newest report of an encounter, the sort by time and the 128 cap change
// - collectPassing copies and scans every member's death list on every call, including calls with no encounter
const now=1_000_000;
const status=(extra={})=>({seenAt:now-100,hp:100,map:'main',server:'USI',x:0,y:0,...extra});
const encounter=(id,at,extra={})=>({id,map:'main',server:'USI',at,mtype:'goo',...extra});
const death=(id,at,extra={})=>({id,map:'main',server:'USI',at,...extra});
function counted(list){
  let reads=0;
  const proxy=new Proxy(list,{get(target,key,receiver){if(typeof key==='string'&&/^[0-9]+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
  return {proxy,reads:()=>reads};
}

test('deaths remove only the same live encounter at or after its start',()=>{
  const members=[
    {name:'A',ctype:'',revision:0,status:status({groupedCombat:{passingEncounters:[encounter('1',now-500,{startedAt:now-900}),encounter('2',now-400),encounter('3',now-300),encounter('4',now-200)],
      deaths:[death('1',now-900),death('2',now-450),death('3',now-250,{map:'halloween'}),death('3',now-250,{server:'USII'}),death('3',now-250,{in:'cave'})]}})},
    {name:'B',ctype:'',revision:0,status:status({groupedCombat:{passingEncounters:[encounter('4',now-150)],deaths:[death('4',now-150)]}})},
  ];
  const result=collectPassing(members,[],now);
  assert.deepEqual(result.map(e=>[e.id,e.at]),[['2',now-400],['3',now-300]]);
});

test('the newest report of an encounter wins, sorted by time and capped at 128',()=>{
  const many=[];for(let index=0;index<200;index++)many.push(encounter(String(index),now-10_000+index));
  const members=[
    {name:'A',ctype:'',revision:0,status:status({groupedCombat:{passingEncounters:many,deaths:[death('199',now)]}})},
    {name:'B',ctype:'',revision:0,status:status({groupedCombat:{passingEncounters:[encounter('5',now-50)],deaths:[]}})},
  ];
  const result=collectPassing(members,[encounter('7',now-20)],now);
  assert.equal(result.length,128);
  assert.deepEqual(result.slice(-3).map(e=>[e.id,e.at]),[['198',now-10_000+198],['7',now-20],['5',now-50]].sort((a,b)=>a[1]-b[1]));
  assert.ok(result.every((e,index)=>!index||result[index-1].at<=e.at));
  assert.ok(!result.some(e=>e.id==='199'));
});

test('a report with no passing encounter does not scan the death lists',()=>{
  const deaths=counted(Array.from({length:500},(_,index)=>death(String(index),now-index)));
  const members=['A','B','C'].map(name=>({name,ctype:'',revision:0,status:status({groupedCombat:{passingEncounters:[],deaths:deaths.proxy}})}));
  assert.deepEqual(collectPassing(members,[],now),[]);
  assert.equal(deaths.reads(),0);
});
