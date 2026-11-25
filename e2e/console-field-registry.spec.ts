import { test, expect } from './fixtures';
import { characterFields, sectionFields, shadowFastOmitted } from '../runtime/status/rules.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Field registry behavior through the real coordinator and dashboard
// (docs/state-field-registry.md, Failure inventory items 3, 5, 7 and 11).
// scripts/tests/character-field-registry.test.cjs checks catalog completeness;
// these journeys check what the sections send and what the dashboard shows.

const fast = async (url: string) => (await (await fetch(`${url}/party-api/state?section=fast&dashboard=1`)).json()).characters;
const carried = async (page: import('@playwright/test').Page) =>
  Number(/carried: ([\d,]+)/.exec(await page.getByTitle(/carried: /).getAttribute('title') || '')?.[1].replaceAll(',', ''));

// The whitelist is the default, so this block sets no PARTY_STATE_FIELDS.
test.describe('enforced field registry', () => {
  test('the fast section sends only whitelisted fields and the dashboard still reads them', async ({ page, app }, info) => {
    const allowed = new Set<string>(sectionFields.fast);
    await expect.poll(async () => Object.keys(await fast(app.url) || {}).sort()).toEqual(['M', 'P', 'W']);
    const sent = await fast(app.url), full = (await app.state()).characters;
    const fields = Object.fromEntries(Object.entries(sent).map(([name, status]) => [name, Object.keys(status as object)]));
    await info.attach('enforced-fast-fields', { body: JSON.stringify({ fields, full: Object.keys(full.W) }, null, 1), contentType: 'application/json' });
    for (const [name, keys] of Object.entries(fields)) {
      expect(keys.filter(key => !allowed.has(key)), name).toEqual([]);
      expect(keys).toEqual(expect.arrayContaining(['hp', 'max_hp', 'gold', 'map', 'seenAt']));
      // The debug tier keeps every stored field; fast leaves the fixture's debug fields out.
      expect(Object.keys(full[name])).toEqual(expect.arrayContaining(['runtime', 'threats', 'items', ...keys]));
      expect(keys).not.toContain('threats');
    }
    // Without the live stream the dashboard polls section=fast (query-cache.tsx).
    await page.route('**/party-api/dashboard-stream**', route => route.abort());
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
    await expect(page.getByText('1,000 / 1,000').first()).toBeVisible();
    await expect.poll(() => carried(page)).toBeGreaterThanOrEqual(1_000_000);
  });
});

// The whitelist is the default; PARTY_STATE_FIELDS=shadow is the registry's audit mode.
test.describe('the shadow audit mode', () => {
test.use({ stateFields: 'shadow' });
test('the shadow audit mode sends every stored field except the v1.4.0 omit list', async ({ app }, info) => {
  await expect.poll(async () => Object.keys(await fast(app.url) || {}).sort()).toEqual(['M', 'P', 'W']);
  const sent = await fast(app.url), full = (await app.state()).characters;
  const omitted = new Set<string>(shadowFastOmitted);
  await info.attach('shadow-fast-fields', { body: JSON.stringify(Object.keys(sent.M)), contentType: 'application/json' });
  for (const name of ['W', 'P', 'M']) {
    // Both reads come from the same stored status, apart from the fixture heartbeat between them.
    expect(Object.keys(sent[name]).sort()).toEqual(Object.keys(full[name]).filter(key => !omitted.has(key)).sort());
    expect(Object.keys(sent[name])).toEqual(expect.arrayContaining(['runtime', 'threats']));
  }
});
});

