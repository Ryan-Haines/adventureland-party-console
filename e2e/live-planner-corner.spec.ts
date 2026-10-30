import {test,expect} from './live-fixtures';
import {W,P,world} from './game/hunt-events';

// Failure inventory: e2e/planner-corner-failures.md (#147). From main (135, 72)
// the planner's route to the tunnel door starts with an edge through the wall at
// x=144 that the game's collision rejects; the party walks it as a shared route.
const start={map:'main',x:135,y:72}, door={map:'main',x:311,y:-328};

test.describe('planner corner edges',()=>{
  test.use({initialPositions:{[W]:start,[P]:start}});
  test('Routes from a town corner contain no edge the game rejects, and the party walks them unrepaired',async({live},info)=>{
    test.setTimeout(600_000);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>!!(await live.state()).characters?.[W]?.movementGeometry,{timeout:120_000}).toBe(true);
    const state=await live.state(), character=state.characters[W];
    const request={character:W,id:'planner-corner-'+Date.now(),from:{map:'main',in:'main',x:start.x,y:start.y},to:{map:'main',in:'main',x:door.x,y:door.y},
      speed:character.speed,town:false,base:{h:8,v:7,vn:2},...character.movementGeometry};
    const plan=await live.post('/movement-plan',request);
    expect(plan.error,'The planner must route from the town corner').toBeFalsy();
    // Every same-map walking edge is checked with the game server's own collision.
    const edges=await live.admin(`output=(()=>{const plot=${JSON.stringify([request.from,...plan.plot])};const out=[];
      for(let i=1;i<plot.length;i++){const a=plot[i-1],b=plot[i];if(a.map!==b.map||b.transport||b.town)continue;
        out.push({from:[Math.round(a.x),Math.round(a.y)],to:[Math.round(b.x),Math.round(b.y)],
          walkable:can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:{h:8,v:7,vn:2}})});}
      return out;})()`);
    await info.attach('planner-corner-plan',{body:JSON.stringify({request,plot:plan.plot,edges},null,2),contentType:'application/json'});
    expect(edges.filter((e:any)=>!e.walkable),'The planned route must contain no edge the game rejects').toEqual([]);

    // Exercise the other reported corners through the real planner HTTP route,
    // and compare its output with native server collision for each footprint.
    const cases=[
      [87,-208,105,-235],[-457,261,-337,280],[-457,280,-439,261],
      [343,-200,311,-219],[-119,149,-137,168],[-345,-656,-327,-616],
    ].map(([x,y,tx,ty])=>({from:{map:'main',x,y},to:{map:'main',x:tx,y:ty},base:{h:8,v:7,vn:2}}));
    cases.push({from:start,to:door,base:{h:6,v:5,vn:1}},
      {from:{map:'main',x:100,y:100},to:{map:'main',x:100,y:-100},base:{h:12,v:9,vn:4}});
    for(const [index,sample] of cases.entries()){
      const input={...request,...sample,id:request.id+'-sample-'+index},result=await live.post('/movement-plan',input);
      expect(result.error,'Reported corner '+index+' must produce a route').toBeFalsy();
      const checked=await live.admin(`output=(()=>{const points=${JSON.stringify([input.from,...result.plot])},base=${JSON.stringify(sample.base)};
        return points.slice(1).flatMap((b,i)=>{const a=points[i];if(a.map!==b.map||b.transport||b.town)return [];
          return [{from:a,to:b,walkable:can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base})}];});})()`);
      await info.attach('planner-corner-sample-'+index,{body:JSON.stringify({input,result,checked}),contentType:'application/json'});
      expect(checked.filter((edge:any)=>!edge.walkable),'Every sampled edge must pass native collision').toEqual([]);
    }

    // The party walks it as a shared route without spending repairs.
    const travelAt=Date.now();
    await live.post('/travel',door);
    await expect.poll(async()=>{const s=await world(live);
      return [W,P].every(n=>s.players[n].map==='main'&&Math.hypot(s.players[n].x-door.x,s.players[n].y-door.y)<35);},
      {timeout:120_000,intervals:[1000],message:'Both fighters must reach the tunnel door'}).toBe(true);
    const logs=(await live.state()).combatLogs||{};
    const repairs=[W,P].flatMap(n=>((logs[n]?.events||logs[n]||[]) as any[]).filter(e=>e.at>=travelAt&&/Repairing rejected walking segment|Shared connector repair failed/.test(e.message))
      .map(e=>({who:n,at:e.at,message:e.message})));
    await info.attach('planner-corner-travel',{body:JSON.stringify({travelAt,arrivedAt:Date.now(),repairs},null,2),contentType:'application/json'});
    expect(repairs,'Walking the planned route must need no client repair').toEqual([]);
  });
});
