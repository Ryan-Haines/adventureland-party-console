import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {poll} from '../gameplay-clock';
import {warrior as W, priest as P, fighters, party, quests, start, world, tokens, artifact} from '../game/hunt-lifecycle';

// W16 Ice Roamer Hunt in Winterland (test-windows DESIGN.md 2.2 W16). One play from the default
// fixture's start: both fighters take a three-kill Ice Roamer quest, the party Hunts it in
// Winterland, kills three and returns to Daisy, where both claim a token.
// Failure modes (H16): the Hunt picks another map; the party stops after its first kill instead of
// engaging the next Ice Roamer; a token is lost or claimed twice.
// The play records what H16's verdict reads; its waits carry the old test's messages.
type Played = {before?: any; destination?: {map: string}; kills?: any[]; failed?: string};
const record: Played = {};

liveWindow({
  id: 'W16', name: 'Ice Roamer Hunt in Winterland',
  // H16's old test bound (live-hunt-ice-roamer.spec.ts at 21fe30a2b, 480 s), which holds its 360 s reward
  // poll.
  timeoutMs: 480_000,
  async play({live, info}: LiveWorld) {
    await party(live);
    await quests(live, info, {
      [W]: { id: "iceroamer", count: 3 },
      [P]: { id: "iceroamer", count: 3 },
    });
    const before = await world(live),
      destination = await start(live, W, "iceroamer");
    Object.assign(record, {before, destination});
    // The reward poll's 360 s is the old one (gameplay-scenarios.ts iceRoamer). Its failure is
    // H16's, so the play records it and still reads the kills.
    try {
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
    } catch (error) { record.failed = String((error as Error)?.message ?? error).slice(0, 2000); }
    const events = await live.clients[W].events();
    record.kills = events.filter(
      (entry: any) => entry.event === "hit" && entry.data?.kill && fighters.includes(entry.data?.hid),
    );
    await live.post("/farming-mode", { character: W, mode: "default" });
  },
  observers: [{
    id: 'H16', owner: 'hunting', behaviours: [],
    start() {},
    async verdict({live, info}: LiveWorld) {
      const {before, kills = []} = record, destination = record.destination as {map: string};
      expect(destination.map).toBe("winterland");
      expect(record.failed, 'H16: the reward poll passes').toBeUndefined();
      expect(new Set(kills.map((entry: any) => entry.data.id)).size).toBeGreaterThanOrEqual(3);
      await artifact(live, info, "native-ice-roamer-successors-and-rewards", {
        before,
        destination,
        kills,
      });
    },
    reads: () => ({failed: record.failed ?? null, destination: record.destination, kills: record.kills?.map((k: any) => k.data?.id)}),
  }],
});
