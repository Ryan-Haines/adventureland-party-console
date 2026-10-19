import {waitForGameplay} from './network-clock';
import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, location } from './game/hunt-lifecycle';

// Failure inventory: e2e/monster-safety-reach-failures.md (#121, Icelocked's booboo
// party from #39). Declared inputs: two booboos (range 420) spawned side by side 390
// from the party, with damage zeroed and a long stun so they stay where a holding tank
// would keep them, both targeting the warrior. Target selection, formation movement,
// range and attacks are native.
const M = 'E2EBankBoi';
test.use({ loadout: 'combat-range', extraFighter: 'mage' });

test('a mage reaches its booboo while a second booboo attacks the warrior', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];

  try {
    expect(await live.clients[M].run('character.ctype')).toBe('mage');
    const mageRange = await live.clients[M].run('character.range');
    expect(mageRange, 'The mage must be outranged by a booboo').toBeLessThan(420);
    await live.post('/formation', { leader: W });
    for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.post('/focus', { character: W, monsterFocus: ['booboo'] });
    await live.post('/travel', await location(live));
    await expect.poll(async () => live.admin(`output=(()=>{const ps=${JSON.stringify([W, P, M])}.map(get_player);
      return ps.every(p=>p.map==='main'&&!p.moving)&&ps.every(p=>Math.hypot(p.x-ps[0].x,p.y-ps[0].y)<250);})()`), { timeout: 120_000 }).toBe(true);
    await live.admin(`output=(()=>{globalThis.__e2eMonsterReachOwned=[];return true;})()`);
    const spawned = await live.admin(`output=(()=>{const w=get_player('${W}'),ids=[];
      for(const dx of [-12,12]){const m=new_monster(w.in,{type:'booboo',position:[w.x+dx,w.y+390],radius:0,count:1},{temp:1});
        globalThis.__e2eMonsterReachOwned.push({id:String(m.id),in:m.in,map:m.map,type:m.type});
        m.hp=m.max_hp=5000000;m.attack=0;m.s.stunned={ms:600000};target_player(m,w);ids.push(String(m.id));}
      return ids;})()`);
    await info.attach('declared-booboos', { body: JSON.stringify({ spawned, mageRange }), contentType: 'application/json' });
    // The setup itself: the mage has to approach to reach either booboo.
    expect(await live.clients[M].run(`${JSON.stringify(spawned)}.every(id => !parent.entities[id] || !is_in_range(parent.entities[id]))`)).toBe(true);

    // Sample actual native readiness in the client; CDP latency must not reduce the cadence.
    await live.clients[M].run(`(() => {
      const ledger={samples:[],deadline:Date.now()+60000,timer:null};
      globalThis.__e2eMonsterReachSamples=ledger;
      const capture=()=>{const p=globalThis.partyCombatPosition,t=p&&p.target&&parent.entities[p.target];
        if(Date.now()>ledger.deadline||ledger.samples.length>=60){clearInterval(ledger.timer);return;}
        ledger.samples.push({at:Date.now(),selectedId:t&&String(t.id),target:t&&t.mtype,
          inRange:!!(t&&is_in_range(t)),x:character.real_x,y:character.real_y,
          mode:p&&p.mode,reason:p&&p.reason,constraint:p&&p.constraint});};
      ledger.timer=setInterval(capture,1000);capture();return true;
    })()`);
    await waitForGameplay(60000);
    samples.push(...await live.clients[M].run('globalThis.__e2eMonsterReachSamples.samples'));
    const booboo = samples.filter(s => s.target === 'booboo');
    expect(booboo.length, 'The party must select a booboo').toBeGreaterThan(30);
    expect(booboo.filter(s => s.inRange).length, 'The mage must spend most of the minute in range').toBeGreaterThan(booboo.length / 2);
  } finally {
    try {
      try {const retained=await live.clients[M].run(`(() => {const ledger=globalThis.__e2eMonsterReachSamples;if(!ledger)return [];clearInterval(ledger.timer);delete globalThis.__e2eMonsterReachSamples;return ledger.samples;})()`);if(retained.length>samples.length)samples.splice(0,samples.length,...retained);}
      catch(error){await info.attach('mage-reach-sampler-observation-error',{body:String(error),contentType:'text/plain'});}
      await info.attach('mage-reach-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    }
    finally {await live.admin(`output=(()=>{for(const entry of globalThis.__e2eMonsterReachOwned||[]){const m=instances[entry.in]?.monsters[entry.id];if(m&&m.type===entry.type&&m.map===entry.map)remove_monster(m,{method:'disappear',nospawn:true});}delete globalThis.__e2eMonsterReachOwned;return true;})()`);}
  }
});
