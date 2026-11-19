const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm'), {EventEmitter} = require('node:events');
const {spawnSync} = require('node:child_process');

for (const legacy of [false, true]) test(`installer replaces ${legacy ? 'legacy host' : 'current launcher'} and safely repeats`, async () => {
  const root = path.resolve(__dirname, '../..');
  const fixtureRoot = path.join(root, '.build');
  const target = await fs.mkdtemp(path.join(fixtureRoot, 'coordinator-installer-test-'));
  // The row removes its install target, as the upgrade-runner row below does.
  try {
  const files = ['src/CharacterThread.js', 'standalones/CharacterCoordinator.js', 'game_files.js','src/ConfigUtil.js'];
  const originals = new Map();
  for (const file of files) {
    const source = await fs.readFile(path.join(root, '.caracal', file), 'utf8');
    originals.set(file, source);
    await fs.mkdir(path.dirname(path.join(target, file)), {recursive: true});
    // A legacy host needs no recognized function anchors: none of its code is
    // retained or executed when installing the maintained application launcher.
    await fs.writeFile(path.join(target, file), legacy && file.startsWith('standalones/')
      ? 'throw new Error("Legacy coordinator must never run during installation");\n'
      : source.replaceAll('.get_game_files(proc_args.version)', '.get_game_files()')
        .replaceAll('.get_runner_files(proc_args.version)', '.get_runner_files()'));
  }
  const expected = await fs.readFile(path.join(root, 'tools/caracal/CharacterCoordinator.cjs'), 'utf8');
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, ['tools/caracal/install.mts', target],
      {cwd: root, encoding: 'utf8', windowsHide: true});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await fs.readFile(path.join(target, files[1]), 'utf8'), expected);
    assert.equal(await fs.readFile(path.join(target, 'game_files.js'), 'utf8'),
      'module.exports = require(process.env.AL_CONSOLE_ARTIFACT ? require("node:path").join(process.env.AL_CONSOLE_ARTIFACT, "runtime/lifecycle/coordinator/client-files.cjs") : "../runtime/lifecycle/coordinator/client-files.cjs");\n');
    const thread = await fs.readFile(path.join(target, files[0]), 'utf8');
    const storage = new Map(), session = new Map();
    const context = {JSDOM:require('../../.caracal/node_modules/jsdom').JSDOM,
      html_spoof:'<!doctype html>',fetch:()=>{},node_query:()=>{},require,console,vm,
      ipc_storage:{make_IPC_storage:ident=>ident==='ls'?storage:session}};
    vm.runInNewContext(thread.slice(thread.indexOf('function make_context('), thread.indexOf('async function ev_files(')),context);
    const game=context.make_context(),runner=context.make_context(game);
    assert.equal(game.localStorage,storage);
    assert.equal(runner.localStorage,game.localStorage);
    runner.localStorage.set('party-production:M','running journal');
    const replacement=context.make_context(context.make_context());
    assert.equal(replacement.localStorage.get('party-production:M'),'running journal');
    assert.equal(replacement.sessionStorage,session);
    for(const window of [runner,game,replacement,replacement.parent])window.close();
    assert.ok(thread.includes('get_game_files(proc_args.version)'));
    assert.ok(thread.includes('get_runner_files(proc_args.version)'));
    assert.equal(thread.split('const originalInitSocket').length,2);
    const events=[],socket=new EventEmitter(),game_context={socket,init_socket(){return 'socket-ready'}};
    const hook=thread.slice(thread.indexOf('  game_context.__partyClientVersion'),thread.indexOf('  vm.runInContext("the_game()", game_context);'));
    vm.runInNewContext(hook,{require,game_context,proc_args:{version:99,clientInstance:'instance'},process:{env:{},connected:true,send:message=>events.push(message)}});
    assert.equal(game_context.init_socket(),'socket-ready');game_context.init_socket();
    socket.emit('welcome',{});socket.emit('reloaded',{});
    assert.deepEqual(events.map(message=>message.event),['welcome','reloaded']);
    assert.equal(game_context.__partyClientVersion,99);assert.equal(game_context.__partyClientInstance,'instance');

    assert.ok(thread.includes('process.send({type: "client_update", event})'));
    // The game log echo installer replaces caracAL's hook only when the bundle has it.
    assert.equal(thread.split('installGameLogEcho?.(game_context, extensions.log, () => extensions.siblings))').length,2);
    assert.match(thread,/installGameLogEcho\?\.\(game_context, extensions\.log, \(\) => extensions\.siblings\)\)\n  vm\.runInContext\(\n    `\n  \(function\(\) \{\n    const old_add_log = add_log;/);
    assert.doesNotMatch(thread, /get_(?:game|runner)_files\(\)/);
    assert.ok(thread.indexOf('game_context.is_electron = false;') < thread.indexOf('await ev_files(game_sources, game_context)'));
    assert.equal(thread.split('game_context.is_electron = false;').length, 2);
  }
  for (const file of files) {
    assert.equal(await fs.readFile(path.join(root, '.caracal', file), 'utf8'), originals.get(file),
      'isolated installation must not change the live caracAL checkout');
  }
  } finally { await fs.rm(target, {recursive: true, force: true}); }
});

// The runner transform (tools/caracal/upgrade-runner.mts) on caracAL's own runner at the revision
// setup.mts pins, read from the caracAL checkout's history, so every anchor the transform replaces
// is checked against that revision, not against a working tree an earlier install already
// transformed.
test('upgrade-runner transforms the pinned caracAL runner, and a second run leaves it as it is', async () => {
  const root = path.resolve(__dirname, '../..');
  const revision = (await fs.readFile(path.join(root, 'tools/caracal/setup.mts'), 'utf8')).match(/const revision = "([0-9a-f]{40})"/)[1];
  const pinned = spawnSync('git', ['-C', path.join(root, '.caracal'), 'show', revision + ':src/CharacterThread.js'], {encoding: 'utf8', windowsHide: true});
  assert.equal(pinned.status, 0, pinned.stderr);
  await fs.mkdir(path.join(root, '.build'), {recursive: true});
  const target = await fs.mkdtemp(path.join(root, '.build', 'upgrade-runner-test-'));
  try {
    const file = path.join(target, 'src/CharacterThread.js');
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, pinned.stdout);
    const upgrade = () => spawnSync(process.execPath, ['tools/caracal/upgrade-runner.mts', target], {cwd: root, encoding: 'utf8', windowsHide: true});
    let result = upgrade();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const once = await fs.readFile(file, 'utf8');
    assert.match(once, /createRunnerHost/);
    assert.match(once, /installGameLogEcho/);
    assert.doesNotMatch(once, /make_runner/, "the runner host replaces caracAL's make_runner");
    result = upgrade();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await fs.readFile(file, 'utf8'), once, 'a second run changes nothing');
  } finally { await fs.rm(target, {recursive: true, force: true}); }
});
