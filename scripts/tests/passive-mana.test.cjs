const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/skill-world.cjs');
const {createSkillEngine}=require('../../runtime/characters/skills/engine.ts');
const {reserve,cost}=require('../../runtime/characters/skills/eligibility.ts');
const {decision}=require('../../runtime/characters/skills/types.ts');
const {createManaSpending}=require('../../runtime/characters/skills/spending.ts');

for(const ctype of ['mage','priest'])test(ctype+' passing basic attacks preserve the existing reserve, including pending spending',()=>{
 const f=fixture(ctype),engine=createSkillEngine(f.ports);f.actor.mp_cost=100;f.actor.mp_reduction=25;
 const floor=reserve(f.w),amount=cost(f.w,'attack');assert.equal(amount,75);
 f.actor.mp=floor+amount-1;assert.equal(engine.reserveBasicAttack(),null);
 f.actor.mp=floor+amount;const settle=engine.reserveBasicAttack();assert.equal(typeof settle,'function');
 assert.equal(engine.reserveBasicAttack(),null);settle(true);
 assert.equal(engine.reserveBasicAttack(),null,'ack does not imply an MP update');
 f.actor.mp=floor;assert.equal(engine.reserveBasicAttack(),null);
 f.actor.mp=floor+amount;assert.equal(typeof engine.reserveBasicAttack(),'function','observed recovery restores budget');
});

test('basic attacks and skills cannot independently spend the same mana',()=>{
 const f=fixture('priest'),engine=createSkillEngine(f.ports),enemy=f.add('bee');
 f.actor.mp_cost=100;f.actor.mp=reserve(f.w)+200;
 const pending=engine.reserveBasicAttack();assert.ok(pending);
 assert.equal(engine.ready(decision('absorb',[enemy],'maintenance')),false);
 pending(false);assert.equal(engine.ready(decision('absorb',[enemy],'maintenance')),true);
});

test('uncertain acknowledgements retain spending until fresh MP evidence after the timeout',()=>{
 const spending=createManaSpending(),ack=spending.acquire(300,0,100,200);
 ack('uncertain');assert.equal(spending.acquire(300,5000,100,200),null);
 assert.equal(spending.acquire(200,5001,100,200),null);
 assert.ok(spending.acquire(300,5002,100,200));
});

test('a rejected attack releases its reservation without erasing another in-flight attack',()=>{
 const spending=createManaSpending(),a=spending.acquire(500,0,100,200),b=spending.acquire(500,0,100,200);
 a(false);assert.equal(spending.observe(500,1),100);b(true);assert.equal(spending.observe(400,2),0);
});
