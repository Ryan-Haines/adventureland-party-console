// The coordinator's rare hunting controller over a three-member party (a shared setup lives in the harness).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRares } = require('../../../runtime/hunting/coordinator/rares.ts');
const { partyHooks } = require('../../../runtime/hooks/index.ts');
const { installCoordinatorTargeting } = require('../../../runtime/coordinator/targeting/install.ts');
const { cycleHolds } = require('../../../runtime/events/coordinator/anniversary.ts');
const { settingsWriter } = require('../helpers/settings-writer.cjs');
const { installTasksOver } = require('../helpers/tasks-owner.cjs');
const boxes = [['main',708,-300,1668,-86],['main',378,1686,904,1920],
  ['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
const catalog = [{ id:'phoenix', locations:boxes.map(([map,...boundary]) => ({ map,boundary,
  x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2 })) }];
// The Phoenix catalog over its five regions and a W, M and P party on main, each status carrying the
// rare observation the coordinator reads. `fields` are the party's own, `member` each status's own.
function phoenixParty(time, fields, member) {
  const party = { leader:'W', followers:{M:true,P:true}, monsterChoices:catalog, monsterPrioritiesByCharacter:{}, combatMode:'auto', commands:{}, statuses:{}, ...fields };
  for (const [name,ctype] of [['W','warrior'],['M','mage'],['P','priest']]) {
    const s = party.statuses[name] = { name,ctype,server:'USII',map:'main',in:'main',hp:1000,seenAt:time,rareSightings:[],...member };
    s.combatSelection = {runtimeId:name};
    Object.defineProperty(s,'rareObservation',{configurable:true,get(){return {at:s.seenAt,runtimeId:s.name,map:s.map,in:s.in,server:s.server,x:s.x,y:s.y,sightings:s.rareSightings};}});
  }
  return party;
}
function fixture() {
  let time = 100000, starts = 0;
  const party = phoenixParty(time, { monsterFocus:['goo'], monsterFocusByCharacter:{},
    // The rules as the hunting owner's load migration writes them (runtime/hunting/coordinator/record.ts `migrateRareRules`).
    passiveHunting:require('../../../runtime/hunting/rules.ts').migratePassiveSettings(null,{tinyp:true,phoenix:true}),
    passiveRareHunts:{tinyp:true,phoenix:true},
    location:{map:'winterland',x:0,y:0}, targetMode:'farming', nextCommandId:1,
    headlessSlots:['W','M','P'], steamMembers:[] }, { x:0,y:0,items:[],rareFields:[] });
  const revisions = {W:1,M:1,P:1}, write = settingsWriter(party).write;
  function refresh() { for(const s of Object.values(party.statuses)) s.seenAt=time; }
  // Targeting's passing column, as the application hands it.
  // `runs` is the tasks owner's answer for the rare source; a row sets `party.rareRefused` to hold it.
  // The rare reads the group's queue through the targeting owner's `targeting.groupView`, which the targeting owner
  // answers from this party's grouped fight.
  // The events owner's `event.cycle` answers from this party's anniversary cycle (events/coordinator/install.ts).
  installCoordinatorTargeting(partyHooks(),{state:()=>party,now:()=>time});
  partyHooks().publish({name:'core:test-events',folder:'core',author:'test',summary:"06's anniversary cycle hold.",
    hooks:{'event.cycle':()=>cycleHolds(party.anniversary?.eventCycle)}});
  // The tasks owner over this party, whose rare source asks the controller's encounter task.
  const tasks = installTasksOver(party,{hooks:partyHooks(),now:()=>time,rare:()=>controller.task()});
  const controller = createRares(party,{now:()=>time,members:()=>['W','M','P'],runs:()=>!party.rareRefused,monsters:()=>({phoenix:{respawn:32}}),
    intent:n=>({revision:revisions[n],cancelled:false}),group:()=>'party:W',reconcileHuntArrival(){},routeDistance:async()=>0,
    ladder:()=>({fail:()=>null,progress(){},rung:()=>null}),
    // The task table's answer for a rare is the tasks owner's `rareRefused` over this party's
    // live task, as application.ts asks it.
    taskRefuses:(mtype)=>tasks.rareRefused(mtype),
    persist(){},write,cancelConvoy(){party.activeConvoy=null;},
    convoy(location,label,names,purpose){starts++;party.activeConvoy={id:'convoy-'+starts,location,label,purpose,phase:'travel'};return true;}});
  function sight(type='phoenix',name='W',extra={}) {
    const s=party.statuses[name];s.rareSightings=[{id:type,mtype:type,x:20,y:10,hp:5600,visible:true,...extra}];
    controller.report(name,s);controller.tick();
  }
  // The navigate route writes the patrol order through the settings writer, then starts the patrol
  // (hunting/coordinator/routes.ts `createMonsterSelectionRoutes`).
  function patrol(order,by='dashboard:navigate-to-monster') {
    write({by,changes:[{field:'phoenixRouteOrder',value:order}]});controller.start();
  }
  return {party,controller,tasks,revisions,sight,refresh,patrol,starts:()=>starts,
    advance(ms){time+=ms;refresh();},time:()=>time};
}
function groupRare(r,id='phoenix',state='planned') {
 for(const s of Object.values(r.party.statuses)) s.groupedCombat={protocol:4};
 const target={id,mtype:id,map:'main',in:'main',server:'USII',x:20,y:10,state};
 r.party.groupedCombat={protocol:4,seenAt:r.time(),target,queue:[target],fights:state==='planned'?[]:[target],deaths:[]};
 return target;
}

module.exports = { fixture, groupRare, phoenixParty };
