// The hunting owner's character rare client (runtime/hunting/character/rares.ts `installRareClient`) for a row that
// reads its passive rare candidate. The passive rare hunts arrive in a status reply, as the console
// sends them; the row names the hunts, the monster focus and the passive level cap. A port the row
// leaves out throws when the client asks it.
const {installRareClient} = require('../../../runtime/hunting/character/rares.ts');
exports.rareClient = ({hunts, focus = () => [], levelAllowed = () => true}) => {
  const planted = {focus, levelAllowed, lootClient: () => null};
  const client = installRareClient(new Proxy(planted, {get: (own, key) => key in own ? own[key] : () => {
    throw Error('rare client port ' + String(key) + ' is not planted');
  }}));
  client.receive({passiveRareHunts: hunts});
  return client;
};

// A grouped member's queue client (targeting's module, queue-client.ts `queueCandidates`) in a
// passing context, whose passive rare candidate is that rare client's under the passive level cap
// (`passiveLevelAllowed`). W leads and the member follows it, so the farm answers grouped; The hunting owner's farm
// client farms `focus`. `values` are the context's own names.
exports.rareQueueContext = ({entities, character, focus, hunts, values = {}}) => {
  const {passingContext} = require('./client-dependencies.cjs');
  const {huntingDoor} = require('./targeting-module.cjs');
  let c;
  const rare = exports.rareClient({hunts, focus: () => focus, levelAllowed: entity => c.passiveLevelAllowed(entity)});
  const hunting = huntingDoor({character: () => character, frame: () => ({entities}), leader: () => 'W', followLeader: () => true},
    {monsterFocus: focus}, {candidate: rare.candidate});
  c = passingContext({parent: {entities}, character, ...values}, {tasks: {membership: {leader: () => 'W'}}, hunting});
  require('node:vm').runInContext(require('./production-functions.cjs').productionFunction('passiveLevelAllowed'), c);
  return c;
};
