const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createNative}=require('../../tools/game/pathfinder-benchmark/native.cjs');
const source=fs.readFileSync('characters/shared.js','utf8'),context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function gatheringDestination('),source.indexOf('  function gatheringStatus(')),context);

test('fishing and mining destinations are reachable and within server 24-unit range with arrival margin',()=>{
 for(const version of [...new Set(['16846','17083',String(require('./helpers/installed-game.cjs').version)])].filter(v=>fs.existsSync('.caracal/game_files/'+v+'/data.js'))) {
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
