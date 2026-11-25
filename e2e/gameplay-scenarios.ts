import { expect, type TestInfo } from "@playwright/test";
import { poll, gameplayNow, type GameplayWorld } from "./gameplay-clock";
import {
  warrior as W,
  warrior as R,
  priest as P,
  fighters,
  party,
  location,
  quests,
  artifact,
} from "./game/hunt-lifecycle";

// The solo ranger's farm (play window W02, C17). rangerPlay sets the ranger alone in Group mode on
// goo and waits until its farming keeps killing; rangerVerdict judges what the play read. The
// wait's own reads hold each sample to the singleton group, and expect.poll retries a sample that
// throws, so the play ends only on a sample that meets them, as the one test before it did.
export type RangerRecord = { destination?: unknown; samples: unknown[]; firstKillsAt: number; firstCount: number; start: number };
export const rangerRecord = (): RangerRecord => ({ samples: [], firstKillsAt: 0, firstCount: 100, start: 0 });
export async function ranger(live: GameplayWorld, info: TestInfo) {
  const record = rangerRecord();
  try {
    await rangerPlay(live, info, record);
    await rangerVerdict(live, info, record);
  } finally {
    await info.attach("solo-ranger-authorization-history", {
      body: JSON.stringify(record.samples),
      contentType: "application/json",
    });
  }
}
export async function rangerPlay(live: GameplayWorld, info: TestInfo, record: RangerRecord) {
  await live.post("/formation", { leader: R });
  await live.post("/formation", { character: P, follow: false });
  await live.post("/farming-mode", { character: R, mode: "default" });
  await live.post("/focus", { character: R, monsterFocus: ["goo"] });
  const destination = await location(live);
  record.destination = destination;
  await quests(live, info, { [R]: { id: "goo", count: 100 } });
  const samples = record.samples;
  record.start = gameplayNow(live);
  await poll(
    live,
    async () => {
      const group = await live.clients[R].run("globalThis.__partyGroupedCombat");
      return group?.members;
    },
    { timeout: 25_000, message: "The native solo ranger must receive a singleton combat group" },
  ).toEqual([R]);
  await live.post("/travel", destination);
  let authorized = false;
  await poll(
    live,
    async () => {
      const state = await live.state();
      const client = await live.clients[R].run(
        "({group:globalThis.__partyGroupedCombat,count:character.s.monsterhunt?.c,statusAt:globalThis.__partyStatusSuccessAt})",
      );
      samples.push({
        at: gameplayNow(live),
        mode: state.partyFarmingMode,
        policy: state.farmingPolicy,
        client,
      });
      expect(state.leader).toBe(R);
      expect(state.followers[P]).toBe(false);
      expect(state.partyFarmingMode).toBe("default");
      expect(client.group?.members).toEqual([R]);
      authorized ||= !!client.group?.committed && client.group?.target?.mtype === "goo";
      if (authorized && client.count <= 97 && !record.firstKillsAt) {
        record.firstKillsAt = gameplayNow(live);
        record.firstCount = client.count;
      }
      return (
        authorized &&
        record.firstKillsAt > 0 &&
        gameplayNow(live) - record.firstKillsAt >= 10_000 &&
        client.count <= record.firstCount - 3
      );
    },
    {
      timeout: 150_000,
      intervals: [250, 500],
      message: "Authorized singleton combat must keep killing native Goos after its first kills",
    },
  ).toBe(true);
}
export async function rangerVerdict(live: GameplayWorld, info: TestInfo, record: RangerRecord) {
  const { destination, samples, firstKillsAt, firstCount, start } = record;
  expect(await live.clients[R].run("character.ctype")).toBe("ranger");
  const server = await live.admin(
    `output=(()=>{const p=get_player(${JSON.stringify(R)});return {ctype:p.type,quest:p.s.monsterhunt,hp:p.hp,x:p.x,y:p.y}})()`,
  );
  expect(server.quest.c).toBeLessThanOrEqual(firstCount - 3);
  expect(
    (await live.clients[R].events()).some((event) => event.at >= start && event.event === "hit"),
  ).toBe(true);
  await artifact(live, info, "solo-ranger-native-goo-farming", {
    destination,
    server,
    firstKillsAt,
    firstCount,
    samples,
  });
}

export async function convoy(live: GameplayWorld, info: TestInfo) {
  await party(live);
  await poll(live, async () => (await live.state()).followers[P]).toBe(true);
  const before = await movementWorld(live),
    destination = await movementPoint(live, W, 350);
  await live.post("/travel", destination);
  await movementArrived(live, [W, P], destination);
  for (const name of [W, P])
    expect(
      Math.hypot(
        (await movementWorld(live))[name].x - before[name].x,
        (await movementWorld(live))[name].y - before[name].y,
      ),
    ).toBeGreaterThan(100);
  await artifact(live, info, "convoy-arrival", { before, destination });
}

async function movementWorld(live: GameplayWorld) {
  return live.admin(
    `output=Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{name:p.name,map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`,
  );
}
async function movementPoint(live: GameplayWorld, name: string, distance: number) {
  return live.admin(
    `output=(()=>{const p=get_player(${JSON.stringify(name)});for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+${distance}*Math.cos(a),y=p.y+${distance}*Math.sin(a);if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))return {map:p.map,x,y};}throw Error('No reachable test destination')})()`,
  );
}
async function movementArrived(
  live: GameplayWorld,
  names: string[],
  destination: { map: string; x: number; y: number },
) {
  await poll(
    live,
    async () => {
      const players = await movementWorld(live);
      return names.every(
        (name) =>
          players[name]?.map === destination.map &&
          Math.hypot(players[name].x - destination.x, players[name].y - destination.y) < 35 &&
          !players[name].moving,
      );
    },
    { timeout: 120000, intervals: [250, 500, 1000] },
  ).toBe(true);
}

