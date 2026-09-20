const { BASE } = require("./native.cjs");
const fs = require("node:fs");
const path = require("node:path");
function merchantStand() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../characters/shared.js"), "utf8");
  const match = source.match(
    /var merchantMarketLocation = \{ map: "([^"]+)", x: (-?[\d.]+), y: (-?[\d.]+) \}/,
  );
  if (!match) throw Error("Cannot locate configured merchant stand in characters/shared.js");
  return { map: match[1], x: Number(match[2]), y: Number(match[3]) };
}
function corpus(native, snapshot = {}) {
  const G = native.game,
    routes = [];
  const point = (map, x, y) => ({ map, x, y });
  const spawn = (map) => point(map, ...G.maps[map].spawns[0]);
  const add = (id, category, from, to, extra = {}) =>
    routes.push({ id, category, from, to, town: false, ...extra });
  const main = spawn("main"),
    stand = merchantStand();
  const npc = (id) => {
    for (const [map, def] of Object.entries(G.maps)) {
      if (def.ignore || def.instance) continue;
      const n = def.npcs?.find((n) => n.id === id && n.position);
      if (n) return point(map, n.position[0], n.position[1] + 15);
    }
    throw Error(`Missing NPC ${id}`);
  };
  add("stand-bank", "merchant", stand, spawn("bank"));
  add("bank-scrolls", "merchant", spawn("bank"), point("main", -465, -71));
  add("scrolls-upgrade", "merchant", point("main", -465, -71), point("main", -204, -129));
  add("upgrade-craftsman", "merchant", point("main", -204, -129), npc("craftsman"));
  add("stand-potions", "merchant", stand, point("main", 56, -122));
  add("craftsman-stand", "merchant", npc("craftsman"), stand);
  if (snapshot.partyLocation?.map) {
    const p = snapshot.partyLocation;
    add("configured-party-farm", "configured", main, point(p.map, p.x, p.y));
    add("configured-party-return", "configured", point(p.map, p.x, p.y), main, { town: true });
  }
  for (const map of ["halloween", "winterland", "desertland", "spookytown"])
    add(`main-${map}`, "cross-map", main, spawn(map));
  add("winterland-return", "cross-map", point("winterland", -160, -660), main, { town: true });
  seededRoutes(native, spawn, point, add);
  add("fence-detour", "obstacle", point("main", -95, 229), point("main", -137, 248));
  add("cave-bridge", "obstacle", point("cave", 121, -1051), point("cave", 23, -1075));
  add("short-straight", "control", main, point("main", main.x + 20, main.y));
  const geometry = G.geometry.main;
  const line = geometry.x_lines[0];
  add("blocked-target", "failure", main, point("main", line[0], (line[1] + line[2]) / 2), {
    expected: "blocked",
  });
  add("disconnected-jail", "failure", main, spawn("jail"), { expected: "no-path" });
  const restricted = Object.entries(G.maps).flatMap(([map, def]) =>
    (def.doors || [])
      .filter((d) => d[7] === "key" || d[8] === "complicated")
      .map((d) => ({ map, d })),
  )[0];
  if (restricted)
    add(
      "restricted-door",
      "access",
      point(restricted.map, ...G.maps[restricted.map].spawns[restricted.d[6]]),
      point(restricted.d[4], ...G.maps[restricted.d[4]].spawns[restricted.d[5] || 0]),
      { expected: "session-access-unverified" },
    );
  if (G.maps.crypt)
    add("instance-crypt", "access", main, spawn("crypt"), {
      expected: "session-access-unverified",
    });
  return { seed: 42, base: BASE, speed: 60, merchantStand: stand, routes };
}
function seededRoutes(native, spawn, point, add) {
  let seed = 42;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (const map of ["main", "halloween", "winterland", "cave", "tunnel", "desertland"]) {
    const center = spawn(map),
      points = [];
    for (let attempts = 0; points.length < 2 && attempts < 10000; attempts++) {
      const p = point(
        map,
        Math.round(center.x + (random() - 0.5) * 800),
        Math.round(center.y + (random() - 0.5) * 800),
      );
      // Independent local geometry validation; do not select on ALClient success.
      if (native.canWalk(p, point(map, p.x + 1, p.y + 1))) points.push(p);
    }
    if (points.length === 2)
      add(
        `seeded-${map}`,
        native.canWalk(points[0], points[1]) ? "seeded-direct" : "seeded-detour",
        ...points,
      );
  }
}
module.exports = { corpus };
