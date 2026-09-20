const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){const deaths=[],invalidations=[];const c=vm.createContext({root:{partyRoleRunner:{invalidateTarget:id=>invalidations.push(id)}},fightPackets:[],Date,coordinatorClockOffset:0,
 character:{name:'W',in:'cave'},reportFightDeath:id=>deaths.push(id)});
 const start=source.indexOf('  function observeFightPacket('),end=source.indexOf('  var combatDeathListener',start);vm.runInContext(source.slice(start,end),c);return {c,deaths,invalidations};}
test('only explicitly lethal disappearance releases an ID, not visibility or teleport',()=>{
 const {c,deaths}=fixture();for(const data of [{id:'a',reason:'vision'},{id:'b',teleport:true},{id:'c'}])c.combatDisappearListener(data);
 assert.deepEqual(deaths,[]);c.combatDisappearListener({id:'d',death:true});assert.deepEqual(deaths,['d']);
});
test('server entity tombstone confirms death only within its instance',()=>{
 const {c,deaths}=fixture();c.combatEntitiesDeathListener({in:'other',monsters:[{id:'a',dead:true}]});
 c.combatEntitiesDeathListener({in:'cave',monsters:[{id:'b',hp:0},{id:'c',dead:true},{id:'d',hp:100}]});
 assert.deepEqual(deaths,['b','c']);
});

test('native iframe replacement removes stale combat callbacks without touching game listeners',()=>{
 const {EventEmitter}=require('node:events');const socket=new EventEmitter();let nativeDeaths=0,oldCalls=0,newCalls=0;
 const gameHandler=()=>nativeDeaths++;socket.on('death',gameHandler);
 socket.on('death',function(){oldCalls++;throw Error('deathCombatMessage from retired CODE');});
 const parent={socket};const start=source.indexOf('  var partyCombatSocketOwner ='),end=source.indexOf('  migratePartyCombatSockets();',start)+'  migratePartyCombatSockets();'.length;
 function install(){const c=vm.createContext({parent});vm.runInContext(source.slice(start,end),c);return c;}
 const first=install(), firstHandler=()=>newCalls++;
 socket.on('death',firstHandler);parent.__partyCombatSocketSubscriptions.push({owner:first.partyCombatSocketOwner,socket,event:'death',handler:firstHandler});
 socket.emit('death',{id:'rat1'});assert.equal(oldCalls,0);assert.equal(newCalls,1);assert.equal(nativeDeaths,1);
 const second=install(),secondHandler=()=>newCalls++;
 socket.on('death',secondHandler);parent.__partyCombatSocketSubscriptions.push({owner:second.partyCombatSocketOwner,socket,event:'death',handler:secondHandler});
 first.retirePartyCombatSockets(first.partyCombatSocketOwner);
 socket.emit('death',{id:'rat2'});assert.equal(newCalls,2);assert.equal(nativeDeaths,2);assert.equal(socket.listeners('death').length,2);
 second.retirePartyCombatSockets(second.partyCombatSocketOwner);assert.deepEqual(socket.listeners('death'),[gameHandler]);
});
