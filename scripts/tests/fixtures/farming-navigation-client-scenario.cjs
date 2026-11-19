// The character's farming navigation slice (a shared setup lives in the harness).
const {productionFunctions} = require('../helpers/production-functions.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMovementContext } = require('./movement-owner-callers.cjs');
function fixture() {
  const stops = [];
  const r = createMovementContext({ travelCombatActive:()=>false, escapeOwns: () => false, root: { __anniversaryReturnLocation: { map: 'cave' } },
    navigationIntent: { revision: 0, cancelled: false }, farmingTravelToken: null, reunion: null,
    anniversaryReturnLocation: { map: 'cave' }, anniversaryStagingReported: 'old', anniversaryReturnReported: 'old',
    groupWalk: {travel:null}, followingLeader: false, forceTraveling: false,
    character: { name: 'F', ctype: 'priest' }, lastCommand: 0,
    stop: async kind => stops.push(kind),
    // The job owner's runner (runtime/merchant-jobs/character/runner.ts) takes the intake's reports and
    // its command releases.
    merchantRunner: { report() {}, releaseCommand() {} },
    // The events owner's exit (runtime/events/character/exit.ts): the intake's cycle fence and its supersede.
    eventExit:{observe(){},accepts:()=>true,supersede(){},run:async()=>{},pending:()=>false,exiting:()=>false,returning:()=>false},
  });
  // The navigation intent is walk-client.ts's; the slice keeps shared.js's code after it.
  require('../helpers/walk-reports.cjs').installNavigation(r);
  vm.runInContext(productionFunctions(['merchantSendMail']), r);
  return { r, stops };
}

module.exports = { fixture };