// DF14: with the whitelist enforced, the fallback poll of each section that table F
// names sends no field outside that section's list. The PWA's and the APK's reads are scanned against
// the same lists in their own repositories (the end run's apps row), since their sources are not here.
test('every whitelisted section the fallback poll reads sends only its own fields', async ({ app }, info) => {
  await expect.poll(async () => Object.keys(await fast(app.url) || {}).sort()).toEqual(['M', 'P', 'W']);
  const sent: Record<string, Record<string, string[]>> = {};
  for (const [section, allowed] of Object.entries(sectionFields) as [string, readonly string[]][]) {
    const body = await (await fetch(`${app.url}/party-api/state?section=${section}&dashboard=1`)).json();
    sent[section] = Object.fromEntries(Object.entries(body.characters ?? {}).map(([name, status]) => [name, Object.keys(status as object)]));
    for (const [name, keys] of Object.entries(sent[section]))
      expect(keys.filter(key => !allowed.includes(key)), `${section} ${name}`).toEqual([]);
  }
  await info.attach('df14-sections', { body: JSON.stringify(sent, null, 1), contentType: 'application/json' });
});

// DF14, the apps' half: every field the PWA and the APK read is a field of table F that
// names the app among its readers and that a polled section sends, so the enforced whitelist leaves
// both apps their reads. The read sets follow docs/state-field-registry.md "Readers inventory": the
// type-aware scan of the PWA's character types, and the APK's kotlinx classes' declared fields plus
// the literal keys it reads from `CharacterDiagnostics.raw`. Their sources are the
// adventureland-party-mobile checkout that PARTY_MOBILE_ROOT names; the row skips with that reason
// when the variable is unset, so a machine without the checkout reports a skip.
test('DF14: every field the PWA and the APK read is whitelisted for them', async ({}, info) => {
  const root = process.env.PARTY_MOBILE_ROOT;
  test.skip(!root, 'PARTY_MOBILE_ROOT is unset; it names the adventureland-party-mobile checkout this row reads');
  const out = info.outputPath('pwa-reads.json');
  execFileSync(process.execPath, ['tools/state-fields/scan-readers.mts', '--project', path.join(root!, 'web/tsconfig.app.json'),
    '--include', path.join(root!, 'web/src'), '--types', 'CharacterVitals,CharacterDiagnostics,CharacterInventory', '--out', out]);
  const pwa = Object.keys(JSON.parse(readFileSync(out, 'utf8')).reads);
  // A kotlinx class's fields: each `val`, under its @SerialName where it has one.
  const kotlinFields = (file: string, name: string) => {
    const text = readFileSync(path.join(root!, 'app/src/main/java/com/partyconsole/companion/model', file), 'utf8');
    let at = text.indexOf(`data class ${name}(`) + `data class ${name}(`.length, depth = 1;
    const start = at;
    while (depth && at < text.length) { if (text[at] === '(') depth++; if (text[at] === ')') depth--; at++; }
    return [...text.slice(start, at - 1).matchAll(/(?:@SerialName\("(\w+)"\)\s*)?val (\w+)/g)].map(match => match[1] ?? match[2]);
  };
  const raw = execFileSync('git', ['-C', root!, 'grep', '-hoE', String.raw`raw\?\.get\("\w+"\)|raw\["\w+"\]`, '--', 'app/src/main/java/com/partyconsole/companion/ui',
    'app/src/main/java/com/partyconsole/companion/domain/StandInspection.kt'], { encoding: 'utf8' })
    .split('\n').map(line => /"(\w+)"/.exec(line)?.[1]).filter((key): key is string => !!key);
  const android = [...kotlinFields('Character.kt', 'CharacterVitals'), ...kotlinFields('State.kt', 'CharacterDiagnostics'), ...raw];
  const sent = new Set<string>(Object.values(sectionFields).flat() as string[]);
  const fields = characterFields as Record<string, { readers: readonly string[] }>;
  const missing: Record<string, string[]> = { pwa: [], android: [] };
  for (const [reader, reads] of [['pwa', pwa], ['android', android]] as const)
    for (const field of new Set(reads))
      if (field in fields && (!fields[field].readers.includes(reader) || !sent.has(field))) missing[reader].push(field);
  await info.attach('df14-app-reads', { body: JSON.stringify({ pwa, android, missing }, null, 1), contentType: 'application/json' });
  expect(missing).toEqual({ pwa: [], android: [] });
});
