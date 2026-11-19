const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createLiveAccount, REFRESH_MS } = require('../../e2e/live-account.cjs');

const roster = { servers: [{ region: 'US', name: 'I', key: 'USI' }], characters: [{ name: 'E2EPriest', online: 0 }] };

test('the live e2e account refreshes on caracAL\'s interval', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../.caracal/account_info.js'), 'utf8');
  assert.match(source, new RegExp(`\\}, ${REFRESH_MS.toExponential().replace('+', '')}\\);`));
});

// application.ts answers the roster's `nextAccount` port with a listener that removes itself on
// the account's next update; the Steam login's offline read (ownership.ts confirmOffline) waits
// on it. Observed on the e2e stack: the second character's /steam/action login held past the
// fixture's 30 s request timeout.
test('the live e2e account delivers its next update without being asked', async () => {
  let asked = 0;
  const account = createLiveAccount(async () => { asked++; return roster; }, 20);
  await account.build();
  try {
    const next = new Promise(resolve => { const answered = info => { account.remove_listener(answered); resolve(info); }; account.add_listener(answered); });
    // Without the refresh this waits until the runner's --test-timeout fails it.
    assert.equal(await next, roster);
    assert.equal(account.listeners.length, 0);
    assert.ok(asked >= 2);
  } finally { account.destroy(); }
});

test('a listener that removes itself does not skip the next listener', async () => {
  const account = createLiveAccount(async () => roster);
  const told = [];
  const first = () => { account.remove_listener(first); told.push('first'); };
  account.add_listener(first); account.add_listener(() => told.push('second'));
  await account.updateInfo();
  assert.deepEqual(told, ['first', 'second']);
});
