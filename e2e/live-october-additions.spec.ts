import { test, expect, type LiveGame } from './live-fixtures';
import { waitForGameplay } from './network-clock';

// Failure inventory: docs/testing-october-events.md § Event bosses outside
// their event and § Event-only monsters in the Bestiary. Fixtures declare
// initial difficulty only; every move, hit and catalog report is native.
const W = 'E2EWarrior', P = 'E2EPriest', fighters = [W, P];

async function checkpoint(live: LiveGame) {
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  await expect.poll(async () => Date.now() - ((await live.state()).characters[W]?.seenAt || 0), { timeout: 60_000 }).toBeLessThan(3000);
  const receipt = await live.post('/checkpoint', {});
  expect(receipt.ok, 'The native checkpoint must be accepted').toBe(true);
}

test.describe('October boss avoidance', () => {
  test.use({ initialPosition: { map: 'halloween', x: -405, y: -1460 } });
  test('October additions: farming with the all focus never pulls an unjoined Horseman', async ({ live }, info) => {
    test.setTimeout(300_000);
    await checkpoint(live);
    await live.post('/focus', { monsterFocus: ['all'], monsterPriorities: {}, monsterSearchRadius: 400 });
    // aggro 0 keeps the Horseman from attacking, so no defense applies.
    const boss = await live.admin(`output=(()=>{
      globalThis.__e2eHorsemanOriginal=G.monsters.horseman;
      G.monsters.horseman={...G.monsters.horseman,attack:1,aggro:0,spawns:[]};
      const m=new_monster('halloween',{type:'horseman',count:1,boundary:[-405,-1640,-405,-1640]},{temp:1});
      return {id:String(m.id)};})()`);
    // A native Goo beside the party proves the fighters are farming at all.
    const goo = await live.admin(`output=(()=>{const m=new_monster('halloween',{type:'goo',count:1,boundary:[-405,-1420,-405,-1420]},{temp:1});return {id:String(m.id)}})()`);
    try {
      await expect.poll(async () => {
        const events = (await Promise.all(fighters.map(name => live.clients[name].events()))).flat();
        return events.some(event => event.event === 'hit' && String(event.data?.id) === goo.id && fighters.includes(event.data?.hid));
      }, { timeout: 120_000, message: 'The all focus must attack the native Goo' }).toBe(true);
      await waitForGameplay(20_000);
      const events = (await Promise.all(fighters.map(name => live.clients[name].events()))).flat();
      const horsemanAttacks = events.filter(event => ['attack-issued', 'hit'].includes(event.event) && String(event.data?.id) === boss.id &&
        (fighters.includes(event.data?.actor) || fighters.includes(event.data?.hid)));
      await info.attach('october-horseman-avoidance', { body: JSON.stringify({ boss, goo, horsemanAttacks }), contentType: 'application/json' });
      expect(horsemanAttacks, 'No fighter may pull the Horseman without joining its event').toEqual([]);
    } finally {
      await live.admin(`output=(()=>{for(const m of Object.values(instances.halloween.monsters))if(['horseman','goo'].includes(m.type)&&m.temp)remove_monster(m,{silent:true});
        if(globalThis.__e2eHorsemanOriginal){G.monsters.horseman=globalThis.__e2eHorsemanOriginal;delete globalThis.__e2eHorsemanOriginal;}return true;})()`);
    }
  });
});

test('October additions: the Bestiary credits each event-only monster to its event', async ({ live }) => {
  test.setTimeout(180_000);
  await expect.poll(async () => {
    const catalog = (await live.state(true)).bestiaryCatalog || [];
    return Object.fromEntries(['horseman', 'jackowalker', 'zombie', 'ghoul', 'gargoyle', 'ghost'].map(id =>
      [id, (catalog.find((monster: any) => monster.id === id)?.eventSources || []).map((source: any) => `${source.id}:${source.role}`)]));
  }, { timeout: 90_000, message: 'A real client derives the event sources from G.events and G.monsters' }).toEqual({
    horseman: ['horseman:boss'], jackowalker: ['horseman:add'], zombie: ['graveyard:wave'], ghoul: ['graveyard:wave'], gargoyle: ['graveyard:boss'], ghost: [] });
});

 test('October additions: older clients retain their complete event priority order', async ({live}) => {
  const old=['mrgreen','mrpumpkin','slenderman','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman'];
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:W,eventPriorities:old});
  await expect.poll(async()=>(await live.state()).eventPrioritiesByCharacter?.[W]).toEqual([...old,'horseman','graveyard','trickortreat','witchcipher']);
 });
