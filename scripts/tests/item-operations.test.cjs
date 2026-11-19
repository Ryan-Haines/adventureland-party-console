const test = require('node:test');
const assert = require('node:assert/strict');
const { productionHarness, planted, emptyCheckpoint } = require('./helpers/items-character.cjs');
const { createBagReads } = require('../../runtime/items/character/bag.ts');
test('upgrade and compound placeholders expose real server chance, smoke and level transition', () => {
  const G = { items: { placeholder: { skin: 'placeholder' }, wshoes: {} }, positions: { placeholder: ['pack_20', 3, 4] },
    imagesets: { pack_20: { file: '/images/pack_20.png', size: 20, columns: 50, rows: 50 } } };
  const reads = createBagReads(planted({ character: () => ({ items: [] }), G: () => G, now: () => 0, calculateItemProperties: null, itemProperties: () => null,
    activeUpgrade: () => ({ slot: 0, item: { name: 'wshoes', level: 6, stat_type: 'int' } }) }));
  for (const [scroll, type] of [['scroll0', 'upgrade'], ['cscroll0', 'compound']]) {
    const entry = reads.inventoryOperationEntry({ name: 'placeholder', p: { name: 'wshoes', level: 6, chance: 0.4215, scroll } }, 0);
    assert.equal(entry.item.name, 'wshoes'); assert.equal(entry.item.stat_type, 'int');
    assert.equal(entry.operation.type, type); assert.equal(entry.operation.chance, 0.4215);
    assert.equal(entry.operation.fromLevel, 6); assert.equal(entry.operation.toLevel, 7);
    assert.deepEqual([entry.operation.sprite.x, entry.operation.sprite.y], [3, 4]);
  }
  assert.equal(reads.inventoryOperationEntry({ name: 'wshoes', level: 7 }, 0).operation, undefined);
});
// The queue entry stays open for twenty round trips (the harness margin) and the result lands one
// round trip after it closes (G11).
const MARGIN = 100, QUEUE = 20 * MARGIN;
test('placeholder remains pending even when queue proxy disappears before the result', async () => {
  const character = { name: 'Fighter', ctype: 'warrior', items: [{ name: 'wshoes', level: 3 }, { name: 'scroll0', q: 1 }], q: {} };
  const { production } = productionHarness({ character, tick: now => {
    if (now >= QUEUE) delete character.q.upgrade;
    if (now >= QUEUE + MARGIN) character.items[0] = { name: 'wshoes', level: 4 };
  }, ports: { upgrade: async () => {
    character.q.upgrade = { ms: QUEUE };
    character.items[0] = { name: 'placeholder', p: { name: 'wshoes', level: 3 } };
    return { success: true, num: 0 };
  } } });
  const result = await production.upgradeConfirmed(0, 1);
  assert.equal(result.toLevel, 4); assert.equal(production.activeUpgrade(), null);
});
// A fighter's marked upgrade run (production.ts `merchantImprove`): two wshoes marks, slot 1 first.
// `operation` is the game's upgrade answer for each attempt, counted from 1.
function loopRuntime(operation) {
  const character = { name: 'Fighter', ctype: 'warrior', items: [{ name: 'wshoes', level: 0 }, { name: 'wshoes', level: 0 }, { name: 'scroll0', q: 20 }], q: {} };
  const calls = [];
  const { production } = productionHarness({ character, G: { items: { wshoes: { upgrade: {} }, scroll0: {} }, skills: {} }, ports: {
    request: emptyCheckpoint,
    upgrade: async slot => { calls.push(slot); return operation(character, slot, calls.length); } } });
  return { production, character, calls, command: { upgrades: [1, 0].map(slot => ({ slot, item: { name: 'wshoes', level: 0 }, tiers: 3 })) } };
}
// The game's answers: a level gained, a confirmed failure the item survived, and a confirmed burn.
const gained = (character, slot) => { character.items[slot] = { ...character.items[slot], level: character.items[slot].level + 1 }; return { success: true, num: slot }; };
const survived = slot => ({ failed: true, success: false, num: slot });
test('finish exact marked slot before another identical copy, retrying a confirmed surviving failure', async () => {
  const { production, calls, command } = loopRuntime((character, slot, attempt) => attempt === 2 ? survived(slot) : gained(character, slot));
  await production.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 1, 1, 1, 0, 0, 0]);
});
test('uncertain confirmation stops work instead of silently switching copies', async () => {
  const { production, calls, command } = loopRuntime(() => { throw new Error('confirmation uncertain'); });
  await assert.rejects(production.merchantImprove(command, []), /confirmation uncertain/);
  assert.deepEqual(calls, [1]);
});
test('confirmed destruction allows the next copy', async () => {
  const { production, calls, command } = loopRuntime((character, slot) => {
    if (slot === 1) { character.items[slot] = null; return survived(slot); }
    return gained(character, slot);
  });
  await production.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 0, 0, 0]);
});

