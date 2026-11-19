import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';
import {contains} from '../runtime/hunting/zones';
import {farmingAreas} from '../runtime/hunting/areas';

// Failure inventory: a visible bot across UHills terrain must not strand the
// convoy; both fighters must reach the farm and deliver actual native hits.
// A retained target may not authorize indefinite pursuit outside that farm.
test.use({loadout:'combat-range',initialPosition:{map:'uhills',x:-225,y:-207}});
test('native UHills farming handoff reaches terrain-safe combat for both fighters',async({live},info)=>{
  test.setTimeout(240000);
  const samples:unknown[]=[];
  const arrivals:Record<string,{at:number;position:unknown;farm:unknown}>={};
  let farm:any;
  try {
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    const area=farmingAreas((await live.state(true)).monsterChoices,['sparkbot'])
      .find(candidate=>candidate.map==='uhills'&&contains(candidate,{map:'uhills',x:-544,y:-275},0,1));
    expect(area,'Native catalog must contain the requested Sparkbot farm').toBeTruthy();
    const accepted=await live.post('/navigate-to-monster',{monsterId:'sparkbot',location:area});
    farm=accepted.location;
    expect(farm).toMatchObject({map:'uhills'});
    expect(!!(farm.boundary||farm.shapes||farm.polygon||farm.allOf)).toBe(true);
    await live.post('/focus',{monsterFocus:['targetron','sparkbot'],monsterPriorities:{},monsterSearchRadius:500});
    await expect.poll(async()=>{
      const state=await live.state();
      const players=await live.admin(`output=Object.fromEntries(${JSON.stringify([W,P])}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))`);
      if(farm?.map==='uhills'&&(farm.boundary||farm.shapes||farm.polygon||farm.allOf))for(const name of [W,P]){
        if(!arrivals[name]&&!players[name].rip&&contains(farm,players[name],150,500))
          arrivals[name]={at:Date.now(),position:players[name],farm};
      }
      const hits=await Promise.all([W,P].map(async name=>{
        const raw=(await live.clients[name].events()).filter((event:any)=>event.event==='hit'&&event.data?.hid===name&&event.data?.damage>0);
        return {name,rawCount:raw.length,events:raw.filter((event:any)=>arrivals[name]&&event.at>=arrivals[name].at)};
      }));
      samples.push({at:Date.now(),farm,players,convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,engagement:state.activeConvoy.farmingEngagement},hits:hits.map(({name,rawCount,events})=>({name,rawCount,count:events.length,last:events.slice(-2)}))});
      if(samples.length>64)samples.shift();
      return [W,P].every(name=>!!arrivals[name]&&!players[name].rip)&&hits.every(result=>result.events.length>0);
    },{timeout:120000,intervals:[500,1000],message:'Both native fighters must enter the UHills farm and actually attack, rather than repeatedly surrendering travel'}).toBe(true);
    await evidence(live,info,'native-uhills-farming-handoff',{farm,arrivals,samples});
  } finally {
    await info.attach('native-uhills-handoff-observations',{body:JSON.stringify({arrivals,samples}),contentType:'application/json'});
  }
});
