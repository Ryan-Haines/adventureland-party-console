const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The convoy code calls the movement owner's requester helpers (walkRequest, claim).
const { createMovementContext } = require('../fixtures/movement-owner-callers.cjs');
const {installPartyMovement}=require('../../../runtime/movement/character/owner.ts');
const {contextScope}=require('./run-scope.cjs');
const {downloadedGameSource}=require('./downloaded-game.cjs');
// The pinned game fixtures keep these rows on one upstream version whatever the local cache holds.
const runner = downloadedGameSource('runner_functions.js');
const nativeCode = runner.slice(runner.indexOf('var smart = {'), runner.indexOf('function proxy('));
const settle = () => new Promise(resolve => setImmediate(resolve));
const command = { id: 2, convoyId: 'test', epoch: 7, phase: 'assemble',
  rally: { map: 'main', x: 0, y: 0 }, location: { map: 'main', x: 120, y: 0 }, slowestSpeed: 57 };

function runtime(options = {}) {
  let now = 1000;
  const calls = [], timers = [], deferred = [];
  const character = { name: 'F', map: 'main', x: 0, y: 0, speed: 57, moving: false, base: {} };
  Object.defineProperties(character, { real_x: { get: () => character.x }, real_y: { get: () => character.y } });
  const context = createMovementContext({
    code_settings: {}, // Native runner defaults live before the extracted smart-move functions.
    game: { graphics: false },
    setTimeout, clearTimeout, encodeURIComponent, Promise, Math, Number, String, Error, Date: class extends Date { static now() { return now; } },
    character, runtimeGeneration: 1, runtimeCurrent: () => true, convoyRuntimeId: 'runtime-1',
    navigationIntent: { revision: 0, cancelled: false }, groupWalk: {travel:null}, reunionRealm: () => 'USI',
    convoySignal: { id: 'test', epoch: 7, commandId: 2, runtimeId: 'runtime-1', phase: 'assemble', validUntil: 5000 },
    anniversaryWithTimeout: promise => promise, farmingEntryPoint: x => x, partyLocation: null, followingLeader: true, coordinatorClockOffset: 50, eventRecoveryState: {},
    setInterval: fn => { timers.push(fn); },
    console: { log() {} }, game_log: (...args) => calls.push(['log', ...args]),
    cruise: speed => { calls.push(['cruise', speed]); return new Promise(() => {}); },
    request: async (url, options) => {calls.push(['request', url, options]); return {ok:true,ready:true};},
    is_string: x => typeof x === 'string', is_number: x => typeof x === 'number',
    is_in: () => false, abs: Math.abs, shuffle: x => x,
    mssince: () => options.slow === false ? 0 : 41,
    can_move: p => !options.noPath && p.y === 0 && p.going_y === 0 && p.going_x >= 0 && p.going_x <= 150,
    can_move_to: () => true, can_walk: () => true, can_use: () => true, is_transporting: () => false,
    simple_distance: (a,b) => Math.hypot(a.x-b.x, a.y-b.y),
    is_door_close: () => true, can_use_door: () => true,
    move: async (x,y) => { calls.push(['move', x, y]); character.x = x; character.y = y;
      if (options.nativeMovingFlag) character.moving = true; },
    use: action => { calls.push(['use', action]); character.x = 0; character.y = 0; },
    push_deferred: () => new Promise((resolve, reject) => deferred.push({ resolve, reject })),
    resolve_deferreds: (key, value) => { for (const p of deferred.splice(0)) p.resolve(value); },
    reject_deferreds: (key, value) => { for (const p of deferred.splice(0)) p.reject(value); },
    resolving_promise: x => Promise.resolve(x), rejecting_promise: x => Promise.reject(x),
    G: { maps: { main: { spawns: [[0,0]], doors: [], npcs: [] }, cave: { spawns: [[0,0]], doors: [], npcs: [] } },
      events: {}, monsters: {}, npcs: { transporter: { places: {} } } },
    parent: { is_hidden: () => false, phrase: value => value, d_text() {}, push_deferred() {},
      socket: { emit: (event, data) => { calls.push([event, data]); if (event === 'transport') { character.map = data.to; character.x = 0; character.y = 0; } } } },
  });
  context.root = context;
  context.departureCombatPending=()=>false;
  context.eligibleDepartureChests=()=>[];
  // The movement owner's sends ask the call budget, a planted one with no game socket.
  require('./planted-calls.cjs').plantCalls();
  vm.runInContext(nativeCode, context);
  let searchStarts = 0;
  const start = context.start_pathfinding;
  context.start_pathfinding = () => { searchStarts++; return start(); };
  let ticks=0;
  context.character.items=[];context.G.version=16846;
  context.movement=installPartyMovement(context,{
    now:()=>now+ticks*80,
    current:()=>true,
    pauses:{manual:()=>false,drainPark:()=>false,caveHolds:()=>false,held:()=>false},
    // Movement's `act` handle on the context's run scope (shared.js `scopes.act02`).
    scope:contextScope(context,'02','act'),
    request:async(url,request)=>{if(url==='/movement-plan') {
      if(options.plan)return options.plan(request.body);
      throw Error('Path not found: native fixture');
    }return context.request(url,request);},
    events:(type,m,e)=>calls.push(['diagnostic',e,m]),
    departureChests:()=>context.eligibleDepartureChests(),
    // Each runtime answers its own departure fight through the owner's port, so no answer lands on the
    // process-wide core:targeting registration.
    departureCombatPending:()=>context.departureCombatPending(),
  });
  // The owner's walk state reads and writes the context's own variables (helpers/walk-state.cjs).
  context.walkState=require('./walk-state.cjs').walkStateOf(context,context.movement.walkState);
  // The walk, its travel and its reports are the walk client's (walk-client.ts `createWalkClient`).
  require('./walk-reports.cjs').installWalkReports(context);
  return { context, calls, timers, setNow: x => { now = x; }, get searches() { return searchStarts; },
    tick: () => {ticks++;timers[0]();}, moves: () => calls.filter(x => x[0] === 'move'),
    async start(cmd = command) { const promise = context.coordinatedMonsterTravel(cmd); await settle(); return { promise }; },
    async ready() { for (let i=0; i<200 && !context.groupWalk.travel.routeReady; i++) { timers[0](); await settle(); }
      assert.equal(context.groupWalk.travel.routeReady, true); },
    // The walk ends its own journey, as the client does when the coordinator drops it; a stop
    // by anyone else never ends a ranked walk.
    async cancel() { const c = context.groupWalk.travel; if (!c) return; c.cancelled = true; if(c.release) c.release(); await context.stop('smart', undefined, context.convoyRequest(c)); await settle(); },
  };
}
module.exports={runtime,settle,command};
