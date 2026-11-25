// The coordinator's Phoenix patrol over the catalog regions, through the hunting owner's rare service (rares.ts
// `createRares`) (a shared setup lives in the harness).
const {createRares}=require('../../../runtime/hunting/coordinator/rares.ts');
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {installCoordinatorTargeting}=require('../../../runtime/coordinator/targeting/install.ts');
const {settingsWriter}=require('../helpers/settings-writer.cjs');
const {zones}=require('../../../runtime/hunting/zones.ts');
const {defaultPhoenixOrder}=require('../../../runtime/hunting/areas.ts');
const {phoenixParty}=require('./rare-hunting-scenario.cjs');
// The events owner's event.cycle and movement's answers the patrol and the snapshot read.
require('./coordinator-core.cjs');
function fixture(extra={}) {
  let time=100000, sequence=0;
  const party=phoenixParty(time,{monsterFocus:['phoenix'],passiveHunting:{version:1,useFieldGenerators:true,rules:{}},passiveRareHunts:{},
    location:{map:'main',x:641,y:1803},nextCommandId:0,navigationEpoch:0},{x:430.6,y:1709.4});
  installCoordinatorTargeting(partyHooks(),{state:()=>party,now:()=>time});
  const write=settingsWriter(party).write;
  const ports={now:()=>time,members:()=>['W','M','P'],runs:()=>true,taskRefuses:()=>false,monsters:()=>({phoenix:{respawn:32}}),
    intent:()=>({revision:1}),group:()=>'party:W',reconcileHuntArrival(){},routeDistance:async()=>0,
    ladder:()=>({fail:()=>null,progress(){},rung:()=>null}),persist(){},write,
    cancelConvoy(){party.activeConvoy=null;party.commands={};},
    convoy(location,label,names,purpose){party.activeConvoy={id:'c'+(++sequence),location,label,purpose,phase:'travel'};return true;},...extra};
  let controller=createRares(party,ports);
  const order=defaultPhoenixOrder(zones(party.monsterChoices,['phoenix']));
  // The navigate route writes the patrol order, then starts the patrol (routes.ts `createMonsterSelectionRoutes`).
  write({by:'dashboard:navigate-to-monster',changes:[{field:'phoenixRouteOrder',value:order}]});controller.start();
  function move(d){for(const s of Object.values(party.statuses))Object.assign(s,d,{in:d.map,seenAt:time});}
  function advance(ms){time+=ms;for(const s of Object.values(party.statuses))s.seenAt=time;}
  function kill(d={map:'main',x:641,y:1803},assist=false) {
    move(d);controller.tick();
    const lead=party.statuses.W;
    lead.rareSightings=[{id:'p1',mtype:'phoenix',x:d.x,y:d.y,hp:100,visible:true,partyEngaged:true,target:assist?'Stranger':'W'}];
    controller.report('W',lead);controller.tick();
    advance(1);lead.rareKills=[{id:'p1',mtype:'phoenix',...d,in:d.map,at:time,partyEngaged:true}];
    controller.report('W',lead);controller.tick();lead.rareSightings=[];
    return time;
  }
  function loot(){advance(1001);party.statuses.W.rareLoot={id:controller.control('W').id,observedAt:time,realm:':USII',map:party.statuses.W.map,in:party.statuses.W.in,complete:true};controller.tick();}
  return {party,ports,order,move,advance,kill,loot,time:()=>time,controller:()=>controller,starts:()=>sequence,
    restart(){controller=createRares(party,ports);controller.tick();return controller;}};
}

module.exports = { fixture };
