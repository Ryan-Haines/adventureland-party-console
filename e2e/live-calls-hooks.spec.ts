import { test, expect } from './live-fixtures';
import { waitForGameplay } from './network-clock';
import { party } from './game/hunt-lifecycle';
import { CALL_NOTICES, callsHooksSwitches, heardSince, registerCallsHooksAddon, type HeardNotice } from './fixtures/calls-hooks-addon';

// The call budget's hooks table. One fixture add-on registers every notice and reads `calls.margin`;
// each row is one hook or event on one shared setup: the default fixture's warrior with row B's
// planted figure (e2e/call-budget-rows.ts `survivalRow`). The rows run in the table's order,
// and row C's planted overflow comes last, since its `limitdc` relogs the warrior. Each step's
// title is the `fixture` its `HOOKS` row names (runtime/hooks/registry.ts).
import { CALL_WINDOW_MS as WINDOW_MS, CALL_LIMIT } from '../runtime/characters/call-budget-limits.ts';
const W = 'E2EWarrior';

test('calls hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(300_000);
  const page = live.clients[W]!;
  const clock = () => page.run('Date.now()') as Promise<number>;
  // Packets come only when something changes, so each poll resends the warrior one.
  const packet = () => live.admin(`output=(()=>{resend(get_player('${W}'),'u');return true;})()`);
  const heard = async (from: number) => (await page.run(heardSince(from))) as HeardNotice[];
  const of = (list: HeardNotice[], event: string) => list.filter(n => n.event === event);
  const planted = async (figure: number) => {
    await live.plantCallCost(W, figure);
    await packet();
    await expect.poll(async () => { await packet(); return page.run(`(__partyCalls.view().cc??0)>=${figure}`); },
      { timeout: 10_000, intervals: [100], message: 'the planted figure arrives' }).toBe(true);
  };
  const unplanted = async () => { await live.plantCallCost(W, 0); await packet(); };
  // Asks a question in the page with no owner's call behind it, as the rows need.
  const ask = (band: string, method: string, emit: boolean) => page.run(`(()=>{const a=__partyHooks.calls.band({band:${JSON.stringify(band)},method:${JSON.stringify(method)},data:{}});
    if(a==='send'&&${emit})parent.socket.emit(${JSON.stringify(method)},{});return a;})()`) as Promise<string>;
  await party(live);
  expect(await page.run(registerCallsHooksAddon), 'the fixture add-on registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(callsHooksSwitches(true)) }] });
  live.undo('the calls fixture add-on switch', async () => live.post('/settings', { changes: [{ field: 'addons', value: await page.run(callsHooksSwitches(false)) }] }));
  live.undo(`the call cost plant on ${W}`, () => live.plantCallCost(W, 0));
  await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify('calls-hooks-fixture')})`), { timeout: 30_000 }).toBe(true);
  const from = await clock(), rows: Record<string, unknown> = {};
  try {
    await planted(199);
    await test.step('calls.waited: a job question waits on the planted figure, then goes', async () => {
      expect(await ask('job', 'players', true), 'the figure holds the job question').toBe('not-now');
      // The untagged emit of the next row is made while the figure holds.
      await test.step('calls.held: an untagged players emit under the planted figure is held', async () => {
        await page.run(`(parent.socket.emit('players',{}),true)`);
        const held = of(await heard(from), 'calls.held');
        rows.held = held;
        expect(held.map(n => [n.payload.character, n.payload.method, n.payload.source, n.payload.by])).toEqual([[W, 'players', 'untagged', 'core:calls']]);
      });
      await test.step('calls.margin: the add-on reads the margin while the figure holds', async () => {
        const margin = of(await heard(from), 'calls.held')[0]?.margin;
        expect(Number.isFinite(margin) && margin! > 0, `the margin the add-on read: ${margin}`).toBe(true);
      });
      await unplanted();
      await test.step('calls.released: the held players emit goes once the figure leaves', async () => {
        await expect.poll(async () => { await packet(); return of(await heard(from), 'calls.released').length; },
          { timeout: WINDOW_MS * 3, intervals: [250] }).toBe(1);
        expect(of(await heard(from), 'calls.released')[0]!.payload.method).toBe('players');
      });
      await expect.poll(async () => { await packet(); return ask('job', 'players', true); }, { timeout: WINDOW_MS * 3, intervals: [250] }).toBe('send');
      const waited = of(await heard(from), 'calls.waited');
      rows.waited = waited;
      expect(waited.map(n => [n.payload.band, n.payload.method])).toEqual([['job', 'players']]);
    });
    await test.step('calls.raised: a background read waits one window and goes in the job band', async () => {
      // A figure of 150 refuses a 16-cost background read (limit 148) and admits it in the job band
      // (the setup for the background band row).
      await planted(150);
      expect(await ask('background', 'secondhands', true)).toBe('not-now');
      await expect.poll(async () => { await packet(); return ask('background', 'secondhands', true); },
        { timeout: WINDOW_MS * 4, intervals: [250] }).toBe('send');
      const raised = of(await heard(from), 'calls.raised');
      rows.raised = raised;
      expect(raised.map(n => n.payload.method)).toEqual(['secondhands']);
      await unplanted();
    });
    await test.step('calls.unmatched: a question with no call after it is unmatched', async () => {
      await waitForGameplay(WINDOW_MS + 500);
      const at = await clock();
      expect(await ask('job', 'secondhands', false)).toBe('send');
      await expect.poll(async () => of(await heard(at), 'calls.unmatched').map(n => [n.payload.method, n.payload.band]), { timeout: 5_000 })
        .toEqual([['secondhands', 'job']]);
    });
    await test.step('calls.limitdc: the planted overflow writes the limitdc snapshot', async () => {
      // Row C's fault (e2e/call-budget-rows.ts `forcedLimitdcRow`): tracker reads sent below the
      // layer pass the server's limit.
      const at = await clock();
      live.declareLimitdc(W);
      const before = page.limitdcs().length;
      await page.run(`(()=>{const emit=parent.__partyCallBudget?.emit??parent.socket.emit;for(let i=0;i<5;i++)emit.call(parent.socket,'tracker');return true;})()`).catch(() => null);
      await expect.poll(() => page.limitdcs().slice(before).filter(e => e.event === 'limitdcreport').length, { timeout: 30_000 }).toBe(1);
      await expect.poll(async () => of(await heard(at), 'calls.limitdc').length, { timeout: 60_000, intervals: [500] }).toBe(1);
      const notice = of(await heard(at), 'calls.limitdc')[0]!;
      rows.limitdc = notice;
      expect(notice.payload.total, 'the server report total').toBeGreaterThan(CALL_LIMIT);
    });
    // Each event of the table came once, from its own change.
    const all = await heard(from);
    expect(CALL_NOTICES.filter(event => of(all, event).length === 0), 'every notice was heard').toEqual([]);
  } finally {
    await info.attach('calls-hooks', { body: JSON.stringify({ rows, heard: await heard(from).catch(() => null) }), contentType: 'application/json' });
  }
});
