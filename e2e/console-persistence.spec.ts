import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

// Failure inventory: docs/efficiency.md (Persistence). These journeys cover the
// items that need the real coordinator and dashboard; the rest are unit tests.

const historyKey = 'party_dashboard_history_state_v1';
function savedRecords(journal: string, key: string) {
  return readFileSync(journal, 'utf8').split('\n').filter(line => line.startsWith(`{"${key}":`)).length;
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
  return { count: sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], samples };
}
// Measurements also go to stdout, so a passing run reports them without its attachments.
async function report(info: import('@playwright/test').TestInfo, name: string, value: unknown) {
  console.log('persistence-metric', name, JSON.stringify(value));
  await info.attach(name, { contentType: 'application/json', body: JSON.stringify(value, null, 2) });
}
async function openDashboardLogs(page: import('@playwright/test').Page) {
  await page.goto('/');
  // A shared development server may finish initial module discovery and reload.
  await page.waitForTimeout(2000);
  const sidebar = page.getByRole('complementary', { name: 'Live logs' });
  // The first click can land before hydration on a cold development server.
  await expect(async () => {
    if (!await sidebar.isVisible()) await page.getByRole('button', { name: 'Show logs' }).click();
    await expect(sidebar).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await sidebar.getByRole('tab', { name: 'Dashboard logs' }).click();
  return sidebar;
}

test('combat lines show at once, save once per window and survive a restart', async ({ page, app }, info) => {
  // P2 items 2, 3 and 5: lines missing from the save, lost at shutdown, or
  // shown only after the save.
  const sidebar = await openDashboardLogs(page);
  const before = savedRecords(app.journal, historyKey);
  const started = Date.now(), latency: number[] = [], messages: string[] = [];
  for (let index = 0; index < 20; index++) {
    const message = `Persistence probe ${index}`;
    messages.push(message);
    const sent = Date.now();
    const response = await page.request.post('/party-api/combat-log', {
      headers: { Origin: app.url }, data: { character: 'W', events: [{ type: 'info', message }] } });
    expect(response.ok()).toBe(true);
    await expect(sidebar.getByText(message, { exact: true })).toBeVisible();
    latency.push(Date.now() - sent);
  }
  const elapsed = Date.now() - started, appended = savedRecords(app.journal, historyKey) - before;
  await report(info, 'combat-line-dashboard-latency', { ...summary(latency), elapsed, historyRecordsAppended: appended });
  // One save per 5 s window, plus one for a window already open at the start.
  expect(appended).toBeLessThanOrEqual(Math.ceil(elapsed / 5000) + 1);
  await app.restartCoordinator();
  const saved = (await app.state()).combatLogs.W.map((entry: { message: string }) => entry.message)
    .filter((message: string) => message.startsWith('Persistence probe'));
  expect(saved).toEqual(messages);
});

test('status reports reach the dashboard without waiting for saves', async ({ page, app }, info) => {
  // Speed requirement: saves never sit between a status report and the DOM.
  // The fixture heartbeat replaces W every second, so each probe repeats
  // until the dashboard shows it; latency counts from the first send.
  await page.goto('/');
  await page.waitForTimeout(2000);
  const base = (await app.state()).characters.W;
  await expect(page.getByText('1,000 / 1,000').first()).toBeVisible();
  const latency: number[] = [], response: number[] = [];
  for (let index = 0; index < 20; index++) {
    const hp = 501 + index, target = `${hp} / 1,000`;
    await page.evaluate(text => {
      const probe = window as unknown as { probeSeenAt?: number };
      delete probe.probeSeenAt;
      const check = () => {
        if (document.body.textContent?.includes(text)) probe.probeSeenAt = Date.now();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, target);
    const first = Date.now();
    for (;;) {
      const sent = performance.now();
      await app.deliverStatus({ ...base, name: 'W', hp });
      response.push(performance.now() - sent);
      const seen = await page.evaluate(() => (window as unknown as { probeSeenAt?: number }).probeSeenAt);
      if (seen) { latency.push(seen - first); break; }
      if (Date.now() - first > 10_000) throw Error('Dashboard never showed ' + target);
      await page.waitForTimeout(150);
    }
  }
  await report(info, 'status-dashboard-latency', { dom: summary(latency), statusResponseMs: summary(response.map(ms => Math.round(ms * 100) / 100)) });
});

// Journal records as [key, JSON text] pairs, in file order.
function journalRecords(journal: string): [string, string][] {
  return readFileSync(journal, 'utf8').split('\n').flatMap(line => {
    const key = /^\{"([^"]+)":/.exec(line)?.[1];
    return key ? [[key, line] as [string, string]] : [];
  });
}
const saved = (journal: string, key: string) => journalRecords(journal).filter(([name]) => name === key).map(([name, line]) => JSON.parse(line)[name]);
const settingsKey = 'party_dashboard_settings_state_v1';
const mailSettings = (page: import('@playwright/test').Page, url: string, settings: { autoCollect: boolean; autoDelete: boolean }) =>
  page.request.post(`${url}/party-api/mail/settings`, { headers: { Origin: url }, data: settings });

// The mail settings route needs the mailbox fixture's account boundary.
test.describe('saves through the mail settings route', () => {
  test.use({ mailbox: true });
  test('saves that repeat the last record append nothing, and a restart reads the same state', async ({ page, app }, info) => {
    // P1 items 1 and 4. Native status reports save the roster on every fixture
    // heartbeat, and each mail settings POST saves settings with unchanged content.
    await page.waitForTimeout(3000);
    for (let index = 0; index < 5; index++) expect((await mailSettings(page, app.url, { autoCollect: false, autoDelete: false })).ok()).toBe(true);
    await page.waitForTimeout(8000);
    const last = new Map<string, string>(), repeats: string[] = [], appended: Record<string, number> = {};
    for (const [key, line] of journalRecords(app.journal)) {
      if (last.get(key) === line) repeats.push(key);
      last.set(key, line);
      appended[key] = (appended[key] || 0) + 1;
    }
    await report(info, 'journal-records-by-key', { appended, repeats });
    expect(repeats).toEqual([]);
    const before = await app.state();
    await app.restartCoordinator();
    const after = await app.state();
    expect(Object.keys(after.characterSnapshots ?? {})).toEqual(Object.keys(before.characterSnapshots ?? {}));
    expect((await (await page.request.get(`${app.url}/party-api/mail`)).json()).settings).toEqual({ autoCollect: false, autoDelete: false });
  });

  test('settings save in layout 2 within a second of a change, and in the v1.4.0 layout at shutdown', async ({ page, app }, info) => {
    // P3 items 7 and 9 through the real coordinator; layout 2 keeps the market
    // cache and production under their own keys while the console runs.
    await page.waitForTimeout(2000);
    const changed = Date.now();
    expect((await mailSettings(page, app.url, { autoCollect: true, autoDelete: false })).ok()).toBe(true);
    await expect.poll(() => saved(app.journal, settingsKey).at(-1)?.mailbox?.settings?.autoCollect, { intervals: [100] }).toBe(true);
    const saveMs = Date.now() - changed;
    const running = saved(app.journal, settingsKey);
    expect(running.at(-1).persistenceLayout).toBe(2);
    expect(running.filter(record => 'production' in record || 'aldataMarketListings' in record)).toEqual([]);
    expect(saved(app.journal, 'party_dashboard_production_state_v1').length).toBeGreaterThan(0);
    expect(saved(app.journal, 'party_dashboard_market_state_v1').length).toBeGreaterThan(0);
    await app.restartCoordinator();
    const shutdown = saved(app.journal, settingsKey).filter(record => 'production' in record && 'aldataMarketListings' in record);
    await report(info, 'settings-layout', { saveMs, runningRecords: running.length, shutdownRecords: shutdown.length });
    // A material change saves within a second, plus the poll.
    expect(saveMs).toBeLessThan(2500);
    expect(shutdown.length).toBeGreaterThan(0);
    expect(shutdown.at(-1)).toMatchObject({ persistenceLayout: 2, mailbox: { settings: { autoCollect: true } } });
    expect((await (await page.request.get(`${app.url}/party-api/mail`)).json()).settings).toEqual({ autoCollect: true, autoDelete: false });
  });
});

test.describe('saved entries past their window', () => {
  const now = Date.now(), hour = 3_600_000;
  const rare = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`USII|main|1|rare-${index}`, { start: now - hour, progress: index, lowHp: 0 }]));
  test.use({ mailbox: true, savedRecords: [{ [settingsKey]: { mluckCastAt: { Expired: now - 2 * hour, Current: now - 60_000 }, rarePursuitProgress: rare } }] });
  test('load drops expired luck casts and keeps the newest 100 rare pursuits', async ({ page, app }, info) => {
    // P5 items 3, 4 and 6 through a saved journal and the real coordinator load.
    await page.waitForTimeout(2000);
    expect((await mailSettings(page, app.url, { autoCollect: true, autoDelete: false })).ok()).toBe(true);
    await expect.poll(() => saved(app.journal, settingsKey).at(-1)?.mailbox?.settings?.autoCollect, { intervals: [100] }).toBe(true);
    const record = saved(app.journal, settingsKey).at(-1);
    await report(info, 'retained-entries', { mluckCastAt: record.mluckCastAt, rare: Object.keys(record.rarePursuitProgress).length });
    expect(Object.keys(record.mluckCastAt)).toEqual(['Current']);
    expect(Object.keys(record.rarePursuitProgress)).toHaveLength(100);
    expect(record.rarePursuitProgress).not.toHaveProperty(['USII|main|1|rare-0']);
    expect(record.rarePursuitProgress).toHaveProperty(['USII|main|1|rare-100']);
  });
});

