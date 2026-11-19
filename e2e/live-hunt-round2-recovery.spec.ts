import {test,expect} from './live-fixtures';
import {anniversaryStatusFaultSource} from './anniversary-status-fault';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {W,P,M,world,beginAnniversary,endAnniversary} from './game/hunt-events';

test.describe('native escape requested membership',()=>{
  test.use({initialPosition:{map:'main',x:200,y:-120}});
  for(const metadata of ['missing'] as const)test(`native escape retains both members with ${metadata} role metadata`,async({live},info)=>{
    test.setTimeout(120_000);
    // Failure inventory is recorded before the implementation in
    // docs/testing-escape-membership.md. Only coordinator metadata is faulted;
    // the native classes, movement and server arrival remain genuine.
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    const context=live.clients[W].page.context();
    await context.route('**/party-api/status',async route=>{
      const body=route.request().postDataJSON();
      if(body?.name===P){if(metadata==='missing')delete body.ctype;else body.ctype='warrior';}
      await route.continue({postData:JSON.stringify(body)});
    });
    const positions:any[]=[];let admission:any;
    try{
      // Let the real coordinator observe the declared metadata before admission.
      await expect.poll(async()=>{const s=(await live.state()).characters[P];return metadata==='missing'?!s?.ctype:s?.ctype==='warrior';},{timeout:15_000}).toBe(true);
      admission=await live.post('/escape',{});
      expect(admission.escape.participants).toEqual(expect.arrayContaining([W,P]));
      if(metadata==='missing'){
        const before=await live.state();
        // Historical persisted omission, not a fabricated gameplay outcome:
        // restore the old membership bug with unchanged native/navigation state.
        // The recovery records the target mode, as runtime/coordinator/survival/recovery.ts `capture` does
        // so the seed stays current.
        await live.restoreHistoricalSettings(settings=>{
          const recovery={id:'declared-historical-membership-death',names:[W,P],leader:W,
            policy:settings.targetMode,focus:JSON.stringify(before.monsterFocus),
            revisions:Object.fromEntries([W,P].map(name=>[name,settings.navigationIntents[name].revision])),
            phase:'recovering',at:Date.now(),deaths:[],reason:'Declared persisted omission'};
          return {escape:{...settings.escape,participants:[W],stage:'failed-hold'},combatRecovery:recovery,
            farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles[W],combatRecovery:recovery}}};
        });
      }else await live.restartCoordinator();
      // The escape walks to the safe table's death goal it was admitted with (Main's spawn 5 here).
      const home=admission.escape.home;
      expect(home?.goal).toBe('death');
      await expect.poll(async()=>{const native=await world(live);positions.push({at:Date.now(),players:native.players});return [W,P].every(name=>{const p=native.players[name];return p&&!p.rip&&p.map===home.map&&Math.hypot(p.x-home.x,p.y-home.y)<=home.radius;});},{timeout:60_000,intervals:[500]}).toBe(true);
    }finally{
      await info.attach('native-escape-requested-membership',{body:JSON.stringify({metadata,admission,positions,final:await live.state(),native:await world(live),events:{[W]:await live.clients[W].events(),[P]:await live.clients[P].events()}}),contentType:'application/json'});
      await context.unrouteAll({behavior:'ignoreErrors'});
    }
  });
});

