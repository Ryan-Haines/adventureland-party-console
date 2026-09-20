const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorAccountCharacterActions}=require('../../runtime/coordinator/http/account-character-actions.ts');
function fixture(){
 const state={headlessSlots:[null],bankboiPrefix:'Vault',bankbois:{},bankboiQueue:[],bankboiTransaction:null};
 const names=new Set(),calls=[],timers=[];let reply=[],refresh=async()=>{};
 const service=createCoordinatorAccountCharacterActions(state,{
  now:()=>100000000,classes:['mage'],characterCount:()=>names.size,owned:name=>names.has(name),session:'fixture-session',
  loadFetch:async()=>{calls.push('load');return async(url,options)=>{calls.push({url,options});return {ok:true,statusText:'OK',json:async()=>reply};};},
  adopt:snapshot=>{calls.push('adopt');for(const entry of snapshot.characters)names.add(entry.name);},
  refresh:async()=>{calls.push('refresh');await refresh();},later:(callback,ms)=>{timers.push(callback);calls.push(['timer',ms]);},
  assign:(slot,name)=>calls.push(['assign',slot,name]),persistBank:()=>calls.push('bank'),serviceBank:()=>calls.push('service'),log:()=>{},
 });
 async function invoke(handler,body={},params={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body,params},res);return res;}
 return {state,names,calls,timers,service,invoke,setReply:value=>{reply=value;},onRefresh:callback=>{refresh=callback;}};
}

test('character creation posts the exact authenticated envelope and adopts the returned roster before assigning',async()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 t.setReply([{type:'servers_and_characters',characters:[{name:'NewMage'}]}]);
 const result=await t.invoke(t.service.creation.roster,{name:' NewMage ',class:'mage',look:2});
 assert.equal(result.code,200);assert.equal(result.body.slot,1);
 assert.deepEqual(t.calls,['load',{url:'https://adventure.land/api/create_character',options:{method:'POST',
  headers:{Cookie:'auth=fixture-session','Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({name:'NewMage',char:'mage',look:2})}},
  'adopt',['assign',1,'NewMage']]);
});

test('account guards prevent paid creation and occupied deletion before loading transport; confirmed deletion persists',async()=>{
 const t=fixture();for(let i=0;i<8;i++)t.names.add('Char'+i);
 assert.equal((await t.invoke(t.service.creation.roster,{name:'NewMage',class:'mage'})).code,409);
 assert.equal((await t.invoke(t.service.creation.bankboi)).code,409);
 t.state.bankbois.B={items:[{name:'leather'}],slots:{},gold:0};
 assert.equal((await t.invoke(t.service.deletion,{}, {name:'B'})).code,409);assert.deepEqual(t.calls,[]);
 t.state.bankbois.B={items:[],slots:{},gold:0};t.names.add('B');t.onRefresh(async()=>t.names.delete('B'));
 assert.equal((await t.invoke(t.service.deletion,{}, {name:'B'})).code,200);
 assert.deepEqual(t.calls,['load',{url:'https://adventure.land/api/delete_character',options:{method:'POST',
  headers:{Cookie:'auth=fixture-session','Content-Type':'application/json; charset=utf-8'},body:'{"name":"B"}'}},'refresh','bank']);
 assert.equal(t.state.bankbois.B,undefined);
});

test('unconfirmed creation waits on the injected retry timer before assigning a character',async()=>{
 const t=fixture();t.setReply({});let refreshes=0;
 t.onRefresh(async()=>{if(++refreshes===2)t.names.add('NewMage');});
 const pending=t.invoke(t.service.creation.roster,{name:'NewMage',class:'mage'});
 for(let i=0;i<20&&t.timers.length===0;i++)await Promise.resolve();
 assert.equal(t.timers.length,1);assert.ok(t.calls.some(call=>Array.isArray(call)&&call[0]==='timer'&&call[1]===500));
 assert.equal(t.calls.some(call=>Array.isArray(call)&&call[0]==='assign'),false);
 t.timers[0]();assert.equal((await pending).code,200);
 assert.deepEqual(t.calls.at(-1),['assign',1,'NewMage']);
 assert.equal(t.calls.filter(call=>call==='load').length,1);
});
