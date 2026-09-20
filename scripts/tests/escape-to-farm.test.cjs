const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
const createEscape=require(process.env.AL_ESCAPE_SOURCE || '../party-escape.cjs');
const convoy=require('../convoy-navigation.cjs'),zones=require('../../.build/shared/farming-zones.cjs');
test('completed manual Escape routes all three fighters to boars only after everyone has a prepared route',()=>{
 let now=10000;const names=['W','M','P'],zone={map:'winterland',x:20,y:-1109,shapes:[{boundary:[-173,-1488,212,-730]}]};
 const party={leader:'W',merchantCharacter:'Merchant',followers:{M:true,P:true},statuses:{},commands:{},navigationEpoch:1,nextCommandId:10,
 marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},statScrolls:{},compounds:{},withdrawals:{},characterLocations:{},navigationIntents:{},anniversary:{},eventSessions:{},deferredEventReturns:{},monsterChoices:[],monsterFocus:['boar'],farmAreaState:{},
 escape:{id:'escaped',stage:'complete',participants:names,roles:{warrior:'W',mage:'M',priest:'P'}}};
 names.forEach((name,i)=>party.statuses[name]={name,ctype:['warrior','mage','priest'][i],map:'winterland',x:0,y:0,seenAt:now,server:'USII',speed:57,hp:100});
 require('./helpers/travel-observations.cjs').observeTravel(party.statuses);
 const c=vm.createContext({party,Date:{now:()=>now},farmZones:zones,persistSettings(){},activeNames:()=>names});
 Object.assign(c,require('./helpers/coordinator-convoys.cjs').convoyService(c));
 require('./helpers/coordinator-farming-authorization.cjs').installFarmingAuthorization(c);
 c.farmingNavigation=require('../farming-navigation.cjs')(party,{names:()=>names,persist(){},cancelConvoy:()=>c.cancelActiveConvoy(),startConvoy:()=>{throw Error('unexpected old convoy');}});
 c.escapeControl=createEscape(party,{now:()=>now,persist(){},cancel:()=>c.cancelActiveConvoy()});
 c.manualNavigationCommands=require('../../runtime/coordinator/navigation/manual-commands.ts').createManualNavigationCommands(party,{
  now:()=>now,nextCommand:()=>party.nextCommandId++,members:()=>c.farmingNavigation.members(),
  authorizeRoute:(...args)=>c.authorizeFarmingRoute(...args),convoy:(...args)=>c.startPartyMonsterConvoy(...args),
 });
 c.upgradeCommands=require('../../runtime/coordinator/inventory/upgrade-commands.ts').createUpgradeCommands(party,{});
 c.compoundCommands=require('../../runtime/coordinator/inventory/compound-commands.ts').createCompoundCommands(party,{});
 c.characterCommandRoute=require('../../runtime/coordinator/http/character-command.ts').createCharacterCommandRoute(party,{
  managed:name=>names.includes(name),farmingLocation:()=>zone,handlers:[c.manualNavigationCommands.handle],
 });
 const routes={};Object.assign(c,{character_manage:{W:{},M:{},P:{}},validFarmingLocation:()=>zone,express_inst:{post:(url,fn)=>routes[url]=fn}});
 routes['/party-api/command']=c.characterCommandRoute;
 const res={json(){return this;},status(code){throw Error('HTTP '+code);}};
 routes['/party-api/command']({body:{character:'W',type:'party-monster-travel',location:zone,farmingMonsterIds:['boar']}},res);
 assert.equal(party.escape.stage,'released');assert.equal(party.activeConvoy.townFirst,false);assert.equal(party.activeConvoy.location.map,'winterland');
 assert.equal(party.activeConvoy.location.y,-1109);assert.equal(party.activeConvoy.participants.length,3);
 c.escapeControl.release();assert.ok(party.activeConvoy,'a duplicate old resume cannot cancel the new convoy');
 const active=party.activeConvoy;
 function report(name,phase,ready=false){const command=party.commands[name];party.statuses[name].seenAt=now;party.statuses[name].convoyNavigation={id:active.id,epoch:active.epoch,commandId:command.id,runtimeId:name,phase,routeReady:ready};}
 names.forEach(n=>report(n,'assembled'));convoy.step(party,now);now+=600;names.forEach(n=>report(n,'assembled'));convoy.step(party,now);assert.equal(active.phase,'prepare');
 report('M','route-ready',true);report('W','route-ready',true);convoy.step(party,now);assert.equal(active.phase,'prepare');assert.equal(active.departAt,undefined);
 report('P','route-ready',true);convoy.step(party,now);assert.equal(active.phase,'scheduled');const depart=active.departAt;
 for(const n of names)assert.equal(convoy.signal(party,n,now).departAt,depart);
 assert.ok(Object.values(party.commands).every(command=>command.location.map==='winterland' && command.location.y===-1109 && command.type==='party-monster-travel'));
});
