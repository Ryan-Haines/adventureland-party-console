const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { namedFunction } = require('./helpers/named-function.cjs');
const { productionFunction } = require('./helpers/production-functions.cjs');
const { publicStateRuntime } = require('./helpers/coordinator-public-state.cjs');
const registry = require('../../runtime/status/rules.ts');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = (text, kind = ts.ScriptKind.JS) => ts.createSourceFile('fixture', text, ts.ScriptTarget.Latest, true, kind);
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }

/**
 * Property names of an object literal. A spread of rules.ts `reportedStats` adds the keys that function
 * returns. Any other spread or a computed key fails, because the catalog test could not see its keys.
 */
function literalKeys(literal, where) {
  return literal.properties.flatMap(property => {
    if (ts.isSpreadAssignment(property) && ts.isCallExpression(property.expression) && property.expression.expression.getText() === 'reportedStats')
      return Object.keys(registry.reportedStats({}));
    if (ts.isSpreadAssignment(property)) throw Error(`${where}: a spread hides report keys from the field catalog`);
    if (property.name && ts.isComputedPropertyName(property.name)) throw Error(`${where}: a computed key hides a report key from the field catalog`);
    return [property.name.text];
  });
}

// The client reports snapshot() merges in whole (report.ts `Object.assign(body, ...)`), each read from its module's `report`.
const clientReports = {
  'o.hunting.rares.report()': 'runtime/hunting/character/rares.ts',
  'o.hunting.farm.report()': 'runtime/hunting/character/farm.ts',
};
/** Keys of the object a module's `report` property returns, as an arrow body or a method's return. */
function clientReportKeys(file) {
  const keys = new Set();
  visit(parse(read(file), ts.ScriptKind.TS), node => {
    if (!(ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) || node.name.getText() !== 'report') return;
    const fn = ts.isPropertyAssignment(node) ? node.initializer : node;
    visit(fn, inner => {
      const returned = ts.isReturnStatement(inner) ? inner.expression : inner === fn.body ? inner : null;
      const literal = returned && ts.isParenthesizedExpression(returned) ? returned.expression : returned;
      if (literal && ts.isObjectLiteralExpression(literal)) literalKeys(literal, file + ' report').forEach(key => keys.add(key));
    });
  });
  assert.ok(keys.size, `${file}: report literal was not found`);
  return keys;
}

/** Every key the character script reports, read from the real report builders (the status owner's report.ts `snapshot`). */
function reportedKeys() {
  const keys = new Set();
  const snapshot = parse(namedFunction(read('runtime/status/character/report.ts'), 'snapshot'), ts.ScriptKind.TS);
  visit(snapshot, node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'body' && node.initializer && ts.isObjectLiteralExpression(node.initializer))
      literalKeys(node.initializer, 'snapshot()').forEach(key => keys.add(key));
    // The catalogs join the body through an object literal while they ride (`carried`); the hunting
    // clients join through their own `report()`. Any other source fails, so the scan never misses keys.
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0]?.getText() === 'body')
      for (const source of node.arguments.slice(1)) {
        if (ts.isObjectLiteralExpression(source)) literalKeys(source, 'snapshot() catalogs').forEach(key => keys.add(key));
        else if (clientReports[source.getText()]) clientReportKeys(clientReports[source.getText()]).forEach(key => keys.add(key));
        else throw Error(`snapshot(): Object.assign source ${source.getText()} hides report keys from the field catalog`);
      }
  });
  assert.ok(keys.size > 100, 'snapshot() status literal was not found');
  // snapshot() hands the status to attachStatusInventory, which adds the inventory only when it changed.
  for (const builder of ['attachStatusInventory', 'withStatusInventory']) visit(parse(productionFunction(builder)), node => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0]?.getText() === 'status' &&
        node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1]))
      literalKeys(node.arguments[1], builder).forEach(key => keys.add(key));
  });
  // The travel sample is the walk client's (runtime/movement/character/walk-client.ts).
  const sample = parse(namedFunction(read('runtime/movement/character/walk-client.ts'), 'sampleTravelReport'), ts.ScriptKind.TS);
  visit(sample, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'body')
      keys.add(node.left.name.text);
    if (ts.isCallExpression(node) && node.expression.getText() === 'Object.assign' && node.arguments[0]?.getText() === 'body')
      literalKeys(node.arguments[1], 'sampleTravelReport()').forEach(key => keys.add(key));
  });
  return keys;
}

/**
 * Keys the coordinator adds to a character: the intake's stamps beside `...body`, an owner's
 * `status.<key> =` on a stored status (the events owner's `eventLeads`), and the keys status/coordinator/state.ts
 * adds to each section's copy beside the status (`activity`).
 */
