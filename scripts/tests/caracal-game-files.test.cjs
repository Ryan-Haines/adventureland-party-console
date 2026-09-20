const test = require('node:test');
const assert = require('node:assert/strict');
const files = require('../client-files.cjs');

test('current game dependencies load in official order before socket initialization', () => {
  const game = files.scripts([
    '/js/generated_zones.js', '/js/entity_animations.js', '/js/game.js',
    '/js/progression/sources.js', '/js/progression/engine.js', '/data.js',
  ].map(file => `<script src="${file}?v=16846"></script>`).join(''));
  assert.ok(game.indexOf('/js/generated_zones.js') < game.indexOf('/js/game.js'));
  assert.ok(game.includes('/js/generated_zones.js'));
  assert.ok(game.includes('/js/entity_animations.js'));
  assert.ok(game.indexOf('/js/progression/sources.js') > game.indexOf('/js/game.js'));
  assert.ok(game.indexOf('/js/progression/engine.js') > game.indexOf('/js/progression/sources.js'));
});

test('localization loads before game.js', () => {
  const game = files.get_game_files();
  assert.ok(game.indexOf('/js/phrases.js') >= 0);
  assert.ok(game.indexOf('/phrases/en.js') >= 0);
  assert.ok(game.indexOf('/js/phrases.js') < game.indexOf('/phrases/en.js'));
  assert.ok(game.indexOf('/phrases/en.js') < game.indexOf('/js/game.js'));
});
