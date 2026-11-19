import {test, expect} from './live-fixtures';
import {departureSignalFaultSource, DEPARTURE_HOLD_MS} from './departure-signal-fault';
import {warrior as W, fighters, party, world, artifact} from './game/hunt-lifecycle';

// MOV-119: a walk departs at once and each member departs on the first reply that
// carries the travel phase. A member whose replies arrive late departs late: the walk keeps its
// epoch, spends no recovery attempt and every member arrives. Holds real replies without
// fabricating movement or acknowledgements.
test('a member that hears the travel phase late departs late, with no new epoch or recovery, and reaches the destination', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+450*Math.cos(a),y=character.real_y+450*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  const installed=await live.clients[W].run(departureSignalFaultSource(W));
  let maxRecoveryAttempts = 0;
  const epochs = new Set<string>();
  const observe = async () => {
    const convoy = (await live.state()).activeConvoy;
    maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
    if (convoy && convoy.phase === 'travel') epochs.add(convoy.id + ':' + convoy.epoch);
  };
  try {
    await live.post('/travel',destination);
    await expect.poll(async () => {
      await observe();
      const blocked=await live.clients[W].run('globalThis.__e2eDepartureFaults || []');
      return blocked.filter((fault:{startedAt:number;endedAt:number})=>fault.endedAt-fault.startedAt>=DEPARTURE_HOLD_MS-50).length;
    }, {timeout:120_000,message:"The warrior's first travel reply must be held"}).toBe(1);
    await expect.poll(async () => {
      await observe();
      const current = await world(live);
      return fighters.every(name => current[name].map===destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
    }, {timeout:90_000}).toBe(true);
    expect(maxRecoveryAttempts,'A late departure is no route failure').toBe(0);
    expect([...epochs],'The walk departs once, under one epoch').toHaveLength(1);
    const hook=await live.clients[W].run('globalThis.__e2eDepartureHook');
    expect(hook?.generation).toBe(installed.generation);
    expect(hook?.signals.length).toBe(1);
    await artifact(live,info,'native-delayed-departures',{installed,signals:hook.signals,maxRecoveryAttempts,epochs:[...epochs],destination});
  } finally {
    const receipt=await live.clients[W].run(`(()=>{const hook=globalThis.__e2eDepartureHook;if(hook){hook.enabled=false;hook.restore?.();}return {responses:hook?.signals||[],blocked:globalThis.__e2eDepartureFaults||[],generation:hook?.generation};})()`);
    await info.attach('native-departure-response-delays',{body:JSON.stringify({installed,...receipt}),contentType:'application/json'});
  }
});