test('retry resumes the same partially upgraded slot and preserves the original final level', async () => {
  const { production, character, calls, command } = loopRuntime((character, slot, attempt) => {
    if (attempt === 2) throw Object.assign(new Error('interrupted'), { reason: 'interrupted' });
    return gained(character, slot);
  });
  await assert.rejects(production.merchantImprove(command, []), /interrupted/);
  assert.equal(character.items[1].level, 1);
  await production.merchantImprove(command, []);
  assert.deepEqual(calls, [1, 1, 1, 1, 0, 0, 0]);
  assert.equal(character.items[1].level, 3, 'retry must not raise the original target to +4');
});

test('partial progress does not match an unrelated item in the marked slot', async () => {
  const { production, character, calls, command } = loopRuntime(() => {});
  character.items[1] = { name: 'different', level: 1 };
  character.items[0] = null;
  await production.merchantImprove(command, []);
  assert.deepEqual(calls, []);
});

for(const response of [{failed:true,success:false,num:0},undefined,{failed:true,success:false,num:1}])
test('destruction needs a matching server failure: '+JSON.stringify(response),async()=>{
 const character={name:'Fighter',ctype:'warrior',items:[{name:'coat',level:2},{name:'scroll0',q:1}],q:{}};
 const {production}=productionHarness({character,ports:{upgrade:async()=>{character.items[0]=null;return response;}}});
 await assert.rejects(production.upgradeConfirmed(0,1,'coat',3),e=>{
  if(response?.num===0){assert.equal(e.reason,'upgrade_destroyed');assert.equal(e.confirmedDestroyed,true);}
  else {assert.match(e.message,/uncertain/);assert.notEqual(e.confirmedDestroyed,true);}
  return true;
 });
});

// The merchant's protection checkpoint answers after a delivery moved the coat to slot 5. The lucky
// slot is 5, so the upgrade runs where the coat now sits.
test('upgrade preparation follows an item relocated during the protection checkpoint',async()=>{
 const items=[{name:'coat',level:2},null,{name:'scroll0',q:2},null,null,null],calls=[];
 const character={name:'M',ctype:'merchant',items,q:{}};let moved=false;
 const {production}=productionHarness({character,ports:{job:()=>({jobId:'j'}),
  request:async(path,{body})=>{
   if(path==='/merchant/checkpoint'&&!moved){moved=true;items[5]=items[0];items[0]=null;}
   return path==='/merchant/production'&&body.action==='pending'?{pending:[]}:{};
  },
  upgrade:async(slot,scroll)=>{calls.push([slot,scroll]);items[slot]={name:'coat',level:3};return {success:true,num:slot};}}});
 production.setLuckySlot(5);
 const result=await production.upgradeConfirmed(0,2,'coat',3);
 assert.deepEqual(calls,[[5,2]]);assert.equal(result.slot,5);
});

