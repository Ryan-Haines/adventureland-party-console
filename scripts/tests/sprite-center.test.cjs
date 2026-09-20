const test = require('node:test'), assert = require('node:assert/strict');
const { spriteCenterOffset } = require('../../dashboard/features/party/sprite-center.ts');
test('visible sprite bounds center without resizing, ignoring transparent frame padding', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 4; y < 8; y++) for (let x = 2; x < 6; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
  assert.deepEqual(spriteCenterOffset(pixels, 8, 8, 48), {x:0,y:-12});
  assert.deepEqual(spriteCenterOffset(new Uint8ClampedArray(8 * 8 * 4), 8, 8, 48), {x:0,y:0});
  pixels.fill(255);
  assert.deepEqual(spriteCenterOffset(pixels, 8, 8, 48), {x:0,y:0});
});
