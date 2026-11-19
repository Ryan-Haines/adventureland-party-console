const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const load = require('./helpers/dashboard-query-module.cjs'), {queryRoot} = load;
const React = require('../../dashboard/node_modules/react'), {create, act} = require('../../dashboard/node_modules/react-test-renderer');
const {supportedEvents} = require('../../runtime/events/api.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const runtime = fs.readFileSync('characters/shared.js', 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();
// The clock's `test` echo asks the call budget's `background` band (character/calls.ts); this realm's
// budget sends it unless a test sets `bandAnswer`.
let bandAnswer = 'send';
require('../../runtime/hooks/index.ts').partyHooks().publish({ name: 'core:calls', folder: 'core', author: 'test', summary: 'Sends every call.',
  hooks: { 'calls.band': () => bandAnswer, 'calls.window': () => 0, 'calls.margin': () => 0 } });

// The clock lives in runtime/events/character/clock.ts. A slower echo whose offset agrees
// within both errors keeps the sharper offset; one that disagrees beyond them means a clock moved.
// A sync that finds the last echo unanswered leaves the clock stale until an echo returns.
// The test drives the clock through the socket listeners start() registers: `connect` syncs and
// `test` is the server's echo.
function socketClock(ports) {
  const {installEventClock} = require('../../runtime/events/character/clock.ts');
  const on = {}, register = {on: (socket, event, handler) => { on[event] = handler; }};
  const clock = installEventClock({...ports, scope: {observe: register, act: register}});
  clock.start();
  return {clock, sync: () => on.connect(), echo: date => on.test({date: new Date(date).toISOString()})};
}
test('clock samples use request midpoint, keep the sharper sample, and go stale on a missed echo', () => {
  let now = 1700000000000, emitted = 0;
  const {clock, sync, echo} = socketClock({now: () => now, socket: () => ({emit: () => emitted++})});
  assert.equal(clock.stale(), true, 'never synced');
  now += 100; echo(now + 60000);
  assert.equal(clock.serverNow() - now, 60050); assert.equal(emitted,1); assert.equal(clock.stale(), false);
  sync(); now += 6000; echo(now+58050);
  assert.equal(clock.serverNow() - now,60050, 'a 6 s echo 1 s off agrees within both errors');
  sync(); now += 6000; echo(now+90000);
  assert.equal(clock.serverNow() - now,93000, 'a 6 s echo 33 s off means a clock moved');
  sync(); assert.equal(clock.feedCurrent(), true, 'an echo in flight is not missed');
  sync(); assert.equal(clock.stale(), true); assert.equal(clock.feedCurrent(), false);
  now += 50; echo(now+93000); assert.equal(clock.stale(), false);
});

// A reload starts the clock while a job wait holds the background band, so its first echo is
// refused. Each later pass asks again until the band sends it, and the echo syncs the clock.
test('a refused first echo is asked again on the next pass', () => {
  let now = 1700000000000, emitted = 0;
  bandAnswer = 'not-now';
  try {
    const {clock, echo} = socketClock({now: () => now, socket: () => ({emit: () => emitted++, connected: true}), feed: () => ({})});
    assert.equal(emitted, 0, 'the band refused the first echo');
    clock.check(); assert.equal(emitted, 0, 'refused again while the band holds');
    bandAnswer = 'send';
    clock.check(); assert.equal(emitted, 1, 'the next pass sends the echo');
    now += 100; echo(now + 60000);
    assert.equal(clock.stale(), false);
    clock.check(); assert.equal(emitted, 1, 'a synced clock asks no echo');
  } finally { bandAnswer = 'send'; }
});

// The October runtime's door status follows the game's daily reset (logic/halloween_events.js): the
// day is the UTC date, and the server re-sends each status on the day change, so a status with the
// day before's knocks holds back until it changes; one that reads as a new day's counts at once.
test('the door status waits for the game daily resend', () => {
  const {createOctoberRuntime} = require('../../runtime/events/october-runtime.ts');
  let now = Date.parse('2026-10-22T23:59:59Z'), status = {doors: [0, 1], doors_left: 5};
  const runtime = createOctoberRuntime({now: () => now, doorStatus: () => status, load: () => null, save() {},
    definitions: () => ({trickortreat: {doors: Array.from({length: 7}, () => ['main', 0, 0]), knocks: 14}})});
  assert.deepEqual(runtime.doorStatus(), status);
  now += 60000;
  assert.equal(runtime.doorStatus(), null, 'the day before\'s knocks before the resend');
  status = {doors: [], doors_left: 7}; assert.deepEqual(runtime.doorStatus(), status, 'the resend');
  status = {doors: [3], doors_left: 6}; assert.deepEqual(runtime.doorStatus(), status, 'a knock today');
  now += 86400000; status = {doors: [], doors_left: 7}; runtime.doorStatus(); now += 86400000;
  assert.deepEqual(runtime.doorStatus(), status, 'a new day\'s status unchanged across the reset');
});
// Part 8's door rule counts a status on first sight after a reload; in the first moments of a UTC day
// that sighting may be the day before's, so it sets no day mark until the server's day confirms it.
test('a first sighting after a reload sets the day door list only once the server day confirms it', () => {
  const {createOctoberRuntime} = require('../../runtime/events/october-runtime.ts');
  let now = Date.parse('2026-10-23T00:00:01Z'), status = {doors: [0, 1], doors_left: 5};
  const runtime = createOctoberRuntime({now: () => now, doorStatus: () => status, load: () => ({day: '2026-10-23', doors: []}), save() {},
    status: () => ({}), stock: () => ({}), definitions: () => ({trickortreat: {doors: Array.from({length: 7}, () => ['main', 0, 0]), knocks: 14}})});
  assert.deepEqual(runtime.doorStatus(), status, 'the schedule counts the first sighting');
  assert.deepEqual(runtime.snapshot().journal.doors, [], "the day before's knocks set no mark");
  status = {doors: [], doors_left: 7}; runtime.snapshot();
  status = {doors: [2], doors_left: 6};
  assert.deepEqual(runtime.snapshot().journal.doors, [2], 'a status that changed during the day sets the mark');
});

// attend.ts `huntPending`: a fighter's Hunt waits while the anniversary's next round
// is due (the clock's `due`, the group's lead), never for the merchant, and not before it.
test('the Hunt pending flag follows the anniversary lead and skips the merchant', () => {
  const {installEventAttendance} = require('../../runtime/events/character/attend.ts'), lead = 90000;
  let now = 1700000000000; const character = {map: 'main', ctype: 'warrior', s: {}}, feed = {anniversary: {live: false, next: now + lead}};
  const attend = installEventAttendance({now: () => now, game: () => ({maps: {}}), selection: () => ({list: ['anniversary'], enabled: true}),
    character: () => character, assignment: () => null, life: () => 0, hint: () => null, anniversary: () => null, roundAborted: () => false, updates: () => undefined,
    entities: () => ({}), members: () => [], realm: () => 'US I', reportOffset: () => 0,
    clock: {status: () => feed, attendance: () => null, feedCurrent: () => true, epoch: value => Number(value), due: (_name, at) => at > now && at - now <= lead, live: () => []},
    facts: {names: () => [], supported: () => true, walkBoss: () => false, staged: () => false, map: name => name, targets: () => []}, october: {}});
  assert.equal(attend.huntPending(), true, 'inside the lead');
  character.ctype = 'merchant'; assert.equal(attend.huntPending(), false, 'the merchant runs no Hunt');
  character.ctype = 'warrior'; now -= 1; assert.equal(attend.huntPending(), false, 'before the lead');
});

// The staging report reads K1 `staged` and the group's lead: a selected staged event
// inside its window stages, outside it does not, a later spawn in the schedule ends a passed one
// (K2 `missed`), and an unstaged event never stages; an
// interaction row is live while its October activity runs, Trick or Treat on the server's day.
test('the clock stages the selected K1 staged events from the lead until a later spawn', () => {
  const lead = 120000;
  // clock.ts keeps the stages on the realm across a reload; the test starts with none.
  globalThis.__partyHalloweenStages = {};
  let now = 1700000000000;
  let feed = {schedule: {events: [{event: 'mrgreen', status: 'scheduled', at: now + lead - 1},
    {event: 'graveyard', status: 'scheduled', at: now + lead + 1000},
    {event: 'franky', status: 'scheduled', at: now + 1000}]}};
  const {clock, echo} = socketClock({now: () => now, socket: () => ({emit() {}, connected: true}), feed: () => feed, selected: () => true,
    joined: () => null, reportOffset: () => 0, names: () => ['franky', 'trickortreat'], supported: () => true,
    walkBoss: () => false, activity: name => name === 'trickortreat',
    // The last reply carried the group's walk estimate lead for both events (rules.ts `leadFor`).
    leads: () => ({mrgreen: lead, graveyard: lead}), destination: () => null, cipherWalk: () => null});
  echo(now);
  assert.deepEqual(clock.staging().map(entry => entry.name), ['mrgreen'], 'graveyard is past the lead, franky is not staged');
  now += lead + 60000;
  assert.ok(clock.staging().some(entry => entry.name === 'mrgreen'), 'a passed spawn stays while the schedule names no later one');
  // A new calendar comes as a new feed: the game replaces `S` on each `server_info` (game.js).
  feed = {...feed, schedule: {...feed.schedule, events: [...feed.schedule.events, {event: 'mrgreen', status: 'scheduled', at: now + 30 * 60000}]}};
  assert.ok(!clock.staging().some(entry => entry.name === 'mrgreen'), 'missed once the schedule names a later spawn');
  assert.deepEqual(clock.live().map(entry => entry.name), ['trickortreat']);
  assert.match(clock.live()[0].id, /^doors:\d{4}-\d{2}-\d{2}$/);
});

// The control renders through react-test-renderer under the real query client. The ui kit, the
// icons, the Cave row and the limits dialog render as tags named after their export. The drag list's
// hook reads the browser's motion setting, and no row here drags.
const tags = new Proxy({}, {get: (_, key) => String(key)});
const eventControl = () => load('event-selection-control.tsx', {'@/components/ui/*': tags, 'lucide-react': tags,
  '@/hooks/use-clock': {useClock: () => 0}, './dungeon-settings': tags, './event-limits-dialog': tags,
  '@/lib/use-reorder-list': {useReorderList: () => ({listRef: {current: null}, remember() {}, rowAt: () => null})}});

test('browser timezone formats the event instant without changing its countdown', () => {
  const {eventTimeLabel} = eventControl();
  const previous=process.env.TZ;
  try {
    const epoch=Date.parse('2026-09-11T19:00:00Z');
    process.env.TZ='America/New_York'; const eastern=eventTimeLabel(epoch,epoch-125000);
    process.env.TZ='Asia/Tokyo'; const tokyo=eventTimeLabel(epoch,epoch-125000);
    assert.notEqual(eastern,tokyo);assert.match(eastern,/\(2m 5s\)/);assert.match(tokyo,/\(2m 5s\)/);
    assert.equal(eventTimeLabel(undefined,epoch),'Time not announced');
  } finally { if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous; }
});

test('dropdown disables inherited and unsupported selections and permits independent choices', async () => {
  const {EventSelectionControl} = eventControl(), {wrap, client} = queryRoot();
  let state={leader:'L',followers:{F:true},eventSelectionsByCharacter:{L:['anniversary'],F:['snowman']},eventSchedules:[{id:'anniversary',name:'Anniversary'},{id:'egghunt',name:'Egg Hunt'}]};
  let saved, view;
  const element=()=>wrap(React.createElement(EventSelectionControl,{state,name:'F',onChange:ids=>saved=ids,onPriorityChange(){},onLimitsChange(){},onAnniversary(){}}));
  const update=async next=>{state={...state,...next};await act(async()=>view.update(element()));};
  const inputFor=id=>view.root.find(n=>n.props['data-event']===id).findByType('input');
  try {
    await act(async()=>{view=create(element());});
    const order=view.root.findAll(n=>n.type==='CaveEventRow'||n.type==='input');
    assert.equal(order[0].type,'CaveEventRow','the Cave row comes before the event rows');
    assert.equal(inputFor('anniversary').props.checked,true);assert.equal(inputFor('anniversary').props.disabled,true);assert.equal(inputFor('egghunt').props.disabled,true);
    await update({followers:{F:false}});
    assert.equal(inputFor('anniversary').props.disabled,false);
    inputFor('anniversary').props.onChange({target:{checked:true}});assert.deepEqual(Array.from(saved),['snowman','anniversary']);
    await update({merchantCharacter:'F',eventSchedules:supportedEvents.map(id=>({id,name:id}))});
    const inputs=view.root.findAllByType('input');
    assert.equal(inputs.length,supportedEvents.length);assert.ok(inputs.every(input=>!input.props.disabled));
  } finally { if(view)await act(async()=>view.unmount()); client.clear(); }
});
// The coordinator reads the events owner's rules from runtime/events/api.ts, the one
// instance events/coordinator/install.ts adopts add-on kinds into; its start loads no second,
// committed copy of them.
test('D-D1: an adopted add-on event kind is selected and enabled through the coordinator\'s eventEnabled', () => {
  const { adoptAddonKinds, eventEnabled, eventKey } = require('../../runtime/events/api.ts');
  adoptAddonKinds([{ name: 'plantedevent', label: 'Planted event', kind: 'walk' }]);
  try {
    const party = { eventSelectionsByCharacter: { W: ['plantedevent'] }, eventPrioritiesByCharacter: {} };
    assert.equal(eventEnabled(party, 'W', 'plantedevent'), true);
    assert.equal(eventKey('slenderman').aloneUntilOver, true);
    const start = fs.readFileSync('runtime/lifecycle/coordinator/start.ts', 'utf8');
    assert.doesNotMatch(start, /event-policy\.cjs/);
  } finally { adoptAddonKinds([]); }
});
