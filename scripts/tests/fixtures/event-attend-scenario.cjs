// The event attendance on the character (runtime/events/character/attend.ts): the poll, the joins and the rejoin rung
// over one live event, with every port a plain value the row sets, and a shared setup
// lives in the harness.
const { installEventAttendance } = require('../../../runtime/events/character/attend.ts');
const { partyHooks } = require('../../../runtime/hooks/index.ts');
const { processScope } = require('../helpers/run-scope.cjs');

// The join asks the calls owner's `job` band and ends at the call margin (character/calls.ts `marginCall`) on the events owner's
// `act` handle of the process's run scope; this realm's budget sends every call.
processScope();
partyHooks().publish({ name: 'core:calls', folder: 'core', author: 'test', summary: 'Sends every call.',
  hooks: { 'calls.band': () => 'send', 'calls.window': () => 0, 'calls.margin': () => 0 } });

// `event` is the live event; `joins` whether its K1 row sends the game's join; `map` the map the
// join puts the character on. `attendance` is the events owner's clock answer for a walk-boss or staged event,
// which attends only while the clock answers. The member's assignment attends it unless the row
// says otherwise. `updates` is the game's update count (game.js `draws`), unset unless the row plants
// it, and `reads` counts the character reads, each one a read of the game window. `targets` plants
// the event's target types, the event's own name unless set.
function attendScenario(over = {}) {
  const t = { event: 'goobrawl', joins: true, map: 'goobrawl', ctype: 'priest', life: 0, rejoin: null, admitted: true, target: null,
    reachable: false, joinError: null, holder: null, freeSlots: 10, logs: [], ...over };
  t.task = 'task' in over ? over.task : { kind: 'event-attendance', owner: 'attend:' + t.event + ':1', tier: 'event-attendance', event: t.event };
  const calls = [], character = { name: 'P', ctype: t.ctype, map: 'main', x: 0, y: 0 }, intent = { revision: 1, cancelled: false };
  // attend.ts keeps the suppression and the join refusal on the realm across a reload; each scenario
  // starts with neither, and `refusal.value` reads the realm's.
  Object.assign(globalThis, { __partyManuallySuppressedEvent: null, __partyEventRefusal: null });
  const refusal = { get value() { return globalThis.__partyEventRefusal; } };
  const attend = installEventAttendance({
    now: () => t.now ?? 1000, game: () => t.game || { maps: { main: {}, [t.map]: t.map === t.event ? { event: t.event } : {} }, events: { [t.event]: { join: t.joins } } },
    selection: () => ({ list: null, enabled: true }), character: () => { t.reads = (t.reads || 0) + 1; return character; }, hint: () => null,
    updates: () => t.updates,
    anniversary: () => null, roundAborted: () => false, entities: () => t.entities || {}, members: () => [], realm: () => 'US I', reportOffset: () => 0,
    nextReport: async () => { calls.push('next-report'); },
    clock: { status: () => t.feed || { [t.event]: { live: true } }, attendance: (name, state) => t.attendance?.(name, state) ?? null, feedCurrent: () => true, epoch: Number, due: () => !!t.due,
      live: () => Object.entries(t.feed || { [t.event]: { live: true } }).filter(([, state]) => state && state.live !== false).map(([name]) => ({ name })) },
    facts: { names: () => [t.event], joins: () => t.joins, supported: () => true, walkBoss: () => !!t.walkBoss, staged: () => false, map: () => t.map, targets: () => t.targets ?? [t.event] },
    // `activity` plants the October runtime's answer for an interaction row (October's `activity`).
    october: { activity: name => t.activity?.(name) ?? null, destination: () => null },
    travel: { admission: () => ({ event: t.event, allowed: t.admitted }), current: () => true, caveOwns: () => false, held: () => false },
    holder: () => t.holder, kiss: () => null, assignment: () => t.task, rejoin: () => t.rejoin, life: () => t.life,
    intent: () => intent, selectionRevision: () => 0, escaping: () => false, returnHolds: () => false, returnPending: () => false, bagErrand: () => false, departing: () => false,
    // `joinLost` plants a join whose reply never comes, as one the network lost.
    join: async name => { calls.push(['join', name]); if (t.joinLost) return new Promise(() => {}); if (t.joinError) throw t.joinError; character.map = t.map; },
    freeSlots: () => t.freeSlots, after: (ms, action) => { t.later = { ms, action }; },
    // `leg` is movement's answer to the walk: walk.ts hands a re-entry ask (the rejoin's life) a leg
    // of the member's own while the party's walk to the same event travels without it.
    walk: async (point, event, owns, reentry) => { calls.push(['walk', point.map, event]); return t.leg?.(point, reentry); },
    // `approaching` is the target id the character's live combat approach walks to (movement's
    // approach.ts `approachingTarget`).
    target: () => t.target, reachable: () => t.reachable, approaching: target => !!target && t.approaching === target.id, partySighting: () => t.partySighting ?? null,
    merchantYield: async () => { calls.push('yield'); return true; },
    // The manual monster walk's leave (attend.ts `leaveForManualWalk`) and the intake's last command.
    exitMap: async () => { calls.push('exit-map'); }, leaveEvent: async () => { calls.push('leave-event'); }, lastCommand: () => t.command ?? 0,
    visit: { busy: () => false, staging: () => false, operation: () => null, yieldTo: async () => {} },
    interaction: { run: async name => { calls.push(['interaction', name]); }, transfer: async () => {} },
    recovery: { begin: () => ({ held: true, request: { owner: 'recovery' } }), release() {}, stop: async () => {},
      walk: async point => { calls.push(['recovery-walk', point.map]); }, mark: () => null, progress: () => null },
    request: async (path, options) => { calls.push(['request', path, options.body]); return {}; }, log: message => t.logs.push(message),
  });
  return { attend, calls, character, intent, refusal, t };
}

module.exports = { attendScenario };
