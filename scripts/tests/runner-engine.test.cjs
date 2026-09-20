const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const jquery = require('../../.caracal/node_modules/jquery');
const { createRunnerHost } = require('../../runtime/lifecycle/runner-host.ts');

test('downloaded game and CODE engines survive repeated runner disposal on one socket', async () => {
  const gameRoot=path.resolve('.caracal/game_files');
  const versions=(await fs.readdir(gameRoot)).filter(name=>/^\d+$/.test(name)).sort((a,b)=>Number(b)-Number(a));
  assert.ok(versions.length,'a downloaded game version is required');
  const gameDirectory=path.join(gameRoot,versions[0]);
  // Snapshot the fixture before repeated reloads; the live coordinator may retire old caches meanwhile.
  const gameSources=new Map(await Promise.all((await fs.readdir(gameDirectory)).filter(name=>name.endsWith('.js'))
    .map(async name=>[name,await fs.readFile(path.join(gameDirectory,name),'utf8')])));
  const directory = path.resolve('.build/test-runners/real-engine');
  await fs.mkdir(directory, { recursive: true });
  const codeFile = path.join(directory, 'entry.js');
  await fs.writeFile(codeFile, 'parent.socket.on("test-event", function(){parent.effects.push(character.name)});');
  const windows = [];
  function createContext(parent) {
    const window = new JSDOM('', { url: 'https://adventure.land/' }).window;
    window.globalThis = window;
    window.$ = window.jQuery = jquery(window);
    window.$.ajax = () => {
      const deferred = window.$.Deferred();
      queueMicrotask(() => deferred.resolve({}));
      return Object.assign(deferred.promise(), { abort() { deferred.reject({}, 'aborted'); } });
    };
    window.bowser = {};
    if (parent) Object.defineProperty(window, 'parent', { value: parent });
    vm.createContext(window);
    windows.push(window);
    return window;
  }
  async function evaluateFiles(files, context) {
    for (const name of files) {
      const source = gameSources.get(name).replace(
        'Object.defineProperty(String.prototype, "hashCode", {',
        'Object.defineProperty(String.prototype, "hashCode", { configurable: true,');
      vm.runInContext(source, context, { filename: name });
    }
  }
  const game = createContext();
  let host;
  try {
    await evaluateFiles(['phrases.js', 'en.js', 'pixi.min.js', 'combined.js', 'codemirror.js',
      'common_functions.js', 'old_common_functions.js', 'functions.js', 'merrit_stand_notice.js',
      'game.js', 'html.js', 'payments.js', 'keyboard.js', 'data.js'], game);
    game.character = { name: 'Test', id: 'Test', type: 'character', real_x: 0, real_y: 0,
      x: 0, y: 0, range: 100, rip: false, map: 'main', direction: 0, q: {}, s: {}, c: {} };
    game.caracAL = {};
    game.no_graphics = true;
    game.no_html = true;
    game.new_attacks = true;
    game.Dev = false;
    game.inside = "game";
    const socket = game.socket = new EventEmitter();
    const actions = [];
    for (const action of ['attack', 'heal']) socket.on(action, payload => {
      actions.push([action, payload.id]);
      queueMicrotask(() => game.resolve_deferred(action, { success: true }));
    });
    const monster = { id: 'monster', type: 'monster', real_x: 20, real_y: 0, x: 20, y: 0 };
    const ally = { id: 'ally', name: 'ally', type: 'character', real_x: 30, real_y: 0, x: 30, y: 0 };
    game.effects = [];
    const messages = [];
    host = createRunnerHost({ upper: game, createContext, evaluateFiles,
      runnerFiles: ['common_functions.js', 'old_common_functions.js', 'runner_functions.js', 'runner_compat.js'],
      codeFile, connected: async () => {}, send: message => messages.push(message) });
    await host.start();
    for (let index = 0; index < 20; index++) {
      await host.reload({ id: String(index), generation: String(index) });
      assert.equal(messages.at(-1).status, 'ready', messages.at(-1).error);
      assert.equal(game.socket, socket);
      assert.equal(socket.listenerCount('test-event'), 1);
      socket.emit('test-event');
      const runner = game.caracAL.runner;
      async function acknowledged(action, target) {
        let timer;
        try { await Promise.race([runner[action](target), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${action} ${target.id}: missing acknowledgement; emitted ${JSON.stringify(actions)}`)), 1000);
        })]); } finally { clearTimeout(timer); }
      }
      await acknowledged('attack', monster);
      await acknowledged('heal', ally);
      await acknowledged('heal', runner.character);
      assert.deepEqual(actions.splice(0), [['attack', 'monster'], ['heal', 'ally'], ['heal', 'Test']]);
      const distant = { ...monster, real_x: 1000, x: 1000 };
      await assert.rejects(runner.attack(distant), error => error.reason === 'too_far');
      assert.deepEqual(actions, [], 'genuine out-of-range actions do not reach the socket');
    }
    assert.equal(game.effects.length, 20);
    await host.dispose();
    assert.equal(socket.listenerCount('test-event'), 0);
    const manifest = JSON.parse(await fs.readFile('.build/game/manifest.json', 'utf8'));
    Object.assign(game.character, { type: 'character', ctype: 'mage', level: 1,
      items: Array(42).fill(null), slots: {}, s: {}, c: {}, q: {}, hp: 100, mp: 100,
      max_hp: 100, max_mp: 100, gold: 0, speed: 40, range: 100, frequency: 1, attack: 10,
      in: 'main', skin: 'marmor1a', base: { h: 8, v: 7, vn: 2 } });
    host = createRunnerHost({ upper: game, createContext, evaluateFiles,
      runnerFiles: ['common_functions.js', 'old_common_functions.js', 'runner_functions.js', 'runner_compat.js'],
      codeFile: path.resolve('.build/game', manifest.classes.mage.file),
      connected: async () => {}, send: message => messages.push(message) });
    await host.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(game.caracAL.runner.__partyStatusSuccessAt, 'compiled shared routine publishes a heartbeat');
    const counts = () => socket.eventNames().map(name => [name, socket.listenerCount(name)]).sort();
    const baseline = counts();
    for (let index = 0; index < 5; index++) {
      await host.reload({ id: 'class-' + index, generation: 'class-' + index });
      assert.equal(messages.at(-1).status, 'ready', messages.at(-1).error);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(counts(), baseline, 'compiled shared listeners do not accumulate');
    }
  } finally {
    await host?.dispose();
    for (const window of windows) window.close();
    assert.ok(directory.startsWith(path.resolve('.build/test-runners') + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
