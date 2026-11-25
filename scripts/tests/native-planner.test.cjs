const assert = require('node:assert/strict');
const { createNativePlanner } = require('../../runtime/movement/character/planner.ts');
const { RunnerScope } = require('../../runtime/lifecycle/character/run.ts');
const { scenarioTable } = require('./fixtures/scenarios.cjs');

// The native planner adapter alone (runtime/movement/character/planner.ts `createNativePlanner`)
// on a verified client, whose search slice shows the character to the game's BFS through
// `parent.is_hidden` and restores it after. Each CODE generation runs behind its own run scope's
// facade, as runtime/lifecycle/character/host.ts builds it. The setup needs only the adapter and a
// parent, so it does not share movement-service's owner fixture. `ending` names how the slice ends.
function planners() {
  const original = () => true, parent = { __partyClientVersion: 17665, is_hidden: original }, observed = [];
  function generation(ending = 'normal') {
    const scope = new RunnerScope(), host = { parent: scope.facade(parent), G: { version: 17665 }, smart: { moving: false, found: false } };
    let planner;
    // The game's smart_move starts the search and its stop('smart') ends it.
    const native = { move: () => { host.smart.moving = true; return new Promise(() => {}); }, stop: () => { host.smart.moving = false; }, next() {},
      start() {
        observed.push(host.parent.is_hidden());
        if (ending === 'throw') throw Error('declared search failure');
        if (ending === 'cancel') planner.cancel();
      } };
    planner = createNativePlanner(host, native);
    planner.begin({ map: 'main', x: 10, y: 0 }, false, 0, 1000, 'movementPlanningMs');
    if (ending === 'normal') planner.tick(0);
    else assert.throws(() => planner.tick(0), ending === 'throw' ? /declared search failure/ : /found no route/);
    scope.dispose();
  }
  return { parent, original, observed, generation };
}

scenarioTable('the native planner restores the game\'s visibility hook across CODE reloads (issue #106)', planners, [
  // A reload that wrapped is_hidden again called itself until the stack overflowed.
  ['two CODE generations each restore the parent\'s own is_hidden, which still answers', p => {
    p.generation(); p.generation();
    assert.deepEqual(p.observed, [false, false]);
    assert.equal(p.parent.is_hidden, p.original);
    assert.equal(p.parent.is_hidden(), true);
  }],
  ['a search that throws or is cancelled restores the hook too', p => {
    p.generation('throw'); p.generation('cancel');
    assert.equal(p.parent.is_hidden, p.original);
    assert.equal(p.parent.is_hidden(), true);
  }],
]);