test('offline snapshots save on an inventory change, not on each 30 s refresh', async ({ page, app }, info) => {
  // Offline character snapshots (docs/efficiency.md, Persistence): nativeOwnership
  // saves the roster on every native fixture report, and a refresh that is not
  // due stays in memory until the 5 min save.
  const rosterKey = 'party_dashboard_roster_state_v1';
  await page.waitForTimeout(5000);
  const before = saved(app.journal, rosterKey).length, watched = Date.now();
  // Every character's snapshot refreshes once in this window.
  await page.waitForTimeout(36_000);
  const memory = (await app.state()).characterSnapshots;
  const refreshes = saved(app.journal, rosterKey).slice(before);
  await report(info, 'roster-records-during-refreshes', { records: refreshes.length,
    refreshedAt: Object.fromEntries(Object.entries(memory).map(([name, snapshot]: [string, any]) => [name, snapshot.updatedAt - watched])) });
  for (const snapshot of Object.values(memory) as { updatedAt: number }[]) expect(snapshot.updatedAt).toBeGreaterThan(watched);
  expect(refreshes).toEqual([]);
  const priest = { ...(await app.state()).characters.P };
  for (const field of ['seenAt', 'inventorySeenAt']) delete priest[field];
  priest.items = priest.items.map((entry: unknown, slot: number) => slot === 5 ? { slot, item: { name: 'coat', level: 1 }, meta: { properties: {} } } : entry);
  await app.deliverStatus(priest);
  await expect.poll(() => saved(app.journal, rosterKey).slice(before)
    .some(record => record.characterSnapshots?.P?.items?.[5]?.item?.name === 'coat')).toBe(true);
});

