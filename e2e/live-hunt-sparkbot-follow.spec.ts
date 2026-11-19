import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';
import {observeNativeTransport} from './native-transport-observer';
import {test,expect} from './live-fixtures';
import {W,P,nativeHit,approachOwned} from './hunt-interruption-helpers';
const M='E2EBankBoi',fighters=[W,P,M];
// All roles begin at the same admitted native-clear position.
const leaderPoint={x:-344.13,y:-437.24};
const starts={
 [W]:{map:'uhills',...leaderPoint},[P]:{map:'uhills',...leaderPoint},
 [M]:{map:'uhills',x:-344.13,y:-437.24},E2EMerchant:{map:'main',x:-63,y:100},
};
test.use({loadout:'combat-follow-range',extraFighter:'mage',initialPositions:starts,initialConsoleHold:false});
const wallRangeStarts=starts;
for(const scene of [{monster:'sparkbot',wallRange:false},{monster:'goo',wallRange:false},{monster:'goo',wallRange:true},{monster:'goo',wallRange:false,queue:true}])test.describe(scene.wallRange?'native wall range readiness':scene.monster,()=>{
 const monster=scene.monster,positions=scene.wallRange?wallRangeStarts:starts,targetPosition=scene.wallRange?[-167,-596]:[-597,-184];
 test.use({initialPositions:positions});
 const queue='queue' in scene&&scene.queue;
 test(queue?'planned roaming Goo advances two queued targets with fresh native confirmation':scene.wallRange?'planned Goo ranged fighters confirm native range through a blocked terrain ray':monster==='sparkbot'?'planned Sparkbot approach independently routes each fighter into native attack range':'planned Goo approach holds every fighter until fresh native range confirmation',async({live},info)=>{
 test.setTimeout(240000);
 await live.post('/merchant/force-stand',{enabled:true});await live.post('/focus',{monsterFocus:[]});
 const samples:any[]=[],configured:any[]=[],events:Record<string,any[]>={};let seed:any,releasedAt:number|undefined,transport:Awaited<ReturnType<typeof observeNativeTransport>>|undefined;
 await live.admin(`output=(globalThis.__e2eFollowOwnedMonsters=[],true)`);
 try{
  await isolateNativeMapAmbient(live,'uhills');
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;p.__e2eIndependentObservedAttackCount=0;p.__e2eIndependentObservedTargets={};});
  await live.post('/formation',{leader:W});for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
  await live.post('/focus',{monsterFocus:[monster],monsterPriorities:{[monster]:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await expect.poll(async()=>{
   const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const s=globalThis.sharedRoutine,g=globalThis.__partyGroupedCombat,focus=globalThis.partyHunting?.farm.focus().slice(),nomination=globalThis.__partyNomination?.focus;return {name:character.name,grouped:!!globalThis.partyHunting?.farm.grouped(),leader:s?.targeting.isLeader()===${name===W},groupLeader:g?.leader===${JSON.stringify(W)},members:${JSON.stringify(fighters)}.every(n=>g?.members?.includes(n)),independent:g?.independentApproach===true,focus,nomination,focusReady:!!focus?.includes(${JSON.stringify(monster)}),nominationReady:!nomination||nomination.includes(${JSON.stringify(monster)})};})()`)));
   configured.push({at:Date.now(),roles});if(configured.length>32)configured.splice(4,1);
   return roles.every(r=>r.grouped&&r.leader&&r.groupLeader&&r.members&&r.independent&&r.focusReady&&r.nominationReady);
  },{timeout:15000,message:'Actual CODE must adopt both configured group and focus before the declared setup hold'}).toBe(true);
  live.consoleDrainLease('native-range-setup');
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>state.characters[name]?.consoleMaintenance?.id==='native-range-setup'&&state.characters[name].consoleMaintenance.ready);},{timeout:15000}).toBe(true);
  seed=await live.admin(`output=(()=>{
   const original=G.monsters[${JSON.stringify(monster)}];globalThis.__e2eFollowOriginal=original;G.monsters[${JSON.stringify(monster)}]={...original,stationary:true};
   const m=new_monster('uhills',{__e2eAmbientExempt:true,type:${JSON.stringify(monster)},count:1,position:${JSON.stringify(targetPosition)},radius:0},{temp:1});
   __e2eFollowOwnedMonsters.push({id:String(m.id),type:m.type,map:m.map,instance:m.in});
   if(!${'queue' in scene&&!!scene.queue}){m.speed=0;m.moving=false;}
   const observableCombatSeconds=20,partyDps=${JSON.stringify(fighters)}.map(get_player).reduce((sum,p)=>sum+Math.max(1,p.attack)*Math.max(0.1,p.frequency),0);
   m.target=null;m.hp=m.max_hp=${'queue' in scene&&!!scene.queue}?Math.ceil(partyDps*observableCombatSeconds):10000000;m.u=true;m.abs=true;m.cid++;
   const successors=[];
   if(!can_move({...m,going_x:m.x,going_y:m.y}))throw Error('Actual primary spawn is not native-clear');
   return {id:String(m.id),x:m.x,y:m.y,map:m.map,speed:m.speed,aggro:original.aggro,hp:m.hp,partyDps,observableCombatSeconds,at:Date.now(),successors};})()`);
  await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(`!!parent.entities[${JSON.stringify(seed.id)}]`))),{timeout:15000}).toEqual([true,true,true]);
  const staging=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{
   const c=character,e=parent.entities[${JSON.stringify(seed.id)}],body=v=>({map:v.map,in:v.in,x:v.real_x??v.x,y:v.real_y??v.y,awidth:v.awidth??(v.width||0)/(v.mscale||1),aheight:v.aheight??(v.height||0)/(v.mscale||1)});
   const self=body(c),enemy=body(e),goal={...self,...${JSON.stringify(leaderPoint)}};
   return {name:c.name,range:c.range,position:self,enemy,gap:distance(goal,enemy),safety:Math.min(e.range,Math.max(6,c.range-24))+8,goalClear:can_move({map:c.map,x:goal.x,y:goal.y,going_x:goal.x,going_y:goal.y,base:c.base})};})()`)));
  await info.attach('native-sparkbot-follow-staging',{body:JSON.stringify({starts:positions,seed,staging}),contentType:'application/json'});
  expect(staging.every(v=>v.goalClear)).toBe(true);
  if(scene.wallRange){
   const geometry=await Promise.all([P,M].map(name=>live.clients[name].run(`(()=>{const e=parent.entities[${JSON.stringify(seed.id)}];return {name:character.name,range:character.range,inRange:is_in_range(e),sight:can_move_to(e.x,e.y),position:{x:character.real_x,y:character.real_y}};})()`)));
   await info.attach('native-independent-wall-range-precondition',{body:JSON.stringify(geometry),contentType:'application/json'});
   expect(geometry.every(v=>v.inRange&&!v.sight),'Actual casters must be in native attack range while terrain blocks movement to the monster').toBe(true);
  }
  const heldSelection=async()=>{
   const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const g=globalThis.__partyGroupedCombat,n=globalThis.__partyNomination,e=parent.entities[${JSON.stringify(seed.id)}],h=globalThis.__partyConsoleMaintenance;return {name:character.name,selected:g?.target?.id===${JSON.stringify(seed.id)}&&!!g?.selection,group:{selection:g?.selection,target:g?.target,committed:g?.committed,independent:g?.independentApproach,reason:g?.reason,members:g?.members},nomination:n&&{focus:n.focus,blocked:n.blocked,eligible:n.eligible,rejected:n.rejected,revision:n.revision},entity:e&&{id:e.id,map:e.map,in:e.in,x:e.real_x??e.x,y:e.real_y??e.y,hp:e.hp,visible:e.visible,dead:e.dead,moving:e.moving,speed:e.speed,going_x:e.going_x,going_y:e.going_y,inRange:is_in_range(e),target:e.target},hold:h&&{id:h.id,mode:h.mode,phase:h.phase},socket:parent.socket?.connected};})()`)));
   configured.push({at:Date.now(),phase:'held-selection',roles});if(configured.length>32)configured.splice(4,1);
   return roles;
  };
  await expect.poll(async()=>(await heldSelection()).map(r=>r.selected),{timeout:15000,message:'All clients must select the declared target before movement setup'}).toEqual([true,true,true]);
  if(queue){
   expect(seed.aggro||0).toBe(0);expect(seed.speed).toBeGreaterThan(0);
   // Declare the encounter's first leg only after setup is acknowledged. Native
   // movement, packets, interception and subsequent random roaming remain real.
   seed.movement=await live.admin(`output=(()=>{
    const m=instances.uhills.monsters[${JSON.stringify(seed.id)}];
    if(!m||m.dead||m.target||!m.temp)throw Error('Declared held Goo is no longer available');
    const players=${JSON.stringify(fighters)}.map(get_player),candidates=[];
    for(const length of [120,100,80])for(let i=0;i<32;i++){
     const x=m.x+Math.cos(i*Math.PI/16)*length,y=m.y+Math.sin(i*Math.PI/16)*length;
     if(can_move({...m,going_x:x,going_y:y})&&players.every(p=>distance(p,{...m,x,y})>p.range+30))candidates.push({x,y,length});
    }
    const destination=candidates[0];if(!destination)throw Error('No native-clear out-of-range Goo movement leg');
    G.monsters.goo=__e2eFollowOriginal;m.map_def.radius=40;
    m.going_x=destination.x;m.going_y=destination.y;start_moving_element(m);
    return {at:Date.now(),from:{x:m.x,y:m.y},destination,speed:m.speed,duration:destination.length/m.speed};
   })()`);
   await expect.poll(async()=>(await heldSelection()).map(r=>r.selected&&r.entity?.moving&&r.entity.inRange===false&&r.entity.speed>0&&
    Math.hypot(r.entity.going_x-r.entity.x,r.entity.going_y-r.entity.y)/r.entity.speed>=4),
   {timeout:15000,message:'Held selection must include a real moving native leg before testing predictive interception'}).toEqual([true,true,true]);
  }
  if(monster==='sparkbot')transport=await observeNativeTransport(live.clients[W].page);
  releasedAt=Date.now();live.consoleDrainLease(null);
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>!state.characters[name]?.consoleMaintenance);},{timeout:15000,message:'The actual ordered host lease release must reach all fighters'}).toBe(true);
  await expect.poll(async()=>{
   const state=await live.state();samples.push({at:Date.now(),roles:fighters.map(name=>({name,x:state.characters[name]?.x,y:state.characters[name]?.y,position:state.characters[name]?.combat?.positioning,recovery:state.characters[name]?.groupedCombat?.formationRecovery}))});
   for(const name of fighters)events[name]=await live.clients[name].events();
   return fighters.every(name=>events[name].some(e=>nativeHit(e,name,seed.id)));
  },{timeout:90000,message:'All three native roles must recover and damage the declared Sparkbot'}).toBe(true);
  if(monster==='goo'){
   const firstAttack=fighters.flatMap(name=>events[name].filter(e=>e.event==='attack-issued'&&e.data?.id===seed.id || e.event==='offensive-skill-issued'&&(e.data?.ids?.includes(seed.id)||!e.data?.ids?.length&&e.motion?.independent?.target===seed.id))).sort((a,b)=>a.at-b.at)[0];
   expect(firstAttack,'Actual outgoing native attack or hostile skill evidence must exist').toBeTruthy();
   const barrier=firstAttack.motion?.independent;
   expect(barrier?.committed).toBe(true);expect(barrier?.target).toBe(seed.id);
   expect(barrier.confirmation?.selection).toBe(barrier.selection);expect(barrier.confirmation?.target).toBe(seed.id);
   expect(firstAttack.motion.inRange).toBe(true);
   expect(barrier.serverAt).toBeLessThan(barrier.confirmation.expiresAt);
   for(const name of fighters){const ready=barrier?.ready?.[name];
    expect(ready?.selection).toBe(barrier.selection);expect(ready?.target).toBe(seed.id);expect(ready?.ready).toBe(true);
    expect(barrier.serverAt-ready.at).toBeGreaterThanOrEqual(-500);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(1000);
    expect(ready.confirmation).toBe(barrier.confirmation?.id);
    expect(ready.at).toBeGreaterThanOrEqual(barrier.confirmation.startedAt);}
   if(scene.wallRange)for(const name of [P,M])expect(events[name].some(e=>e.event==='move-issued'&&e.at<=firstAttack.at&&e.motion?.position?.target===seed.id&&e.motion?.position?.movementOwner==='combat-approach'),'An already range-ready caster must not acquire an approach before the first confirmed attack').toBe(false);
   await info.attach('native-independent-all-ready-before-first-attack',{body:JSON.stringify(firstAttack),contentType:'application/json'});
  }
  if(queue){
   seed.successors=await live.admin(`output=(()=>{const primary=instances.uhills.monsters[${JSON.stringify(seed.id)}];if(!primary||!(primary.hp>0)||primary.dead)throw Error('Declared primary is no longer alive before successor seeding');const successors=[];for(const dx of [-24,-48]){let x=primary.x+dx,y=primary.y,centerFallback=false;if(!can_move({map:primary.map,x,y,going_x:x,going_y:y,base:primary.base})){x=primary.x;y=primary.y;centerFallback=true;if(!can_move({...primary,going_x:x,going_y:y}))throw Error('Current native primary center is not clear for successor declaration');}const next=new_monster('uhills',{__e2eAmbientExempt:true,type:'goo',count:1,position:[x,y],radius:40},{temp:1});__e2eFollowOwnedMonsters.push({id:String(next.id),type:next.type,map:next.map,instance:next.in});next.hp=next.max_hp=10000000;next.u=true;next.abs=true;next.cid++;if(!can_move({...next,going_x:next.x,going_y:next.y}))throw Error('Actual roaming successor spawn is not native-clear');successors.push({id:String(next.id),x:next.x,y:next.y,center:{x,y},centerFallback});}return successors;})()`);
   const queued=seed.successors.map((m:any)=>m.id);
   // An issued attack or hostile skill aimed at one of the queued successors.
   const attacksQueued=(e:any)=>(e.event==='attack-issued'||e.event==='offensive-skill-issued')&&(queued.includes(e.data?.id)||e.data?.ids?.some((id:string)=>queued.includes(id))||queued.includes(e.motion?.independent?.target));
   await expect.poll(async()=>{for(const name of fighters)events[name]=await live.clients[name].events();samples.push({at:Date.now(),queue:await live.clients[W].run(`(()=>{const g=globalThis.__partyGroupedCombat,e=parent.entities[${JSON.stringify(seed.id)}];return {target:g?.target?.id,ids:g?.queue?.map(t=>t.id),primaryAlive:!!e&&e.hp>0&&!e.dead};})()`)});return events[W].some(e=>e.event==='death'&&String(e.data?.id)===seed.id)&&fighters.some(name=>events[name].some(attacksQueued));},{timeout:90000,message:'Real native first Goo death must advance to an initially queued successor'}).toBe(true);
   expect(samples.some(s=>s.queue?.target===seed.id&&s.queue.primaryAlive&&queued.every((id:string)=>s.queue.ids?.includes(id))),'Both actual successors must be observed queued while the first native primary is alive').toBe(true);
   const attack=fighters.flatMap(name=>events[name]).filter(attacksQueued).sort((a,b)=>a.at-b.at)[0],barrier=attack.motion?.independent;
   expect(attack.motion.inRange).toBe(true);expect(barrier?.committed).toBe(true);expect(queued).toContain(barrier?.target);
   expect(attack.motion.attackTarget?.id).toBe(barrier.target);
   expect(barrier.confirmation?.target).toBe(barrier.target);expect(barrier.serverAt).toBeLessThan(barrier.confirmation.expiresAt);
   for(const name of fighters){const ready=barrier.ready[name];expect(ready.confirmation).toBe(barrier.confirmation.id);expect(ready.selection).toBe(barrier.selection);expect(ready.target).toBe(barrier.target);expect(ready.ready).toBe(true);expect(ready.at).toBeGreaterThanOrEqual(barrier.confirmation.startedAt);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(1000);}
   await info.attach('native-queued-successor-confirmation',{body:JSON.stringify({seed,attack}),contentType:'application/json'});
   const firstMoves=new Map<string,any>();
   for(const name of fighters)for(const event of events[name].filter(e=>e.event==='move-issued')){const r=event.motion?.independentRoute;
    if(r?.id&&!firstMoves.has(name+':'+r.id))firstMoves.set(name+':'+r.id,{name,event});}
   const candidates=[...firstMoves.values()].filter(({event})=>{const r=event.motion?.independentRoute,t=r?.nativeTarget,input=r?.prediction;
    return r?.direct===true&&r.id===event.motion?.position?.approachId&&r.target===t?.id&&t.moving&&t.inRange===false&&Math.hypot(t.going_x-t.x,t.going_y-t.y)>0.000001&&input?.targetSpeed>0&&
      Math.hypot(input.destination.x-t.going_x,input.destination.y-t.going_y)<0.01&&Math.abs(input.targetSpeed-t.speed)<0.01;
   }).sort((a,b)=>a.event.at-b.event.at);
   const first=candidates[0];
   await info.attach('native-moving-target-issued-intercept',{body:JSON.stringify({candidates:candidates.slice(0,12),first}),contentType:'application/json'});
   expect(first,'A coherent first actual direct move must observe a genuinely moving native target outside attack range').toBeTruthy();
   const route=first.event.motion.independentRoute,input=route.prediction,point=route.point,native=route.nativeTarget;
   const dx=input.destination.x-input.target.x,dy=input.destination.y-input.target.y,leg=Math.hypot(dx,dy),px=point.x-input.target.x,py=point.y-input.target.y;
   expect(input.ownSpeed).toBeGreaterThan(0);expect(input.horizon).toBeGreaterThan(0);expect(input.horizon,'The prediction ends with the target leg').toBeLessThanOrEqual(leg/input.targetSpeed+0.000001);
   expect((px*dx+py*dy)/leg,'The actually issued center must lead along its immutable native motion input').toBeGreaterThan(0.000001);
   expect(Math.abs(px*dy-py*dx)/leg).toBeLessThanOrEqual(0.000001);
   expect(Math.hypot(px,py)).toBeLessThanOrEqual(leg+0.000001);
   expect(Math.abs(Math.hypot(px,py)-input.targetSpeed*input.horizon)).toBeLessThanOrEqual(0.000001);
   expect(first.event.at-input.at,'Issued inputs and actual native packet share the native clock').toBeGreaterThanOrEqual(0);
   expect(((point.x-native.x)*dx+(point.y-native.y)*dy)/leg,'The issued center must still lead the actual moving monster at its first packet').toBeGreaterThan(0);

  }
  for(const name of scene.wallRange?[]:[P,M]){
   const firstHit=events[name].find(e=>nativeHit(e,name,seed.id));
   const ownedMove=events[name].find(e=>e.event==='move-issued'&&e.at<=firstHit.at&&e.motion?.position?.target===seed.id&&
    approachOwned(e.motion.position)&&Math.hypot(e.data.going_x-e.data.x,e.data.going_y-e.data.y)>1);
   expect(ownedMove,'Caster must independently move under the matching owned approach before its first native damage').toBeTruthy();
   expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.sequence>ownedMove.sequence&&e.at<=firstHit.at&&
    Math.hypot(e.data.x-ownedMove.data.x,e.data.y-ownedMove.data.y)>1),'Actual socket displacement must follow the owned recovery move').toBe(true);
  }
  for(const name of scene.wallRange?[]:[P,M])expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='uhills'&&Math.hypot(e.data.x-positions[name as typeof P|typeof M].x,e.data.y-positions[name as typeof P|typeof M].y)>20)).toBe(true);
  for(const name of fighters){const moves=events[name].filter(e=>e.event==='move-issued');if(!scene.wallRange)expect(moves.length).toBeGreaterThan(0);expect(moves.every(e=>e.motion?.clear===true)).toBe(true);expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);}
 }finally{
  try{
  if(transport)await info.attach('native-sparkbot-http-transport',{body:JSON.stringify(await transport.finish()),contentType:'application/json'});
  await info.attach('native-sparkbot-follow-result',{body:JSON.stringify({seed,releasedAt,configured,samples,events}),contentType:'application/json'});
  }finally{
  live.consoleDrainLease(null);
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;}).catch(()=>{});
  try{
  await live.admin(`output=(()=>{for(const entry of globalThis.__e2eFollowOwnedMonsters||[]){const m=instances[entry.instance||entry.map]?.monsters?.[entry.id];if(m&&m.temp&&m.type===entry.type&&m.map===entry.map&&m.in===(entry.instance||entry.map))remove_monster(m,{method:'disappear'});}delete globalThis.__e2eFollowOwnedMonsters;if(globalThis.__e2eFollowOriginal)G.monsters[${JSON.stringify(monster)}]=__e2eFollowOriginal;return true;})()`);
  }finally{const ambient=await restoreNativeMapAmbient(live,true);await info.attach('native-ambient-isolation-restored',{body:JSON.stringify(ambient),contentType:'application/json'});}
  }
 }
});

});
