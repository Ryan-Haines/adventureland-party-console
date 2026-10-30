const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// L2 failure modes (docs/efficiency.md § Requests and logs):
// 1. every 6 s poll logs "updating account info" and "found N servers and N characters";
// 2. a change in the server or character count goes unlogged;
// 3. the poll leaves the first account read after start unlogged;
// 4. the poll interval, the response or the listeners change (realm switch,
//    roster and sibling updates read them every 6 s);
// 5. a failed poll stops logging its warning.
const source = fs.readFileSync(path.join(__dirname, '../../.caracal/account_info.js'), 'utf8');
function load(responses) {
  const logs = [], timers = [];
  const logger = { log: (...args) => logs.push(['info', args.join(' ')]), debug: (...args) => logs.push(['debug', args.join(' ')]),
    warn: (...args) => logs.push(['warn', args.join(' ')]) };
  const module = { exports: {} };
  // The upstream file imports node-fetch; this test answers the account API itself.
  const body = source.slice(source.indexOf('const { console }'));
  const fetch = async (url, options) => {
    assert.equal(url, 'https://adventure.land/api/servers_and_characters');
    assert.equal(options.method, 'POST');
    const next = responses.shift();
    if (next instanceof Error) return { ok: false, statusText: next.message, json: async () => ({}) };
    return { ok: true, json: async () => next };
  };
  vm.runInNewContext(body, { module, require: (name) => (name === './src/LogUtils' ? { console: logger } : require(name)), fetch,
    setInterval: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearInterval: () => {} });
  return { build: module.exports, logs, timers };
}
const account = (servers, characters) => ({ servers: Array.from({ length: servers }, (_, i) => ({ key: 'S' + i })),
  characters: Array.from({ length: characters }, (_, i) => ({ name: 'C' + i, online: i % 2 })) });

test('account info logs the first read and each change of the counts, and keeps the 6 s poll', async () => {
  const responses = [account(2, 3), account(2, 3), account(2, 3), account(3, 3), account(3, 3), new Error('Bad Gateway'), account(3, 4)];
  const { build, logs, timers } = load(responses);
  const info = await build('session');
  const heard = [];
  info.add_listener((value) => heard.push(value.characters.length));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 6000);
  for (let i = 0; i < 6; i++) await timers[0].callback();
  const shown = logs.filter(([level]) => level !== 'debug').map(([level, text]) => level + ': ' + text);
  assert.deepEqual(shown, [
    'info: found 2 servers and 3 characters',
    'info: found 3 servers and 3 characters',
    'warn: failed to update account info: %s Error: failed to update account info: Bad Gateway',
    'info: found 3 servers and 4 characters',
  ]);
  assert.equal(logs.filter(([level, text]) => level === 'debug' && text === 'updating account info').length, 7);
  assert.deepEqual(heard, [3, 3, 3, 3, 4], 'every successful poll still reaches the listeners');
  assert.equal(info.response.characters.length, 4);
  assert.equal(info.resolve_char('C1').online, 1);
});
