const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const { createRunnerHost } = require('../../runtime/lifecycle/runner-host.ts');

test('real JSDOM CODE replacement keeps the game context and retires old windows', async () => {
  const oldApiPort = process.env.AL_INTERNAL_API_PORT;
  process.env.AL_INTERNAL_API_PORT = '1924';
  await fs.mkdir('.build/test-runners', { recursive: true });
  const directory = await fs.mkdtemp('.build/test-runners/host-');
  const codeFile = path.resolve(directory, 'entry.js');
  const upper = { caracAL: {}, effects: [], busy: false, record(value) { this.effects.push(value); } };
  const windows = [], messages = [];
  let handshakes = 0;
  await fs.writeFile(codeFile, 'parent.record("first"); globalThis.sharedRoutine={isOccupied:()=>parent.busy,stop:()=>{}};');
  const host = createRunnerHost({ upper, codeFile, runnerFiles: [],
    createContext(parent) {
      const window = new JSDOM('', { url: 'https://adventure.land/' }).window;
      window.globalThis = window;
      Object.defineProperty(window, 'parent', { value: parent });
      vm.createContext(window);
      windows.push(window);
      return window;
    },
    async evaluateFiles(_files, context) { vm.runInContext('var character={rip:false};function set_message(){}', context); },
    async connected() { handshakes++; }, send: message => messages.push(message),
  });
  try {
    await host.start();
    assert.equal(windows[0].__partyServer, 'http://127.0.0.1:1924');
    const savedParent = windows[0].parent;
    upper.busy = true;
    await host.reload({ id: 'busy', generation: '2' });
    assert.equal(messages.at(-1).status, 'busy');
    assert.equal(windows.length, 1);
    upper.busy = false;
    await fs.writeFile(codeFile, 'this is not valid javascript {');
    await host.reload({ id: 'invalid', generation: 'bad' });
    assert.equal(messages.at(-1).status, 'failed');
    savedParent.record('still alive');
    for (let index = 2; index <= 12; index++) {
      await fs.writeFile(codeFile, `parent.record(${index});`);
      await host.reload({ id: String(index), generation: String(index) });
      assert.equal(messages.at(-1).status, 'ready');
      assert.equal(windows.at(-1).__partyServer, 'http://127.0.0.1:1924');
    }
    assert.throws(() => savedParent.record('stale'), /retired/);
    assert.equal(handshakes, 1);
    assert.deepEqual(upper.effects, ['first', 'still alive', 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  } finally {
    if (oldApiPort === undefined) delete process.env.AL_INTERNAL_API_PORT;
    else process.env.AL_INTERNAL_API_PORT = oldApiPort;
    await host.dispose(); await fs.rm(directory, { recursive: true });
  }
});
