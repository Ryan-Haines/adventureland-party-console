const test=require('node:test'), assert=require('node:assert/strict');
const {createMoveBudget, MOVE_WINDOW_MS, MOVE_LIMIT, SOFT_CALL_COST}=require('../../runtime/characters/move-budget.ts');
const {installPartyMovement}=require('../../runtime/characters/movement.ts');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

// Failure inventory: docs/movement-request-budget.md. Each test names its line.
function fixture(options={}) {
 let now=1000, cc=options.cc, seq=0;
 const issued=[], logs=[], timers=new Map();
 const native=(x,y)=>{issued.push({x,y,at:now});return options.reject?Promise.reject({reason:options.reject}):Promise.resolve({x,y});};
 const budget=createMoveBudget({native,now:()=>now,cc:()=>cc,
  schedule:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;},
  cancel:id=>timers.delete(id),report:(event,message)=>logs.push({...event,message})});
 async function advance(ms){
  const end=now+ms;
  for(;;){
   const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next||next[1].at>end)break;
   timers.delete(next[0]);now=next[1].at;next[1].fn();await settle();
  }
  now=end;await settle();
 }
 return {budget,issued,logs,timers,advance,setCc:value=>{cc=value;},get now(){return now;}};
}
function costInAnyWindow(issued){
 let worst=0;
 for(const first of issued){const inside=issued.filter(m=>m.at>=first.at&&m.at<first.at+MOVE_WINDOW_MS).length;worst=Math.max(worst,inside*2.5);}
 return worst;
}

test('1: a walk restart loop cannot push move cost toward the server disconnect limit',async()=>{
 const r=fixture();
 // The 2026-10-15 churn: a stop move plus a new walk every 50 ms for 20 seconds.
 for(let t=0;t<20000;t+=50){r.budget.move(r.now%7,0);r.budget.move(100+t,0);await r.advance(50);}
 await r.advance(MOVE_WINDOW_MS);
 assert.ok(r.issued.length>MOVE_LIMIT,'the loop keeps moving, it is not frozen');
 assert.ok(costInAnyWindow(r.issued)<=MOVE_LIMIT*2.5,`worst 4s window cost ${costInAnyWindow(r.issued)}`);
 assert.ok(MOVE_LIMIT*2.5<200,'the budget stays under limits.calls');
});

test('2: the newest deferred destination is issued once the window frees',async()=>{
 const r=fixture();
 for(let i=0;i<MOVE_LIMIT;i++)r.budget.move(i,0);
 r.budget.move(500,1);r.budget.move(600,2);
 assert.equal(r.issued.length,MOVE_LIMIT);
 await r.advance(MOVE_WINDOW_MS+1);
 assert.equal(r.issued.length,MOVE_LIMIT+1);
 assert.deepEqual(r.issued.at(-1).x,600);
});

test('3: a superseded deferred move settles as interrupted like native move',async()=>{
 const r=fixture();
 for(let i=0;i<MOVE_LIMIT;i++)r.budget.move(i,0);
 const older=r.budget.move(500,0), newer=r.budget.move(600,0);
 assert.deepEqual(await older,{reason:'interrupted'});
 await r.advance(MOVE_WINDOW_MS+1);
 assert.deepEqual(await newer,{x:600,y:0});
});

test('4: the ordinary approach cadence passes through in order without deferral',async()=>{
 const r=fixture();
 for(let t=0;t<30000;t+=250){r.budget.move(t,0);r.budget.move(t,1);await r.advance(250);}
 assert.equal(r.issued.length,240);
 assert.ok(r.issued.every((m,i)=>m.x===Math.floor(i/2)*250&&m.y===i%2));
 assert.ok(r.issued.every((m,i)=>m.at===1000+Math.floor(i/2)*250),'no move waited');
 assert.equal(r.logs.length,0);
});

test('5: a high server call cost defers moves until cc falls',async()=>{
 const r=fixture({cc:SOFT_CALL_COST});
 const pending=r.budget.move(10,0);
 assert.equal(r.issued.length,0);
 await r.advance(1000);assert.equal(r.issued.length,0);
 r.setCc(SOFT_CALL_COST-30);await r.advance(1000);
 assert.equal(r.issued.length,1);assert.deepEqual(await pending,{x:10,y:0});
 r.setCc(undefined);r.budget.move(20,0);assert.equal(r.issued.length,2,'a missing cc does not block');
});

test('6: reinstalling movement wraps native move once and dispose restores it',async()=>{
 const native=async(x,y)=>({x,y});
 const host=movementHost(native);
 const first=installPartyMovement(host,ports());
 assert.notEqual(host.move,native);
 const wrapper=host.move;
 const second=installPartyMovement(host,ports());
 assert.notEqual(host.move,wrapper,'the old wrapper is not wrapped again');
 for(let i=0;i<MOVE_LIMIT;i++)host.move(i,0);
 const pending=host.move(999,0);
 second.dispose();
 assert.deepEqual(await pending,{reason:'interrupted'});
 assert.equal(host.move,native);
 first.dispose();assert.equal(host.move,native);
});

test('7: throttling reports once per window with counts',async()=>{
 const r=fixture();
 for(let i=0;i<MOVE_LIMIT+30;i++)r.budget.move(i,0);
 assert.equal(r.logs.length,1);
 await r.advance(MOVE_WINDOW_MS+1);
 for(let i=0;i<MOVE_LIMIT+5;i++)r.budget.move(i,0);
 assert.equal(r.logs.length,2);
 assert.equal(r.logs[0].phase,'Movement request budget reached');
 // The newest move from the first burst takes one slot of the next window.
 assert.equal(r.budget.report().superseded,29+5);
 assert.match(r.logs[0].message,/40 moves in 4s/);
});

test('8: native rejections reach the caller of the issued move',async()=>{
 const r=fixture({reject:'cave_paused'});
 await assert.rejects(r.budget.move(1,1),e=>e.reason==='cave_paused');
});

function movementHost(move){
 const c={name:'Test',map:'main',in:'main',x:0,y:0,real_x:0,real_y:0,speed:60,base:{h:8,v:7,vn:2},items:[],moving:false};
 return {character:c,G:{version:1,geometry:{},maps:{main:{spawns:[[0,0]],doors:[],npcs:[]}},npcs:{transporter:{places:{}}}},smart:{moving:false,plot:[]},
  parent:{socket:{emit(){}},push_deferred:()=>Promise.resolve()},smart_move:async()=>{},stop:async()=>{},smart_move_logic(){},start_pathfinding(){},continue_pathfinding(){},
  move,use:async()=>{},can_use:()=>true,can_walk:()=>true,is_transporting:()=>false,can_move:()=>true,is_door_close:()=>true,can_use_door:()=>true,find_npc:()=>null,game_log(){}};
}
function ports(){ return {now:()=>1000,context:()=>({runtime:'test',revision:1,current:true,paused:false}),request:async()=>({}),diagnostic(){}}; }