// IT25: a stat scroll keeps the item's level, so its confirmation reads the item's
// `stat_type` becoming the scroll's stat. Red on b9b5c91e: the confirmation waited for level + 1 and
// threw after the scroll applied.
test('IT25: a stat scroll is confirmed by the stat it applied, at the same level', async () => {
  const character = { name: 'Fighter', ctype: 'warrior', items: [{ name: 'coat', level: 5, stat_type: 'str' }, { name: 'intscroll', q: 1 }], q: {} };
  const { production } = productionHarness({ character, G: { items: { intscroll: { type: 'pscroll', stat: 'int' }, coat: {} }, skills: {} },
    ports: { upgrade: async () => { character.items = [{ name: 'coat', level: 5, stat_type: 'int' }, null]; return { success: true }; } } });
  const result = await production.upgradeConfirmed(0, 1);
  assert.deepEqual([result.slot, result.toLevel, result.item.stat_type], [0, 5, 'int']);
});

// IT57: a compound counts only when every input slot changed and the game's `q.compound`
// entry ended. Red on b9b5c91e: one changed input confirmed it.
test('IT57: a compound with an input unchanged is not confirmed', async () => {
  const ring = { name: 'ringsj', level: 0 };
  const character = { name: 'Fighter', ctype: 'warrior', items: [{ ...ring }, { ...ring }, { ...ring }, { name: 'cscroll0', q: 1 }], q: {} };
  const { production } = productionHarness({ character, ports: { compound: async () => {
    character.items[0] = { name: 'ringsj', level: 1 }; character.items[1] = null; return { success: true };
  } } });
  await assert.rejects(production.compoundConfirmed(0, 1, 2, 3), error => error.code === 'not_confirmed');
});
test('IT57: a compound waits for its queue entry to end before it counts', async () => {
  const ring = { name: 'ringsj', level: 0 };
  const character = { name: 'Fighter', ctype: 'warrior', items: [{ ...ring }, { ...ring }, { ...ring }, { name: 'cscroll0', q: 1 }], q: {} };
  const { production, clock } = productionHarness({ character,
    tick: now => { if (now >= 600) delete character.q.compound; },
    ports: { compound: async () => {
      character.q.compound = { ms: 1000 };
      character.items = [{ name: 'ringsj', level: 1 }, null, null, null];
      return { success: true };
    } } });
  await production.compoundConfirmed(0, 1, 2, 3);
  assert.ok(clock.now >= 600, 'the count waited for the queue entry');
});
// G11 in calls.ts `itemCall`: the game settles a call's promise only on its reply,
// so a lost reply ends the call `not_confirmed` after two measured round trips. An upgrade answers
// after its queue time, which production's own wait reads, so it gets no such bound.
test('G11: an item call with no reply ends not_confirmed; an upgrade waits on its queue time', async () => {
  const saved = { hooks: globalThis.__partyHooks, parent: globalThis.parent, buy: globalThis.buy, upgrade: globalThis.upgrade };
  const handle = { sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: id => clearTimeout(id) };
  globalThis.__partyHooks = { calls: { band: () => 'send', window: () => 1, margin: () => 5 } };
  globalThis.parent = { ...(saved.parent || {}), __partyRunScope: { scope: () => handle } };
  globalThis.buy = () => new Promise(() => {});
  globalThis.upgrade = () => new Promise(() => {});
  try {
    const { bankGame, productionGame } = require('../../runtime/items/character/calls.ts');
    const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
    boundsSent(boundsPending().length);
    await assert.rejects(bankGame.buy('hpot0', 1), error => error.code === 'not_confirmed' && /buy was not confirmed/.test(error.message));
    // itemReplyBound (bigcheck/bounds.md): the lost reply queues its firing for the next report.
    assert.deepEqual(boundsPending().map(f => [f.bound, f.owner, f.state.method, f.state.ms]), [['itemReplyBound', '10', 'buy', 10]]);
    boundsSent(1);
    const upgrade = productionGame.upgrade(0, 1);
    assert.equal(await Promise.race([upgrade.then(() => 'settled', () => 'settled'), new Promise(resolve => setTimeout(() => resolve('pending'), 50))]), 'pending');
  } finally { Object.assign(globalThis, { __partyHooks: saved.hooks, parent: saved.parent, buy: saved.buy, upgrade: saved.upgrade }); }
});
