const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const shared = fs.readFileSync('characters/shared.js', 'utf8');
function fixture() {
  const context = vm.createContext({ character: { items: [{name:'tracker'}] },
    parent: {character: {}}, G: {items: {tracker:{skin:'tracker'}}, monsters: {
      rat: {achievements:[[10,'stat','dex',2],[20,'stat','dex',3],[10,'item','gold',100]]},
      goo: {achievements:[[5,'stat','speed',1]]},
    }}, spriteDefinition:skin=>({skin}), monsterAchievementProgress:()=>({rat:{score:15},goo:{score:5}}) });
  vm.runInContext(shared.slice(shared.indexOf('  function tracktrixBonuses('),shared.indexOf('  function monsterAchievementProgress(')),context);
  return context;
}
test('Tracktrix totals only unlocked stat rewards and prefers reported stats',()=>{
  const r=fixture();assert.deepEqual(JSON.parse(JSON.stringify(r.tracktrixBonuses().bonuses)),{dex:2,speed:1});
  r.parent.character.monster_stats={dex:7};assert.equal(r.tracktrixBonuses().bonuses.dex,7);
});
test('banked Tracktrix does not display stale bonuses; missing data remains unknown',()=>{
  const r=fixture();r.parent.character.monster_stats={dex:7};r.character.items=[];
  assert.equal(r.tracktrixBonuses().active,false);assert.equal(Object.keys(r.tracktrixBonuses().bonuses).length,0);
  r.character.items=[{name:'supercomputer'}];delete r.parent.character.monster_stats;
  r.monsterAchievementProgress=()=>null;assert.equal(r.tracktrixBonuses().bonuses,null);
});
