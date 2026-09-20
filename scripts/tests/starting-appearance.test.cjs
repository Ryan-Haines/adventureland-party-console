const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const functions = source.slice(source.indexOf('  function startingAppearanceHtml('), source.indexOf('  function merchantCatalog('));

test('starting choices retain native renderer geometry and never mutate official cosmetics', () => {
  const looks = [['ranger', { head: 'head1', hair: 'hair1' }], ['ranger2', {}]];
  const calls = [];
  const context = vm.createContext({
    G: { classes: { ranger: { looks } } }, parent: {},
    sprite(skin, options) {
      calls.push({ skin, width: options.width, height: options.height, scale: options.scale });
      options.cx.head = 'renderer-mutation';
      return '<div><img style="top: 12px; width: 40px"><img style="top: 4px; width: 24px"></div>';
    },
    dashboardDollHtml: html => html,
    spriteDefinition: skin => ({ skin }),
  });
  vm.runInContext(functions, context);
  const choices = context.classAppearanceChoices().ranger;
  assert.equal(choices.length, 2);
  assert.deepEqual(Array.from(choices, choice => choice.index), [0, 1]);
  assert.equal(looks[0][1].head, 'head1');
  assert.deepEqual(looks[1][1], {});
  assert.deepEqual(calls, ['ranger', 'ranger2'].map(skin => ({ skin, width: 54, height: 76, scale: 2 })));
  assert.match(choices[0].html, /top: 12px; width: 40px/);
  assert.match(choices[0].html, /top: 4px; width: 24px/);
  assert.match(choices[0].html, /max-width: none/);
});

test('unavailable or failing game renderer leaves a pending preview', () => {
  const context = vm.createContext({ parent: {}, dashboardDollHtml: html => html });
  vm.runInContext(functions, context);
  assert.equal(context.startingAppearanceHtml('ranger', {}), null);
  context.parent.sprite = () => { throw new Error('not loaded'); };
  assert.equal(context.startingAppearanceHtml('ranger', {}), null);
});
