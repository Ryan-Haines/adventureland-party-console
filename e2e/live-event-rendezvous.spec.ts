import {test,expect} from './live-fixtures';
import type {Route} from '@playwright/test';

const W='E2EWarrior',P='E2EPriest',names=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

async function seedPumpkin(live:any){
  return live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;
    globalThis.__rendezvousOriginalPumpkin=original;
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    E.mrpumpkin={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
}
async function clearPumpkin(live:any,seed:{id:string}){
  await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(String(m?.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});
    if(globalThis.__rendezvousOriginalPumpkin)G.monsters.mrpumpkin=globalThis.__rendezvousOriginalPumpkin;delete globalThis.__rendezvousOriginalPumpkin;delete E.mrpumpkin;broadcast_e();return true;})()`);
}

for(const fault of ['moved destination','silent member'] as const)
test(`event rendezvous starts with a ${fault}`,async({live},info)=>{
  test.setTimeout(420_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const seed=await seedPumpkin(live);
  const context=live.clients[W].page.context(),submissions:any[]=[];
  // Fixture faults target only the Priest's event walk to this boss.
  const fixture=async(route:Route)=>{
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body?.character!==P||body.activity!=='event'||body.key!=='mrpumpkin')return route.fallback();
    submissions.push({at:Date.now(),cancel:!!body.cancel,destination:body.destination});
    if(fault==='silent member')return route.abort('failed');
    // A boss that moved between two members' requests: each froze its own point.
    await route.fallback({postData:JSON.stringify({...body,destination:{...body.destination,x:body.destination.x+40}})});
  };
  await context.route('**/party-api/shared-travel',fixture);
  const samples:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{
      const s=await live.state();
      samples.push({at:Date.now(),convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,participants:s.activeConvoy.participants,
        activity:s.activeConvoy.walkingActivity,location:s.activeConvoy.location},characters:Object.fromEntries(names.map(n=>[n,{map:s.characters[n]?.map,x:s.characters[n]?.x,y:s.characters[n]?.y}]))});
      if(samples.length>80)samples.splice(1,1);
      const walking=s.activeConvoy?.walkingActivity==='event'&&s.activeConvoy.walkingEvent==='mrpumpkin';
      return walking&&(fault==='silent member'?s.activeConvoy.participants.includes(W):names.every(n=>s.activeConvoy.participants.includes(n)));
    },{timeout:120_000,message:'The event walk must start within the rendezvous window'}).toBe(true);
    // Arrival hands the walkers to boss combat; attendance records the joined fight.
    await expect.poll(async()=>{
      const s=await live.state(),attending=(n:string)=>s.eventAttendance?.[n]?.mrpumpkin?.attending===true;
      return fault==='silent member'?attending(W):names.every(attending);
    },{timeout:180_000,message:'The walkers must join the boss fight'}).toBe(true);
  }finally{
    await context.unroute('**/party-api/shared-travel',fixture);
    await info.attach('event-rendezvous-'+fault.replace(' ','-'),{body:JSON.stringify({seed,submissions:submissions.slice(-20),samples}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await clearPumpkin(live,seed);
  }
});
