const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../characters/shared.js'), 'utf8');

function fixture(desktop) {
  const context = vm.createContext({
    G: { sprites: { body: { file: '/images/body.png?v=3' }, head: { file: '/images/head.png' } } },
    parent: { desktop }, character: { skin: 'body', cx: { head: 'head' } },
    sprite: () => '<div><img style="width: 648px" src="blob:https://adventure.land/body"><img src=\'blob:https://adventure.land/head\'></div>',
  });
  vm.runInContext(source.slice(source.indexOf('  var dashboardImageUrls ='), source.indexOf('  function snapshot()')), context);
  return context;
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
  const map = context.mapDollHtml({ type: 'character', skin: 'body' }, 2);
  assert.ok(map.includes('https://adventure.land/images/head.png'));
  assert.ok(!map.includes('blob:'));
  assert.equal(calls, 2, 'known blob mappings are reused');
});

test('ordinary URLs remain portable and unknown local images select the sprite fallback', () => {
  const context = fixture();
  assert.equal(context.characterDollHtml(), null);
  assert.equal(context.dashboardDollHtml('<img src="file:///local/body.png">'), null);
  assert.equal(context.dashboardDollHtml('<img src="/images/body.png"><img src=\'https://cdn.example/head.png\'>'),
    '<img src="https://adventure.land/images/body.png"><img src=\'https://cdn.example/head.png\'>');
});
