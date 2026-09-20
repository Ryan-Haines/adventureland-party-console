const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {isCoordinatorApplicationLauncher}=require('../../tools/caracal/coordinator-launcher.mts');
const source=fs.readFileSync('tools/caracal/CharacterCoordinator.cjs','utf8');
const {runLauncher}=require('./helpers/coordinator-host.cjs');

for(const directory of ['C:\\Games\\Adventure Land\\.caracal\\standalones','/app/.caracal/standalones']) {
  test('launcher starts the real bundle and serves a heartbeat: '+directory,async()=>{
    const host=await runLauncher(directory,1900000000000);
    let response;
    host.handlers.get('/party-api/status')({body:{name:'P',ctype:'priest',map:'main',x:0,y:0,
      server:'USII',gold:0,items:Array(42).fill(null),hp:100,max_hp:100}},
      {status(code){assert.equal(code,200);return this;},json(value){response=value;}});
    assert.equal(response.merchantCharacter,'GoldMajesty');
    assert.equal(response.partyPositions[0].name,'P');
    assert.ok(host.routes.some(route=>route[1]==='/party-api/merchant/complete'));
  });
  test('application launcher delegates installed paths unchanged: '+directory,async()=>{
    const calls=[],completion=Promise.resolve(),hostModule={exports:{}};
    function hostRequire(name) {
      calls.push(name);
      assert.equal(name,'../../.build/runtime/coordinator-application.cjs');
      return {startCoordinatorApplication:platform=>{
        assert.equal(platform.require,hostRequire);assert.equal(platform.directory,directory);
        assert.equal(typeof platform.loadFetch,'function');return completion;
      }};
    }
    vm.runInNewContext(source,{require:hostRequire,module:hostModule,__dirname:directory});
    assert.equal(hostModule.exports,completion);await completion;
    assert.deepEqual(calls,['../../.build/runtime/coordinator-application.cjs']);
  });
}
test('launcher recognition does not mistake legacy imports or comments for the application entry',()=>{
  assert.equal(isCoordinatorApplicationLauncher(source),true);
  assert.equal(isCoordinatorApplicationLauncher('const x = require("../../.build/runtime/coordinator-application.cjs");'),false);
  assert.equal(isCoordinatorApplicationLauncher('coordinatorPolicies.createCoordinatorHunt(party, {});'),false);
});
