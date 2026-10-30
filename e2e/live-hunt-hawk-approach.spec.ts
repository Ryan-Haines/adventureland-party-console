import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';
import {test,expect} from './live-fixtures';
import {W,P} from './hunt-interruption-helpers';
const M='E2EBankBoi',fighters=[W,P,M];
// Co-located native-clear declaration prevents setup regroup from carrying actors across the obstacle.
const leaderPoint={x:1400,y:-150};
const starts={
 [W]:{map:'main',...leaderPoint},[P]:{map:'main',...leaderPoint},
 [M]:{map:'main',...leaderPoint},E2EMerchant:{map:'main',x:-63,y:100},
};
const ringProbe=`(e)=>{const c=character,origin={x:c.real_x,y:c.real_y},clear=(a,b)=>can_move({map:c.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:c.base}),length=Math.hypot(c.x-e.x,c.y-e.y),corrected=globalThis.sharedRoutine?.correctedCombatDistance?.(e),attackDistance=typeof corrected==='number'?corrected:distance(c,e),padding=Math.max(0,length-attackDistance),radius=Math.max(1,c.range-10)+padding,angle=Math.atan2(origin.y-e.y,origin.x-e.x);
 const ring=r=>Array.from({length:16},(_,i)=>({x:e.x+Math.cos(angle+i*Math.PI/8)*r,y:e.y+Math.sin(angle+i*Math.PI/8)*r})).filter(p=>clear(p,p)).map(p=>({...p,direct:clear(origin,p),distance:Math.hypot(p.x-origin.x,p.y-origin.y)})).sort((a,b)=>a.distance-b.distance);
 return {name:c.name,range:c.range,position:origin,nativeMoving:!!c.moving,activeJourney:globalThis.__partyMovement?.report?.()?.id,body:{width:get_width(c),height:get_height(c)},centerDistance:length,vision:c.vision||parent.character.vision,base:c.base,speed:c.speed,radius,padding,corrected,attackDistance,enemy:{id:e.id,type:e.type,mtype:e.mtype,map:e.map,in:e.in,x:e.x,y:e.y,real_x:e.real_x,real_y:e.real_y,width:get_width(e),height:get_height(e),rawWidth:e.width,rawHeight:e.height,awidth:e.awidth,aheight:e.aheight,mscale:e.mscale},ring:ring(radius),half:ring(Math.max(1,c.range-10)/2+padding),goalClear:clear(origin,origin),directToEnemy:clear(origin,e)};}`;

