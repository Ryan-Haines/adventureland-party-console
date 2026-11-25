// Movement's walk state fields with their one writer each (runtime/movement/character/owner.ts),
// as install.ts hands them to the walk client, the formation, the approach and the requesters. A
// test passes the object it reads back (a host or a world), which takes the fields.
const { defendConvoy, showNavigation } = require('../../../runtime/movement/character/owner.ts');

function walkStatePorts(state = {}) {
  state.townGeneration ??= 0; state.convoyDefense ??= null; state.navigationDetail ??= null;
  return { townGeneration: () => state.townGeneration, convoyDefense: () => state.convoyDefense,
    defendConvoy: convoy => defendConvoy(state, convoy), showNavigation: detail => showNavigation(state, detail) };
}
module.exports = { walkStatePorts };
