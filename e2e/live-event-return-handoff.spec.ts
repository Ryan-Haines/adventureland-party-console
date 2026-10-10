import {test,expect} from './live-fixtures';

const W='E2EWarrior',P='E2EPriest',fighters=[W,P];
const checkpoint={map:'halloween',x:-550,y:-290};
test.use({initialPosition:checkpoint});

for(const variant of ['leaving Green','following a Pumpkin leader','restoring a held Green return','interrupting a checkpoint return'] as const){
  test(`active event return hands off when ${variant}`,async({live},info)=>{
    test.setTimeout(360_000);
    // Failure inventory: docs/testing-event-return-handoff.md. Initial native
    // monsters are declared inputs; damage, commands and return arrival are real.
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await live.post('/travel',checkpoint);
    await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>
      s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:90_000}).toBe(true);
    const seeds=await live.admin(`output=(()=>{const result={};for(const [type,x,y] of [['mrgreen',-495,650],['mrpumpkin',-495,685]]){
      const original=G.monsters[type];try{G.monsters[type]={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};
        const m=new_monster('halloween',{type,count:1,boundary:[x,y,x,y]},{temp:1});result[type]={id:String(m.id),map:m.map,x:m.x,y:m.y,original};
        E[type]={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};}catch(error){G.monsters[type]=original;throw error;}}
      broadcast_e();return result;})()`);
    const samples:any[]=[];
    const hits=async(name:string,event:string,after=0)=>(await live.clients[name].events()).some(packet=>
      packet.event==='hit'&&String(packet.data?.id)===seeds[event].id&&packet.data?.hid===name&&packet.data?.damage>0&&packet.at>=after);
    try{
      if(variant!=='following a Pumpkin leader'){
        await live.post('/formation',{character:W,eventSelections:['mrgreen']});
        await expect.poll(async()=>Promise.all(fighters.map(name=>hits(name,'mrgreen'))).then(values=>values.every(Boolean)),{timeout:120_000}).toBe(true);
      }else{
        await live.post('/formation',{character:P,follow:false,eventSelections:['mrgreen']});
        await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
        await expect.poll(async()=>await hits(W,'mrpumpkin')&&await hits(P,'mrgreen'),{timeout:120_000}).toBe(true);
      }
      const transitionAt=Date.now();
      const beforeTransition=await live.state();
      // Following captures the leader's current location as the new destination.
      const checkpoints=Object.fromEntries(fighters.map(name=>[name,variant==='following a Pumpkin leader'&&name===P?
        {map:beforeTransition.characters[W].map,x:beforeTransition.characters[W].x,y:beforeTransition.characters[W].y}:checkpoint]));
      if(variant==='restoring a held Green return'||variant==='interrupting a checkpoint return'){
        // Declare the persisted failure state, never a successful exit or hit.
        // Its dispatched timestamp must not strand an empty recovery.
        await live.restoreHistoricalSettings(settings=>{
          const profile=settings.farmingProfiles[W];
          const waypoints=Object.fromEntries(fighters.map(name=>[name,{revision:settings.navigationIntents?.[name]?.revision||0,location:checkpoint}]));
          const recovery={cycleId:'historical-active-green-return',event:'mrgreen',participants:fighters,pending:fighters,
            startedAt:Date.now(),phase:'evacuating',checkpoint,waypoints,deferred:[],
            ...(variant==='restoring a held Green return'?{returnDispatchedAt:Date.now()}:{})};
          return {eventReturn:recovery,activeConvoy:null,farmingProfiles:{...settings.farmingProfiles,[W]:{...profile,eventReturn:recovery,activeConvoy:null}},
            eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:variant==='restoring a held Green return'?['mrgreen']:[]}};
        });
        if(variant==='restoring a held Green return'){
          // A globally live but disabled Pumpkin must not release this return.
          await expect.poll(async()=>{const s=await live.state();return fighters.every(name=>
            s.characters[name]?.seenAt>transitionAt&&s.eventReturn?.participants?.includes(name));},{timeout:15_000}).toBe(true);
        }else{
          // Wait for actual Town exits and an admitted native checkpoint convoy.
          await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.purpose==='event-return'&&
            fighters.every(name=>s.activeConvoy.participants.includes(name));},{timeout:60_000}).toBe(true);
          await info.attach('active-checkpoint-return-before-handoff',{body:JSON.stringify(await live.state()),contentType:'application/json'});
        }
        await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      }else if(variant==='leaving Green') await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      else await live.post('/formation',{character:P,follow:true});
      await expect.poll(async()=>{
        const s=await live.state(),damaged=await Promise.all(fighters.map(name=>hits(name,'mrpumpkin',transitionAt)));
        samples.push({at:Date.now(),return:s.eventReturn,profiles:s.farmingProfiles,commands:s.pendingCommands,
          characters:Object.fromEntries(fighters.map(name=>[name,{map:s.characters[name]?.map,event:s.characters[name]?.joinedEvent}]))});
        if(samples.length>64)samples.shift();
        return damaged.every(Boolean)&&fighters.every(name=>!s.eventReturn?.participants?.includes(name))&&
          !Object.values(s.farmingProfiles||{}).some((profile:any)=>profile.eventReturn?.participants?.some((name:string)=>fighters.includes(name)));
      },{timeout:120_000,message:'Both native fighters must damage Pumpkin without an active return holding either member'}).toBe(true);
      const fighting=await live.state();
      await info.attach('active-return-handoff-combat',{body:JSON.stringify({variant,seeds,checkpoints,samples,state:fighting,events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&fighters.every(name=>
        s.characters[name]?.map===checkpoints[name].map&&!s.characters[name]?.joinedEvent&&Math.hypot(s.characters[name].x-checkpoints[name].x,s.characters[name].y-checkpoints[name].y)<100);},{timeout:150_000,message:'After Pumpkin attendance, both fighters must actually return to their saved navigation checkpoint'}).toBe(true);
    }finally{
      await info.attach('active-return-handoff-final',{body:JSON.stringify({variant,samples,state:await live.state(),events:await Promise.all(fighters.map(name=>live.clients[name].events()))}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      await live.post('/formation',{character:P,eventSelections:[]}).catch(()=>{});
      await live.admin(`output=(()=>{const seeds=${JSON.stringify(seeds)};for(const type of ['mrgreen','mrpumpkin']){for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.type===type&&m.hp>1000000)remove_monster(m,{silent:true});G.monsters[type]=seeds[type].original;delete E[type];}broadcast_e();return true;})()`);
    }
  });
}
