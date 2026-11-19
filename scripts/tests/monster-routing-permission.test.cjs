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

// The card offers a route by the tasks owner's scopeOwner, as the coordinator farms each character in
// its own scope (runtime/tasks/rules.ts scopeOwner). A merchant with a saved follower mark, and a
// follower in a party with no leader, each own their scope, so each can route. v1.5.0's
// card refused both.
test('a merchant marked as a follower and a follower with no leader can route', () => {
  assert.equal(canRouteToMonster({ leader: 'Warrior', followers: { Merchant: true }, merchantCharacter: 'Merchant' }, 'Merchant'), true);
  assert.equal(canRouteToMonster({ leader: null, followers: { Priest: true } }, 'Priest'), true);
});
