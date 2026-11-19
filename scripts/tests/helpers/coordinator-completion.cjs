const {withDoor} = require('./coordinator-merchant.cjs');
// The build's CompletionPorts over a unit test's state, with the merchant jobs owner's enqueue door on the same clock.
function fixture(scenario) {
  const state = {merchantCharacter:'M', merchantCurrent:{id:'job',target:'F',reason:'service'},
    merchantQueue:[], commands:{M:{type:'merchant-service'},F:{type:'merchant-handoff'}},
    nextCommandId:10, standSearch:null, merchantCargo:null, mluckCastAt:{},
    marked:{F:[{name:'leather'},{name:'leather'}],M:[{name:'ore'}]},
    upgrades:{F:[{name:'sword'}]}, statScrolls:{F:[{name:'strscroll'}]}, compounds:{F:[{name:'ring'}]},
    autoCompounds:{F:[{name:'ring'},{name:'amulet'}]}, withdrawals:{F:[{name:'ring'}],M:[{name:'ore'}]},
    purchases:{F:[{name:'potion'}]}, merchantMarked:{F:[{name:'cape'}]},
    merchantDeliveries:{F:[{item:{name:'sword',level:8},equipOnDelivery:true}]},
    npcSaleMarks:[], merchantJobBlocks:{}, bankSnapshot:{gold:500}, statuses:{M:{gold:100,items:[]}},
    aldata:{auth:'NO',authCheckedAt:0,key:'key'}};
  Object.assign(state, structuredClone(scenario.state || {}));
  Object.assign(state.merchantCurrent, structuredClone(scenario.job || {}));
  const calls=[], timers=[];
  const record=name=>(...args)=>{calls.push([name,...args]);};
  const ports=withDoor(state,{now:()=>100000,nextCommand:()=>state.nextCommandId++,mailComplete:record('mail'),
    clearUpgrades:record('upgrades'),clearIncoming:record('incoming'),log:record('log'),
    capacitySignature:()=> 'capacity',persistALData:record('persistALData'),
    publishALData:record('publishALData'),
    timers:{setTimeout:(callback,delay)=>{calls.push(['timer',delay]);timers.push(callback);}},stamp:job=>job,
    queue:record('queue'),ensureHome:record('home'),persistBank:record('bank'),persist:record('persist'),
    dispatch:record('dispatch'),pontyMatches:()=>{calls.push(['ponty']);return false;},aldataMatches:record('aldata')});
  const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
  return {state,ports,response,calls,timers};
}
module.exports={fixture};
