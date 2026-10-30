const test = require('node:test');
const assert = require('node:assert/strict');
const { installPartyMovement } = require('../../runtime/characters/movement.ts');
const contracts = require('../../runtime/navigation/contracts.ts');
const { geometryFingerprint } = contracts;

// Failure inventory: docs/efficiency.md, Character threads, CT4.
function countedLines(lines) {
  // Counts element reads, which JSON.stringify makes for every collision line.
  const reads = { count: 0 };
  const proxy = new Proxy(lines, { get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++; return target[key]; } });
  return { proxy, reads };
}
function game(lines) {
  return { version: 16846,
    geometry: { main: { x_lines: lines, y_lines: [[0, -10, 10]] }, bank: { x_lines: [], y_lines: [] } },
    maps: { main: { spawns: [[0, 0]], doors: [], npcs: [{ id: 'transporter', position: [5, 5] }] }, bank: { spawns: [[0, 0]], doors: [], npcs: [] } },
    npcs: { transporter: { places: { main: 1 } } } };
}
function movement(G) {
  const c = { name: 'Test', map: 'main', in: 'main', x: 0, y: 0, real_x: 0, real_y: 0, speed: 60, base: { h: 8, v: 7, vn: 2 }, items: [], moving: false };
  const host = { character: c, G, smart: { moving: false, plot: [] }, parent: { socket: { emit() {} }, push_deferred: () => Promise.resolve() },
    smart_move: () => Promise.resolve(), stop: async () => {}, smart_move_logic() {}, start_pathfinding() {}, continue_pathfinding() {},
    move: async () => {}, use: async () => {}, can_use: () => true, can_walk: () => true, is_transporting: () => false, can_move: () => true,
    is_door_close: () => true, can_use_door: () => true, find_npc: () => null, game_log() {} };
  const ports = { now: () => 1000, context: () => ({ runtime: 'test', revision: 1, current: true, paused: false }),
    request: () => new Promise(() => {}), diagnostic() {} };
  return installPartyMovement(host, ports);
}

test('movement reuses the geometry identity until collision or transition data changes', () => {
  const { proxy, reads } = countedLines([[50, -10, 10]]);
  const G = game(proxy);
  const service = movement(G);
  try {
    const initial = service.identity.fingerprint;
    assert.equal(initial, geometryFingerprint(G));
    const afterInstall = reads.count;
    for (let index = 0; index < 20; index++) void service.move({ map: 'main', x: 100 + index, y: 0 }).catch(() => {});
    assert.equal(reads.count, afterInstall, 'repeated moves must not serialize unchanged collision lines again');
    assert.equal(service.identity.fingerprint, initial);

    // In-place collision edits change the identity, as geometryFingerprint does.
    G.geometry.main.x_lines.push([60, -10, 10]);
    void service.move({ map: 'main', x: 200, y: 0 }).catch(() => {});
    assert.notEqual(service.identity.fingerprint, initial);
    assert.equal(service.identity.fingerprint, geometryFingerprint(G));

    const pushed = service.identity.fingerprint;
    G.geometry.main = { x_lines: [[70, -10, 10]], y_lines: [[0, -10, 10], [1, 2, 3]] };
    void service.move({ map: 'main', x: 210, y: 0 }).catch(() => {});
    assert.notEqual(service.identity.fingerprint, pushed);
    assert.equal(service.identity.fingerprint, geometryFingerprint(G));

    const replaced = service.identity.fingerprint;
    G.maps.main.doors.push([10, 10, 20, 20, 'bank']);
    void service.move({ map: 'main', x: 220, y: 0 }).catch(() => {});
    assert.notEqual(service.identity.fingerprint, replaced);
    assert.equal(service.identity.fingerprint, geometryFingerprint(G));

    const doors = service.identity.fingerprint;
    G.maps.added = { spawns: [[1, 1]], doors: [], npcs: [] };
    void service.move({ map: 'main', x: 230, y: 0 }).catch(() => {});
    assert.notEqual(service.identity.fingerprint, doors);
    assert.equal(service.identity.fingerprint, geometryFingerprint(G));
  } finally { service.dispose(); }
});

test('renderer decoration keeps the cached identity equal to a full fingerprint', () => {
  const G = game([[50, -10, 10]]);
  const service = movement(G);
  try {
    const initial = service.identity.fingerprint;
    G.maps.main.data = G.geometry.main;
    G.maps.main.npcs[0].color = 'white';
    void service.move({ map: 'main', x: 100, y: 0 }).catch(() => {});
    assert.equal(service.identity.fingerprint, initial);
    assert.equal(geometryFingerprint(G), initial);
  } finally { service.dispose(); }
});
