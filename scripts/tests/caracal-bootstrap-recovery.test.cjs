const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

test('failed character bootstrap exits and requests cache repair', () => {
  const child = fs.readFileSync('.caracal/src/CharacterThread.js', 'utf8');
  assert.match(child, /type: "bootstrap_failed"/);
  assert.match(child, /process\.exit\(1\)/);
  // Coordinator repair/restart ordering is exercised through the worker manager
  // in coordinator-workers.test.cjs, rather than by inspecting source text.
});
