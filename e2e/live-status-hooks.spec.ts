import { test, expect, type LiveGame } from './live-fixtures';
import { party } from './game/hunt-lifecycle';
import { FIXTURE_RING, REPORT_FIELD, STATUS_LINE, STATUS_NOTICES, STATUS_TASK_LABEL, registerCharacterHalf, statusHooksSwitches, type Heard } from './fixtures/status-hooks-addon';

// Dashboard and status's hooks table. One fixture add-on answers `status.line` and `status.report`, hears every 12
// notice and asks the three reads, on the console project's party, in the table's order: the dashboard opens,
// the add-on's line, a dashboard command, a diagnostics view, an app key's command, a settings change,
// and the dashboard closes. Each step's title is the `fixture` its row names
// (runtime/hooks/rows/12-status.ts). The app key steps are this table's rows; the gateway half is
// console-build-gateway.spec.ts's.
const W = 'E2EWarrior';
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-status-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
const api = (live: LiveGame, route: string, init: RequestInit = {}) => fetch(`${live.deploymentPaths.apiUrl}/party-api${route}`, init);

test('status hooks: one fixture add-on registers every hook and event', async ({ live, page: dashboard }, info) => {
  test.setTimeout(600_000);
  await party(live);
  const page = live.clients[W]!;
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(statusHooksSwitches(true)) }] });
  const since = Date.now(), rows: Record<string, unknown> = {};
  const stream = new AbortController();
  try {
    await test.step('L: the dashboard opens and closes', async () => {
      const opened = await api(live, '/dashboard-stream', { signal: stream.signal });
      expect(opened.ok).toBe(true);
      await expect.poll(async () => of(await heard(live, since), 'dashboard.opened').length, { timeout: 10_000 }).toBeGreaterThan(0);
    });
    await test.step('L: each report sends status.received', async () => {
      await expect.poll(async () => of(await heard(live, since), 'status.received').filter(h => h.payload.character === W).length,
        { timeout: 30_000 }).toBeGreaterThan(1);
    });
    await test.step('L: each reply names its sections', async () => {
      const replied = of(await heard(live, since), 'status.replied').find(h => h.payload.character === W);
      expect(replied?.payload.sections, 'the reply lists the table R sections it sent').toEqual(expect.arrayContaining([expect.any(String)]));
    });
    await test.step("L: the add-on's report field reaches the card", async () => {
      await expect.poll(async () => (await live.state()).characters[W]?.addonReports?.['status-hooks-fixture']?.[REPORT_FIELD] ?? null,
        { timeout: 30_000 }).not.toBeNull();
    });
    await test.step("L: the add-on's line shows under the card line with its name", async () => {
      await fixture(live, { op: 'line', line: STATUS_LINE });
      await expect.poll(async () => (await live.state()).characters[W]?.activity?.addons ?? [], { timeout: 30_000 })
        .toContainEqual({ addon: 'status-hooks-fixture', label: `${STATUS_LINE} (${W})` });
    });
    // The add-on's task line names its own task, never "Idle". The fixture asks one
    // add-on task for the group, so table L's own line changes to its label.
    await test.step("L: the add-on task's line arrives as status.lineChanged", async () => {
      const at = Date.now();
      await fixture(live, { op: 'task', task: true });
      try {
        // The line is derived on each state read (status/coordinator/line.ts), so the poll reads the
        // state as the dashboard does, and keeps the group's task for the evidence.
        await expect.poll(async () => {
          rows.taskLine = { activity: (await live.state()).characters[W]?.activity ?? null,
            group: ((await live.tasks()).groups as { id: string; live?: unknown; waiting?: unknown; ring?: unknown[] }[]).find(g => g.id === `party:${W}`) ?? null };
          return of(await heard(live, at), 'status.lineChanged').filter(h => h.payload.character === W).map(h => h.payload.line);
        }, { timeout: 60_000, intervals: [500] }).toContainEqual(expect.stringContaining(STATUS_TASK_LABEL));
        const changed = of(await heard(live, at), 'status.lineChanged').filter(h => h.payload.character === W && String(h.payload.line).includes(STATUS_TASK_LABEL));
        expect(String(changed.at(-1)!.payload.by)).toMatch(/^L[1-9]$/);
      } finally { await fixture(live, { op: 'task', task: false }); }
    });
    await test.step('L: the add-on reads the card line', async () => {
      const read = (await fixture(live, { op: 'ask', hook: 'status.cardLine', args: [W] })).answer;
      expect(read?.text, 'the read is table L\'s line').toBe((await live.state()).characters[W]?.activity?.text);
    });
    await test.step("L: the add-on reads its character's report", async () => {
      const read = (await fixture(live, { op: 'ask', hook: 'status.lastReport', args: [W] })).answer;
      expect(read?.report?.name).toBe(W);
      expect(read?.seenAt).toBeGreaterThan(since);
    });
    await test.step('L: the stopped character reads not connected', async () => {
      expect((await fixture(live, { op: 'ask', hook: 'status.connected', args: [W] })).answer, 'a reporting character reads connected').toBe(true);
      expect((await fixture(live, { op: 'ask', hook: 'status.connected', args: ['E2ENoSuchCharacter'] })).answer).toBe(false);
    });
    await test.step('L: a dashboard command arrives as dashboard.command by user', async () => {
      await live.post(`/combat-log/${W}/clear`, {});
      const command = of(await heard(live, since), 'dashboard.command').find(h => h.payload.route === `/party-api/combat-log/${W}/clear`);
      expect(command?.payload.by).toBe('user');
    });
    await test.step('L: the diagnostics view leases the rings, then releases them', async () => {
      const at = Date.now();
      expect((await api(live, `/diagnostics/records?character=${W}&rings=movement`)).ok).toBe(true);
      expect(of(await heard(live, at), 'diagnostics.leased').map(h => h.payload.rings)).toContainEqual(['movement']);
      // The lease lasts two report periods (table G); the next read after it lapsed sees the release.
      await expect.poll(async () => { await api(live, `/diagnostics/records?character=${W}&rings=turns`);
        return of(await heard(live, at), 'diagnostics.released').length; }, { timeout: 60_000 }).toBeGreaterThan(0);
    });
    await test.step('table G: each leased ring posts after the report', async () => {
      // The turns owner's `skills.records` and the targeting owner's `targeting.records` answer the turns and targeting rings, which
      // the character posts after its report while a view leases them.
      await expect.poll(async () => {
        const read = await (await api(live, `/diagnostics/records?character=${W}&rings=turns,targeting`)).json();
        return ['turns', 'targeting'].filter(ring => read.live?.[ring]?.at > since);
      }, { timeout: 30_000 }).toEqual(['turns', 'targeting']);
    });
    await test.step("L: the add-on's ring shows as a tab of the diagnostics view", async () => {
      // The `diagnostics-ring` slot: the add-on list names the ring with its label, a view's read
      // leases it like a table G ring, and the character half's read posts after the report.
      const listed = await (await api(live, '/addons')).json();
      expect(listed.rings, 'the add-on list names the ring').toContainEqual({ ring: FIXTURE_RING.ring, addon: 'status-hooks-fixture', label: FIXTURE_RING.label });
      await expect.poll(async () => {
        const read = await (await api(live, `/diagnostics/records?character=${W}&rings=${FIXTURE_RING.ring}`)).json();
        return read.live?.[FIXTURE_RING.ring]?.records?.[0]?.readAt > since;
      }, { timeout: 30_000 }).toBe(true);
      // A ring no enabled add-on declares is refused, as an unknown table G ring is.
      expect((await api(live, `/diagnostics/records?character=${W}&rings=status-hooks-fixture.none`)).status).toBe(400);
      rows.addonRing = FIXTURE_RING.ring;
    });
    await test.step('L: a planted stuck record lights the icon', async () => {
      // The record icon reads the last ring save, which the movement owner's `records.saved` lights.
      await fixture(live, { op: 'notify', hook: 'records.saved', args: [{ ring: 'movement', character: W, record: 'df11-planted' }] });
      // The dashboard reads the icon from its core section (status/coordinator/state.ts `core`).
      await expect.poll(async () => (await (await api(live, '/state?section=core&dashboard=1')).json()).recordSaved?.record ?? null, { timeout: 10_000 }).toBe('df11-planted');
    });
    await test.step('L: a key is issued, used once and revoked', async () => {
      const at = Date.now();
      const issued = await live.post('/apps', { name: 'e2eStatusApp', scopes: ['read', 'command'], ownCommands: false });
      expect(issued.key, 'the key shows once at issue').toMatch(/^[0-9a-f]{64}$/);
      const bearer = { authorization: `Bearer ${issued.key}` };
      const state = await api(live, '/state?section=core&dashboard=1', { headers: bearer });
      expect(state.status, 'the read scope reads state').toBe(200);
      expect(JSON.stringify(await state.json()), 'K9: no answer reveals the key').not.toContain(issued.key);
      // The refused scope row: a key without `settings` writes no setting.
      const refused = await api(live, '/settings', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ changes: [{ field: 'anniversaryAutoChat', value: true }] }) });
      expect(refused.status).toBe(403);
      // An app's command names the app and ranks at `app`.
      await api(live, `/combat-log/${W}/clear`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}' });
      const command = of(await heard(live, at), 'dashboard.command').find(h => h.payload.by === 'app:e2eStatusApp');
      expect(command, 'the command is named by the app').toBeTruthy();
      expect((await live.post('/apps/e2eStatusApp/revoke', {})).app.revokedAt).toBeGreaterThan(0);
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'a revoked key is refused').toBe(401);
      const events = await heard(live, at);
      expect(of(events, 'app.keyIssued')[0]?.payload).toMatchObject({ name: 'e2eStatusApp', tier: 'app', by: 'user' });
      expect(of(events, 'app.used').length, 'each use sends app.used').toBeGreaterThanOrEqual(1);
      expect(of(events, 'app.keyRevoked')[0]?.payload.name).toBe('e2eStatusApp');
    });
    // The screen half: the Interface settings "Apps" screen (app-keys-settings.tsx)
    // issues a key, shows it once, saves a lock through the settings writer and revokes the key.
    await test.step('L: the Apps screen issues a key once, locks a setting and revokes the key', async () => {
      const at = Date.now(), name = 'e2eScreenApp';
      const settings = dashboard.getByRole('dialog', { name: 'Interface settings', exact: true });
      // The page renders its buttons before React hydrates them, so the open click repeats until
      // the dialog shows.
      const open = async () => {
        await dashboard.goto(live.url);
        await dashboard.bringToFront();
        await expect(async () => {
          if (!await settings.isVisible()) await dashboard.getByRole('button', { name: 'Interface settings', exact: true }).click();
          await expect(settings).toBeVisible();
        }).toPass();
        return settings.getByRole('region', { name: 'Apps' });
      };
      let apps = await open();
      await apps.getByLabel('App name').fill(name);
      await apps.getByRole('checkbox', { name: 'Change settings' }).check();
      await apps.getByRole('button', { name: 'Issue key' }).click();
      const shown = apps.getByTestId('issued-app-key');
      await expect(shown).toContainText(`Key for ${name}, shown only now`);
      const key = (await shown.locator('code').textContent()) ?? '';
      expect(key, 'the screen shows the issued key').toMatch(/^[0-9a-f]{64}$/);
      const bearer = { authorization: `Bearer ${key}` };
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'the screen key reads state').toBe(200);
      expect(JSON.stringify(await (await api(live, '/apps')).json()), 'K9: the app list never holds the key').not.toContain(key);
      const write = async () => {
        const answer = await api(live, '/settings', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
          body: JSON.stringify({ changes: [{ field: 'anniversaryAutoChat', value: false }] }) });
        return answer.ok ? 'written' : JSON.stringify(await answer.json());
      };
      expect(await write(), 'the settings scope writes an unlocked setting').toBe('written');
      // The lock ticked on the screen saves through the settings owner's writer, which refuses the app's write.
      await apps.getByText('Settings locked against apps', { exact: true }).click();
      // The box shows the saved lock list (app-keys-settings.tsx `locks`), so it ticks once the write
      // comes back; the row clicks it and reads the write the lock refuses.
      const lockBox = apps.getByRole('checkbox', { name: 'Anniversary auto chat', exact: true });
      await lockBox.click();
      await expect(lockBox).toBeChecked();
      await expect.poll(write).toContain('Anniversary auto chat is locked against apps');
      // K9: a reload shows the app's row and never the key again.
      apps = await open();
      await expect(apps.getByTestId('issued-app-key')).toHaveCount(0);
      const row = apps.getByTestId('app-key').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).not.toContainText(key);
      await apps.getByText('Settings locked against apps', { exact: true }).click();
      const unlockBox = apps.getByRole('checkbox', { name: 'Anniversary auto chat', exact: true });
      await unlockBox.click();
      await expect(unlockBox).not.toBeChecked();
      await row.getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(row).toHaveCount(0);
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'a key revoked on the screen is refused').toBe(401);
      const events = await heard(live, at);
      expect(of(events, 'app.keyIssued').find(h => h.payload.name === name)?.payload).toMatchObject({ tier: 'app', by: 'user' });
      expect(of(events, 'app.keyRevoked').map(h => h.payload.name)).toContain(name);
    });
    stream.abort();
    await expect.poll(async () => of(await heard(live, since), 'dashboard.closed').length, { timeout: 10_000 }).toBeGreaterThan(0);
    const all = await heard(live, since);
    rows.heard = all.slice(-200);
    // Every status event fired at its change.
    expect(STATUS_NOTICES.filter(hook => of(all, hook).length === 0), 'every notice was heard').toEqual([]);
  } finally {
    stream.abort();
    await info.attach('status-hooks', { body: JSON.stringify(rows), contentType: 'application/json' });
    await fixture(live, { op: 'off' }).catch(() => null);
    await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(statusHooksSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
