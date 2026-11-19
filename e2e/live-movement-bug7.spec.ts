import { test, expect } from './live-fixtures';

// D.BUG7 (e2e/movement-owner-failures.md "D.BUG7"):
// a mage escort in a joined event whose formation corner holds adds reaches its range of the boss.
// b9b5c91e held it with "no safe local detour; waiting for an opening" (review ledger 7), and the
// terrain recovery refuses while an event runs, so the mage stood out of range. The blocked
// mage takes the event's own approach. The adds here are passive, so the event does not fight them
// (the full step check stays out of the row).
const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EBankBoi', members = [W, P, M];

test.use({ loadout: 'fragile', extraFighter: 'mage' });

test('D.BUG7: a mage escort whose corner holds adds reaches its range of the joined boss', async ({ live }, info) => {
  test.setTimeout(480_000);
  const world = () => live.admin(`output={boss:get_monster('franky')&&{x:get_monster('franky').x,y:get_monster('franky').y,hp:get_monster('franky').hp},
    players:Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}`);
  await live.post('/formation', { leader: W });
  for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
  // A living Franky that hits softly and spawns no adds of its own, held in one corner of level2w.
  await live.admin(`output=(()=>{
    if(events.franky || get_monster('franky')) throw Error('Franky needs a clean baseline');
    globalThis.__e2eBug7Definition={attack:G.monsters.franky.attack,spawns:G.monsters.franky.spawns,aggro:G.monsters.franky.aggro};
    Object.assign(G.monsters.franky,{attack:1,spawns:[],aggro:0});
    globalThis.__e2eBug7Boundary=G.maps.level2w.monsters[0].boundary.slice();
    G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];
    events.franky=true;delete timers.franky;return true;
  })()`);
  try {
    await expect.poll(async () => !!(await world()).boss, { timeout: 30_000 }).toBe(true);
    for (const name of members) await live.post('/formation', { character: name, eventSelections: ['franky'] });
    await expect.poll(async () => {
      const state = await live.state();
      return members.every(name => state.characters[name]?.map === 'level2w' && state.characters[name]?.joinedEvent === 'franky');
    }, { timeout: 180_000, message: 'The warrior, the priest and the mage must join the living Franky' }).toBe(true);
    // The adds: passive goos on the mage's side of the boss, between it and every formation corner
    // its local detour could take.
    const planted = await live.admin(`output=(()=>{const m=get_player('${M}'),b=get_monster('franky'),dx=m.x-b.x,dy=m.y-b.y,d=Math.hypot(dx,dy)||1;
      const ids=[];for(const [along,side] of [[0.5,0],[0.5,30],[0.5,-30],[0.7,15],[0.7,-15]]){
        const x=b.x+dx*along-dy/d*side,y=b.y+dy*along+dx/d*side;
        const a=new_monster(m.in,{type:'goo',position:[x,y],radius:0,count:1},{temp:1});ids.push(a&&a.id);}
      return {ids,mage:{x:m.x,y:m.y},boss:{x:b.x,y:b.y}};})()`);
    await info.attach('bug7-adds', { body: JSON.stringify(planted), contentType: 'application/json' });
    const range = await live.clients[M].run('character.range');
    await expect.poll(async () => {
      const server = await world(), mage = server.players[M];
      return !!server.boss && !mage.rip && Math.hypot(mage.x - server.boss.x, mage.y - server.boss.y) <= Number(range);
    }, { timeout: 90_000, message: 'The blocked mage must take the event approach into its range of Franky' }).toBe(true);
    await info.attach('bug7-in-range', { body: JSON.stringify({ server: await world(), coordinator: await live.state() }), contentType: 'application/json' });
  } finally {
    await live.admin(`output=(()=>{if(globalThis.__e2eBug7Definition)Object.assign(G.monsters.franky,globalThis.__e2eBug7Definition);
      if(globalThis.__e2eBug7Boundary)G.maps.level2w.monsters[0].boundary=globalThis.__e2eBug7Boundary;return true;})()`);
  }
});
