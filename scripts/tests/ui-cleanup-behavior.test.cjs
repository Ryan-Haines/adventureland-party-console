// The status owner's dashboard fixes: the status countdown, DF43, DF44 and DF20.
const test = require('node:test'), assert = require('node:assert/strict');
const {observeStatus,statusRemaining} = require('../../dashboard/features/party/status-duration.ts');
test('status countdown retains duration across polls, refreshes and handles unknown duration',()=>{
 const condition={id:'luck',remainingMs:10000,definition:{},source:'M'};
 let value=observeStatus(condition,undefined,1000);
 assert.equal(statusRemaining(value,6000),5000);
 assert.equal(observeStatus(condition,value,4000),value);
 value=observeStatus({...condition,remainingMs:7000},value,4000);
 assert.equal(statusRemaining(value,5000),6000);
 value=observeStatus({...condition,remainingMs:20000},value,5000);
 assert.equal(statusRemaining(value,26000),0);
 assert.equal(observeStatus({...condition,remainingMs:null},value,6000),undefined);
});

// DF43: on a console reached by plain HTTP the browser has no
// crypto.randomUUID and no clipboard. The one id helper builds a version 4 UUID from getRandomValues,
// no dashboard file calls randomUUID, and Copy key uses the clipboard only on a secure origin.
test('DF43: ids and Copy key work on a plain-HTTP origin', () => {
  const fs = require('node:fs'), { execFileSync } = require('node:child_process');
  const saved = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    const { requestId } = require('../../dashboard/lib/request-id.ts');
    const ids = [requestId(), requestId()];
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(ids[0], ids[1]);
  } finally { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: saved, configurable: true }); }
  const callers = execFileSync('git', ['grep', '-l', 'randomUUID', '--', 'dashboard/features', 'dashboard/app', 'dashboard/lib'], { encoding: 'utf8' })
    .split('\n').filter(file => file && file !== 'dashboard/lib/request-id.ts');
  assert.deepEqual(callers, [], 'every id site uses the one helper');
  const panel = fs.readFileSync('dashboard/features/party/party-inventory-panels.tsx', 'utf8');
  assert.match(panel, /if \(secureOrigin\) navigator\.clipboard\.writeText\(aldataKey\)\.catch\(select\);\s*else select\(\);/);
  assert.match(panel, /press Ctrl\+C to copy it/);
});

