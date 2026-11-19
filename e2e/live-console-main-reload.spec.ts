import {test,expect,reloadCode} from './live-fixtures';
import {W,P,M,evidence} from './hunt-interruption-helpers';
test.use({loadout:'god',initialPosition:{map:'forest',x:300,y:100}});
test('Main reload parks fighters, preserves the merchant position and restores the saved farm checkpoint',async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:[],monsterPriorities:{},monsterSearchRadius:300});await live.post('/checkpoint',{});
  const before=await live.clients[W].snapshot(),merchant=await live.clients[M].snapshot(),samples:any[]=[];
  try{
    live.consoleDrainLease('main-reload',Date.now()+180000,{loadMode:'main',phase:'moving-main'});
    await expect.poll(async()=>{const state=await live.state();samples.push({at:Date.now(),characters:Object.fromEntries([W,P,M].map(n=>[n,{map:state.characters[n]?.map,maintenance:state.characters[n]?.consoleMaintenance}]))});return [W,P].every(n=>state.characters[n]?.map==='main'&&state.characters[n]?.consoleMaintenance?.ready);},{timeout:90000}).toBe(true);
    expect((await live.clients[M].snapshot()).map).toBe(merchant.map);
    const runtime=(await live.state()).characters[W].dashboardRuntime;
    await reloadCode(live,W);
    await expect.poll(async()=>{const report=(await live.state()).characters[W];return report?.dashboardRuntime!==runtime&&report?.consoleMaintenance?.id==='main-reload';},{timeout:30000}).toBe(true);
    live.consoleDrainLease(null);
    await expect.poll(async()=>{const position=await live.clients[W].snapshot();return position.map===before.map&&Math.hypot(position.x-before.x,position.y-before.y)<30;},{timeout:120000}).toBe(true);
    expect((await live.clients[M].snapshot()).map).toBe(merchant.map);
    await info.attach('main-reload-restored',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
  }finally{live.consoleDrainLease(null);await evidence(live,info,'main-reload-checkpoints',{before,merchant,samples});}
});
