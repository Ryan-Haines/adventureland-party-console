const test = require('node:test');
const assert = require('node:assert/strict');
const { gameReads } = require('./helpers/status-report.cjs');

test('starting choices retain native renderer geometry and never mutate official cosmetics', () => {
  const looks = [['ranger', { head: 'head1', hair: 'hair1' }], ['ranger2', {}]];
  const calls = [];
  const report = gameReads({
    character: {}, G: { classes: { ranger: { looks } } }, parent: {},
    sprite(skin, options) {
      calls.push({ skin, width: options.width, height: options.height, scale: options.scale });
      options.cx.head = 'renderer-mutation';
      return '<div><img style="top: 12px; width: 40px"><img style="top: 4px; width: 24px"></div>';
    },
  });
  const choices = report.classAppearanceChoices().ranger;
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
  const c = { character: {}, G: { classes: { ranger: { looks: [['ranger', {}]] } } }, parent: {} };
  const report = gameReads(c);
  assert.equal(report.classAppearanceChoices().ranger[0].html, null);
  c.parent.sprite = () => { throw new Error('not loaded'); };
  assert.equal(report.classAppearanceChoices().ranger[0].html, null);
});
