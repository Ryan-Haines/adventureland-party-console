// The character's anniversary in one kiss round (runtime/events/character/anniversary.ts), with every
// port a plain value the row sets, and a shared setup
// lives in the harness. Time moves only by the waits and the kiss's own reply. The kiss asks the calls owner's `job` band
// (character/calls.ts `marginCall`) on the events owner's `act` handle of the process's run scope; this realm's
// budget answers "send" at once, and its margin is 0, so a kiss reply the row leaves unsettled times
// out on the next timer turn.
const { installEventAnniversary } = require('../../../runtime/events/character/anniversary.ts');
const { yieldConvoy } = require('../../../runtime/movement/character/install.ts');
const { partyHooks } = require('../../../runtime/hooks/index.ts');
const { processScope } = require('../helpers/run-scope.cjs');

processScope();
partyHooks().publish({ name: 'core:calls', folder: 'core', author: 'test', summary: 'Sends every call.',
  hooks: { 'calls.band': () => 'send', 'calls.window': () => 0, 'calls.margin': () => 0 } });

// Options: `approach` puts the featured player 200 away, `missing` hides it, `move` and `skill` are
// what the walk and the kiss await, `resolves` lets the kiss reply (with none it never comes), `newBuff` and `oldBuff` set the
// buff, `scheduled` makes the round a scheduled one inside the look-ahead, `landed` whether the
// character counts as in Main's Town, `convoy` a farming convoy the visit preempts, `preempt` the
// coordinator's answer to it, `onStop` what a stop does and `update` the game update that ends a wait.
// A wait with no `update` moves time by its length. With one, the time stays, and after the timers
// due now have run, `update(event)` may change the round and names the kind of game update that
// arrives (character/install.ts registers the listeners).
function fixture(options = {}) {
  let now = 1000000, slices = 0, revision = 0, command = 1;
  const calls = [], root = {};
  const event = options.scheduled ? { active: true, live: false, next: now + 60000, target: 'DxMerchant' }
    : { active: true, live: true, round: 'round', target: options.designated ? 'F' : 'DxMerchant', id: 'target-id', map: 'main', x: 0, y: 0, expires: 1300000 };
  const character = { name: 'F', ctype: options.merchant ? 'merchant' : 'warrior', map: 'main', x: 0, y: 0, stand: !!options.stand,
    s: { anniversary_visit: { round: 'round' }, ...(options.oldBuff ? { anniversary_kiss: { ms: 100000 } } : {}) } };
  const plan = { abortedRounds: {}, partyFeatured: !!options.partyFeatured, eventCycle: options.cycle ?? null };
  const featuredEntity = () => options.missing ? null : { type: 'character', name: 'DxMerchant', map: 'main', x: options.approach ? 200 : 0, y: 0 };
  const walking = async kind => { calls.push([kind]); if (options.move) await options.move(); };
  const anniversary = installEventAnniversary({
    now: () => now, character: () => character, root: () => root, current: () => true, generation: () => 1,
    // The look-ahead (clock.ts `due`): a `scheduled` round sits inside it.
    round: () => event, epoch: value => Number(value) || 0, due: () => true,
    attend: { selected: () => true, allowed: () => options.allowed?.() ?? true, active: () => options.combatEvent ? { name: options.combatEvent } : null,
      traveling: () => null, joined: () => null, poll: () => calls.push(['poll-events']) },
    exitPending: () => false, eventsEnabled: () => !!options.combatEvent,
    paused: () => false, escaping: () => false, caveOwns: () => false, huntTurnIn: () => false,
    merchant: { reserved: () => false, holder: () => null, gathering: () => false, forceStand: () => false, errand: () => false, wake() {} },
    walk: {
      revision: () => revision, command: () => command, townActive: () => false, townTraveling: () => false, forceTraveling: () => false,
      convoy: () => (options.convoy ? 'convoy-1' : null), convoying: () => !!options.convoy, convoyActive: () => !!options.convoy, held: () => false,
      yieldConvoy(request, owns) {
        return yieldConvoy({ release: () => calls.push(['release-convoy']), stop: (kind, by) => this.stop(kind, by), end: () => calls.push(['convoy-stopped']) }, request, owns);
      },
      endFollow(request) { return this.stop('smart', request); },
      request: { kind: 'anniversary' }, returnRequest: { kind: 'anniversary-return' },
      stop: async kind => { calls.push(['stop', kind]); await options.onStop?.(kind, { setCommand: next => { command = next; } }); },
      smart: () => walking('smart'), direct: () => walking('move'), leave: async () => calls.push(['leave']),
      toMain: async point => calls.push(['to-main', point]), landed: () => options.landed ?? true,
    },
    farmingLabel: () => 'bee',
    game: {
      entities: () => { const entity = featuredEntity(); return entity ? { [entity.name]: entity } : {}; }, player: () => null,
      joinedInstance: () => false, canMoveTo: () => true,
      // The kiss's reply: the row's `skill` decides when the call settles, then the buff and the slice
      // land; with no `resolves` the server's reply never comes.
      useSkill: async () => {
        calls.push(['kiss']);
        await (options.skill ? options.skill() : undefined);
        if (options.newSlice) slices++;
        if (options.newBuff) character.s.anniversary_kiss = { ms: 300000 };
        if (!options.resolves) await new Promise(() => {});
      },
      readyAt: () => 0,
      say: async () => {}, send: async () => {}, closeStand: async () => { calls.push(['close-stand']); character.stand = false; },
      quantity: () => slices, slot: () => -1, realm: () => 'US I',
    },
    clearTarget() {},
    request: async (url, body) => {
      calls.push([url, body?.body]);
      // `stale` is how many reservations the coordinator refuses first, as its routes.ts `attempt` does
      // while its own read of the round is behind.
      if (url === '/anniversary/attempt' && calls.filter(x => x[0] === url).length <= (options.stale ?? 0))
        throw Error('POST /anniversary/attempt · HTTP 409 · http: stale anniversary attempt');
      if (url === '/anniversary/attempt') return { attempt: calls.filter(x => x[0] === '/anniversary/attempt').length };
      if (url === '/anniversary/navigation-preempt') return options.preempt ?? {};
      if (url === '/anniversary/failure' && body.body.attempt >= 2 && body.body.failureReason) return { anniversary: { abortedRounds: { round: { reason: body.body.failureReason } } } };
      return {};
    },
    wait: async ms => {
      if (!options.update) { now += ms; return; }
      await new Promise(resolve => setImmediate(resolve));
      const kind = options.update(event); if (kind) anniversary.updated(kind);
    },
    later: action => action(), log() {},
  });
  anniversary.receive(plan);
  return { anniversary, calls, event, character, root, plan, run: () => anniversary.kiss(),
    revise: () => { revision++; }, advance: ms => { now += ms; } };
}

module.exports = { fixture };
