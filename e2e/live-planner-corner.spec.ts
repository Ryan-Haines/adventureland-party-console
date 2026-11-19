import {test,expect} from './live-fixtures';
import {W,P,world} from './game/hunt-events';
import {readFileSync} from 'node:fs';
import path from 'node:path';

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
    // MOV-028: the planner's own first edge, start to (153, -51), crosses the wall at x=144, and
    // the worker puts one detour point in front of it (corner-edges.ts detourRejectedEdges).
    // The plot opens with the start itself, so one detour point is one point between the two.
    const corner=plan.plot.findIndex((p:any)=>p.map==='main'&&Math.hypot(p.x-153,p.y+51)<=1);
    const before=plan.plot.slice(0,corner).filter((p:any)=>Math.hypot(p.x-start.x,p.y-start.y)>1);
    expect(corner,'The route keeps the planner\'s point past the corner').toBeGreaterThan(0);
    expect(before.length,'One detour point in front of the corner').toBe(1);
    expect(await live.admin(`output=can_move({map:'main',x:${start.x},y:${start.y},going_x:153,going_y:-51,base:{h:8,v:7,vn:2}})`),
      'The planner\'s own edge past the corner is one the game rejects').toBe(false);

    // MOV-157: a game version the coordinator holds no prepared geometry for, as after a failed
    // preparation (application.ts prepareMovement), answers a completed rejection the client's
    // native planner takes over from, and the coordinator keeps planning the prepared version.
    const unprepared=await live.post('/movement-plan',{...request,id:request.id+'-unprepared',version:request.version+1});
    expect(String(unprepared.error),'An unprepared version answers a planner rejection').toMatch(/No compatible game geometry prepared/);
    expect(unprepared.plot,'An unprepared version answers no route').toBeUndefined();
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

    // bothAt waits for both fighters on main within 35 of the point.
    const bothAt=(point:{x:number;y:number},message:string)=>expect.poll(async()=>{const s=await world(live);
      return [W,P].every(n=>s.players[n].map==='main'&&Math.hypot(s.players[n].x-point.x,s.players[n].y-point.y)<35);},
      {timeout:120_000,intervals:[1000],message}).toBe(true);

    // The party walks it as a shared route without spending repairs.
    const travelAt=Date.now();
    await live.post('/travel',door);
    await bothAt(door,'Both fighters must reach the tunnel door');
    const logs=(await live.state()).combatLogs;
    expect(logs,'the state publishes combatLogs').toBeDefined();
    const repairs=[W,P].flatMap(n=>((logs[n]?.events||logs[n]||[]) as any[]).filter(e=>e.at>=travelAt&&/Repairing rejected walking segment|Shared connector repair failed/.test(e.message))
      .map(e=>({who:n,at:e.at,message:e.message})));
    await info.attach('planner-corner-travel',{body:JSON.stringify({travelAt,arrivedAt:Date.now(),repairs},null,2),contentType:'application/json'});
    expect(repairs,'Walking the planned route must need no client repair').toEqual([]);

    // MOV-157: the coordinator restarts on game files that fail to load. prepareMovement's catch
    // prepares no geometry, every plan request answers the planner rejection, and the party
    // still walks home on the clients' native planner.
    await live.restartCoordinator(undefined,{E2E_UNLOADABLE_GAME_FILES:'1'});
    const failed=await live.post('/movement-plan',{...request,id:request.id+'-unloadable'});
    expect(String(failed.error),'With no prepared geometry the planner rejects the running version').toMatch(/No compatible game geometry prepared.*prepared none/);
    expect(failed.plot,'With no prepared geometry the planner answers no route').toBeUndefined();
    // The same fault fails the items owner's bank vault read, which warns and answers no vaults
    // (items/coordinator/storage.ts loadCoordinatorBankVaults), so the coordinator still started.
    const coordinatorLog=readFileSync(path.join(live.deploymentPaths.directory,'coordinator.log'),'utf8');
    expect(coordinatorLog,'The bank vault read warns on the unloadable game file').toContain('Could not load bank-vault definitions');
    // The restarted coordinator takes the travel once both fighters report to it again.
    await expect.poll(async()=>{const s=await live.state();return [W,P].every(n=>s.characters?.[n]?.runtime==='native'&&Date.now()-s.characters[n].seenAt<3000);},
      {timeout:60_000,message:'Both fighters must report to the restarted coordinator'}).toBe(true);
    const fallbackAt=Date.now(), walkedOut=await live.clients[W].run('__partyMovement.last()?.id');
    await live.post('/travel',start);
    await bothAt(start,'Both fighters must walk back on native movement');
    // bothAt passes within 35 of the start while the walk back still runs, and last() holds the
    // walk out until that journey ends; one run read it 13 s before the native arrival.
    let last:any;
    await expect.poll(async()=>{last=await live.clients[W].run('(()=>{const l=__partyMovement.last();return l&&{id:l.id,end:l.end,engine:l.engine,done:l.done};})()');
      return !!last&&last.id!==walkedOut&&!await live.clients[W].run('!!__partyMovement.report()');},
      {timeout:60_000,message:'The walk back ends'}).toBe(true);
    await info.attach('planner-corner-unloadable',{body:JSON.stringify({failed,fallbackAt,last}),contentType:'application/json'});
    expect(last?.engine,'The walk back plans natively').toBe('native');
  });
});
