const test = require('node:test'), assert = require('node:assert/strict');
const policy = require('../../runtime/hunt/policy.ts');
test('selected follower owns cutoff and reward return without changing party leader', () => {
 const h={stage:'farming',participants:['W','P'],owner:'P',selectionLeader:'W',policyVersion:3};
 const statuses={W:{monsterHunt:{id:'bbpompom',count:20,remainingMs:1000}},P:{monsterHunt:{id:'bee',count:10,remainingMs:900000}}};
 assert.equal(policy.needsReconcile(h,'W'),false);
 assert.equal(policy.shouldReturn(h,'W',statuses),false);
 statuses.P.monsterHunt.remainingMs=180000;
 assert.equal(policy.shouldReturn(h,'W',statuses),false);
 statuses.P.monsterHunt.remainingMs=1;
 assert.equal(policy.shouldReturn(h,'W',statuses),false);
 statuses.P.monsterHunt.remainingMs=0;
 assert.equal(policy.shouldReturn(h,'W',statuses),true);
 policy.beginTurnIn(h,'W');assert.equal(h.turnIn.owner,'P');
 assert.equal(policy.owner(h,'W'),'P');
});
test('leadership changes invalidate a fallback selection outside turn-in', () => {
 const h={stage:'farming',participants:['W','P','M'],owner:'P',selectionLeader:'W',policyVersion:3};
 assert.equal(policy.needsReconcile(h,'M'),true);
});
