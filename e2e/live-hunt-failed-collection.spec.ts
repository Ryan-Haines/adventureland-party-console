import {test,expect} from './live-fixtures';
import {W,P,M,fighters,seedCargo,totalLeather,evidence,observed,quantity} from './hunt-interruption-helpers';

test('failed convoy permits native collection without restarting exhausted travel',async({live},info)=>{
  test.setTimeout(240000);
  // Failure inventory: docs/testing-failed-convoy-collection.md. Only the
  // historical failure is declared; stop acknowledgements and sends are native.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await seedCargo(live,W);
  await seedCargo(live,P);
  const total=await totalLeather(live),failure='Declared exhausted native travel';
  await live.post('/travel',{map:'main',x:700,y:0});
  await expect.poll(async()=>!!(await live.state()).activeConvoy,{timeout:15000}).toBe(true);
  const convoy=structuredClone((await live.state()).activeConvoy);
  await live.restoreHistoricalSettings(settings=>{
    const failed={...convoy,phase:'failed',failure,failureCode:'route-failed',retryExhausted:true,
      purpose:'shared-walk',label:'event walking leg',walkingActivity:'event',walkingEvent:'mrgreen',
      walkingParents:Object.fromEntries(fighters.map(name=>[name,{revision:convoy.expected[name].revision,parentId:0}])),
      recoveryAttempts:3,failedAt:Date.now(),departAt:null};
    return {activeConvoy:failed,farmingProfiles:{...settings.farmingProfiles,
      [W]:{...settings.farmingProfiles[W],activeConvoy:failed}}};
  });
  await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.phase==='failed'&&
    fighters.every(name=>s.characters[name]?.seenAt>Date.now()-3000&&!s.characters[name]?.moving);},{timeout:20000}).toBe(true);
  await evidence(live,info,'failed-convoy-before-collection',{total,convoy});
  await live.post('/bank-party',{group:W});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{const players=await observed(live);return fighters.every(name=>quantity(players[name].items,'leather')===0);},
    {timeout:90000,message:'Both native marked stacks must transfer despite exhausted travel'}).toBe(true);
  await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.activeConvoy?.merchantInterruption;},{timeout:90000}).toBe(true);
  const state=await live.state();
  expect(state.activeConvoy.phase).toBe('failed');
  expect(state.activeConvoy.failure).toBe(failure);
  expect(state.activeConvoy.failureCode).toBe('route-failed');
  expect(state.activeConvoy.recoveryAttempts).toBe(3);
  expect(state.activeConvoy.retryExhausted).toBe(true);
  expect(state.activeConvoy.location).toEqual(convoy.location);
  expect(await totalLeather(live)).toBe(total);
  expect(state.merchantActivity.filter((entry:any)=>entry.level==='error'&&String(entry.details).includes('convoy merchant pause'))).toEqual([]);
  await live.restartCoordinator();
  const restarted=await live.state();
  expect(restarted.activeConvoy.phase).toBe('failed');
  expect(restarted.activeConvoy.failure).toBe(failure);
  expect(restarted.activeConvoy.retryExhausted).toBe(true);
  expect(await totalLeather(live)).toBe(total);
  await evidence(live,info,'failed-convoy-collected-and-restarted',{total,events:await Promise.all([W,P,M].map(name=>live.clients[name].events()))});
});
