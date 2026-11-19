// installItems publishes `core:items`, whose reads answer from the state it was given, and its
// blacklist runs on that state. Failure modes: a read answers from a stale or hand-built
// registration; a recorded seller failure is not read back, or is read while the player's automatic
// blacklist is off.
const test = require('node:test'), assert = require('node:assert/strict');
const {installItems} = require('../../runtime/items/coordinator/owner.ts');
const {partyHooks} = require('../../runtime/hooks/index.ts');
const {MAIL_POSTAGE} = require('../../runtime/items/rules.ts');

function install(bag, overrides = {}) {
  const state = {merchantCharacter: 'M', statuses: {F: {items: bag, seenAt: Date.now()}}, marked: {}, merchantMarked: {}, upgrades: {},
    compounds: {}, statScrolls: {}, autoCompounds: {}, autoItemMarks: {}, autoUpgradeMarks: {}, withdrawals: {}, merchantQueue: [],
    merchantCurrent: null, merchantBlacklist: {}, goldTargets: {}, standBids: {}, standListings: [], npcSaleMarks: [], bankbois: {},
    merchantDeliveries: {}, nextCommandId: 1, production: {attempts: {}}};
  return {state, owner: installItems(state, {account: {response: {characters: []}, resolve_realm: () => null, updateInfo: async () => {}},
    persist() {}, merchantHeld: () => false, queue() {}, deconstruct: () => false, automaticSales: () => false, characterId: () => undefined,
    observePonty() {}, adoptReservedCargo() {}, persistBank() {}, marketReport() {}, storage: {busy: () => false, start: async () => {}},
    log() {}, removeQueued() {}, observe() {}, ponty() {}, aldata() {}, dispatch() {}, ...overrides})};
}

test('installItems answers the item reads and the blacklist from its state', () => {
  const bag = Array(42).fill(null);
  bag[0] = {name: 'hpot1', q: 5};
  const {state, owner} = install(bag);
  const free = partyHooks().ask('items.freeSlots', 'F');
  bag[1] = {name: 'mpot1', q: 5};
  assert.equal(partyHooks().ask('items.freeSlots', 'F'), free - 1, 'the read counts the bag installItems was given, as it changes');
  assert.equal(partyHooks().ask('items.needs', {id: 'a', reason: 'ALData authentication'}).postage, MAIL_POSTAGE.letter);
  const seller = {seller: 'S', serverRegion: 'US', serverIdentifier: 'I'};
  assert.equal(owner.blacklisted(seller), false);
  owner.blacklist(seller, 'stand not open');
  assert.equal(owner.blacklisted(seller), true, 'a recorded failure blocks the seller');
  state.autoBlacklistMerchants = false;
  assert.equal(owner.blacklistingEnabled(), false);
  assert.equal(owner.blacklisted(seller), false, 'the player turned the automatic blacklist off');
});

test('reconcileReport reconciles a report once, deconstruction first, and reports a change from the sales', () => {
  const order = [], bag = Array(42).fill(null);
  const {owner} = install(bag, {deconstruct: name => (order.push(['deconstruct', name]), false),
    automaticSales: report => (order.push(['sales', report.name]), true)});
  assert.equal(owner.reconcileReport({name: 'F', items: bag, seenAt: Date.now()}), true, 'the automatic sales changed state');
  assert.deepEqual(order, [['deconstruct', 'F'], ['sales', 'F']]);
});
