const {productionFunctions} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const context=vm.createContext({});
vm.runInContext(productionFunctions(['gatheringDestination']),context);

test('fishing and mining destinations are reachable and within server 24-unit range with arrival margin',()=>{
 const versions=[...new Set(['16846','17083',String(require('./helpers/installed-game.cjs').version)])].filter(v=>fs.existsSync('.caracal/game_files/'+v+'/data.js'));
 assert.ok(versions.length>0,'no game files under .caracal/game_files for 16846, 17083 or the installed version; run node scripts/ci/restore-game-fixtures.cjs');
 for(const version of versions) {
  const n=createNative('.caracal/game_files/'+version);
  for(const mode of ['fishing','mining']) {
   const p=context.gatheringDestination(mode),zone=n.game.maps[p.map].zones.find(z=>z.type===mode);
   for(const dx of [-1,0,1])for(const dy of [-1,0,1]) {
    const actual={...p,x:p.x+dx,y:p.y+dy};
    assert.ok(n.canWalk(p,actual),`${version} ${mode} collision`);
    // Server checks these four offsets; the client's 48-unit indicator is broader.
    assert.ok([[0,-24],[-24,0],[24,0],[0,24]].some(([x,y])=>
     n.context.is_point_inside([actual.x+x,actual.y+y],zone.polygon)),`${version} ${mode} location`);
   }
  }
  assert.ok(n.canWalk({map:'main',x:-1590,y:555},context.gatheringDestination('fishing')));
 }
});
