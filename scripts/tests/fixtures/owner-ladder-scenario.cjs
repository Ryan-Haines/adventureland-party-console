// The game maps typed from design/maps.js, the shared clock and the ladders over them (a shared setup lives in the harness).
// Isolated tests for steps 3 and 8a of the movement owner migration. Failure lists first,
// in e2e/movement-owner-failures.md "Isolated: the death goal and the ladder" and "Step 8a"
// items 3 and 4. Map data is typed by hand from the game's design/maps.js. Step 8a runs the
// step 3 survival ladder cases on the one owner ladder (runtime/protocol/ladder.ts).
const {createOwnerLadder,survivalRound,rejoinRound}=require('../../../runtime/protocol/ladder.ts');

const clock={now:0};
const createSurvivalLadder=game=>createOwnerLadder(survivalRound(game),()=>clock.now);
const mainSpawns=[[0,0,0,100],[-968,-163],[535,1677],[168,-134],[160,1381],[-87,673],[232,397],[294,498]];
const maps={
  main:{spawns:mainSpawns,on_death:['main',5],doors:[]},
  arena:{spawns:[[151.6,40.82]],on_death:['main',7],doors:[[152.99,85.42,60.9,40.55,'main',6,0]]},
  crypt:{spawns:[[0,0]],on_death:['cave',2],doors:[]},
  spider_instance:{spawns:[[0,0]],on_death:['gateway',3],doors:[]},
  halloween:{spawns:[[8,630]],doors:[]},
};
// Step 8a: e2e/movement-owner-failures.md "Step 8a", items 3 and 4.
const rejoin=join=>createOwnerLadder(rejoinRound(join),()=>clock.now);

module.exports = { clock, createSurvivalLadder, mainSpawns, maps, rejoin };
