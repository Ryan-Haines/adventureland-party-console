import { expect, type TestInfo } from "@playwright/test";
import { poll, gameplayNow, type GameplayWorld } from "./gameplay-clock";
import {
  warrior as W,
  warrior as R,
  priest as P,
  fighters,
  party,
  world,
  tokens,
  location,
  quests,
  start,
  artifact,
} from "./game/hunt-lifecycle";

export async function ranger(live: GameplayWorld, info: TestInfo) {
  expect(await live.clients[R].run("character.ctype")).toBe("ranger");
  await live.post("/formation", { leader: R });
  await live.post("/formation", { character: P, follow: false });
  await live.post("/farming-mode", { character: R, mode: "default" });
  await live.post("/focus", { character: R, monsterFocus: ["goo"] });
  const destination = await location(live);
  await quests(live, info, { [R]: { id: "goo", count: 100 } });
  const samples: unknown[] = [];
  const start = gameplayNow(live);
  try {
    await poll(
      live,
      async () => {
        const group = await live.clients[R].run("globalThis.__partyGroupedCombat");
        return group?.members;
      },
      { timeout: 25_000, message: "The native solo ranger must receive a singleton combat group" },
    ).toEqual([R]);
    await live.post("/travel", destination);
    let firstKillsAt = 0,
      firstCount = 100,
      authorized = false;
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
        if (authorized && client.count <= 97 && !firstKillsAt) {
          firstKillsAt = gameplayNow(live);
          firstCount = client.count;
        }
        return (
          authorized &&
          firstKillsAt > 0 &&
          gameplayNow(live) - firstKillsAt >= 10_000 &&
          client.count <= firstCount - 3
        );
      },
      {
        timeout: 150_000,
        intervals: [250, 500],
        message: "Authorized singleton combat must keep killing native Goos after its first kills",
      },
    ).toBe(true);
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
  } finally {
    await info.attach("solo-ranger-authorization-history", {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
  }
}

export async function iceRoamer(live: GameplayWorld, info: TestInfo) {
  await party(live);
  await quests(live, info, {
    [W]: { id: "iceroamer", count: 3 },
    [P]: { id: "iceroamer", count: 3 },
  });
  const before = await world(live),
    destination = await start(live, W, "iceroamer");
  expect(destination.map).toBe("winterland");
  await poll(
    live,
    async () => {
      const current = await world(live);
      return fighters.every((name) => tokens(current[name]) === tokens(before[name]) + 1);
    },
    {
      timeout: 360_000,
      message: "Three native Ice Roamer kills must progress to both Daisy rewards",
    },
  ).toBe(true);
  const events = await live.clients[W].events();
  const kills = events.filter(
    (entry: any) => entry.event === "hit" && entry.data?.kill && fighters.includes(entry.data?.hid),
  );
  expect(new Set(kills.map((entry: any) => entry.data.id)).size).toBeGreaterThanOrEqual(3);
  await live.post("/farming-mode", { character: W, mode: "default" });
  await artifact(live, info, "native-ice-roamer-successors-and-rewards", {
    before,
    destination,
    kills,
  });
}

export async function booBoo(live: GameplayWorld, info: TestInfo) {
  const overallDeadline = gameplayNow(live) + 600_000;
  await party(live);
  await quests(live, info, { [W]: { id: "booboo", count: 1 }, [P]: { id: "booboo", count: 1 } });
  const before = await world(live);
  const destination = await start(live, W, "booboo");
  const progress: any[] = [];
  const observe = async (phase: string) => {
    const native = await world(live);
    if (progress.length >= 64) progress.shift();
    progress.push({
      at: gameplayNow(live),
      phase,
      participants: Object.fromEntries(
        fighters.map((name) => [
          name,
          {
            map: native[name].map,
            x: native[name].x,
            y: native[name].y,
            quest: native[name].quest,
            tokens: tokens(native[name]),
          },
        ]),
      ),
    });
    return native;
  };
  const remaining = (cap: number) =>
    Math.max(1, Math.min(cap, overallDeadline - gameplayNow(live)));
  try {
    await poll(live, async () => (await observe("native door arrival"))[W].map, {
      timeout: remaining(240_000),
    }).toBe(destination.map);
    await poll(
      live,
      async () => {
        const native = await observe("native quest completion");
        return fighters.every((name) => native[name].quest?.c === 0);
      },
      {
        timeout: remaining(300_000),
        message: "Both actual native Boo Boo quests must complete before timing the Daisy return",
      },
    ).toBe(true);
    // The existing reward budget measures the return leg after real kills;
    // native combat cannot consume that budget before return begins.
    await poll(live, async () => tokens((await observe("native Daisy reward"))[W]), {
      timeout: remaining(300_000),
    }).toBe(tokens(before[W]) + 1);
    const events = await live.clients[W].events();
    expect(events.some((entry: any) => entry.event === "hit" && entry.data?.kill)).toBe(true);
    expect((await world(live))[W].map).toBe("main");
  } finally {
    await artifact(live, info, "booboo-native-door-combat-reward", {
      before,
      destination,
      progress,
      overallDeadline,
      loadout: "god",
    });
  }
}

export async function followerReward(live: GameplayWorld, info: TestInfo) {
  await party(live);
  await quests(live, info, { [W]: { count: 2 }, [P]: { count: 0 } });
  const before = await world(live);
  await start(live);
  await poll(
    live,
    async () => {
      const current = await world(live);
      return fighters.every((name) => tokens(current[name]) === tokens(before[name]) + 1);
    },
    { timeout: 210_000 },
  ).toBe(true);
  expect(
    (await live.clients[W].events()).some(
      (entry: any) => entry.event === "hit" && entry.data?.kill,
    ),
  ).toBe(true);
  await artifact(live, info, "follower-quest-owner-return", { before });
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

export async function unequalQuests(live: GameplayWorld, info: TestInfo) {
  await party(live);
  await quests(live, info, { [W]: { count: 1 }, [P]: { count: 8 } });
  const before = await world(live);
  await start(live);
  let intermediate: Awaited<ReturnType<typeof world>>;
  await poll(
    live,
    async () => {
      const current = await world(live);
      if (
        current[W].quest?.id === "goo" &&
        current[W].quest.c === 0 &&
        current[P].quest?.id === "goo" &&
        current[P].quest.c > 0 &&
        current[P].quest.c < 8
      ) {
        intermediate = current;
        return true;
      }
      return false;
    },
    {
      timeout: 120_000,
      intervals: [50, 100, 200],
      message: "A native kill must complete only the leader quest",
    },
  ).toBe(true);
  await info.attach("unequal-native-quest-progress", {
    body: JSON.stringify(intermediate!),
    contentType: "application/json",
  });
  await poll(live, async () => tokens((await world(live))[W]), { timeout: 150_000 }).toBe(
    tokens(before[W]) + 1,
  );
  const afterLeaderReward = await world(live);
  const scopeChange = tokens(afterLeaderReward[P]) === tokens(before[P]);
  if (scopeChange) {
    expect(afterLeaderReward[P].quest?.id).toBe("goo");
    expect(afterLeaderReward[P].quest.c).toBeLessThanOrEqual(intermediate![P].quest.c);
    // A leader-owned Hunt need not finish the follower's different remaining
    // count. Explicitly give the follower its own controller to claim that quest.
    await live.post("/formation", { character: P, follow: false });
    await start(live, P);
  }
  await poll(live, async () => tokens((await world(live))[P]), { timeout: 150_000 }).toBe(
    tokens(before[P]) + 1,
  );
  await artifact(live, info, "unequal-owners-native-kill-and-claims", {
    before,
    intermediate,
    afterLeaderReward,
    followerCompletion: scopeChange ? "explicit Follow-off and solo Hunt" : "original party Hunt",
  });
}

export async function gooHunt(live: GameplayWorld, info: TestInfo) {
  await party(live);
  await quests(live, info, { [W]: { count: 2 }, [P]: { count: 2 } });
  const before = await world(live),
    tokens = tokenCount(before[W]);
  const backup = await rawGooHunt(live);
  await poll(live, async () => tokenCount((await world(live))[W]), {
    timeout: 180_000,
    intervals: [1000],
  }).toBeGreaterThan(tokens);
  expect(
    (await live.clients[W].events()).some(
      (entry: any) => entry.event === "hit" || entry.event === "death",
    ),
  ).toBe(true);
  await artifact(live, info, "hunt-kills-and-reward", { before, backup });
}

const tokenCount = tokens;
async function rawGooHunt(live: GameplayWorld) {
  await poll(
    live,
    async () => (await live.state(true)).monsterChoices?.some((entry: any) => entry.id === "goo"),
    { timeout: 120000 },
  ).toBe(true);
  const state = await live.state(true);
  const location = state.monsterChoices
    .find((entry: any) => entry.id === "goo")
    ?.locations.find((area: { map: string }) => area.map === "main");
  expect(location, "The real client must publish a Goo spawn catalog").toBeTruthy();
  await live.post("/farming-mode", {
    character: W,
    mode: "hunt",
    backup: { monsterFocus: ["goo"], location },
  });
  return location;
}