// DF44: the giveaway picker takes a typed host the directory never
// listed, checked by the game's name rule, the lifecycle owner's one copy.
test('DF44: a typed giveaway host passes only by the game name rule', () => {
  const { characterNameAllowed } = require('../../runtime/lifecycle/api.ts');
  // The game's rule allows between 4 and 12 letters, digits and underscores.
  for (const name of ['Seller', 'seller_2', 'A1b2']) assert.equal(characterNameAllowed(name), true, name);
  for (const name of ['', 'A1', '12345', 'two words', 'semi;colon']) assert.equal(characterNameAllowed(name), false, name);
  const panels = require('node:fs').readFileSync('dashboard/features/party/party-management-panels.tsx', 'utf8');
  assert.match(panels, /characterNameAllowed\(/, 'the picker checks a typed host by the rule');
});

// DF20: each dashboard bug fix keeps its fix. The Cipher id is DF43
// above; the import path and size are dashboard-state-import.test.cjs; the Cave map floor is
// daily-dungeons-dashboard.test.cjs.
test('DF20: the D2 dashboard bug fixes hold', async () => {
  const fs = require('node:fs');
  const read = name => fs.readFileSync('dashboard/features/party/' + name, 'utf8');
  const load = require('./helpers/dashboard-query-module.cjs');
  // Event times read the events owner's milliseconds as they are: a time an hour away shows 60m, not a seconds guess.
  const { eventTimeLabel } = load('event-selection-control.tsx');
  const now = Date.UTC(2026, 10, 13, 12);
  assert.match(eventTimeLabel(now + 3_600_000, now), /\(60m 0s\)$/);
  assert.match(eventTimeLabel(5e11, 0), /\(8333333m 20s\)$/, 'a value under 1e12 stays milliseconds');
  for (const name of ['event-selection-control.tsx', 'anniversary-dialog.tsx']) assert.doesNotMatch(read(name), /1e12/, name);
  // The escape label reads an ASCII dash, not the mojibake of an em dash.
  assert.match(read('escape-control.tsx'), /'Escape - exit dungeon'/);
  assert.doesNotMatch(read('escape-control.tsx'), /â€/);
  // Monster priority saves once, when the box commits; typing only edits the draft.
  const picker = read('monster-focus-picker.tsx');
  assert.match(picker, /const commitPriority = \(id: string\) => \{\s*if \(!\(id in priorityDrafts\)\) return;/);
  assert.match(picker, /if \(priorities && onPriorityChange && value !== priorities\[id\]\) onPriorityChange\(\{ \.\.\.priorities, \[id\]: value \}\);/);
  const draft = picker.slice(picker.indexOf('setPriorityDrafts((current) => ({ ...current, [id]: draft }));'));
  assert.doesNotMatch(draft.slice(0, draft.indexOf('};')), /onPriorityChange/, 'a keystroke saves nothing');
  // The deploy request's refusal shows on the control.
  const build = read('console-build-control.tsx');
  assert.match(build, /catch \(error\) \{\s*setDeployError\(error instanceof Error \? error\.message : String\(error\)\);/);
  assert.match(build, /\{deployError && <p className="break-words text-sm text-red-300">\{deployError\}<\/p>\}/);
  // The game image proxy hands the browser's abort to its fetch and keeps the game's Cache-Control.
  const { proxyGameImage } = require('../../dashboard/lib/game-image.ts');
  const saved = globalThis.fetch;
  let signal;
  try {
    globalThis.fetch = async (_url, init) => { signal = init.signal; return new Response('png', { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=60' } }); };
    const abort = new AbortController();
    const answer = await proxyGameImage(new Request('http://console/proxy?url=/images/tiles/map/a.png', { signal: abort.signal }), '/images/', /\.png$/, 'Map image');
    assert.equal(answer.headers.get('cache-control'), 'max-age=60');
    abort.abort();
    assert.equal(signal.aborted, true, 'the browser drops the request and the fetch ends with it');
    assert.equal((await proxyGameImage(new Request('http://console/proxy?url=https://example.com/a.png'), '/images/', /\.png$/, 'Map image')).status, 400);
    globalThis.fetch = async () => { throw new Error('stalled'); };
    assert.equal((await proxyGameImage(new Request('http://console/proxy?url=/images/a.png'), '/images/', /\.png$/, 'Map image')).status, 502);
  } finally { globalThis.fetch = saved; }
  // A headless character's gear comparison shows the doll the coordinator saved for it.
  assert.match(read('gear-comparison-dialog.tsx'), /comparison\?\.character\.characterDollHtml \|\|\s*savedDollHtml,/);
  assert.match(read('party-reference-panels.tsx'), /savedDollHtml=\{/);
  // A blocked log filter save is caught: the sidebar saves through the stored-JSON hook, whose write
  // catches a refused setItem.
  assert.match(read('log-sidebar.tsx'), /useStoredJson<Record<string,boolean>>\('party-log-filters',/);
  assert.match(fs.readFileSync('dashboard/hooks/use-stored-boolean.ts', 'utf8'), /try \{\s*localStorage\.setItem\(key, text\);\s*\} catch \{/);
  // The two trip toggles are one control.
  const settings = read('merchant-collection-settings.tsx');
  assert.match(settings, /<MerchantTripSetting routine="deliveries" enabled=\{deliveryTripsEnabled\} \/>/);
  assert.match(settings, /<MerchantTripSetting routine="withdrawals" enabled=\{withdrawalTripsEnabled\} \/>/);
  assert.equal(fs.existsSync('dashboard/features/party/withdrawal-trip-setting.tsx'), false);
});
