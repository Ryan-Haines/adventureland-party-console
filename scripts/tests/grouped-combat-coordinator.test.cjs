const test = require('node:test');
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
  const navigation=require('../../runtime/coordinator/navigation/manual-commands.ts').createManualNavigationCommands(party,{
    now:()=>Date.now(),members:()=>c.farmingNavigation.members(),authorizeRoute:(...args)=>c.authorizeFarmingRoute(...args),convoy:c.startPartyMonsterConvoy,
  });
  routes['/party-api/command']=require('../../runtime/coordinator/http/character-command.ts').createCharacterCommandRoute(party,{
    managed:name=>Object.hasOwn(c.character_manage,name),farmingLocation:()=>null,handlers:[navigation.handle],
  });
  return { party, starts: () => starts, engaged: () => engaged, call(path, body) {
    const result = { status: 200 };
    const res = { status: code => { result.status = code; return res; }, json: data => { result.body = data; return res; } };
    routes['/party-api/' + path]({ body }, res); return result;
  } };
}

test('completion racing a combat handoff preserves the replacement route',()=>{
  const r=setup(), replacement=r.party.commands.P;
  r.party.lastConvoyEngagement={convoyId:'c',epoch:1,reports:{P:{commandId:2,runtimeId:'p-runtime'}}};
  const result=r.call('convoy-complete',{character:'P',convoyId:'c',epoch:1,commandId:2,runtimeId:'p-runtime'});
  assert.equal(result.status,200);assert.equal(result.body.superseded,true);
  assert.equal(r.party.commands.P,replacement);
});
test('coordinator rejects a follower nomination even if it bypasses the client guard', () => {
  const r = setup();
  assert.equal(r.call('convoy-engage', { character: 'P' }).status, 409);
  assert.equal(r.engaged(), 0);
});
test('leader cannot release a farming convoy while a follower is outside the cave',()=>{
  const r=setup();r.party.groupedCombat={ready:false,anchor:{map:'cave'},blockers:['P: different map']};
  const body={character:'W',target:{id:'A',map:'cave'}};
  assert.equal(r.call('convoy-engage',body).status,409);assert.equal(r.engaged(),0);
  r.party.groupedCombat={ready:true,anchor:{map:'main'},blockers:[]};
  assert.equal(r.call('convoy-engage',body).status,409);assert.equal(r.engaged(),0);
  r.party.groupedCombat.anchor.map='cave';
  assert.equal(r.call('convoy-engage',body).status,200);assert.equal(r.engaged(),1);
});
test('individual handoff cannot acknowledge a second target or a stale leader report', () => {
  const r = setup(), body = { character: 'P', commandId: 3, navigationRevision: 1,
    engagedTarget: { id: 'B', map: 'main', x: 20, y: 0 } };
  assert.equal(r.call('event-resume-complete', body).status, 409); assert.ok(r.party.commands.P);
  body.engagedTarget.id = 'A'; r.party.statuses.W.seenAt = 1;
  assert.equal(r.call('event-resume-complete', body).status, 409); assert.ok(r.party.commands.P);
  r.party.statuses.W.seenAt = Date.now();
  assert.equal(r.call('event-resume-complete', body).status, 200); assert.equal(r.party.commands.P, undefined);
});
test('restoring a farming waypoint during an event preserves its command and attendance', () => {
  const r = setup(); r.party.commands.W = { id: 4, type: 'event' };
  const result = r.call('command', { character: 'W', type: 'party-monster-travel',
    location: { map: 'winterland', x: 20, y: -1109 }, resumeAfterEvent: true });
  assert.equal(result.body.deferredUntilEventEnd, true);
  assert.equal(r.starts(), 0); assert.equal(r.party.commands.W.id, 4);
  assert.equal(r.party.location.map, 'winterland'); assert.equal(r.party.statuses.W.joinedEvent, 'franky');
});
test('only an idle leader can convoy the party back to its saved farming spawn', () => {
  const r = setup();
  Object.assign(r.party, { activeConvoy: null, location: { map: 'halloween', x: 146, y: -1177 },
    merchantCharacter: 'M', partyFarmingMode: 'default' });
  r.party.statuses.W.joinedEvent = null;
  Object.assign(r.party.statuses.W, {map:'main',x:0,y:0});
  r.party.statuses.P = { seenAt: Date.now(), target: null };
  assert.equal(r.call('farming-return', { character: 'P' }).status, 403);
  r.party.statuses.P.target = { id: 'ghost' };
  assert.equal(r.call('farming-return', { character: 'W' }).status, 409);
  r.party.statuses.P.target = null;
  const result = r.call('farming-return', { character: 'W' });
  assert.equal(result.status, 200);
  assert.equal(r.starts(), 1);
  assert.match(r.party.combatLogs.W.at(-1).message, /Outside authorized farming area/);
});
