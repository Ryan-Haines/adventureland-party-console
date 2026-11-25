// The declared source order (runtime/tasks/rules.ts SOURCE_ORDER): survival and the merchant
// publish their own sources from their own modules, after the tasks owner's install, and the
// registry still asks every core source in the order the console's providers asked, then the
// add-ons.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createRegistry } = require('../../runtime/hooks/registry.ts');

const source = (name, folder = 'core') => ({ name, folder, author: 'adventureland-party-console', summary: name,
  hooks: { 'task.request': () => folder === 'core' ? [] : null } });

test('the core sources ask in 01\'s declared order, whichever publishes first', () => {
  const hooks = createRegistry();
  for (const name of ['core:manual', 'core:follow-me', 'core:cave', 'core:event', 'core:rare', 'core:slot', 'core:hunt'])
    assert.equal(hooks.publish(source(name)).ok, true, name);
  assert.equal(hooks.publish(source('core:merchant-realm')).ok, true);
  assert.equal(hooks.publish(source('core:survival-tasks')).ok, true);
  assert.equal(hooks.publish(source('core:merchant-jobs')).ok, true);
  assert.deepEqual(hooks.taskRequests({ group: 'party', groupKind: 'party', members: [] }).map(r => r.name),
    ['core:manual', 'core:follow-me', 'core:cave', 'core:survival-tasks', 'core:event', 'core:merchant-realm', 'core:merchant-jobs', 'core:rare', 'core:slot', 'core:hunt']);
});
