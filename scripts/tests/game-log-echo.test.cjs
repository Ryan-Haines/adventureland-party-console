const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installGameLogEcho } = require('../../runtime/characters/game-log-echo.ts');
const { installHostGameLogs } = require('../../runtime/characters/game-logs.ts');

// L1 failure modes (docs/efficiency.md § Requests and logs):
// 1. every caracAL thread prints a party kill or find that a sibling thread also receives;
// 2. a thread stops printing a line about its own character;
// 3. two separate events with identical text lose a line, in stdout or in the console capture;
// 4. a kill or find by a party member outside this caracAL process (the Steam client) leaves stdout;
// 5. the console's game log capture (gameLogs) changes in any byte;
// 6. a phrase lookup that no add_log follows silences the next unrelated line;
// 7. without a siblings list, or for lines without a phrase, anything stops printing.

// caracAL's upstream echo hook (src/CharacterThread.js at the pinned revision).
const upstreamEcho = `
  (function() {
    const old_add_log = add_log;
    add_log = function(msg, col) {
      old_add_log(msg,col);
      for(let [msg, col] of game_logs) {
        caracAL.log.info({col:col, type:"game_logs"}, msg);
      }
      game_logs = [];
    }
  })();
  `;
const render = {
  'server.kill.player.a': (args) => `${args.player} killed a ${args.monster}`,
  'server.item.named_found.a': (args) => `${args.player} found a ${args.item}`,
  'server.party.joined': (args) => `${args.player} joined the party`,
};
// One caracAL thread: the game's add_log and phrase lookup, the echo hook from
// make_game, then the console capture that runner-host installs later.
function thread(name, siblings, echo) {
  const printed = [];
  const context = vm.createContext({
    no_html: 'bot', game_logs: [], character: { name },
    phrase: { message: (data) => (data && data.phrase ? render[data.phrase](data.phrase_args) : data.message || data) },
    caracAL: { log: { info: (details, message) => printed.push([details.col, message]) } },
  });
  vm.runInContext('function add_log(message, color) { if (no_html == "bot") game_logs.push([message, color]); }', context);
  if (echo === 'upstream') vm.runInContext(upstreamEcho, context);
  else assert.equal(installGameLogEcho(context, context.caracAL.log, () => siblings), true);
  const sent = [];
  installHostGameLogs(context, async (events) => { sent.push(...events); });
  const capture = () => context.__partyGameLogCapture.queue;
  // The game's socket handler: ui_log(phrase.message(data, true), data.color).
  const deliver = (data) => { context.data = data; vm.runInContext('add_log(phrase.message(data, true), data.color)', context); };
  const local = (message, color) => { context.data = [message, color]; vm.runInContext('add_log(data[0], data[1])', context); };
  return { name, printed, capture, deliver, local, phraseOnly: (data) => context.phrase.message(data, true) };
}
const kill = (player, monster = 'Goo') => ({ phrase: 'server.kill.player.a', phrase_args: { player, monster }, color: 'gray' });
const found = (player, item = 'Seashell') => ({ phrase: 'server.item.named_found.a', phrase_args: { player, item }, color: '#4BAEAA' });
// The game delivers each party event to every member's client.
function party(threads, events) {
  for (const event of events) for (const member of threads) {
    if (event.only && !event.only.includes(member.name)) continue;
    if (event.local) member.local(...event.local); else member.deliver(event.data);
  }
}
function run(echo, events, siblings = ['A', 'B', 'C']) {
  const now = Date.now, random = Math.random;
  let clock = 1_000_000;
  Date.now = () => (clock += 7); Math.random = () => 0.5;
  try {
    const threads = ['A', 'B', 'C'].map((name) => thread(name, siblings === 'none' ? undefined : siblings, echo));
    party(threads, events);
    return threads;
  } finally { Date.now = now; Math.random = random; }
}
const stream = [
  { data: kill('A') }, { data: kill('A') },                 // two Goos, same killer, identical text
  { data: kill('A') }, { data: kill('B') },                 // the same moment from two killers
  { data: found('B') }, { data: found('B') },
  { data: kill('Patinder') }, { data: found('Patinder') },  // a Steam client party member
  { data: { phrase: 'server.party.joined', phrase_args: { player: 'C' }, color: 'gray' } },
  { data: 'Plain string line', only: ['A'] },
  { local: ['13 gold', 'gold'] },                           // each member's own share
];

test('the console capture is byte-identical to the upstream echo for the same event stream', () => {
  const before = run('upstream', stream), after = run('filtered', stream);
  for (let index = 0; index < 3; index++)
    assert.equal(JSON.stringify(after[index].capture()), JSON.stringify(before[index].capture()), before[index].name);
  assert.equal(before[0].capture().filter((entry) => entry.message === 'A killed a Goo').length, 3);
});

test('a sibling line prints once, from the thread of the character it is about', () => {
  const before = run('upstream', stream), after = run('filtered', stream);
  const count = (threads, message) => threads.flatMap((member) => member.printed).filter(([, text]) => text === message).length;
  assert.equal(count(before, 'A killed a Goo'), 9);
  assert.equal(count(after, 'A killed a Goo'), 3, 'all three of A\'s kills, from A only');
  assert.deepEqual(after[0].printed.filter(([, text]) => text === 'A killed a Goo').length, 3);
  assert.equal(count(after, 'B killed a Goo'), 1);
  assert.equal(count(after, 'B found a Seashell'), 2, 'both identical finds survive');
  assert.equal(after[1].printed.filter(([, text]) => text === 'B found a Seashell').length, 2);
  // Not a sibling: every thread keeps printing it, as before.
  assert.equal(count(after, 'Patinder killed a Goo'), count(before, 'Patinder killed a Goo'));
  assert.equal(count(after, 'Patinder found a Seashell'), 3);
  // Other phrases, plain strings and each member's own gold are unchanged.
  for (const message of ['C joined the party', 'Plain string line', '13 gold'])
    assert.equal(count(after, message), count(before, message), message);
  assert.equal(count(after, '13 gold'), 3);
});

test('without a siblings list every thread prints as before', () => {
  for (const siblings of ['none', []]) {
    const before = run('upstream', stream), after = run('filtered', stream, siblings);
    for (let index = 0; index < 3; index++) assert.deepEqual(after[index].printed, before[index].printed);
  }
});

test('a phrase lookup that no add_log follows does not silence the next line', async () => {
  const [a] = run('filtered', []);
  a.phraseOnly(kill('B'));
  await Promise.resolve();
  a.local('Your own line', 'white');
  assert.deepEqual(a.printed.at(-1), ['white', 'Your own line']);
});
