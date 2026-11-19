import { expect, test, type TestInfo } from '@playwright/test';
import type { LiveGame } from '../live-fixtures';
import {poll, type GameplayWorld} from '../gameplay-clock';
import { farmingAreas } from '../../runtime/hunting/areas';

// The party, quest, travel and Hunt steps every live row file shares, one copy of each, so the
// specs and the row tables (live-game-rows.ts, hunt-rows.ts) seed and observe the same way.
export const warrior = 'E2EWarrior', priest = 'E2EPriest';
export const fighters = [warrior, priest];
export const merchant = 'E2EMerchant', partyNames = [...fighters, merchant];
export type Location = { map: string; x: number; y: number };
export async function world(live: GameplayWorld) {
  return live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip,xp:p.xp,items:p.items,quest:p.s.monsterhunt||null}]}))`);
}
export const quantity = (items: any[], id: string): number => items.reduce((sum, item) => sum + (item?.name === id ? item.q || 1 : 0), 0);
export const tokens = (player: any): number => quantity(player.items, 'monstertoken');
export function profile(state: any, name = warrior) { return state.farmingProfiles?.[name] || state; }
export function hunt(state: any) { return state.monsterHunt || state.farmingProfiles?.[warrior]?.monsterHunt; }
// The server's view of all three account characters. It waits until each is present, so a read
// during a reconnect returns the reconnected player.
export async function observed(live: GameplayWorld): Promise<Record<string, any>> {
  let snapshot: Record<string, any> = {};
  await poll(live, async () => {
    snapshot = await live.admin(`output=Object.fromEntries(${JSON.stringify(partyNames)}.map(name=>{const p=get_player(name);return [name,p?{name:p.name,map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:!!p.rip,moving:!!p.moving,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,quest:p.s.monsterhunt||null,party:p.party||null,townAt:p.last.town?+p.last.town:0}:null]}))`);
    return partyNames.every(name => !!snapshot[name]);
  }, { timeout: 30_000, intervals: [100, 250], message: 'All three account characters must be present before observing their state' }).toBe(true);
  return snapshot;
}
export async function evidence(live: GameplayWorld, info: TestInfo, label: string, detail: unknown = {}) {
  await info.attach(label, { body: JSON.stringify({ detail, server: await observed(live), coordinator: await live.state() }, null, 2), contentType: 'application/json' });
}
export async function arrived(live: GameplayWorld, party: string[], destination: Location, timeout = 120_000) {
  await poll(live, async () => {
    const players = await observed(live);
    return party.every(name => players[name].map === destination.map && Math.hypot(players[name].x-destination.x, players[name].y-destination.y) < 35 && !players[name].moving);
  }, { message: `Real server must observe ${party.join(', ')} arriving`, timeout, intervals: [250, 500, 1000] }).toBe(true);
}
export async function location(live: GameplayWorld, monster = 'goo') {
  await poll(live, async () => (await live.state(true)).monsterChoices?.some((entry: any) => entry.id === monster),
    { timeout: 120_000, message: 'Native catalog discovery must publish Hunt destinations' }).toBe(true);
  // The dashboard/API selects merged farming areas; raw overlapping spawn
  // centers are not necessarily valid backup choices (notably native Bees).
  const locations = farmingAreas((await live.state(true)).monsterChoices, [monster]);
  return locations.find((entry: any) => entry.map === 'main') || locations[0];
}
// The priest follows the warrior once the coordinator publishes the follow.
export async function party(live: GameplayWorld) {
  await live.post('/formation', { leader: warrior });
  await live.post('/formation', { character: priest, follow: true });
  await poll(live, async () => (await live.state()).followers?.[priest]).toBe(true);
}
// The default reset leaves the party in town with no focus, so a row that plays on a farm picks the
// field as the dashboard's monster pick does, and starts once the server sees the warrior target a
// monster on the field's map.
export async function farm(live: GameplayWorld, monster = 'goo') {
  const at = await location(live, monster);
  await live.post('/navigate-to-monster', { monsterId: monster, location: at });
  await poll(live, async () => await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(warrior)});return !!p&&!!p.target&&p.map===${JSON.stringify(at.map)}})()`),
    { timeout: 180_000, intervals: [500, 1000], message: `The warrior must fight on the ${monster} field` }).toBe(true);
  return at;
}
/** Seed only initial quest conditions; native timer/kills/claims execute thereafter. */
export async function quests(live: GameplayWorld, info: TestInfo, entries: Record<string, { id?: string; count: number; ms?: number }>) {
  const seeded = await live.admin(`output=Object.entries(${JSON.stringify(entries)}).map(([name,q])=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:q.id||'goo',c:q.count,ms:q.ms||1800000};resend(p,'u+cid+reopen');return {name,quest:p.s.monsterhunt}})`);
  await info.attach('hunt-initial-quests', { body: JSON.stringify(seeded), contentType: 'application/json' });
  await poll(live, async () => {
    const state = await live.state();
    // A member already fighting the quest's monster kills toward it before its next report, so the
    // report shows the seeded quest with the seeded count or fewer left. A seed of 0 plants a
    // completed quest, and the one-kill Boo Boo seed at the Boo Boo spawn reports 0 too.
    return Object.entries(entries).every(([name, q]) => { const hunt = state.characters[name]?.monsterHunt;
      return hunt?.id === (q.id || 'goo') && hunt.count >= 0 && hunt.count <= q.count; });
  }, { timeout: 30_000, message: 'Every seeded native quest must reach the coordinator before Hunt selects its owners' }).toBe(true);
}
// Both fighters carry the same seeded quest.
export const seedQuest = (live: GameplayWorld, monster: string, count: number) =>
  quests(live, test.info(), Object.fromEntries(fighters.map(name => [name, { id: monster, count }])));
