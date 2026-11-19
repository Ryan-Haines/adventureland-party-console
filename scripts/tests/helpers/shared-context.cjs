const {createMovementContext} = require('../fixtures/movement-owner-callers.cjs');
const {installRequesters} = require('./requesters.cjs');
const {installApproach} = require('./approach.cjs');
const identity = require('../../../runtime/items/identity.ts');

// A sliced context runs with no console drain: The lifecycle owner's drain is the context's `drain` port. The drain
// gates, the pull gates and the Graveyard exclusion are targeting module functions; the context builds
// the module (helpers/targeting-module.cjs) over the test's `doors` once its own names are planted.
exports.createSharedContext = (options, doors) => {
  const made = {};
  options.root ||= {};
  options.runtimeCurrent ||= () => true;
  // Legacy extracted scenarios declare no managed independent-approach journey.
  options.movement ||= {report:()=>null};
  // The items owner's bag holder and failures (runtime/items/character/owner.ts), the names shared.js's install
  // line gives a sliced function; a test's own bag stays.
  if (!options.bag) {
    options.bag = require('../../../runtime/items/character/owner.ts').createBag();
    // shared.js connects the bag's reads at its install, before any reader asks a fact. The free
    // cells count as bag.ts `freeInventorySlots` counts them, over the context's character.
    const me = () => (made.context || options).character || {};
    options.bag.connect({ freeCells: () => { const items = me().items || []; let free = 0; for (let slot = 0; slot < (Number(me().isize) || items.length); slot++) if (!items[slot]) free++; return free; },
      lucky: () => false, map: () => me().map, merchant: () => me().ctype === 'merchant', name: () => me().name });
  }
  if (!options.itemsOwner) options.itemsOwner = { bag: options.bag, failure: require('../../../runtime/items/rules.ts').itemFailure };
  // shared.js always holds movement's service and walk state; a sliced context gets the free
  // character's (fixtures/movement-owner-callers.cjs).
  const context = made.context = createMovementContext(options);
  // The game's `distance` and `can_move`, which movement's steps and step safety read on the host. A
  // context with neither gets the hitbox-free distance, and `can_move` answers as its own `can_move_to`
  // does, else open ground.
  if (typeof context.distance !== 'function') context.distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  if (typeof context.can_move !== 'function') context.can_move = m => typeof context.can_move_to === 'function' ? !!context.can_move_to(m.going_x, m.going_y) : true;
  // The merchant job owner's runner (runner.ts), the name a sliced merchant function reads.
  if (!context.merchantRunner) require('./merchant-runner.cjs').installRunner(context);
  installRequesters(context, { missingOnly: true });
  require('./survival-escaping.cjs').plantEscaping(context);
  // shared.js binds the item copy reads from the items owner's item identity (shared.js:199, items/identity.ts).
  for (const name of ['fingerprint', 'sameItemState']) if (typeof context[name] !== 'function') context[name] = identity[name];
  // A sliced combat function reads the queue rings (telemetry.ts `createQueueMarkers`).
  if (typeof context.queueMarkers !== 'function') require('./queue-markers.cjs').installQueueMarkers(context);
  // A sliced formation or combat function reads the approaches' journey check (approach.ts).
  installApproach(context);
  // Targeting's module is the context's own (targeting-module.cjs).
  require('./targeting-module.cjs').targetingModule(context, {}, doors);
  return context;
};
