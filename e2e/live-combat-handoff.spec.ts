import {test,expect} from './live-fixtures';
import {W,M,spawnGoo,seedCargo,totalLeather,evidence} from './hunt-interruption-helpers';

test('bag-only native merchant collection finishes while the fighter keeps fighting',async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await seedCargo(live);
  const total=await totalLeather(live),monster=await spawnGoo(live,W,300);
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  const hits=async()=> (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(monster.id)&&event.data?.hid===W&&event.data?.damage>0);
  await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0);
  const before=await live.clients[W].snapshot(),initialHits=(await hits()).length;
  await live.post('/bank-party',{group:W});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(M)})?.items.some(i=>i?.name==='leather'&&i.q>=7)`),{timeout:90000}).toBe(true);
  const during=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),m=instances[p.in].monsters[${JSON.stringify(monster.id)}];return {monster:m&&{id:m.id,hp:m.hp},fighter:{x:p.x,y:p.y,hp:p.hp},merchant:get_player(${JSON.stringify(M)}).items}})()`);
  expect(during.monster?.hp).toBeGreaterThan(0);
  await expect.poll(async()=>(await hits()).length,{timeout:15000}).toBeGreaterThan(initialHits);
  expect(await totalLeather(live)).toBe(total);
  await expect.poll(async()=>(await live.state()).merchantMarked?.[W]?.length??0,{timeout:30000}).toBe(0);
  await evidence(live,info,'native-bag-handoff-mid-combat',{monster,before,during,total,hits:await hits()});
  await info.attach('native-combat-handoff-client',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
});

// The collection's sends wait on the call budget with no cap of their own: the wait ends on the game's
// call-cost reading, and the budget gates every send (user decision 2026-11-17).
test('native collection sends wait while the call-cost window is held, then all transfer',async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await seedCargo(live);
  const total=await totalLeather(live),monster=await spawnGoo(live,W,300);
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  const hits=async()=> (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(monster.id)&&event.data?.hid===W&&event.data?.damage>0);
  await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0);
  // Declared observation fault: hold only the fighter's call-cost reading, the `cc` of each player
  // packet, which the call budget reads (runtime/characters/call-budget.ts `onPlayer`). Native
  // attack/send handlers and server call-cost accounting remain active. The held reading sits past
  // the job band's limit, which is at most the call limit less the 12 survival room
  // (call-budget-limits.ts `bandLimits`), and under the survival band's, so sends wait and attacks go.
  const receipts:any[]=[];
  const receiptRoute=async(route:import('@playwright/test').Route)=>{
    receipts.push(route.request().postDataJSON());await route.continue();
  };
  const HELD=190;
  try{
    const fault=await live.clients[W].run(`(()=>{
      const socket=parent.socket,onevent=socket.onevent;globalThis.__e2eHoldHandoffCost=true;
      socket.onevent=function(packet){
        const [event,data]=packet.data||[];
        if(globalThis.__e2eHoldHandoffCost&&event==='player'&&data&&Number.isFinite(data.cc))data.cc=${HELD};
        return onevent.call(socket,packet);
      };
      globalThis.__e2eRestoreHandoffCost=()=>{
        globalThis.__e2eHoldHandoffCost=false;socket.onevent=onevent;
        delete globalThis.__e2eRestoreHandoffCost;
      };
      return {held:${HELD},before:character.cc};
    })()`);
    await expect.poll(()=>live.clients[W].run('character.cc')).toBe(HELD);
    await info.attach('native-handoff-cost-observation-fault',{body:JSON.stringify(fault),contentType:'application/json'});
    await live.clients[W].page.route('**/party-api/merchant/handoff-complete',receiptRoute);
  await live.post('/bank-party',{group:W});
  await live.post('/merchant/force-stand',{enabled:false});
  // The merchant reaches the fighter's send range (the send handler's `B.dist`), so only the held
  // budget keeps the sends back.
  await expect.poll(()=>live.admin(`output=(()=>{const w=get_player(${JSON.stringify(W)}),m=get_player(${JSON.stringify(M)});
    return !!w&&!!m&&w.in===m.in&&Math.hypot(w.x-m.x,w.y-m.y)<=B.dist;})()`),{timeout:90000}).toBe(true);
  // The fighter's own next hits are the clock: game calls go on while every send waits.
  const heldHits=(await hits()).length;
  await expect.poll(async()=>(await hits()).length,{timeout:30000}).toBeGreaterThan(heldHits+1);
  expect(await live.admin(`output=get_player(${JSON.stringify(W)}).items.some(i=>i?.name==='leather')`),'no send while the call cost is held').toBe(true);
  expect(receipts,'no receipt while the sends wait').toEqual([]);
  expect((await live.state()).merchantMarked[W].length).toBeGreaterThan(0);
  expect(await totalLeather(live)).toBe(total);
  await live.clients[W].run('globalThis.__e2eRestoreHandoffCost?.()');
  await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(W)}).items.some(i=>i?.name==='leather')`),{timeout:90000}).toBe(false);
  await expect.poll(()=>receipts.length,{timeout:30000}).toBeGreaterThan(0);
  expect(receipts.filter(receipt=>receipt.partial),'the waiting sends all transfer').toEqual([]);
  await expect.poll(async()=>(await live.state()).merchantMarked?.[W]?.length??0,{timeout:30000}).toBe(0);
  expect(await totalLeather(live)).toBe(total);
  await evidence(live,info,'native-handoff-sends-wait-then-transfer',{monster,total,receipts,hits:await hits()});
  }finally{
    try{await live.clients[W].page.unroute('**/party-api/merchant/handoff-complete',receiptRoute);}
    finally{await live.clients[W].run('globalThis.__e2eRestoreHandoffCost?.()');}
  }
});