test('metrics frames answer at once, reach disk within one commit and survive a restart', async ({ page, app }, info) => {
  // Metrics history (docs/efficiency.md, Persistence): a POST answers without
  // waiting for the commit, and one shared commit writes each bucket once.
  const journal = app.journal + '.metrics.jsonl', characters = ['W', 'P', 'M'];
  const lines = () => existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [];
  const receipts = () => new Set(lines().flatMap(line => Object.values(JSON.parse(line))
    .flatMap((bucket: any) => Array.isArray(bucket?.receipts) ? bucket.receipts : [])));
  await page.waitForTimeout(1000);
  // Every frame lands in the bucket that is open now, so all nine share it.
  while (Date.now() % 10_000 > 4000) await page.waitForTimeout(200);
  const start = Date.now(), at = Math.floor(start / 10_000) * 10_000, before = lines().length;
  const frame = (sequence: number) => {
    const sample = { at: Math.min(at + 9000, Date.now()), gold: 1_000_000, luck: 100, ping: 40, level: 80, xp: 1000 + sequence, maxXp: 90_000_000 };
    return { at, sequence, observedMs: 1000, partial: false, first: sample, last: sample,
      damage: [{ monster: 'goo', skill: 'attack', amount: 100, hits: 1 }], credits: [{ monster: 'goo', count: 1 }], kills: [], loot: [] };
  };
  const ackMs: number[] = [], acknowledged: string[] = [];
  for (let sequence = 1; sequence <= 3; sequence++) {
    await Promise.all(characters.map(async character => {
      const sent = Date.now(), runtime = 'e2e-metrics-' + character;
      const response = await page.request.post(`${app.url}/party-api/metrics`, { headers: { Origin: app.url },
        data: { character, server: 'USII', runtime, frames: [frame(sequence)] } });
      expect(response.status(), await response.text()).toBe(200);
      ackMs.push(Date.now() - sent);
      acknowledged.push(JSON.stringify([character, runtime, sequence]));
    }));
    await page.waitForTimeout(300);
  }
  // Each acknowledged frame reaches the journal within one 750 ms commit.
  await expect.poll(() => { const held = receipts(); return acknowledged.filter(receipt => !held.has(receipt)); },
    { timeout: 2000, intervals: [100] }).toEqual([]);
  const appended = lines().length - before;
  await report(info, 'metrics-acknowledgement', { ...summary(ackMs), appended, frames: 9 });
  // A POST no longer waits for the commit window.
  expect(Math.max(...ackMs)).toBeLessThan(500);
  // Frames that wait for the same commit share one write of their bucket.
  expect(appended).toBeLessThan(9);
  await app.restartCoordinator();
  const metrics = await (await page.request.get(`${app.url}/party-api/metrics?from=${at - 60_000}&to=${Date.now()}`)).json();
  const samples = Object.fromEntries(characters.map(character => [character, metrics.points
    .flatMap((point: any) => point.values).filter((row: any) => row.character === character)
    .reduce((total: number, row: any) => total + row.samples, 0)]));
  expect(samples).toEqual({ W: 3, P: 3, M: 3 });
});

