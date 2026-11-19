const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = require('./helpers/coordinator-source.cjs').coordinatorSource();
function setup() {
  const routes = {}, party = { leader: 'W', partyFarmingMode: 'default', statuses: {
    W: { seenAt: Date.now(), combatSelection: { id: 'A', map: 'main' }, joinedEvent: 'franky' },
  }, commands: { P: { id: 3, type: 'event-resume-travel', convoyHandoff: 'c', location: { map: 'main', x: 0, y: 0 } } },
    activeConvoy: { participants: ['W', 'P'] }, monsterSearchRadiusByCharacter: {},
    anniversary: {}, eventSessions: {}, deferredEventReturns: {}, combatLogs: {}, monsterFocus: ['goo'] };
  let starts = 0, engaged = 0;
  const c = vm.createContext({ party, character_manage: { W: {}, P: {} }, ownedCharacter: () => true,
    farmZones:require('../../.build/shared/farming-zones.cjs'),
    groupedCombatSnapshot:()=>party.groupedCombat || null,huntSafety:{acceptArrival:()=>false},
    farmingNavigation: { intent: () => ({ revision: 1 }), members: () => ['W', 'P'],
      authorize: (_names, location) => party.location = location },
    activeNames: () => ['W', 'P'],
    startPartyMonsterConvoy: () => { starts++; return true; }, persistSettings() {},
    convoyNavigation: { engage: () => { engaged++; return true; } },
    express_inst: { post: (path, fn) => routes[path] = fn },
  });
  c.escapeControl={release(){}};
  require('./helpers/coordinator-farming-authorization.cjs').installFarmingAuthorization(c);
  routes['/party-api/event-resume-complete']=require('./helpers/coordinator-event-acknowledgements.cjs').acknowledgementRoutes(c).resumeComplete;
  for (const [url,handler] of Object.entries(require('./helpers/coordinator-convoy-routes.cjs').convoyRoutes(c))) routes['/party-api/'+url]=handler;
  const navigation=require('../../runtime/movement/coordinator/arrivals.ts').createManualNavigationCommands(party,{
    now:()=>Date.now(),members:()=>c.farmingNavigation.members(),authorizeRoute:(...args)=>c.authorizeFarmingRoute(...args),convoy:c.startPartyMonsterConvoy,caller:()=>undefined,
  });
  routes['/party-api/command']=require('../../runtime/items/coordinator/routes/characters.ts').createCharacterCommandRoute(party,{
    managed:name=>Object.hasOwn(c.character_manage,name),handlers:[navigation.handle],
    farming:require('../../runtime/hunting/coordinator/routes.ts').createFarmingCommand(party,{farmingState:()=>party,location:()=>null,members:()=>[],invalidate(){},persist(){}}),
  });
  return { party, starts: () => starts, engaged: () => engaged, call(path, body) {
    const result = { status: 200 };
    const res = { status: code => { result.status = code; return res; }, json: data => { result.body = data; return res; } };
    routes['/party-api/' + path]({ body }, res); return result;
  } };
}

const { scenarioTable } = require('./fixtures/scenarios.cjs');
scenarioTable('the coordinator keeps a replacement route, refuses a follower nomination and acknowledges a handoff only for its own target', setup, [
['completion racing a combat handoff preserves the replacement route', r => {
  const replacement=r.party.commands.P;
  r.party.lastConvoyEngagement={convoyId:'c',epoch:1,reports:{P:{commandId:2,runtimeId:'p-runtime'}}};
  const result=r.call('convoy-complete',{character:'P',convoyId:'c',epoch:1,commandId:2,runtimeId:'p-runtime'});
  assert.equal(result.status,200);assert.equal(result.body.superseded,true);
  assert.equal(r.party.commands.P,replacement);
}],
['coordinator rejects a follower nomination even if it bypasses the client guard', r => {
  assert.equal(r.call('convoy-engage', { character: 'P' }).status, 409);
  assert.equal(r.engaged(), 0);
}],
['leader cannot release a farming convoy while a follower is outside the cave', r => {
  r.party.groupedCombat={ready:false,anchor:{map:'cave'},blockers:['P: different map']};
  const body={character:'W',target:{id:'A',map:'cave'}};
  assert.equal(r.call('convoy-engage',body).status,409);assert.equal(r.engaged(),0);
  r.party.groupedCombat={ready:true,anchor:{map:'main'},blockers:[]};
  assert.equal(r.call('convoy-engage',body).status,409);assert.equal(r.engaged(),0);
  r.party.groupedCombat.anchor.map='cave';
  assert.equal(r.call('convoy-engage',body).status,200);assert.equal(r.engaged(),1);
}],
['individual handoff cannot acknowledge a second target or a stale leader report', r => {
  const body = { character: 'P', commandId: 3, navigationRevision: 1,
    engagedTarget: { id: 'B', map: 'main', x: 20, y: 0 } };
  assert.equal(r.call('event-resume-complete', body).status, 409); assert.ok(r.party.commands.P);
  body.engagedTarget.id = 'A'; r.party.statuses.W.seenAt = 1;
  assert.equal(r.call('event-resume-complete', body).status, 409); assert.ok(r.party.commands.P);
  r.party.statuses.W.seenAt = Date.now();
  assert.equal(r.call('event-resume-complete', body).status, 200); assert.equal(r.party.commands.P, undefined);
}],
['restoring a farming waypoint during an event preserves its command and attendance', r => {
  r.party.commands.W = { id: 4, type: 'event' };
  const result = r.call('command', { character: 'W', type: 'party-monster-travel',
    location: { map: 'winterland', x: 20, y: -1109 }, resumeAfterEvent: true });
  assert.equal(result.body.deferredUntilEventEnd, true);
  assert.equal(r.starts(), 0); assert.equal(r.party.commands.W.id, 4);
  assert.equal(r.party.location.map, 'winterland'); assert.equal(r.party.statuses.W.joinedEvent, 'franky');
}],
]);
