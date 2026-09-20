const test = require('node:test');
const assert = require('node:assert/strict');
const { canRouteToMonster, FOLLOWER_ROUTE_MESSAGE } = require('../../dashboard/lib/party-routing.ts');

test('only leaders and independent characters can route to monsters', () => {
  const formation = { leader: 'Warrior', followers: { Warrior: true, Priest: true, Mage: false } };
  assert.equal(canRouteToMonster(formation, 'Warrior'), true);
  assert.equal(canRouteToMonster(formation, 'Priest'), false);
  assert.equal(canRouteToMonster(formation, 'Mage'), true);
  formation.followers.Priest = false;
  assert.equal(canRouteToMonster(formation, 'Priest'), true);
});

test('routing checks use current leadership and retain the requested explanation', () => {
  const formation = { leader: 'Warrior', followers: { Warrior: true, Priest: true } };
  formation.leader = 'Priest';
  assert.equal(canRouteToMonster(formation, 'Warrior'), false);
  assert.equal(canRouteToMonster(formation, 'Priest'), true);
  assert.equal(FOLLOWER_ROUTE_MESSAGE, 'only leader can route to monster');
});
