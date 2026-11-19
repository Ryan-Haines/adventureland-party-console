// The job owner's rendezvous and the items owner's send run with the shared movement harness (fixtures/movement-owner-callers.cjs)
// and the errand walk they call (runtime/movement/character/errands.ts, helpers/errands.cjs).
const {createBagReads} = require('../../../runtime/items/character/bag.ts');
const {marketHarness} = require('../helpers/items-character.cjs');
const { createMovementContext } = require('./movement-owner-callers.cjs');
const {installErrandWalk} = require('../helpers/errands.cjs');
// The fake movement owner keeps a request for the place its live journey walks to (design 2.2), and
// a `stuck` character's try ends one second in with the executor's walking stall (R2F3), as the
// owner's journey rejects to its requester. The merchant reports on each 200 ms tick, or every
// `reportEvery` ticks.
function runtime(options={}) {
 let now=0,goal=null,smart=false,ticks=0,live=null;
 const calls=[],player={name:'F',map:'main',x:1000,y:0,visible:true};
 const r=createMovementContext({root:{},Date:{now:()=>now},coordinatorClockOffset:0,character:{ctype:'merchant',map:'main',x:0,y:0},lastCommand:1,navigationIntent:{revision:1},runtimeCurrent:()=>true,
  eventMerchant:{anniversaryReserved:()=>false},get_player:()=>options.invisible?null:player,can_move_to:()=>!options.wall,reunionRealm:()=> 'USII',
  setTimeout:callback=>{now+=200;ticks++;if(options.tick)options.tick(r,player,ticks);
   if(options.stuck&&live&&ticks-live.since>=5){const stalled=live;live=null;stalled.reject(Error('Stalled walking movement (stopped short after its step was sent again)'));}
   if(goal&&!options.stuck&&!(r.smart&&r.smart.moving&&!r.smart.found)){const dx=goal.x-r.character.x,dy=goal.y-r.character.y,d=Math.hypot(dx,dy)||1;r.character.x+=dx/d*Math.min(60,d);r.character.y+=dy/d*Math.min(60,d);}
   if(ticks%(options.reportEvery||1)===0){r.reports=(r.reports||0)+1;r.reportSucceeded();}callback();},
  move:(x,y)=>{calls.push({kind:'move',x,y});goal={x,y};},
  smart_move:(destination,_callback,request)=>{calls.push({kind:'smart',...destination,at:now,request:request&&request.request&&request.request.kind,native:!!(request&&request.native)});smart=true;goal=destination;if(options.smartMove)return options.smartMove(r,destination,request);
   const key=JSON.stringify([destination.map,destination.x,destination.y]);
   if(!live||live.key!==key){const next={key,since:ticks};next.promise=new Promise((_,reject)=>{next.reject=reject;});next.promise.catch(()=>{});live=next;}
   return live.promise;},
  stop:async kind=>{calls.push({kind:'stop',type:kind});if(kind==='smart'&&smart||kind==='move'){goal=null;live=null;}smart=false;},
  request:async()=>({targetStatus:{...player,seenAt:now,server:'USII'}}),anniversaryWithTimeout:async promise=>promise,
  send_item:async(name,slot,q)=>calls.push({kind:'send',name,slot,q}),
  // The owner's pass is one 200 ms tick of this clock.
  nextPass:()=>new Promise(resolve=>r.setTimeout(resolve)),
 });
 installErrandWalk(r);
 // The items owner's bag reads answer a merchant's wait for a player with the errand walk's meet
 // (bag.ts `waitForPlayer`), and shared.js's `merchantSendItem` is the items owner's market send,
 // which meets the player before the game's send_item (market.ts `send`).
 const {waitForPlayer}=createBagReads({character:()=>r.character,now:()=>now,meet:(name,timeout)=>r.meet(name,timeout)});
 r.waitForPlayer=waitForPlayer;
 r.merchantSendItem=marketHarness({character:r.character,reads:{waitForPlayer},game:{sendItem:(name,slot,quantity)=>r.send_item(name,slot,quantity)}}).market.send;
 // The rendezvous is the job owner's (visits.ts); the errand walk's `meet` carries the route.
 require('../helpers/merchant-visits.cjs').installVisits(r);
 return {r,player,calls};
}
module.exports = { runtime };