test.describe('native collateral convoy defense',()=>{
  test.use({initialPosition:{map:'main',x:0,y:0}});
  for(const partyTarget of [false,true])test(`native Targetron splash ${partyTarget?'preserves party defense':'does not stop an outsider convoy pass'}`,async({live},info)=>{
    test.setTimeout(180_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    await live.post('/merchant/stand-location',{map:'main',x:0,y:0});
    await expect.poll(()=>live.clients[M].run('Math.hypot(character.real_x,character.real_y)'),{timeout:45_000}).toBeLessThan(4);
    await expect.poll(()=>live.clients[W].run(`!parent.party_list.includes('${M}')`),{timeout:15_000}).toBe(true);
    // Lose the readiness transport while the real client has installed its
    // owner. This gives the native explosion a stationary initial window;
    // readiness and actual movement are restored immediately after its receipt.
    let holdReady=true;
    const context=live.clients[W].page.context();
    await context.route('**/party-api/status',async route=>{
      const body=route.request().postDataJSON();
      if(holdReady&&body?.name===W&&body.convoyNavigation?.routeReady)return route.abort('failed');
      return route.continue();
    });
    const samples:any[]=[];let monster:any;
    const destination=await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const x=100*Math.cos(i*Math.PI/8),y=100*Math.sin(i*Math.PI/8);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No native clear convoy endpoint');})()`);
    expect(await live.clients[P].run(`can_move_to(${destination.x},${destination.y})`),'The same native endpoint must be clear for the Priest footprint').toBe(true);
    try{
      await live.post('/travel',destination);
      await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.participants?.includes(W)&&['shared-prepare','shared-travel','travel'].includes(s.activeConvoy.phase);},{timeout:30_000}).toBe(true);
      // The route above drops each report of the warrior's that carries routeReady, and the
      // warrior's first report of the walk can already carry it, so the coordinator may never hear
      // its convoy. The warrior's own client names the walk it runs.
      await expect.poll(async()=>{const s=await live.state(),own=await live.clients[W].run('partyMovement.convoyNavigationReport()?.id??null');return !!s.activeConvoy&&own===s.activeConvoy.id;},{timeout:15_000}).toBe(true);
      monster=await live.admin(`output=(()=>{const p=get_player('${W}'),original=G.monsters.targetron;try{
        G.monsters.targetron={...original,hp:1000000,attack:1000,speed:0,charge:0,aggro:0,range:200};
        const m=new_monster(p.in,{type:'targetron',count:1,boundary:[p.x+40,p.y,p.x+41,p.y+1]},{temp:1});
        // Every later recalculation (target_player, a condition: node/server.js
        // calculate_monster_stats) reads zone_stats before the catalog, so the seed keeps its
        // declared attack, frequency and speed for the whole case.
        m.zone_stats={...G.monsters.targetron};
        target_player(m,get_player('${partyTarget?W:M}'));return {id:m.id,type:m.type,instance:p.in,target:m.target??null,map:m.map,x:m.x,y:m.y,explosion:m.explosion,
          peaceful:!!m.peaceful,dead:!!m.dead,conditions:Object.keys(m.s||{}),zoneActor:!!m.zone_actor};
      }finally{G.monsters.targetron=original;}})()`);
      // The seed's own precondition: the declared Targetron attacks its declared target.
      expect(monster.target,'The seeded Targetron must target '+(partyTarget?W:M)+': '+JSON.stringify(monster)).toBe(partyTarget?W:M);
      // Each poll also records the seed's own state and where W and M stand, so a case that
      // sees no hit names whom the Targetron attacked and from where.
      const seedTrace:any[]=[];
      try{
        await expect.poll(async()=>{
          seedTrace.push(await live.admin(`output=(()=>{const m=instances[${JSON.stringify(monster.instance)}]?.monsters?.[${JSON.stringify(monster.id)}],w=get_player('${W}'),mm=get_player('${M}');
            return {at:Date.now(),seed:m?{target:m.target||null,x:m.x,y:m.y,speed:m.speed,attack:m.attack,frequency:m.frequency,moving:!!m.moving}:null,W:w&&{x:w.x,y:w.y,moving:!!w.moving},M:mm&&{x:mm.x,y:mm.y}};})()`));
          const hits=(await live.clients[W].events()).filter((e:any)=>e.event==='hit'&&String(e.data?.hid)===String(monster.id)&&e.data?.id===W&&e.data?.damage>0);
          return partyTarget?hits.length:hits.filter((e:any)=>e.data.splash===true).length;},{timeout:30_000}).toBeGreaterThan(0);
      }finally{await info.attach('native-targetron-seed-trace',{body:JSON.stringify(seedTrace),contentType:'application/json'});}
      holdReady=false;
      await expect.poll(async()=>{const state=await live.state(),native=await world(live);samples.push({at:Date.now(),convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,epoch:state.activeConvoy.epoch},players:Object.fromEntries([W,P].map(n=>[n,{map:native.players[n].map,x:native.players[n].x,y:native.players[n].y}]))});
        return partyTarget?[W,P].some(n=>state.characters[n]?.convoyNavigation?.defenseTargets?.some((t:any)=>String(t.id)===String(monster.id))):[W,P].every(n=>native.players[n].map===destination.map&&Math.hypot(native.players[n].x-destination.x,native.players[n].y-destination.y)<=25);
      },{timeout:60_000}).toBe(true);
    }finally{
      holdReady=false;
      await context.unrouteAll({behavior:'ignoreErrors'});
      try{
        await info.attach('native-targetron-collateral-ownership',{body:JSON.stringify({partyTarget,destination,monster,samples,native:await world(live),state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
      }finally{
        if(monster)await live.admin(`output=(()=>{const seed=${JSON.stringify(monster)},m=instances[seed.instance]?.monsters?.[seed.id];if(m&&m.type===seed.type&&m.map===seed.map)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
      }
    }
  });
});

test.describe('native arrival connector recovery',()=>{
  test.use({initialPosition:{map:'main',x:200,y:-120}});
  for(const dropped of ['first','all'] as const)test(`native Town connector ${dropped} submission loss preserves arrival and deadline`,async({live},info)=>{
    test.setTimeout(120_000);
    // Failure inventory: lost connector never resent; repeated sends extend
    // transition timeout; retry collides or issues after cancellation.
    await live.clients[W].run(`(()=>{
      const socket=parent.socket,nativeMove=globalThis.move;
      const fault=globalThis.__e2eConnector={submissions:[],landedAt:null,landing:null,startedAt:Date.now(),done:null};
      const arrival=()=>{fault.landedAt=Date.now();fault.landing={map:character.map,x:character.real_x,y:character.real_y};};socket.on('new_map',arrival);
      // Drop before native move's optimistic prediction; server/client positions
      // and native packet handlers remain untouched throughout the fault.
      globalThis.move=function(x,y){
        if(fault.landedAt&&Math.hypot(x-character.real_x,y-character.real_y)>1){
          const drop=${JSON.stringify(dropped)}==='all'||fault.submissions.length===0;
          fault.submissions.push({at:Date.now(),drop,from:{map:character.map,x:character.real_x,y:character.real_y},target:{x,y}});
          if(drop)return new Promise(()=>{});
        }return nativeMove.call(globalThis,x,y);
      };
      fault.restore=()=>{globalThis.move=nativeMove;socket.off('new_map',arrival);};
      __partyMovement.move({map:'main',x:0,y:0},undefined,{relocation:'town',arrivalTolerance:1})
        .then(()=>{fault.done={ok:true,at:Date.now()};},error=>{fault.done={ok:false,error:String(error.reason||error.message||error),at:Date.now()};});
      return true;})()`);
    const nativeSamples:any[]=[];
    const nativePosition=()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y,moving:!!p.moving};})()`);
    try {
      await expect.poll(async()=>{nativeSamples.push({at:Date.now(),position:await nativePosition()});return live.clients[W].run('globalThis.__e2eConnector.done');},{timeout:35_000,intervals:[250]}).toBeTruthy();
      const proof=await live.clients[W].run(`({done:__e2eConnector.done,submissions:__e2eConnector.submissions,landing:__e2eConnector.landing,landedAt:__e2eConnector.landedAt,startedAt:__e2eConnector.startedAt,last:__partyMovement.last(),position:{map:character.map,x:character.real_x,y:character.real_y}})`);
      expect(proof.submissions.length).toBeGreaterThanOrEqual(2);
      expect(proof.submissions[0].drop).toBe(true);
      expect(proof.submissions[1].at-proof.submissions[0].at).toBeGreaterThanOrEqual(950);
      if(dropped==='first'){
        expect(proof.done.ok).toBe(true);expect(Math.hypot(proof.position.x,proof.position.y)).toBeLessThanOrEqual(1);
        await expect.poll(()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return Math.hypot(p.x,p.y);})()`),{timeout:5000}).toBeLessThanOrEqual(1);
      }else{
        expect(proof.done.ok).toBe(false);expect(proof.done.error).toContain('town warp');
        expect(proof.done.at-proof.startedAt).toBeLessThan(18_000);
      }
    }finally{
      const proof=await live.clients[W].run(`({done:__e2eConnector.done,submissions:__e2eConnector.submissions,landing:__e2eConnector.landing,landedAt:__e2eConnector.landedAt,startedAt:__e2eConnector.startedAt,last:__partyMovement.last(),position:{map:character.map,x:character.real_x,y:character.real_y}})`);
      await info.attach('native-connector-submission-loss-ledger',{body:JSON.stringify({dropped,proof,nativeSamples,nativePosition:await nativePosition(),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.clients[W].run('__e2eConnector.restore()');
    }
  });
});

test.describe('native Anniversary staging recovery',()=>{
test.use({initialPosition:{map:'main',x:200,y:-120}});
test('native Anniversary staging survives an old-round slice without repeated Town warps',async({live},info)=>{
  test.setTimeout(240_000);
  // Historical stock/schedule read-boundary fixtures only; real Town calls,
  // walking, native live-round kiss and reward are observed unchanged.
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  await live.admin(`output=(()=>{const p=get_player('${W}');p.items[20]={name:'slice_strawberry',q:1};resend(p,'u+cid');return true;})()`);
  await live.post('/command',{character:M,type:'bank'});
  await expect.poll(async()=>(await world(live)).players[M].map,{timeout:60_000}).toBe('bank');
  const next=Date.now()+50_000;
  const faultOwners=Object.keys(live.clients);
  const installed:Record<string,any>={};
  const readFaults=async()=>{
    const observations:Record<string,any>={};
    for(const name of faultOwners)observations[name]=await live.clients[name].run('globalThis.__e2eAnniversaryStatusFault');
    return observations;
  };
  const disableFaults=async()=>{
    for(const name of Object.keys(installed))await live.clients[name].run('if(globalThis.__e2eAnniversaryStatusFault)globalThis.__e2eAnniversaryStatusFault.enabled=false');
  };
  const samples:any[]=[];
  try{
  await live.admin(`output=(()=>{
    const original=broadcast_e;globalThis.__e2eStagingBroadcast=original;
    broadcast_e=function(dontSend){if(dontSend)return;broadcast('server_info',{...E,anniversary:{live:false,next:${next},target:'${P}',available:true}});};
    globalThis.__e2eStagingTimer=setInterval(()=>broadcast_e(),500);broadcast_e();return true;})()`);
    for(const name of faultOwners)installed[name]=await live.clients[name].run(anniversaryStatusFaultSource(W,M));
  await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await expect.poll(async()=>{const p=(await world(live)).players[W];return p.map==='main'&&Math.hypot(p.x,p.y)<=100;},{timeout:60_000}).toBe(true);
    const faults=await readFaults();
    for(const name of faultOwners){
      expect(faults[name]?.count,`${name}: actual historical status JSON was transformed`).toBeGreaterThan(0);
      expect(faults[name]?.generation).toBe(installed[name].generation);
    }
    const started=Date.now();
    await expect.poll(async()=>{const native=await world(live);samples.push({at:Date.now(),players:native.players});
      expect(Math.hypot(native.players[W].x,native.players[W].y)).toBeLessThanOrEqual(110);
      return Date.now()-started>=30_000;},{timeout:40_000,intervals:[1000]}).toBe(true);
    // Player packets repeat the remaining cast condition; a late echo is not
    // a newly issued Town. Native CIDs fence duplicates/out-of-order echoes.
    const castStarts:any[]=[];let remaining=0,lastCid=-Infinity;
    for(const packet of await live.clients[W].events()){
      if(packet.event!=='player')continue;
      const data=packet.data||{},cid=Number(data.cid);
      if(Number.isFinite(cid)){if(cid<lastCid)continue;lastCid=cid;}
      if(!Object.prototype.hasOwnProperty.call(data,'c'))continue;
      const nextRemaining=Number(data.c?.town?.ms)||0;
      if(nextRemaining>0&&(remaining===0||nextRemaining>remaining+250))castStarts.push(packet);
      remaining=nextRemaining;
    }
    const casts=castStarts.filter(packet=>packet.at>=started);
    expect(casts.length).toBe(0);
    await disableFaults();
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;output=true');
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>(await world(live)).players[W].conditions.anniversary_kiss,{timeout:90_000}).toBeTruthy();
    await info.attach('native-anniversary-staging-history',{body:JSON.stringify({next,installed,faults,samples,casts,seed,final:await world(live),state:await live.state()}),contentType:'application/json'});
  }finally{await disableFaults();
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);if(globalThis.__e2eStagingBroadcast){broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;}output=true');
    await live.post('/formation',{character:W,eventSelections:[]});await endAnniversary(live);}
});
});