test.use({loadout:'combat-follow-range',extraFighter:'mage',initialPositions:starts,initialConsoleHold:false});
const monster='bigbird',positions=starts;
for(const scene of [{name:'direct alternate',target:[1140,240],direct:true},{name:'all blocked ring',target:[1280,300],direct:false}]){
test(`planned Main hawks recover ranged actors from disconnected approach ring points: ${scene.name}`,async({live},info)=>{
 test.setTimeout(240000);
 await live.post('/merchant/force-stand',{enabled:true});await live.post('/focus',{monsterFocus:[]});
 const samples:any[]=[],configured:any[]=[],events:Record<string,any[]>={};let seed:any,releasedAt:number|undefined;
 await live.admin(`output=(globalThis.__e2eFollowOwnedMonsters=[],true)`);
 try{
  await isolateNativeMapAmbient(live,'main');
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;p.__e2eIndependentObservedAttackCount=0;p.__e2eIndependentObservedTargets={};});
  await live.post('/formation',{leader:W});for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
  // A manual waypoint preserves this geometry when focus changes; a catalog
  // farming waypoint would legitimately schedule an unrelated farm relocation.
  await live.post('/travel',{map:'main',...leaderPoint});
  await expect.poll(async()=>{
    const state=await live.state();
    return !state.activeConvoy&&fighters.every(name=>Math.hypot(state.characters[name]?.x-leaderPoint.x,state.characters[name]?.y-leaderPoint.y)<4);
  },{timeout:45000,message:'The manual native geometry waypoint must be acknowledged before focus selection'}).toBe(true);
  await live.post('/focus',{character:W,monsterFocus:[monster],monsterPriorities:{[monster]:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await expect.poll(async()=>{
   const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const s=globalThis.sharedRoutine,g=globalThis.__partyGroupedCombat,focus=s?.getMonsterFocus?.(),nomination=globalThis.__partyNomination?.focus;return {name:character.name,grouped:!!s?.usesGroupedCombat(),leader:s?.isLeader()===${name===W},groupLeader:g?.leader===${JSON.stringify(W)},members:${JSON.stringify(fighters)}.every(n=>g?.members?.includes(n)),independent:g?.independentApproach===true,focus,nomination,focusReady:!!focus?.includes(${JSON.stringify(monster)}),nominationReady:!nomination||nomination.includes(${JSON.stringify(monster)})};})()`)));
   configured.push({at:Date.now(),roles});if(configured.length>32)configured.splice(4,1);
   return roles.every(r=>r.grouped&&r.leader&&r.groupLeader&&r.members&&r.independent&&r.focusReady&&r.nominationReady);
  },{timeout:15000,message:'Actual CODE must adopt both configured group and focus before the declared setup hold'}).toBe(true);
  live.consoleDrainLease('native-range-setup');
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>state.characters[name]?.consoleMaintenance?.id==='native-range-setup'&&state.characters[name].consoleMaintenance.ready);},{timeout:15000}).toBe(true);
  // Measure each client's actual native-rendered body; a Steam sprite clone is not a headless body.
  const calibration=await live.admin(`output=(()=>{const original=G.monsters.bigbird;globalThis.__e2eFollowOriginal=original;G.monsters.bigbird={...original,aggro:0,rage:0,stationary:true,charge:0};const w=get_player('${W}'),point=[[32,0],[0,32],[-32,0],[0,-32]].map(([dx,dy])=>({x:w.x+dx,y:w.y+dy})).find(p=>can_move({...w,going_x:p.x,going_y:p.y}));if(!point)throw Error('No nearby native-clear calibration input');const m=new_monster('main',{__e2eAmbientExempt:true,type:'bigbird',count:1,position:[point.x,point.y],radius:0},{temp:1});__e2eFollowOwnedMonsters.push({id:String(m.id),type:m.type,map:m.map,instance:m.in});m.speed=0;m.moving=false;m.hp=m.max_hp=1000000;m.u=true;m.abs=true;m.cid++;return {id:String(m.id),point};})()`);
  const calibrationBodies:Record<string,any>={};
  try{for(const name of fighters){await expect.poll(()=>live.clients[name].run(`!!get_entity(${JSON.stringify(calibration.id)})`),{timeout:15000}).toBe(true);
    calibrationBodies[name]=await live.clients[name].run(`(()=>{const e=get_entity(${JSON.stringify(calibration.id)}),c=character;return {actor:{name:c.name,x:c.x,y:c.y,real_x:c.real_x,real_y:c.real_y,range:c.range,width:get_width(c),height:get_height(c),vision:c.vision||parent.character.vision},body:{type:e.type,mtype:e.mtype,map:e.map,in:e.in,width:get_width(e),height:get_height(e)},raw:{width:e.width,height:e.height,awidth:e.awidth,aheight:e.aheight,mscale:e.mscale}};})()`);
  }}finally{try{await info.attach('native-main-hawk-body-calibration',{body:JSON.stringify({calibration,calibrationBodies}),contentType:'application/json'});}finally{await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(calibration.id)}];if(m&&m.temp&&m.type==='bigbird'&&m.map==='main'&&m.in==='main')remove_monster(m,{method:'disappear'});return true;})()`);}}
  // Choose declared inputs from current native geometry, never move an admitted actor.
  const geometryChoices=await Promise.all([P,M].map(name=>live.clients[name].run(`(()=>{const probe=(${ringProbe}),body=${JSON.stringify(calibrationBodies[name].body)},choices=[];for(let x=1100;x<=1580;x+=20)for(let y=160;y<=336;y+=20){const e={...body,id:'declaration-only',x,y},r=probe(e),vision=r.vision;if(!r.goalClear||!vision||Math.abs(x-r.position.x)>=vision[0]-5||Math.abs(y-r.position.y)>=vision[1]-5||r.attackDistance<=r.range+20||r.directToEnemy||!r.ring.length||r.ring[0].direct||r.ring.some(p=>p.direct)!==${scene.direct})continue;choices.push(r);}return {name:character.name,body,vision:character.vision||parent.character.vision,choices};})()`)));
  const stateBeforeSeed=await live.state(),declarations:any[]=[];let declaration:any;
  const candidates=geometryChoices[0].choices.filter((r:any)=>geometryChoices[1].choices.some((v:any)=>v.enemy.x===r.enemy.x&&v.enemy.y===r.enemy.y)).sort((a:any,b:any)=>Math.hypot(a.enemy.x-scene.target[0],a.enemy.y-scene.target[1])-Math.hypot(b.enemy.x-scene.target[0],b.enemy.y-scene.target[1])).slice(0,8);
  try{for(const candidate of candidates){const target={x:candidate.enemy.x,y:candidate.enemy.y};const roles=geometryChoices.map(group=>group.choices.find((r:any)=>r.enemy.x===target.x&&r.enemy.y===target.y));
    const proofs=await Promise.all(roles.map(async(role:any)=>{const request={character:role.name,id:'native-hawk-declaration-'+role.name,from:{map:'main',in:'main',...role.position},speed:role.speed,town:false,base:role.base,...stateBeforeSeed.characters[role.name].movementGeometry};
      const [closest,center]=await Promise.all([live.post('/movement-plan',{...request,to:{map:'main',in:'main',x:role.ring[0].x,y:role.ring[0].y}}),live.post('/movement-plan',{...request,id:request.id+'-center',to:{map:'main',in:'main',...target}})]);return {role,closest,center};}));
    declarations.push({target,proofs});if(proofs.every(p=>typeof p.closest.error==='string'&&p.closest.error.includes('no route')&&!p.center.error&&p.center.plot?.length)){declaration={target,proofs};break;}
  }
  expect(declaration,'Bounded actual-native scan must find the declared disconnected-ring geometry; never skip or weaken it').toBeTruthy();
  }finally{await info.attach('native-main-hawk-input-declaration',{body:JSON.stringify({scene,geometryChoices,candidates:candidates.map((r:any)=>r.enemy),declarations}),contentType:'application/json'});}
  const targetPosition=[declaration.target.x,declaration.target.y];
  seed=await live.admin(`output=(()=>{
   const original=globalThis.__e2eFollowOriginal;G.monsters[${JSON.stringify(monster)}]={...original,aggro:0,rage:0,stationary:true,charge:0};
   const m=new_monster('main',{__e2eAmbientExempt:true,type:${JSON.stringify(monster)},count:1,position:${JSON.stringify(targetPosition)},radius:0},{temp:1});
   __e2eFollowOwnedMonsters.push({id:String(m.id),type:m.type,map:m.map,instance:m.in});
   // Native stat recalculation must retain this encounter's declared zero speed.
   m.zone_stats={...G.monsters.bigbird,speed:0};m.speed=0;m.moving=false;
   const observableCombatSeconds=20,partyDps=${JSON.stringify(fighters)}.map(get_player).reduce((sum,p)=>sum+Math.max(1,p.attack)*Math.max(0.1,p.frequency),0);
   m.target=null;m.hp=m.max_hp=Math.ceil(partyDps*observableCombatSeconds);m.u=true;m.abs=true;m.cid++;
   const successors=[];
   if(!can_move({...m,going_x:m.x,going_y:m.y}))throw Error('Actual primary spawn is not native-clear');
   return {id:String(m.id),x:m.x,y:m.y,map:m.map,speed:m.speed,aggro:G.monsters[${JSON.stringify(monster)}].aggro,hp:m.hp,partyDps,observableCombatSeconds,at:Date.now(),successors};})()`);
  await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const e=get_entity(${JSON.stringify(seed.id)});return !!e&&e.visible&&!e.dead;})()`))),{timeout:15000,message:'The declared primary must be genuinely visible in all three native clients'}).toEqual([true,true,true]);
  const enemyBodies=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const e=get_entity(${JSON.stringify(seed.id)});return {name:character.name,id:e.id,width:get_width(e),height:get_height(e),rawWidth:e.width,rawHeight:e.height,awidth:e.awidth,aheight:e.aheight,mscale:e.mscale};})()`)));
  const staging=await Promise.all(fighters.map(name=>live.clients[name].run(`(${ringProbe})(get_entity(${JSON.stringify(seed.id)}))`)));
  for(const role of staging){expect(role.nativeMoving).toBe(false);expect(role.activeJourney,'Setup must not retain a movement journey that could bypass independent approach').toBeUndefined();}
  const state=await live.state(),plans:any[]=[];
  try{for(const role of staging.filter(v=>v.name!==W)){
    expect(Math.abs(role.enemy.x-role.position.x)).toBeLessThan(role.vision[0]);expect(Math.abs(role.enemy.y-role.position.y)).toBeLessThan(role.vision[1]);
    expect(role.attackDistance).toBeGreaterThan(role.range+20);
    expect(role.goalClear).toBe(true);expect(role.directToEnemy).toBe(false);
    expect(role.ring[0].direct,'The closest self-clear range point must be blocked by terrain').toBe(false);
    expect(role.ring.some((p:any)=>p.direct)).toBe(scene.direct);
    const identity=state.characters[role.name].movementGeometry,request={character:role.name,id:'native-hawk-setup-'+role.name,from:{map:'main',in:'main',...role.position},speed:role.speed,town:false,base:role.base,...identity};
    const closest=await live.post('/movement-plan',{...request,to:{map:'main',in:'main',x:role.ring[0].x,y:role.ring[0].y}});
    expect(closest.error,'The nearest self-clear point must actually be unreachable by the maintained planner').toContain('no route');
    const center=await live.post('/movement-plan',{...request,id:request.id+'-center',to:{map:'main',in:'main',x:seed.x,y:seed.y}});
    expect(center.error,'The actual native hawk center must remain connected').toBeUndefined();expect(center.plot?.length).toBeGreaterThan(0);
    plans.push({name:role.name,request,closest,center});
  }}finally{await info.attach('native-main-hawk-staging',{body:JSON.stringify({starts:positions,seed,enemyBodies,staging,plans}),contentType:'application/json'});}
  expect(seed.aggro).toBe(0);expect(seed.speed).toBe(0);
  releasedAt=Date.now();live.consoleDrainLease(null);
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>!state.characters[name]?.consoleMaintenance);},{timeout:Math.min(15000,Math.max(1,releasedAt+30000-Date.now())),message:'The actual ordered host lease release must reach all fighters'}).toBe(true);
  await expect.poll(async()=>{
   const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const g=globalThis.__partyGroupedCombat,n=globalThis.__partyNomination,e=parent.entities[${JSON.stringify(seed.id)}],h=globalThis.__partyConsoleMaintenance;return {name:character.name,selected:g?.target?.id===${JSON.stringify(seed.id)}&&!!g?.selection,group:{selection:g?.selection,target:g?.target,committed:g?.committed,independent:g?.independentApproach,reason:g?.reason,members:g?.members},nomination:n&&{focus:n.focus,blocked:n.blocked,eligible:n.eligible,rejected:n.rejected,revision:n.revision},entity:e&&{id:e.id,map:e.map,in:e.in,x:e.real_x??e.x,y:e.real_y??e.y,hp:e.hp,visible:e.visible,dead:e.dead,moving:e.moving,target:e.target},hold:h&&{id:h.id,mode:h.mode,phase:h.phase},socket:parent.socket?.connected};})()`)));
   configured.push({at:Date.now(),phase:'released-selection',roles});if(configured.length>32)configured.splice(4,1);
   return roles.map(r=>r.selected);
  },{timeout:Math.min(15000,Math.max(1,releasedAt+30000-Date.now()))}).toEqual([true,true,true]);
  await expect.poll(async()=>{
   const state=await live.state();samples.push({at:Date.now(),roles:fighters.map(name=>({name,x:state.characters[name]?.x,y:state.characters[name]?.y,position:state.characters[name]?.combat?.positioning,recovery:state.characters[name]?.groupedCombat?.formationRecovery}))});
   for(const name of fighters)events[name]=await live.clients[name].events();
   return fighters.every(name=>events[name].some(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt'));
  },{timeout:Math.max(1,releasedAt+30000-Date.now()),message:'All three native roles must recover and damage the declared Main hawk within30 seconds'}).toBe(true);
  for(const name of fighters){const hit=events[name].find(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt');expect(hit.at-releasedAt,'Each actual first native hit must arrive within30 seconds of release').toBeLessThanOrEqual(30000);}
  {
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
   await info.attach('native-independent-all-ready-before-first-attack',{body:JSON.stringify(firstAttack),contentType:'application/json'});
  }
  {
   seed.successors=await live.admin(`output=(()=>{G.monsters[${JSON.stringify(monster)}]={...__e2eFollowOriginal,aggro:0,rage:0,charge:0};const primary=instances.main.monsters[${JSON.stringify(seed.id)}];if(!primary||!(primary.hp>0)||primary.dead)throw Error('Declared primary is no longer alive before successor seeding');const successors=[];for(const dx of [-24,-48]){const radius=40,visions=${JSON.stringify(Object.fromEntries(staging.map((role:any)=>[role.name,role.vision])))},people=${JSON.stringify(fighters)}.map(name=>({name,player:get_player(name),vision:visions[name]}));
    const offsets=[[dx,0],[24,0],[48,0],[72,0],[0,24],[0,-24],[-24,0],[-48,0],[48,24],[48,-24],[72,24],[72,-24],[96,0],[0,48],[0,-48],[-72,0]];
    let checks=0;const candidate=offsets.map(([ox,oy])=>({x:primary.x+ox,y:primary.y+oy})).find(point=>{if(successors.some(entry=>entry.center.x===point.x&&entry.center.y===point.y))return false;
      if(!people.every(({player:p,vision})=>p&&p.map===primary.map&&p.in===primary.in&&Array.isArray(vision)&&Math.abs(point.x-p.x)+radius<vision[0]&&Math.abs(point.y-p.y)+radius<vision[1]))return false;
      if(!can_move({...primary,going_x:point.x,going_y:point.y}))return false;
      for(let oy=-radius;oy<=radius;oy++){checks++;if(!can_move({map:primary.map,x:point.x-radius,y:point.y+oy,going_x:point.x+radius,going_y:point.y+oy,base:primary.base}))return false;}return true;});
    if(!candidate)throw Error('No collision-clear, connected and mutually visible native roaming declaration');const {x,y}=candidate,centerFallback=false;
const next=new_monster('main',{__e2eAmbientExempt:true,type:'bigbird',count:1,position:[x,y],radius:40},{temp:1});__e2eFollowOwnedMonsters.push({id:String(next.id),type:next.type,map:next.map,instance:next.in});next.hp=next.max_hp=10000000;next.u=true;next.abs=true;next.cid++;if(!can_move({...next,going_x:next.x,going_y:next.y}))throw Error('Actual roaming successor spawn is not native-clear');if(!can_move({map:primary.map,x,y,going_x:next.x,going_y:next.y,base:next.base}))throw Error('Declared safe roaming region did not contain the actual native spawn');successors.push({id:String(next.id),x:next.x,y:next.y,center:{x,y},centerFallback,radius,checks,visibility:people.map(({name,player:p,vision})=>({name,x:p.x,y:p.y,vision}))});}return successors;})()`);
   const queued=seed.successors.map((m:any)=>m.id);
   await expect.poll(async()=>{for(const name of fighters)events[name]=await live.clients[name].events();samples.push({at:Date.now(),queue:await live.clients[W].run(`(()=>{const g=globalThis.__partyGroupedCombat,e=parent.entities[${JSON.stringify(seed.id)}];return {target:g?.target?.id,ids:g?.queue?.map(t=>t.id),primaryAlive:!!e&&e.hp>0&&!e.dead};})()`)});return events[W].some(e=>e.event==='death'&&String(e.data?.id)===seed.id)&&fighters.some(name=>events[name].some(e=>(e.event==='attack-issued'||e.event==='offensive-skill-issued')&&(queued.includes(e.data?.id)||e.data?.ids?.some((id:string)=>queued.includes(id))||queued.includes(e.motion?.independent?.target))));},{timeout:90000,message:'Real native first hawk death must advance to an initially queued successor'}).toBe(true);
   expect(samples.some(s=>s.queue?.target===seed.id&&s.queue.primaryAlive&&queued.every((id:string)=>s.queue.ids?.includes(id))),'Both actual successors must be observed queued while the first native primary is alive').toBe(true);
   const attack=fighters.flatMap(name=>events[name]).filter(e=>(e.event==='attack-issued'||e.event==='offensive-skill-issued')&&(queued.includes(e.data?.id)||e.data?.ids?.some((id:string)=>queued.includes(id))||queued.includes(e.motion?.independent?.target))).sort((a,b)=>a.at-b.at)[0],barrier=attack.motion?.independent;
   expect(attack.motion.inRange).toBe(true);expect(barrier?.committed).toBe(true);expect(queued).toContain(barrier?.target);
   const origin=seed.successors.find((m:any)=>m.id===barrier.target);expect(attack.motion.attackTarget?.id).toBe(barrier.target);expect(Math.hypot(attack.motion.attackTarget.x-origin.x,attack.motion.attackTarget.y-origin.y),'The actual next target must move under native AI before its first hostile packet').toBeGreaterThan(5);
   expect(barrier.confirmation?.target).toBe(barrier.target);expect(barrier.serverAt).toBeLessThan(barrier.confirmation.expiresAt);
   for(const name of fighters){const ready=barrier.ready[name];expect(ready.confirmation).toBe(barrier.confirmation.id);expect(ready.selection).toBe(barrier.selection);expect(ready.target).toBe(barrier.target);expect(ready.ready).toBe(true);expect(ready.at).toBeGreaterThanOrEqual(barrier.confirmation.startedAt);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(1000);}
   await info.attach('native-queued-successor-confirmation',{body:JSON.stringify({seed,attack}),contentType:'application/json'});
  }
  for(const name of [P,M]){
   const firstHit=events[name].find(e=>e.event==='hit'&&e.data?.hid===name&&String(e.data?.id)===seed.id&&e.data?.damage>1&&e.data?.source!=='taunt');
   const ownedMove=events[name].find(e=>e.event==='move-issued'&&e.at<=firstHit.at&&e.motion?.position?.target===seed.id&&
    e.motion.position.mode==='independent-approach'&&e.motion.position.movementOwner==='combat-approach'&&
    e.motion.position.approachId&&e.motion.position.target===seed.id&&Math.hypot(e.data.going_x-e.data.x,e.data.going_y-e.data.y)>1);
   expect(ownedMove,'Caster must independently move under the matching owned approach before its first native damage').toBeTruthy();
   const nativeLevel=ownedMove.motion.independentRoute?.level;
   expect(Number.isInteger(nativeLevel)&&nativeLevel>=0,'The actual issued approach must declare its halving level').toBe(true);
   expect(ownedMove.motion.independentRoute.id).toBe(ownedMove.motion.position.approachId);
   const actualRange=staging.find((actor:any)=>actor.name===name).range;
   expect(ownedMove.motion.position.radius,'Issued approach radius must start ten units inside actual range, then halve').toBeCloseTo(Math.max(1,(actualRange-10)/2**nativeLevel),6);
   expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.sequence>ownedMove.sequence&&e.at<=firstHit.at&&
    Math.hypot(e.data.x-ownedMove.data.x,e.data.y-ownedMove.data.y)>1),'Actual socket displacement must follow the owned recovery move').toBe(true);
  }
  for(const name of [P,M])expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='main'&&Math.hypot(e.data.x-positions[name as typeof P|typeof M].x,e.data.y-positions[name as typeof P|typeof M].y)>20)).toBe(true);
  for(const name of fighters){const moves=events[name].filter(e=>e.event==='move-issued');expect(moves.length).toBeGreaterThan(0);expect(moves.every(e=>e.motion?.clear===true)).toBe(true);expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);}
 }finally{
  live.consoleDrainLease(null);
  try{await info.attach('native-main-hawk-approach-result',{body:JSON.stringify({seed,releasedAt,configured,samples,events}),contentType:'application/json'});}
  finally{
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;}).catch(()=>{});
  try{
  await live.admin(`output=(()=>{for(const entry of globalThis.__e2eFollowOwnedMonsters||[]){const m=instances[entry.instance||entry.map]?.monsters?.[entry.id];if(m&&m.temp&&m.type===entry.type&&m.map===entry.map&&m.in===(entry.instance||entry.map))remove_monster(m,{method:'disappear'});}delete globalThis.__e2eFollowOwnedMonsters;if(globalThis.__e2eFollowOriginal)G.monsters[${JSON.stringify(monster)}]=__e2eFollowOriginal;return true;})()`);
  }finally{const ambient=await restoreNativeMapAmbient(live,true);await info.attach('native-ambient-isolation-restored',{body:JSON.stringify(ambient),contentType:'application/json'});}
  }
 }
});
}
