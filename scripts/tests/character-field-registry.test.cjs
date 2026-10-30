const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { namedFunction } = require('./helpers/named-function.cjs');
const { publicStateRuntime } = require('./helpers/coordinator-public-state.cjs');
const registry = require('../../runtime/coordinator/telemetry/character-fields.ts');
const { liveFields } = require('../../runtime/coordinator/telemetry/dashboard-stream.ts');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = (text, kind = ts.ScriptKind.JS) => ts.createSourceFile('fixture', text, ts.ScriptTarget.Latest, true, kind);
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }

/** Property names of an object literal. A spread or computed key fails, because the catalog test could not see its keys. */
function literalKeys(literal, where) {
  return literal.properties.map(property => {
    if (ts.isSpreadAssignment(property)) throw Error(`${where}: a spread hides report keys from the field catalog`);
    if (property.name && ts.isComputedPropertyName(property.name)) throw Error(`${where}: a computed key hides a report key from the field catalog`);
    return property.name.text;
  });
}

/** Every key the character script reports, read from the real report builders in characters/shared.js. */
function reportedKeys() {
  const shared = read('characters/shared.js');
  const keys = new Set();
  const snapshot = parse(namedFunction(shared, 'snapshot'));
  visit(snapshot, node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'status' && node.initializer && ts.isObjectLiteralExpression(node.initializer))
      literalKeys(node.initializer, 'snapshot()').forEach(key => keys.add(key));
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'status')
      keys.add(node.left.name.text);
  });
  assert.ok(keys.size > 100, 'snapshot() status literal was not found');
  // snapshot() hands the status to attachStatusInventory, which adds the inventory only when it changed.
  for (const builder of ['attachStatusInventory', 'withStatusInventory']) visit(parse(namedFunction(shared, builder)), node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'status')
      keys.add(node.left.name.text);
  });
  const sample = parse(namedFunction(shared, 'sampleTravelReport'));
  visit(sample, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'body')
      keys.add(node.left.name.text);
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0]?.getText() === 'body')
      literalKeys(node.arguments[1], 'sampleTravelReport()').forEach(key => keys.add(key));
  });
  return keys;
}

/** Keys the coordinator adds while storing a full report (runtime/coordinator/status/ingestion.ts). */
function coordinatorKeys() {
  const keys = new Set();
  visit(parse(read('runtime/coordinator/status/ingestion.ts'), ts.ScriptKind.TS), node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isSpreadAssignment(p) && p.expression.getText() === 'body'))
      for (const property of node.properties) if (!ts.isSpreadAssignment(property)) keys.add(property.name.text);
  });
  assert.ok(keys.has('seenAt'), 'ingestion seenAt stamp was not found');
  return keys;
}

/** Report keys the coordinator deletes before storing (status/catalogs.ts, bank.ts, ponty.ts, inventory-carry.ts). */
function consumedKeys() {
  const keys = new Set();
  for (const file of ['catalogs.ts', 'bank.ts', 'ponty.ts', 'inventory-carry.ts']) visit(parse(read('runtime/coordinator/status/' + file), ts.ScriptKind.TS), node => {
    if (ts.isDeleteExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['body', 'raw'].includes(node.expression.expression.getText()))
      keys.add(node.expression.name.text);
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'consumedFields')
      for (const element of node.initializer.expression.elements) keys.add(element.text);
  });
  return keys;
}

const catalog = registry.characterFields;
const names = Object.keys(catalog);
const storedNames = names.filter(name => catalog[name].stored);
// v1.4.0's literal omit list, written out so the test does not trust the module it checks.
const v140FastOmitted = ['items', 'slots', 'bank', 'realmPlayers', 'nearbyStandListings', 'nearbyGiveaways', 'characterDollHtml'];
/** A status carrying every stored catalog field, each with a distinct value. */
function everyFieldStatus(name = 'P') {
  return Object.fromEntries(storedNames.map(field => [field,
    field === 'name' ? name : field === 'items' ? [{ slot: 0, item: { name: 'coat' }, meta: { sprite: 's', unneeded: 'x' } }]
      : field === 'slots' ? { helmet: { item: { name: 'helmet' }, meta: { sprite: 'h' } } }
      : field === 'combat' ? { positioning: { mode: 'hold' }, runner: { private: true } } : { field }]));
}
function readSection(route, query) { let result; route({ query }, { json: value => { result = value; } }); return JSON.parse(JSON.stringify(result)); }
function withMode(mode, callback) {
  const before = process.env.PARTY_STATE_FIELDS;
  if (mode === undefined) delete process.env.PARTY_STATE_FIELDS; else process.env.PARTY_STATE_FIELDS = mode;
  try { return callback(); } finally { if (before === undefined) delete process.env.PARTY_STATE_FIELDS; else process.env.PARTY_STATE_FIELDS = before; }
}
function runtimeWithEveryField() {
  const r = publicStateRuntime();
  r.party.statuses = { P: everyFieldStatus('P') };
  return r;
}

