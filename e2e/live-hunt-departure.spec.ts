import {test, expect} from './live-fixtures';
import {departureSignalFaultSource} from './departure-signal-fault';
import {warrior as W, fighters, party, world, artifact} from './game/hunt-lifecycle';

// Delay targeted native control responses without fabricating movement or acknowledgements.
// Install before travel so fault injection does not race a short departure window.
test('three delayed native departure signals preserve walking recovery budget and reach the destination', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+450*Math.cos(a),y=character.real_y+450*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  const installed=await live.clients[W].run(departureSignalFaultSource(W));
  let maxRecoveryAttempts = 0;
  try {
    await live.post('/travel',destination);
    await expect.poll(async () => {
      const convoy = (await live.state()).activeConvoy;
      maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
      const blocked=await live.clients[W].run('globalThis.__e2eDepartureFaults || []');
      return blocked.filter((fault:{deadline:number;startedAt:number;endedAt:number})=>
        fault.startedAt<=fault.deadline && fault.endedAt>=fault.deadline+1500).length;
    }, {timeout:120_000,message:'Three genuine scheduled departure signals must be delayed beyond their deadlines'}).toBe(3);
    await expect.poll(async () => {
      const current = await world(live), convoy = (await live.state()).activeConvoy;
      maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
      return fighters.every(name => current[name].map===destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
    }, {timeout:90_000}).toBe(true);
    expect(maxRecoveryAttempts,'Delayed readiness must not spend physical route retries').toBe(0);
    const hook=await live.clients[W].run('globalThis.__e2eDepartureHook');
    expect(hook?.generation).toBe(installed.generation);
    expect(hook?.signals.length).toBe(3);
    await artifact(live,info,'native-delayed-departures',{installed,signals:hook.signals,maxRecoveryAttempts,destination});
  } finally {
    const receipt=await live.clients[W].run(`(()=>{const hook=globalThis.__e2eDepartureHook;if(hook){hook.enabled=false;hook.restore?.();}$(document).off('.e2eDepartureFault');return {responses:hook?.signals||[],blocked:globalThis.__e2eDepartureFaults||[],generation:hook?.generation};})()`);
    await info.attach('native-departure-response-delays',{body:JSON.stringify({installed,...receipt}),contentType:'application/json'});
  }
});
