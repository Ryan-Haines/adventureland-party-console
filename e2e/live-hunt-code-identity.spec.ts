import {readFile} from 'node:fs/promises';
import {test, expect} from './live-fixtures';

test('native characters acknowledge executing CODE hashes and preserve inventory across coordinator restart', async ({live}, info) => {
  test.setTimeout(180_000);
  // Failure inventory: docs/testing-console-build-staging.md. These are real
  // native CODE reports, not substituted heartbeat or generation observations.
  const manifest = JSON.parse(await readFile('.build/game/manifest.json', 'utf8'));
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => {
      const report = state.characters[name];
      return report?.seenAt > Date.now() - 5000 && report.codeHash === manifest.classes[report.ctype].sha256;
    });
  }, {timeout: 30_000}).toBe(true);
  const inventory = async () => live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>{const p=get_player(name);return [name,{items:p.items,slots:p.slots,gold:p.gold}]}))`);
  const before = await inventory();
  await info.attach('native-code-before', {body: JSON.stringify({state: await live.state(), inventory: before}), contentType: 'application/json'});
  await live.restartCoordinator();
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => {
      const report = state.characters[name];
      return report?.seenAt > Date.now() - 5000 && report.codeHash === manifest.classes[report.ctype].sha256;
    });
  }, {timeout: 30_000}).toBe(true);
  expect(await inventory()).toEqual(before);
  await info.attach('native-code-after', {body: JSON.stringify({state: await live.state(), inventory: await inventory()}), contentType: 'application/json'});
});
