const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {isCoordinatorApplicationLauncher}=require('../../tools/caracal/coordinator-launcher.mts');
const source=fs.readFileSync('tools/caracal/CharacterCoordinator.cjs','utf8');
const {runLauncher,heartbeat}=require('./helpers/coordinator-host.cjs');

for(const directory of ['C:\\Games\\Adventure Land\\.caracal\\standalones','/app/.caracal/standalones']) {
  test('launcher starts the real bundle and serves a heartbeat: '+directory,async()=>{
    const host=await runLauncher(directory,1900000000000);
    const response=heartbeat(host);
    assert.equal(response.merchantCharacter,'GoldMajesty');
    assert.equal(response.partyPositions[0].name,'P');
    assert.ok(host.routes.some(route=>route[1]==='/party-api/merchant/complete'));
  });
  test('application launcher delegates installed paths unchanged: '+directory,async()=>{
    const calls=[],completion=Promise.resolve(),hostModule={exports:{}};
    function hostRequire(name) {
      if(name.startsWith('node:'))return require(name);
      calls.push(name);
      assert.equal(name,'../../.build/runtime/coordinator-application.cjs');
      return {startCoordinatorApplication:platform=>{
        assert.equal(platform.require('../../.build/runtime/coordinator-application.cjs').startCoordinatorApplication instanceof Function,true);assert.equal(platform.directory,directory);assert.equal(platform.codeDirectory,directory);
        assert.equal(typeof platform.loadFetch,'function');return completion;
      }};
    }
    vm.runInNewContext(source,{require:hostRequire,module:hostModule,__dirname:directory,process:{env:{}}});
    assert.equal(hostModule.exports,completion);await completion;
    assert.deepEqual(calls,['../../.build/runtime/coordinator-application.cjs','../../.build/runtime/coordinator-application.cjs']);
  });
}
test('launcher recognition does not mistake legacy imports or comments for the application entry',()=>{
  assert.equal(isCoordinatorApplicationLauncher(source),true);
  assert.equal(isCoordinatorApplicationLauncher('const x = require("../../.build/runtime/coordinator-application.cjs");'),false);
  assert.equal(isCoordinatorApplicationLauncher('coordinatorPolicies.createCoordinatorHunt(party, {});'),false);
});

// The coordinator bundle holds one copy of movement's defense.ts. start.ts takes the convoy
// defense step from movement's door, as every other caller does, so the bundle requires no second
// build of defense.ts (scripts/convoy-defense.cjs) at run time.
test('the coordinator bundle evaluates defense.ts once',()=>{
  const {buildSync}=require('esbuild');
  const built=buildSync({entryPoints:['runtime/coordinator/application.ts'],bundle:true,write:false,format:'cjs',platform:'node',
    target:'node22',external:['alpathfinder','bot-web-interface','express','../monitoring_util','../src/*'],logLevel:'silent'}).outputFiles[0].text;
  assert.equal(built.split('function travelObservationIssue(').length-1,1);
  assert.doesNotMatch(built,/convoy-defense\.cjs/);
});

// The coordinator process holds one copy of the console's modules. The targeting queue and the
// roster routes come from the application bundle's own modules; grouped-combat.cjs and roster.cjs
// each bundled most of the console beside it. The movement planner runs in its own worker.
test('the coordinator bundle requires no second build of the console',async()=>{
  const {build}=require('esbuild');
  const built=(await build({entryPoints:['runtime/coordinator/application.ts'],bundle:true,write:false,format:'cjs',platform:'node',
    target:'node22',external:['alpathfinder','bot-web-interface','express','../monitoring_util','../src/*'],logLevel:'silent'})).outputFiles[0].text;
  const required=[...built.matchAll(/\(\s*["'](\.\.\/\.\.\/\.build\/runtime\/[^"']+)["']\s*\)/g)].map(m=>m[1]);
  assert.deepEqual(required,[]);
});

// The bundle names its source map file beside it (tools/build-runtime.mts says why). Inline, the
// map cost the coordinator 38 MB of working set at an idle start (docs/efficiency.md "The source
// map stays on disk").
test('the coordinator bundle links its source map from a file beside it',()=>{
  const bundle=fs.readFileSync('.build/runtime/coordinator-application.cjs','utf8');
  assert.doesNotMatch(bundle,/sourceMappingURL=data:/);
  assert.match(bundle.slice(-200),/\/\/# sourceMappingURL=coordinator-application\.cjs\.map\s*$/);
  const map=JSON.parse(fs.readFileSync('.build/runtime/coordinator-application.cjs.map','utf8'));
  const entry=map.sources.findIndex(source=>source.endsWith('runtime/coordinator/application.ts'));
  assert.ok(entry>=0);
  assert.equal(map.sourcesContent[entry],fs.readFileSync('runtime/coordinator/application.ts','utf8'));
});
