"use strict";
function observePlayer(p, { baseline, deaths, ripped, deathLog, sim, clock, startedAt }) {
  if (!baseline.has(p.name)) baseline.set(p.name, { xp: p.xp, gold: p.gold, level: p.level });
  if (!p.rip) {
    ripped.delete(p.name);
    return;
  }
  if (ripped.has(p.name)) return;
  ripped.add(p.name);
  deaths.set(p.name, (deaths.get(p.name) || 0) + 1);
  const attackers = Object.values((sim.server.instances[p.in] || {}).monsters || {})
    .filter((m) => m.target === p.name)
    .map((m) => ({
      id: m.id,
      type: m.type,
      hp: m.hp,
      max_hp: m.max_hp,
      x: Math.round(m.x),
      y: Math.round(m.y),
    }));
  deathLog.push({
    name: p.name,
    minute: +((clock.now - startedAt) / 60000).toFixed(2),
    map: p.map,
    x: Math.round(p.x),
    y: Math.round(p.y),
    attackers,
  });
}
function nativeMonsters(server) {
  return Object.values(server.instances || {}).flatMap((instance) =>
    Object.values(instance.monsters || {}),
  );
}
function observeMonsters(sim, tracked, clock) {
  if (!tracked.types.length) return;
  const seen = new Set();
  for (const m of nativeMonsters(sim.server)) {
    if (!tracked.types.includes(m.type) || m.dead) continue;
    seen.add(m.id);
    if (!tracked.alive.has(m.id))
      tracked.alive.set(m.id, { type: m.type, map: m.map, spawnedAt: clock.now });
  }
  for (const id of tracked.alive.keys()) if (!seen.has(id)) tracked.alive.delete(id);
}
module.exports = { observePlayer, observeMonsters };
