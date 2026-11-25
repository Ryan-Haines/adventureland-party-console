const test = require('node:test');
const assert = require('node:assert/strict');
// The Tracktrix request's two tests left with its code: their goals are
// e2e/call-budget-rows.ts row A and the headless row.
test('dashboard includes BankBoi and inactive merchant snapshots and takes the highest score', () => {
  const { aggregateMonsterAchievements } = require('../../dashboard/features/party/monster-achievements.ts');
  const characters = {
    QwenTina: { name: 'QwenTina', monsterAchievements: null },
    bankboi0: { name: 'bankboi0', monsterAchievements: { ghost: { score: 2100, owner: 'GDroidPT' } } },
    GoldMajesty: { name: 'GoldMajesty', monsterAchievements: { ghost: { score: 2366, owner: 'GDroidPT' } } },
  };
  assert.equal(aggregateMonsterAchievements(characters).ghost.score, 2366);
  delete characters.GoldMajesty;
  assert.equal(aggregateMonsterAchievements(characters).ghost.score, 2100);
});

