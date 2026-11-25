// The Hunt settings, spawn preference and blacklist routes on an active Hunt, which left the live
// Hunt lifecycle spec (test-windows DESIGN.md 4.1, H26): the live test sent each body to the
// coordinator and read the farming profile back, so the route checks need no game. The routes are
// hunting/coordinator/routes.ts `createHuntRoutes` behind tasks/coordinator/routes.ts
// `createScopedFarmingRoute`, as coordinator/application.ts scopes them. The Hunt's turn-in after
// the rejected writes is H21's reward, which W12 plays.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createScopedFarmingRoute } = require('../../runtime/tasks/coordinator/routes.ts');
const { createHuntRoutes } = require('../../runtime/hunting/coordinator/routes.ts');
const { defaultHuntSettings } = require('../../runtime/hunting/saved-fields.ts');
const { huntSpawnKey } = require('../../runtime/hunting/areas.ts');
const { settingsWriter } = require('./helpers/settings-writer.cjs');

const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EMerchant';
const bee = { map: 'main', x: 494, y: 1101 }, goo = { map: 'main', x: -64, y: 787 };
const response = () => ({ code: 200, status(n) { this.code = n; return this; }, json(v) { this.value = v; return v; } });

// The warrior leads a party on an active Hunt; the priest follows it and the merchant runs no Hunt.
function activeHunt() {
  const state = { leader: W, statuses: { [W]: { map: 'main', x: 0, y: 0 } }, monsterHunterLocation: { map: 'main', x: 126, y: -413 },
    monsterChoices: [{ id: 'bee', locations: [bee] }, { id: 'goo', locations: [goo] }, { id: 'spider', locations: [{ map: 'main', x: 968, y: -144 }] }],
    huntSettings: { ...defaultHuntSettings }, combatMode: 'auto', targetMode: 'hunt', monsterFocus: ['goo'], location: goo,
    monsterHunt: { cycleId: 'cycle-1', stage: 'farming', returnLocation: goo } };
  const routes = createHuntRoutes(state, { group: () => null, write: settingsWriter(state).write, now: () => 100, persist() {},
    participants: () => [W, P], waypoint: () => goo, intent: () => ({ cancelled: false }), fighting: () => false });
  const ports = { owned: n => [W, P, M].includes(n), merchant: () => M, combat: n => n !== M, owner: n => n === P ? W : n, solo: () => null, mainOwner: () => W, mode: () => 'hunt' };
  const scope = route => createScopedFarmingRoute(route, () => route, ports, true);
  const send = (route, body) => { const res = response(); route({ body }, res); return res; };
  const settings = body => send(scope(routes.settings), body), blacklist = body => send(scope(routes.blacklist), body), mode = body => send(scope(routes.mode), body);
  const unchanged = () => JSON.parse(JSON.stringify({ settings: state.huntSettings, blacklist: state.huntBlacklist ?? null, combatMode: state.combatMode,
    targetMode: state.targetMode, focus: state.monsterFocus, location: state.location, cycle: state.monsterHunt?.cycleId }));
  return { state, settings, blacklist, mode, unchanged };
}

scenarioTable('H26: invalid backup, setting and spawn preference writes leave an active Hunt intact', activeHunt, [
  ['spawn preferences set and clear per monster, and a manual blacklist entry names its reason', t => {
    const beeKey = huntSpawnKey(bee), gooKey = huntSpawnKey(goo);
    assert.equal(t.settings({ character: W, preferredSpawns: { bee: beeKey } }).code, 200);
    assert.equal(t.settings({ character: W, preferredSpawns: { goo: gooKey } }).code, 200);
    assert.deepEqual(t.state.huntSettings.preferredSpawns, { bee: beeKey, goo: gooKey });
    t.settings({ character: W, preferredSpawns: { goo: '' } });
    assert.deepEqual(t.state.huntSettings.preferredSpawns, { bee: beeKey, goo: '' });
    for (const monsterId of ['bee', 'spider']) assert.equal(t.blacklist({ character: W, action: 'add', monsterId }).code, 200);
    t.blacklist({ character: W, action: 'remove', monsterId: 'bee' });
    assert.equal(t.state.huntBlacklist.bee, undefined);
    assert.deepEqual({ monsterId: t.state.huntBlacklist.spider.monsterId, deaths: t.state.huntBlacklist.spider.deaths, reason: t.state.huntBlacklist.spider.reason },
      { monsterId: 'spider', deaths: 0, reason: 'Manually blacklisted' });
    t.blacklist({ character: W, action: 'clear' });
    assert.deepEqual(t.state.huntBlacklist, {});
    assert.deepEqual(t.state.huntFailures ?? {}, {});
  }],
  ['each invalid write answers its refusal and changes nothing', t => {
    t.blacklist({ character: W, action: 'add', monsterId: 'spider' });
    const expected = t.unchanged();
    assert.deepEqual([expected.targetMode, expected.cycle], ['hunt', 'cycle-1']);
    const invalid = [
      [t.mode, { character: W, mode: 'hunt', backup: { monsterFocus: ['goo'], location: { map: 'not-a-map', x: 0, y: 0 } } }, 400],
      ...[{ deathThreshold: 0 }, { expirationThreshold: 1.5 }, { blacklistDeaths: 'true' }, { unknown: true }, { blacklistDeaths: false, deathThreshold: 0 },
        ...[[], null, { goo: 7 }, { goo: 'not-a-spawn' }, { missing: huntSpawnKey(goo) }].map(preferredSpawns => ({ preferredSpawns }))]
        .map(body => [t.settings, { character: W, ...body }, 400]),
      [t.settings, { character: P, deathThreshold: 4 }, 409],
      [t.settings, { character: M, deathThreshold: 4 }, 409],
      [t.settings, { character: 'not-owned', deathThreshold: 4 }, 400],
      [t.blacklist, { character: W, action: 'invalid' }, 400],
      [t.blacklist, { character: W, action: 'add', monsterId: 'not-a-monster' }, 400],
    ];
    for (const [route, body, status] of invalid) {
      assert.equal(route(body).code, status, JSON.stringify(body));
      assert.deepEqual(t.unchanged(), expected, 'Rejected mutation must be atomic: ' + JSON.stringify(body));
    }
  }],
]);
