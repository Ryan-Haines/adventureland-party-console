// The call budget's planted install: installCallBudget (runtime/characters/call-budget.ts) over a
// fake game socket on a test clock. The reads' timers are the test's: each delay is kept with its
// run, so a row reads the wait a read set and runs it; a timer the install clears is marked
// `cleared`, and `run` passes over it. `winTimers` keeps the game window's timers,
// which the record's drain runs on after a stop.
const {installCallBudget}=require('../../../runtime/characters/call-budget.ts');
const {READ_PICKS}=require('../../../runtime/characters/call-budget-limits.ts');

// The call budget's run scope handle over the test's socket and its own timers, read at each call so
// a row's planted timers hold.
const scope={on:(target,event,fn)=>target.on(event,fn),off:(target,event,fn)=>target.off(event,fn),setTimeout:(run,ms)=>globalThis.setTimeout(run,ms),clearTimeout:id=>globalThis.clearTimeout(id),setInterval:(run,ms)=>globalThis.setInterval(run,ms),clearInterval:id=>globalThis.clearInterval(id),queueMicrotask:run=>queueMicrotask(run)};

function plantedInstall({items=[],pings=[99],fields={},render,handle=scope,winTimers}={}){
  const kept={},timers=[],intervals=[],handlers={},emitted=[],sent=[],replies=[];
  for(const [field,value] of Object.entries(fields)){kept[field]=READ_PICKS[field];READ_PICKS[field]=value;}
  const real={setTimeout:globalThis.setTimeout,setInterval:globalThis.setInterval,clearTimeout:globalThis.clearTimeout,clearInterval:globalThis.clearInterval};
  const clear=t=>{if(t&&typeof t==='object')t.cleared=true;};
  const plantTimers=()=>{globalThis.setTimeout=(run,ms)=>{const t={run,ms};timers.push(t);return t;};globalThis.setInterval=(run,ms)=>{const t={run,ms};intervals.push(t);return t;};
    globalThis.clearTimeout=clear;globalThis.clearInterval=clear;};
  const realTimers=()=>Object.assign(globalThis,real);
  let now=500_000,budget;
  // `sent` keeps each emit that reached the game's socket with its time and data.
  const socket={emit(method,data){emitted.push(method);sent.push({at:now,method,data});return socket;},on(event,fn){(handlers[event]??=[]).push(fn);},off(event,fn){handlers[event]=(handlers[event]??[]).filter(f=>f!==fn);}};
  const win={socket,pings,render_tracker:render,setTimeout:winTimers?(run,ms)=>winTimers.push({run,ms}):()=>0,clearTimeout:()=>{},Date:{now:()=>now}};
  const host={parent:win,character:{name:'W',map:'main',items,slots:{}},G:{items:{},skills:{},maps:{},conditions:{}}};
  plantTimers();
  try{budget=installCallBudget(host,{now:()=>now,cpu:()=>0,scope:handle,held:()=>false,tracker:data=>replies.push(data)});}
  finally{realTimers();for(const [field,value] of Object.entries(kept))READ_PICKS[field]=value;}
  // Every turn of the planted install runs on the planted timers.
  const turn=run=>{plantTimers();try{return run();}finally{realTimers();}};
  return {budget,win,host,socket,handlers,timers,intervals,emitted,sent,replies,at:()=>now,advance:ms=>{now+=ms;},to:ms=>{now=ms;},
    fire:(event,data)=>turn(()=>{for(const fn of handlers[event]??[])fn(data);}),
    emit:(...args)=>turn(()=>win.socket.emit(...args)),
    ask:question=>turn(()=>budget.band(question)),
    run:t=>turn(()=>t.cleared?undefined:t.run()),
    stop:()=>turn(()=>budget.stop())};
}

module.exports={plantedInstall};