test('the metrics collector keeps acknowledged frames until a commit writes them, across a coordinator crash', async ({ page, app }, info) => {
  // Failure modes: the collector drops a frame on the acknowledgement while its
  // commit is still waiting, so a crash in the 750 ms window loses it; the
  // collector never sends a frame again after the restart; a resent frame counts
  // twice; a POST waits for the commit.
  test.setTimeout(120_000);
  const { installPartyMetrics } = await import('../runtime/characters/metrics.ts');
  const journal = app.journal + '.metrics.jsonl', runtime = { value: '' };
  const receipts = () => new Set((existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [])
    .flatMap(line => Object.values(JSON.parse(line)).flatMap((bucket: any) => Array.isArray(bucket?.receipts) ? bucket.receipts : [])));
  const storage = new Map<string, string>(), exchanges: any[] = [], crash: any = {};
  let running = true, crashing: Promise<void> | undefined;
  installPartyMetrics({
    now: () => Date.now(), current: () => running, connected: () => true, name: () => 'W',
    own: actor => actor === 'W', ownedCharacter: name => ['W', 'P', 'M'].includes(name),
    context: () => ({ server: 'USII', map: 'main', instance: 'main', party: ['W', 'P', 'M'] }),
    sample: () => ({ gold: 1_000_000, luck: 100, ping: 40, level: 80, xp: 1000, maxXp: 90_000_000 }),
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
    async send(batch) {
      runtime.value = batch.runtime;
      const sent = Date.now();
      const response = await fetch(`${app.url}/party-api/metrics`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(batch) });
      const body = await response.json();
      exchanges.push({ sent, ms: Date.now() - sent, status: response.status, sequences: batch.frames.map(frame => frame.sequence), body });
      if (!response.ok) throw Error(`metrics POST ${response.status}`);
      // Crash right after the first acknowledgement whose commit has not run yet.
      if (!crashing && batch.frames.length && body.commit > body.durableCommit) {
        crash.acknowledged = batch.frames.map(frame => JSON.stringify(['W', batch.runtime, frame.sequence]));
        crashing = app.crashCoordinator(() => {
          const held = receipts();
          crash.onDiskAfterKill = crash.acknowledged.filter((receipt: string) => held.has(receipt));
        });
      }
      return body;
    },
  });
  const header = () => JSON.parse(storage.get('party-metrics-v1:W') || '{"sequence":0,"queue":[]}') as { sequence: number; queue: number[] };
  let sealed = 0;
  try {
    await expect.poll(() => !!crashing, { timeout: 20_000 }).toBe(true);
    await crashing;
    // The crash came inside the commit window: the acknowledged frames were not on disk.
    expect(crash.onDiskAfterKill).toEqual([]);
    // Every frame sealed by a moment after the restart reaches the journal and leaves the outbox.
    await page.waitForTimeout(3000);
    sealed = header().sequence;
    await expect.poll(() => header().queue.filter(sequence => sequence <= sealed),
      { timeout: 30_000, intervals: [250] }).toEqual([]);
  } finally { running = false; }
  const expected = Array.from({ length: sealed }, (_, index) => JSON.stringify(['W', runtime.value, index + 1]));
  const held = receipts();
  await report(info, 'metrics-crash-durability', { sealed, crash, missing: expected.filter(receipt => !held.has(receipt)),
    ackMs: summary(exchanges.map(exchange => exchange.ms)), exchanges });
  expect(expected.filter(receipt => !held.has(receipt))).toEqual([]);
  // A frame sent to both coordinator processes counts once: the query returns one sample per frame on disk.
  await page.waitForTimeout(2000);
  const onDisk = [...receipts()].filter(receipt => JSON.parse(receipt)[0] === 'W').length;
  const metrics = await (await page.request.get(`${app.url}/party-api/metrics?from=${Date.now() - 600_000}&to=${Date.now()}`)).json();
  const samples = metrics.points.flatMap((point: any) => point.values).filter((row: any) => row.character === 'W')
    .reduce((total: number, row: any) => total + row.samples, 0);
  expect(samples).toBe(onDisk);
  expect(Math.max(...exchanges.filter(exchange => exchange.status === 200).map(exchange => exchange.ms))).toBeLessThan(500);
});

