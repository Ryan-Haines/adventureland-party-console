import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';
import {contains} from '../dashboard/lib/farming-zones';

// Failure inventory: a visible bot across UHills terrain must not strand the
// convoy; both fighters must reach the farm and deliver actual native hits.
// A retained target may not authorize indefinite pursuit outside that farm.
test.use({initialPosition:{map:'uhills',x:-225,y:-207}});
test('native UHills farming handoff reaches terrain-safe combat for both fighters',async({live},info)=>{
  test.setTimeout(240000);
  const samples:unknown[]=[];
  let farm:any;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await live.post('/travel',{map:'uhills',x:-544,y:-275});
    await live.post('/focus',{monsterFocus:['targetron','sparkbot'],monsterPriorities:{},monsterSearchRadius:500});
    await expect.poll(async()=>{
      const state=await live.state();
      farm=state.farmingProfiles?.[W]?.location||state.partyLocation;
      const players=await live.admin(`output=Object.fromEntries(${JSON.stringify([W,P])}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))`);
      const hits=await Promise.all([W,P].map(async name=>({name,events:(await live.clients[name].events()).filter((event:any)=>event.event==='hit'&&event.data?.hid===name&&event.data?.damage>0)})));
      samples.push({at:Date.now(),farm,players,convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,engagement:state.activeConvoy.farmingEngagement},hits:hits.map(({name,events})=>({name,count:events.length,last:events.slice(-2)}))});
      if(samples.length>64)samples.shift();
      return !!farm&&farm.map==='uhills'&&[W,P].every(name=>!players[name].rip&&contains(farm,players[name],150,500))&&hits.every(result=>result.events.length>0);
    },{timeout:120000,intervals:[500,1000],message:'Both native fighters must enter the UHills farm and actually attack, rather than repeatedly surrendering travel'}).toBe(true);
    await evidence(live,info,'native-uhills-farming-handoff',{farm,samples});
  } finally {
    await info.attach('native-uhills-handoff-observations',{body:JSON.stringify(samples),contentType:'application/json'});
  }
});
