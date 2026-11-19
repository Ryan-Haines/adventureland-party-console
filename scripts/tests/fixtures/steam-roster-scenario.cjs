// The Steam roster's services (runtime/lifecycle/roster/handoff.ts SteamHandoff, steam-group.ts
// SteamGroup) over planted sessions, and the merchant realm move both wait on (a shared setup lives in the harness).
const assert=require('node:assert/strict');
const {SteamHandoff}=require('../../../runtime/lifecycle/roster/handoff.ts');
const {SteamGroup}=require('../../../runtime/lifecycle/roster/steam-group.ts');
const {createCoordinatorOwnershipPorts}=require('../../../runtime/lifecycle/roster/ownership.ts');
const {createMerchantRealmOwner}=require('../../../runtime/merchant-realm/coordinator/owner.ts');

function handoffFixture(slots = ['Mage', 'Warrior', 'Merchant', null]) {
  const state = { native: 'Priest', slots, handoff: null };
  const online = new Set(['Priest', ...slots.filter(Boolean)]), started = [], stopped = [];
  const ports = {
    now: () => 100, id: () => 'transaction-1', save() {}, bridgeReady: () => true,
    owned: name => ['Priest', 'Mage', 'Warrior', 'Merchant', 'Ranger'].includes(name),
    validateParticipants(names) { if (new Set(names).size > 4) throw new Error('session limit'); },
    async stopHeadless(name) { stopped.push(name); online.delete(name); },
    startHeadless(name, slot) { assert.ok(!online.has(name), 'never double login'); online.add(name); started.push([name, slot]); },
    async confirmOffline(name) { return !online.has(name); },
  };
  return { state, online, started, stopped, ports, service: new SteamHandoff(state, ports) };
}

function groupFixture(steam=['P'],slots=['M','W','Trader',null]) {
 let now=1000,id=0;const state={native:steam[0]||null,steam,slots,handoff:null};
 const online=new Set([...steam,...slots.filter(Boolean)]),stopped=[],started=[];
 const ports={now:()=>now,id:()=>String(++id),save(){},bridgeReady:()=>true,owned:()=>true,
  validateParticipants:names=>assert.ok(new Set(names).size<=4),
  stopHeadless:async name=>{stopped.push(name);online.delete(name);},confirmOffline:async name=>!online.has(name),
  startHeadless:(name,slot)=>{assert.ok(!online.has(name));online.add(name);started.push([name,slot]);}};
 const service=new SteamGroup(state,ports);
 return {state,online,stopped,started,service,ports,advance:ms=>now+=ms,
  release:async()=>{state.handoff.multi.release.forEach(n=>online.delete(n));await service.released(state.handoff.id);}};
}

// The realm owner holds `merchant` on SR_USII with a job
// running, and the coordinator's ownership ports read its move. `arrive` reports the merchant on
// SR_EUI, which ends the move.
function merchantMove({merchant,steam,slots}){
 let now=100000;const blocks={[merchant]:{realm:'SR_USII',connected:true}};
 const realmState={merchantCharacter:merchant,activeRealm:'SR_USII',merchantRealmRequests:{},merchantRealmBlacklist:[],
  statuses:{[merchant]:{server:'USII',seenAt:now,runtime:'headless'}},commands:{},nextCommandId:1,merchantCurrent:{id:'a',reason:'ALData marketplace purchases'}};
 const realm=createMerchantRealmOwner(realmState,{now:()=>now,block:name=>blocks[name],realmLabel:r=>r,log(){},persist(){},restart(){},resolve:()=>true});
 const ownership=createCoordinatorOwnershipPorts({steamMembers:steam,nativeOwner:steam[0],headlessSlots:slots,steamSwitch:null,
  statuses:realmState.statuses,bankbois:{},bankboiTransaction:null,merchantCharacter:merchant,leader:null,lifecycle:{}},{},
  {now:()=>now,realmMoving:name=>realm.movingFor(name),id:()=>'x',commit(){},owned:()=>({}),updateAccount:async()=>{},sleep:async()=>{},
   stop:async()=>{},assignSlot(){},roster:()=>[],configuredRealm:'SR_USII'});
 return {realm,validateParticipants:names=>ownership.validateParticipants(names),
  arrive(){now+=1000;realmState.statuses[merchant]={server:'EUI',seenAt:now,runtime:'headless'};}};
}
module.exports={handoffFixture,groupFixture,merchantMove};