test.describe('mail read marks', () => {
  const old = Array.from({ length: 2100 }, (_, index) => `old-mail-${index}`);
  test.use({ mailbox: true, savedRecords: [{ [settingsKey]: { mailbox: { settings: { autoCollect: false, autoDelete: false }, seenIds: old, outbox: [] } } }] });
  test('opening the mail keeps the newest 2000 read marks, including every listed mail', async ({ page, app }, info) => {
    // Mail read marks (docs/efficiency.md, Persistence): seenIds keeps the newest SEEN_IDS_KEPT ids.
    await page.goto('/');
    await expect(page.getByLabel('New mail')).toBeVisible();
    await page.getByRole('button', { name: /^Mail/ }).click();
    await expect(page.getByRole('dialog', { name: 'Mail', exact: true })).toBeVisible();
    await expect(page.getByLabel('New mail')).toHaveCount(0);
    await expect.poll(() => saved(app.journal, settingsKey).at(-1)?.mailbox?.seenIds?.length).toBe(2000);
    const seen: string[] = saved(app.journal, settingsKey).at(-1).mailbox.seenIds;
    await report(info, 'mail-read-marks', { kept: seen.length, first: seen[0], last: seen.slice(-4) });
    expect(seen).toEqual(expect.arrayContaining(['mail-unclaimed', 'mail-pending', 'mail-text']));
    expect(seen).not.toContain('old-mail-0');
    expect(seen).toContain('old-mail-2099');
    await app.restartCoordinator();
    expect((await (await page.request.get(`${app.url}/party-api/mail`)).json()).newCount).toBe(0);
  });
});
