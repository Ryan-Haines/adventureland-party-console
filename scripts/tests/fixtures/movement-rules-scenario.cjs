// The rule table's request builders (a shared setup lives in the harness).
// The isolated test of the movement owner design.
// Failure list first, in
// e2e/movement-owner-failures.md "Isolated: the rule table". Expected values are the
// rank table typed by hand, with the user's answers applied. A request
// names a tier of the rank table.
const test=require('node:test'), assert=require('node:assert/strict');
const {decide,judgeStop,stepAllowed}=require('../../../runtime/movement/rules.ts');


// A request of `kind`; its owner defaults to one of that kind.
const r=(kind,owner,tier)=>({kind,owner:owner??kind+':1',...(tier===undefined?{}:{tier})});
const decision=(live,incoming)=>decide(live,incoming).decision;
// A task request of `kind` for the task rows.
// `extra` carries a rare's `interruptsHunt` or an add-on's `interrupted`.
const task=(kind,owner,extra)=>({kind,owner:owner??kind+':1',...extra});

module.exports = { r, decision, task };
