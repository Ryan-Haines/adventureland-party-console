const test = require('node:test'), assert = require('node:assert/strict');
const { selectCoordinatorMonsterDestination: select } = require('../../runtime/coordinator/navigation/selected-destination.ts');
function fixture() {
  return { leader: 'L', followers: { F: true }, statuses: Object.fromEntries(['L','F','I'].map(name => [name, { map: 'main', x: 0, y: 0 }])),
    monsterFocus: ['goo'], monsterFocusByCharacter: {}, monsterPrioritiesByCharacter: {},
    monsterChoices: [{ id: 'goo', locations: [{ map: 'main', x: 30, y: 0 }] }, { id: 'bee', locations: [{ map: 'main', x: 10, y: 0 }] }] };
}
test('party members use shared focus while independent empty selections remain empty', () => {
  const state = fixture(); state.monsterFocusByCharacter = { L: ['bee'], F: [], I: [] };
  assert.equal(select(state, 'L').id, 'goo'); assert.equal(select(state, 'F').id, 'goo');
  assert.equal(select(state, 'I'), null);
  delete state.monsterFocusByCharacter.I; assert.equal(select(state, 'I').id, 'goo');
  state.monsterFocus = ['all']; assert.equal(select(state, 'L'), null);
});
test('priority precedes distance and legacy zero priorities default to fifty', () => {
  const state = fixture(); state.monsterFocus = ['goo','bee'];
  state.monsterPrioritiesByCharacter.L = { goo: 0, bee: 49 };
  assert.equal(select(state, 'L').id, 'goo');
  state.monsterPrioritiesByCharacter.L.bee = '51'; assert.equal(select(state, 'L').id, 'bee');
  state.monsterPrioritiesByCharacter.L = {}; assert.equal(select(state, 'L').id, 'bee');
});
test('same-map nearest locations win ties without mutating catalogs or copying the selected location', () => {
  const state = fixture(), locations = [{ map: 'cave', x: 0, y: 0 }, { map: 'main', x: '3', y: '4' }, { map: 'main', x: -3, y: -4 }];
  state.monsterChoices[0].locations = locations;
  assert.equal(select(state, 'L').location, locations[1]);
  assert.equal(locations[0].map, 'cave');
  delete state.statuses.L; assert.equal(select(state, 'L'), null);
});
