const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorCharacterCommands} = require('../../runtime/coordinator/http/character-actions.ts');
const {autoItemRuleKey, autoItemRuleMode, sameMarkedItem} = require('../../runtime/coordinator/inventory/item-identity.ts');

function fixture() {
  const state = {merchantCharacter: 'M', nextCommandId: 30, statuses: {W: {}}, commands: {},
    marked: {}, merchantMarked: {}, autoItemMarks: {}, upgrades: {}, autoUpgradeMarks: {}, goldTargets: {},
    compounds: {}, autoCompounds: {}, merchantQueue: [], merchantCurrent: null, merchantWeapon: null,
    merchantDeliveries: {}, withdrawals: {}, bankbois: {}, autoExchanges: {}, purchases: {}, statScrolls: {}, farmAreaState: null};
  const workers = Object.assign(Object.create({Ghost: {}}), {W: {}, M: {}}), calls = [];
  const ports = {navigation: body => {calls.push(['navigation', body.type]);}, farmingLocation: () => null,
    key: autoItemRuleKey, mode: autoItemRuleMode, persist: () => calls.push(['persist']), persistBank: () => calls.push(['bank']),
    queue: (...args) => calls.push(['queue', ...args]), reconcileUpgrades: (...args) => calls.push(['upgrades', ...args]),
    reconcileMarks: (...args) => calls.push(['marks', ...args]), scheduleCompound: () => {}, scheduleExchange: () => {},
    log: () => {}, removeReservations: () => {}, clearIncoming: () => {}, sameItem: sameMarkedItem,
    identity: item => JSON.stringify(item), bankboi: async () => {}};
  const route = createCoordinatorCharacterCommands(state, workers, ports);
  const invoke = body => {let status = 200, result; const res = {status: code => {status = code; return res;}, json: value => {result = value;}};
    route({body}, res); return {status, result};};
  return {state, workers, calls, ports, invoke};
}

test('character action validation rejects unavailable farming and inherited worker names before mutation', () => {
  const t = fixture(), body = {character: 'W', type: 'mark', slot: 1, item: {name: 'leather'}};
  assert.equal(t.invoke({...body, farmingMonsterIds: ['goo']}).status, 400);
  assert.equal(t.invoke({...body, character: 'Ghost'}).status, 400); assert.deepEqual(t.calls, []);
  t.workers.Ghost = {};
  assert.equal(t.invoke({...body, character: 'Ghost'}).status, 200);
  assert.equal(t.state.marked.Ghost[0].item.name, 'leather');
});

test('character action dispatch keeps navigation first and acknowledges the current mark collections', () => {
  const t = fixture(), item = {name: 'leather'}, body = {character: 'W', type: 'mark', slot: 1, item};
  const first = t.invoke(body); assert.equal(first.status, 200);
  assert.deepEqual(t.calls, [['navigation', 'mark'], ['persist']]);
  assert.equal(first.result.marked, t.state.marked.W); assert.equal(t.state.marked.W[0].item, item);
  // A handler that claims the command prevents downstream inventory mutation.
  const state = t.state, calls = [];
  const route = createCoordinatorCharacterCommands(state, t.workers, {...t.ports, navigation: () => {calls.push('navigation'); return {status: 409, body: {error: 'busy'}};}});
  const res = {status: code => {assert.equal(code, 409); return res;}, json: value => assert.deepEqual(value, {error: 'busy'})};
  route({body}, res); assert.equal(state.marked.W.length, 1); assert.deepEqual(calls, ['navigation']);
});

test('character transfer commands use the current coordinator command counter', () => {
  const t = fixture(), item = {name: 'helmet'};
  assert.equal(t.invoke({character: 'W', type: 'equip', item}).status, 200);
  assert.deepEqual(t.state.commands.W, {id: 30, type: 'equip', item});
  t.state.commands = {}; t.state.nextCommandId = 70;
  assert.equal(t.invoke({character: 'W', type: 'equip', item}).status, 200); assert.equal(t.state.commands.W.id, 70);
});
test('automatic mark callbacks receive the current status unchanged, including absent reports', () => {
  const t = fixture(), item = {name: 'leather'};
  const status = {items: [{slot: 2, item, meta: {upgradeable: false, definition: {type: 'material'}}}]};
  t.state.statuses.W = status;
  assert.equal(t.invoke({character: 'W', type: 'auto-item-mark', item, mode: 'bank'}).status, 200);
  assert.equal(t.calls.find(call => call[0] === 'marks')[2], status);
  t.calls.length = 0; delete t.state.statuses.W;
  assert.equal(t.invoke({character: 'W', type: 'clear-auto-item-marks', mode: 'bank'}).status, 200);
  assert.equal(t.calls.find(call => call[0] === 'marks')[2], undefined);
});
