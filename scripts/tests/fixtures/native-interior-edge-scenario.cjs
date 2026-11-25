// The captured Halloween interior edge and the native walk check over it (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fixture=require('./halloween-native-interior-edge.json');
const {repairDoorApproaches}=require('../../../runtime/movement/geometry/door-approach.ts');
const native=vm.createContext({G:{geometry:{halloween:fixture.geometry},maps:{halloween:fixture.mapData,main:{spawns:[[0,0]],doors:[],npcs:[]}},npcs:{transporter:{places:{}}}},Place:'code',Math,Date});
vm.runInContext(fs.readFileSync(path.join(require('../helpers/installed-game.cjs').directory,'old_common_functions.js'),'utf8'),native);
const walk=(a,b)=>a.map===b.map&&native.can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:fixture.base});
const ports={game:native.G,walk,door:()=>false,hasKey:()=>false};
const from=fixture.from,to={...fixture.to,method:'move'};
const origin={map:'spookytown',x:34,y:1449},entry={map:'halloween',x:784,y:-1060,transport:true,s:2};

module.exports = { fixture, repairDoorApproaches, native, walk, ports, from, to, origin, entry };
