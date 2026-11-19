const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorAccountCharacterActions}=require('../../runtime/items/coordinator/routes/characters.ts');
function fixture(){
 const state={headlessSlots:[null],bankboiPrefix:'Vault',bankbois:{},bankboiQueue:[],bankboiTransaction:null};
 const names=new Set(),calls=[],timers=[];let reply=[],refresh=async()=>{};
 const service=createCoordinatorAccountCharacterActions(state,{
  now:()=>100000000,classes:['mage'],characterCount:()=>names.size,owned:name=>names.has(name),session:'fixture-session',
  loadFetch:async()=>{calls.push('load');return async(url,{signal,...options})=>{assert.ok(signal instanceof AbortSignal,'the request carries the kept bound');calls.push({url,options});return {ok:true,statusText:'OK',json:async()=>reply};};},
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
 t.names.add('B');t.state.bankbois.B={items:[{name:'leather'}],slots:{},gold:0};
 assert.equal((await t.invoke(t.service.deletion,{}, {name:'B'})).code,409);assert.deepEqual(t.calls,['refresh']);t.calls.length=0;
 t.state.bankbois.B={items:[],slots:{},gold:0};t.names.add('B');let rosterRefreshes=0;t.onRefresh(async()=>{if(++rosterRefreshes===2)t.names.delete('B');});
 assert.equal((await t.invoke(t.service.deletion,{}, {name:'B'})).code,200);
 assert.deepEqual(t.calls,['refresh','load',{url:'https://adventure.land/api/delete_character',options:{method:'POST',
  headers:{Cookie:'auth=fixture-session','Content-Type':'application/json; charset=utf-8'},body:'{"name":"B"}'}},'refresh','bank']);
 assert.equal(t.state.bankbois.B,undefined);
});
