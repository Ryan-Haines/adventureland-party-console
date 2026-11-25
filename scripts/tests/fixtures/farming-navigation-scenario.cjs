// The farming navigation module over a party in an anniversary round (a shared setup lives in the harness).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createNavigation = require('../helpers/farming-navigation.cjs');
const coordinator = require('../helpers/coordinator-source.cjs').coordinatorSource();
const { settingsWriter } = require('../helpers/settings-writer.cjs');
const cave = { map: 'cave', x: -194, y: -461 };
const forest = { map: 'main', x: 900, y: 900 };
function fixture() {
  let time = 1000000, starts = 0;
  const names = ['L', 'F', 'P', 'Solo', 'M'];
  let online = names.slice();
  const party = { leader: 'L', merchantCharacter: 'M', followers: { F: true, P: true },
    location: { ...cave }, characterLocations: { Solo: { ...forest } }, navigationIntents: {},
    commands: {}, nextCommandId: 1, statuses: Object.fromEntries(names.map(name => [name,
      { map: 'main', x: 0, y: 0, seenAt: time }])),
    anniversary: { returnReady: {} }, eventSessions: {}, deferredEventReturns: {},
    monsterFocus: ['bat'], monsterFocusByCharacter: {}, monsterPrioritiesByCharacter: {},
    monsterSearchRadiusByCharacter: {}, scatterEpoch: 0,
  };
  const logs = [];
  const hooks = { now: () => time, names: () => names, activeNames: () => online,
    persist() {}, log: message => logs.push(message),
    cancelConvoy() {
      const id = party.activeConvoy?.id;
      for (const [name, command] of Object.entries(party.commands))
        if (command.convoyId === id) delete party.commands[name];
      party.activeConvoy = null;
    },
    startConvoy(location, label, participants, purpose) {
      starts++;
      const id = `convoy-${starts}`;
      party.activeConvoy = { id, location, label, participants: participants.slice(), purpose };
      for (const name of participants) party.commands[name] = {
        id: party.nextCommandId++, type: 'party-monster-travel', convoyId: id, location,
      };
      return true;
    },
  };
  const nav = createNavigation(party, hooks);
  const cycle = () => ({ id: 'round', startsAt: time, endsAt: time + 300000,
    participants: nav.members(), destination: { ...cave }, waypoints: nav.capture(), returnDispatchedAt: null });
  party.anniversary.eventCycle = cycle();
  const routes = {};
  const context = vm.createContext({ party, farmingNavigation: nav, escapeControl: { release() {} },
    huntTurnInOwnsTravel: require('../../../runtime/tasks/api.ts').priority,
    Date: { now: () => time }, ownedCharacter: name => names.includes(name),
    activeNames: hooks.activeNames, persistSettings: hooks.persist,
    anniversaryCombatParticipants: nav.members, anniversaryFallbackDestination: () => nav.waypoint('L'),
    anniversaryLog: hooks.log, cancelActiveConvoy: hooks.cancelConvoy,
    scheduleAnniversaryReturnConvoy() {},
    express_inst: { post: (url, handler) => { routes[url] = handler; } },
  });
  Object.assign(context,require('../helpers/coordinator-anniversary.cjs').anniversaryService(context));
  const anniversaryRoutes=require('../helpers/coordinator-anniversary-navigation.cjs').navigationRoutes(context);
  for (const [url,key] of [['return-ready','ready'],['navigation-preempt','preempt'],['staging','staging']])
    routes['/party-api/anniversary/'+url]=anniversaryRoutes[key];
  routes['/party-api/focus']=require('../../../runtime/hunting/coordinator/routes.ts').createFocusRoute(party,{
    owned:context.ownedCharacter,members:()=>nav.members(),invalidate:(...args)=>nav.invalidate(...args),persist:hooks.persist,
    write:settingsWriter(party,{owned:context.ownedCharacter}).write,
  });
  routes['/party-api/event-resume-complete']=require('../helpers/coordinator-event-acknowledgements.cjs').acknowledgementRoutes(context).resumeComplete;
  for (const [url,handler] of Object.entries(require('../helpers/coordinator-convoy-routes.cjs').convoyRoutes(context))) routes['/party-api/'+url]=handler;
  routes['/party-api/town-party']=require('../../../runtime/movement/coordinator/routes.ts').createPartyTravelRoutes(party,{
    now:()=>time,nextCommand:()=>party.nextCommandId++,release:()=>context.escapeControl.release(),members:()=>nav.members(),
    active:hooks.activeNames,invalidate:(...args)=>nav.invalidate(...args),persist:hooks.persist,
  }).town;
  function post(url, body = {}) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    routes['/party-api/' + url]({ body }, response);
    return response;
  }
  return { party, nav, hooks, cycle, post, logs, context, starts: () => starts,
    advance(ms) { time += ms; }, offline(name) { online = online.filter(value => value !== name); } };
}

function failRound(t, overrides = {}) {
  t.party.anniversary.eventCycle.target ||= 'DxMerchant';
  return t.context.abortAnniversaryRound({ character: 'M', round: 'round', target: 'DxMerchant',
    navigationRevision: 0, attempt: 2, ended: true, failureReason: 'target-missing', ...overrides });
}

module.exports = { fixture, failRound };