test('every key the character script reports or the coordinator stamps appears in the field catalog', () => {
  const missing = [...reportedKeys(), ...coordinatorKeys()].filter(key => !Object.hasOwn(catalog, key));
  assert.deepEqual(missing, [], 'Add these report fields to runtime/coordinator/telemetry/character-fields.ts');
});

test('the catalog lists no field the script and coordinator no longer produce', () => {
  const produced = new Set([...reportedKeys(), ...coordinatorKeys()]);
  assert.deepEqual(names.filter(name => !produced.has(name)), []);
});

test('fields the coordinator consumes at ingestion are marked as not stored', () => {
  const consumed = consumedKeys();
  for (const name of names) assert.equal(catalog[name].stored, !consumed.has(name), name);
});

test('every catalog entry names its tier, size, description and readers', () => {
  for (const [name, field] of Object.entries(catalog)) {
    assert.ok(field.description.length >= 5, name);
    assert.ok(['lean', 'debug'].includes(field.tier), name);
    assert.ok(['small', 'large'].includes(field.size), name);
    if (field.size === 'large') assert.ok(field.bytes, name + ' needs a measured or estimated size');
    assert.ok(Array.isArray(field.readers), name);
  }
});

test('every whitelisted field exists in the catalog and is stored', () => {
  for (const [section, fields] of Object.entries(registry.sectionFields))
    for (const field of fields) {
      assert.ok(Object.hasOwn(catalog, field), `${section}.${field} is not in the catalog`);
      assert.equal(catalog[field].stored, true, `${section}.${field} never reaches state.statuses`);
    }
  assert.deepEqual([...registry.streamFields], [...liveFields], 'character-fields.ts streamFields must match dashboard-stream.ts liveFields');
});

test('a field is lean exactly when an external client reads it from a lean section or the stream', () => {
  for (const name of names)
    assert.equal(catalog[name].tier, catalog[name].readers.length || liveFields.includes(name) ? 'lean' : 'debug', name);
});

test('the fast whitelist is every stored lean field except the large ones v1.4.0 already left to inventory', () => {
  const expected = storedNames.filter(name => catalog[name].tier === 'lean' && !registry.shadowFastOmitted.includes(name));
  assert.deepEqual([...registry.sectionFields.fast].sort(), expected.sort());
  for (const field of liveFields) assert.ok(registry.sectionFields.fast.includes(field), field + ' must reach the fast fallback for the live stream');
  for (const field of registry.sectionFields.inventory) assert.equal(catalog[field].tier, 'lean', field);
});

test('enforced fast section sends exactly the whitelisted fields', () => withMode('enforce', () => {
  const value = readSection(runtimeWithEveryField().route, { section: 'fast', dashboard: '1' });
  assert.deepEqual(Object.keys(value.characters.P).sort(), [...registry.sectionFields.fast].sort());
  for (const field of ['combatTrace', 'groupedCombat', 'items', 'slots', 'farmingNavigationDebug'])
    assert.equal(Object.hasOwn(value.characters.P, field), false, field);
}));

test('shadow fast section is the v1.4.0 omit-list output, and shadow is the default', () => {
  for (const mode of [undefined, 'shadow', 'anything-else']) withMode(mode, () => {
    const value = readSection(runtimeWithEveryField().route, { section: 'fast', dashboard: '1' });
    assert.deepEqual(Object.keys(value.characters.P).sort(), storedNames.filter(name => !v140FastOmitted.includes(name)).sort(), String(mode));
  });
});

test('the full state request still returns every stored field in both modes', () => {
  for (const mode of ['shadow', 'enforce']) withMode(mode, () => {
    const r = runtimeWithEveryField();
    const value = readSection(r.route, {});
    assert.deepEqual(value.characters.P, JSON.parse(JSON.stringify(r.party.statuses.P)), mode);
    assert.deepEqual(Object.keys(value.characters.P).sort(), [...storedNames].sort(), mode);
  });
});

test('inventory and core sections keep their v1.4.0 shape', () => withMode('enforce', () => {
  const r = runtimeWithEveryField();
  const inventory = readSection(r.route, { section: 'inventory', dashboard: '1' }).characters.P;
  assert.deepEqual(Object.keys(inventory).sort(), ['characterDollHtml', 'items', 'slots']);
  assert.equal(inventory.items[0].meta.unneeded, undefined);
  assert.equal(inventory.items[0].meta.sprite, 's');
  const core = readSection(r.route, { section: 'core', dashboard: '1' });
  assert.deepEqual(core.characters.P, { name: 'P', ctype: { field: 'ctype' }, level: { field: 'level' }, server: { field: 'server' } });
  const details = core.characterDetails.P;
  assert.deepEqual(details.combat, { positioning: { mode: 'hold' } });
  assert.deepEqual(Object.keys(details).filter(key => key !== 'combat').sort(), [...registry.sectionFields.diagnostics].sort());
}));
