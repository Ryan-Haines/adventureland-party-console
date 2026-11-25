const test = require('node:test'), assert = require('node:assert/strict');
const { spriteCenterOffset } = require('../../dashboard/features/party/sprite-center.ts');
test('visible sprite bounds center without resizing, ignoring transparent frame padding', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 4; y < 8; y++) for (let x = 2; x < 6; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
  assert.deepEqual(spriteCenterOffset(pixels, 8, 8, 48), {x:0,y:-12});
  // A box off centre on both axes pins the x term and the y term: columns 1-3 sit left of the frame
  // centre (+9 of 48), rows 0-1 sit above it (+18).
  const offCentre = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 2; y++) for (let x = 1; x < 4; x++) offCentre[(y * 8 + x) * 4 + 3] = 255;
  assert.deepEqual(spriteCenterOffset(offCentre, 8, 8, 48), {x:9,y:18});
  assert.deepEqual(spriteCenterOffset(new Uint8ClampedArray(8 * 8 * 4), 8, 8, 48), {x:0,y:0});
  pixels.fill(255);
  assert.deepEqual(spriteCenterOffset(pixels, 8, 8, 48), {x:0,y:0});
});
