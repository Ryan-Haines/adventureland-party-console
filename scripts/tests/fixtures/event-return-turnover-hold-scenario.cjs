// A failed event return convoy (a shared setup lives in the harness).
const {productionFunction} = require('../helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// createSharedContext loads the real maintenance gates, the console Pause check among them.
const {createSharedContext}=require('../helpers/shared-context.cjs');
function fixture(){
 // The tasks owner's recovery hold, which a row sets on c.assignment.
 const assignment={combatRecoveryHolds:()=>false};
 const c=createSharedContext({root:{},cycle:'event-1',eventExit:{returning:()=>typeof c.cycle==='string'&&!!c.cycle},character:{name:'W',map:'main',in:'main',rip:false},
  navigationIntent:{cancelled:false},escapeOwns:()=>false,
  groupWalk:{travel:null},parent:{entities:{}},isAttackingPartyMember:e=>e.target==='W'||e.target==='P',is_in_range:()=>true},{tasks:{assignment}});
 c.assignment=assignment;
 vm.runInContext(['returnCombatActive','returnAttacker','returnDefenseTarget'].map(name=>productionFunction(name)).join('\n'),c);return c;
}

module.exports = { fixture };
