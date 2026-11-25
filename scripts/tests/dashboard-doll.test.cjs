const test = require('node:test');
const assert = require('node:assert/strict');
const { gameReads } = require('./helpers/status-report.cjs');

function fixture(desktop) {
  return gameReads({
    G: { sprites: { body: { file: '/images/body.png?v=3' }, head: { file: '/images/head.png' } } },
    parent: { desktop }, character: { skin: 'body', cx: { head: 'head' } },
    sprite: () => `<div><img style="width: 648px" src="blob:https://adventure.land/body"><img src='blob:https://adventure.land/head'></div>`,
  });
}

test('Steam portrait and map export original URLs while preserving cosmetic layers and crops', () => {
  let calls = 0;
  const context = fixture({ imageUrl(file) {
    calls++;
    return 'blob:https://adventure.land/' + (file.includes('body') ? 'body' : 'head');
  } });
  const portrait = context.characterDollHtml();
  assert.ok(portrait.includes('src="https://adventure.land/images/body.png?v=3"'));
  assert.ok(portrait.includes("src='https://adventure.land/images/head.png'"));
  assert.ok(portrait.includes('width: 648px'));
  assert.ok(portrait.includes('image-rendering: pixelated'));
  const map = context.doll('body', undefined, 1, { overflow: true, j: 2 });
  assert.ok(map.includes('https://adventure.land/images/head.png'));
  assert.ok(!map.includes('blob:'));
  assert.equal(calls, 2, 'known blob mappings are reused');
});

test('ordinary URLs remain portable and unknown local images select the sprite fallback', () => {
  const context = fixture();
  assert.equal(context.characterDollHtml(), null);
  assert.equal(context.dollHtml('<img src="file:///local/body.png">'), null);
  assert.equal(context.dollHtml('<img src="/images/body.png"><img src=\'https://cdn.example/head.png\'>'),
    '<img src="https://adventure.land/images/body.png"><img src=\'https://cdn.example/head.png\'>');
});