// The formation, both fighters' quest and the Hunt destination, ready for start().
export async function prepareHunt(live: GameplayWorld, { monster = 'goo', count, location: at }: { monster?: string; count: number; location?: Location }) {
  await party(live);
  await seedQuest(live, monster, count);
  const destination = at ?? await location(live, monster);
  expect(destination, `The real client must publish a ${monster} spawn catalog`).toBeTruthy();
  return { monster, location: destination as Location };
}
export async function start(live: GameplayWorld, name = warrior, monster = 'goo', at?: Location) {
  const destination = at ?? await location(live, monster);
  expect(destination).toBeTruthy();
  // Public restart readiness and fresh character publication are independent.
  // Hunt admission requires the latter; never retry the mutating request.
  await poll(live,async()=>{
    const state=await live.state(),character=state.characters?.[name],now=Date.now();
    return !!character&&character.ctype!=='merchant'&&character.seenAt>=now-3000&&character.seenAt<=now+1000;
  },{timeout:30000}).toBe(true);
  await live.post('/farming-mode', { character: name, mode: 'hunt', backup: { monsterFocus: [monster], location: destination } });
  return destination;
}
// The Hunt cycle start() opened.
export async function cycle(live: GameplayWorld): Promise<string> {
  await poll(live, async () => !!(await live.state()).monsterHunt?.cycleId, { timeout: 30_000 }).toBe(true);
  return (await live.state()).monsterHunt.cycleId;
}
// Both fighters stand inside the current mission's boundary while the cycle farms.
export async function missionReached(live: GameplayWorld, cycleId: string, message: string) {
  await poll(live, async () => {
    const current = await observed(live), state = await live.state(), mission = state.monsterHunt?.missions?.[state.monsterHunt.currentIndex];
    const bounds = mission?.destination?.boundary;
    return state.monsterHunt?.cycleId === cycleId && state.monsterHunt.stage === 'farming' && Array.isArray(bounds) &&
      fighters.every(name => { const p = current[name]; return p.map === mission.destination.map &&
        p.x >= bounds[0] && p.x <= bounds[2] && p.y >= bounds[1] && p.y <= bounds[3]; });
  }, { timeout: 90_000, message }).toBe(true);
}
export async function point(live: GameplayWorld, name: string, distance = 250, direction = 1): Promise<Location> {
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});for(let i=0;i<16;i++){const a=i*Math.PI/8;const x=p.x+${distance * direction}*Math.cos(a),y=p.y+${distance * direction}*Math.sin(a);if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))return {map:p.map,x,y};}throw Error('No reachable test destination')})()`);
}
export async function travel(live: GameplayWorld, character: string, destination: Location) {
  return live.post('/command', { character, type: 'character-travel', location: destination, label: 'E2E observed destination' });
}
export async function artifact(live: GameplayWorld, info: TestInfo, label: string, detail: unknown = {}) {
  await info.attach(label, { body: JSON.stringify({ detail, server: await world(live), coordinator: await live.state(),
    nativeEvents: Object.fromEntries(await Promise.all(fighters.map(async name => [name, await live.clients[name].events()]))) }, null, 2), contentType: 'application/json' });
}
export async function rejected(live: LiveGame, route: string, body: unknown) {
  const response = await fetch(live.url + '/party-api' + route, { method: 'POST', headers: { 'content-type': 'application/json', origin: live.url }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