function coordinatorKeys() {
  const keys = new Set();
  visit(parse(read('runtime/status/coordinator/intake.ts'), ts.ScriptKind.TS), node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isSpreadAssignment(p) && p.expression.getText() === 'body'))
      for (const property of node.properties) if (!ts.isSpreadAssignment(property)) keys.add(property.name.text);
  });
  assert.ok(keys.has('seenAt'), 'ingestion seenAt stamp was not found');
  for (const file of coordinatorFiles()) visit(parse(read(file), ts.ScriptKind.TS), node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.getText() === 'status')
      keys.add(node.left.name.text);
  });
  visit(parse(read('runtime/status/coordinator/state.ts'), ts.ScriptKind.TS), node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isSpreadAssignment(p) && /\bstatus\b/.test(p.expression.getText())))
      for (const property of node.properties) if (!ts.isSpreadAssignment(property)) keys.add(property.name.text);
  });
  return keys;
}

/** Every coordinator source file (runtime/<owner>/coordinator/**), where the ingestion stamps and consumers live. */
function coordinatorFiles(directory = 'runtime', inside = false) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) return coordinatorFiles(file, inside || entry.name === 'coordinator');
    return inside && entry.name.endsWith('.ts') ? [file] : [];
  });
}

/** Report keys a coordinator owner deletes before storing (intake.ts, the hunting owner's modes.ts, the merchant owner's market, storage and owner). */
function consumedKeys() {
  const keys = new Set();
  for (const file of coordinatorFiles()) visit(parse(read(file), ts.ScriptKind.TS), node => {
    if (ts.isDeleteExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['body', 'raw', 'report'].includes(node.expression.expression.getText()))
      keys.add(node.expression.name.text);
    // The intake deletes table F's catalog rows by name (`for (const key of CATALOG_FIELDS) delete body[key]`).
    if (ts.isForOfStatement(node) && node.expression.getText() === 'CATALOG_FIELDS' && node.statement.getText().includes('delete body[key]'))
      for (const key of registry.CATALOG_FIELDS) keys.add(key);
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
  assert.deepEqual(missing, [], 'Add these report fields to table F in runtime/status/rules.ts');
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
});

test('a field is lean exactly when an external client reads it from a lean section or the stream', () => {
  for (const name of names)
    assert.equal(catalog[name].tier, catalog[name].readers.length || registry.streamFields.includes(name) ? 'lean' : 'debug', name);
});

test('the fast whitelist is every stored lean field except the large ones v1.4.0 already left to inventory', () => {
  const expected = storedNames.filter(name => catalog[name].tier === 'lean' && !registry.shadowFastOmitted.includes(name));
  assert.deepEqual([...registry.sectionFields.fast].sort(), expected.sort());
  for (const field of registry.streamFields) assert.ok(registry.sectionFields.fast.includes(field), field + ' must reach the fast fallback for the live stream');
  for (const field of registry.sectionFields.inventory) assert.equal(catalog[field].tier, 'lean', field);
});

// The whitelist is the default; only PARTY_STATE_FIELDS=shadow, the audit mode, sends more.
test('enforced fast section sends exactly the whitelisted fields, and enforce is the default', () => {
  for (const mode of [undefined, 'enforce', 'anything-else']) withMode(mode, () => {
    const value = readSection(runtimeWithEveryField().route, { section: 'fast', dashboard: '1' });
    assert.deepEqual(Object.keys(value.characters.P).sort(), [...registry.sectionFields.fast].sort(), String(mode));
    for (const field of ['groupedCombat', 'items', 'slots', 'farmingNavigationDebug'])
      assert.equal(Object.hasOwn(value.characters.P, field), false, field);
  });
});

test('shadow fast section is the v1.4.0 omit-list output', () => {
  for (const mode of ['shadow']) withMode(mode, () => {
    const value = readSection(runtimeWithEveryField().route, { section: 'fast', dashboard: '1' });
    assert.deepEqual(Object.keys(value.characters.P).sort(), storedNames.filter(name => !v140FastOmitted.includes(name)).sort(), String(mode));
  });
});

test('the full state request still returns every stored field in both modes', () => {
  for (const mode of ['shadow', 'enforce']) withMode(mode, () => {
    const r = runtimeWithEveryField();
    const value = readSection(r.route, {});
    // The card line comes from line.ts through the `activity` port, never from the stored report.
    assert.deepEqual(value.characters.P, { ...JSON.parse(JSON.stringify(r.party.statuses.P)), activity: null }, mode);
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
  // The coordinator derives `online` beside `combat` from the presence rule; neither is a stored diagnostics field.
  assert.deepEqual(Object.keys(details).filter(key => key !== 'combat' && key !== 'online').sort(), [...registry.sectionFields.diagnostics].sort());
}));

// DF22: table F's `dashboard` readers come from the dashboard's real reads. The scan reads
// every dashboard source file, so a field the table says the dashboard reads appears there as a
// property access, a quoted key or an object key.
test('DF22: every field table F says the dashboard reads is read by the dashboard source', () => {
  const sources = [];
  const walk = directory => { for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file); else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(read(file));
  } };
  walk('dashboard/features'); walk('dashboard/lib');
  const text = sources.join('\n');
  const unread = Object.entries(catalog).filter(([, field]) => field.readers.includes('dashboard'))
    .map(([name]) => name).filter(name => !new RegExp(`(\\.|['"\`])${name}\\b|\\b${name}\\s*[?]?:`).test(text));
  assert.deepEqual(unread, [], 'fields listed with the dashboard as reader that no dashboard file reads');
});
