const test = require('node:test');
const assert = require('node:assert/strict');
const { createPorcupineEquipment } = require('../../runtime/characters/roles/porcupine-equipment.ts');
const { installPorcupineEquipment } = require('../../runtime/characters/roles/porcupine-equipment-runtime.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
const target = { id: 'p1', mtype: 'porcupine' };
function fixture(options = {}) {
  const hands = { mainhand: { name: 'sword', level: 8 }, offhand: { name: 'shield', level: 3 } };
  const items = [{ name: 'bow', level: 2 }, { name: 'bow', level: 7 }, null];
  const calls = [], errors = [], memory = {};
  let now = 1000;
  const ports = {
    now: () => now, hands: () => hands, items: () => items,
    usableBow: item => item.name === 'bow', twoHanded: () => true,
    fingerprint: item => item && structuredClone(item),
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    async equip(index, slot) { calls.push(['equip', index, slot]); const previous = hands[slot]; hands[slot] = items[index]; items[index] = previous; },
    async unequip(slot) { calls.push(['unequip', slot]); items[items.indexOf(null)] = hands[slot]; hands[slot] = null; },
    report: error => errors.push(error),
    ...options,
  };
  const api = createPorcupineEquipment(ports, memory);
  const tick = (selected = target, type = 'physical', range = 30, allowed = true) => api.tick(selected, type, range, allowed);
  return { api, ports, memory, hands, items, calls, errors, tick, advance() { now += 2100; } };
}
test('highest upgrade bow, retained through target changes and holds, exact loadout restored on departure', async () => {
  const f = fixture(); f.tick(); await settle();
  assert.deepEqual(f.hands, { mainhand: { name: 'bow', level: 7 }, offhand: null });
  f.tick({ id: 'goo', mtype: 'goo' }); f.tick(null, 'physical', 150, false); await settle();
  f.api.depart('grouped-approach'); await settle();
  assert.equal(f.calls.length, 2);
  f.items.reverse(); f.api.depart(); await settle();
  assert.deepEqual(f.hands, { mainhand: { name: 'sword', level: 8 }, offhand: { name: 'shield', level: 3 } });
  assert.equal(f.memory.session, undefined);
});
test('safe ranged, magical and pure users do not swap; inactive and non-porcupine selections do not swap', async () => {
  for (const [selected, type, range, allowed] of [[target,'physical',75,true], [target,'magical',30,true],
    [target,'pure',30,true], [target,'physical',30,false], [{id:'g',mtype:'goo'},'physical',30,true], [null,'physical',30,true]]) {
    const f = fixture(); f.tick(selected,type,range,allowed); await settle(); assert.equal(f.calls.length, 0);
  }
});
test('ties use inventory order and unusable bows are excluded', async () => {
  const f = fixture(); f.items.splice(0, 2, {name:'bow',level:7,p:'first'}, {name:'bow',level:7,p:'second'}, {name:'other',level:13});
  f.tick(); await settle(); assert.equal(f.hands.mainhand.p, 'first');
});
test('no bow and full inventory fail safely with bounded retries', async () => {
  const f = fixture(); f.items[2] = {name:'pot'}; f.tick(); await settle();
  assert.equal(f.calls.length, 0); assert.match(f.errors[0], /inventory space/);
  f.tick(); await settle(); assert.equal(f.errors.length, 1);
  const empty = fixture(); empty.items.length = 0; empty.tick(); await settle();
  assert.match(empty.errors[0], /no usable/); assert.equal(empty.memory.session, undefined);
});
test('failed bow equip retries and departure restores partial offhand removal', async () => {
  const f = fixture({equip: async () => { throw Error('busy'); }});
  f.tick(); await settle(); assert.equal(f.hands.offhand, null); assert.match(f.errors[0], /busy/);
  f.ports.equip = async (index, slot) => { const previous=f.hands[slot]; f.hands[slot]=f.items[index]; f.items[index]=previous; };
  f.api.depart(); await settle(); assert.equal(f.hands.mainhand.name, 'sword'); assert.equal(f.hands.offhand.name, 'shield');
});
test('reload retains restoration state and departure suppresses stale target swaps', async () => {
  const f = fixture(); f.tick(); await settle(); f.api.stop();
  const replacement = createPorcupineEquipment(f.ports, f.memory);
  replacement.depart(); await settle(); replacement.tick(target, 'physical', 30, true); await settle();
  assert.equal(f.hands.mainhand.name, 'sword');
  replacement.tick({...target,id:'p2'}, 'physical', 30, true); await settle(); assert.equal(f.hands.mainhand.name, 'bow');
});
test('manual equipment changes supersede restoration; missing original item stays recoverable', async () => {
  const f = fixture(); f.tick(); await settle(); f.hands.mainhand={name:'manual'};
  f.api.depart(); await settle(); assert.equal(f.hands.mainhand.name,'manual'); assert.equal(f.memory.session, undefined);
  const g = fixture(); g.tick(); await settle();
  const index=g.items.findIndex(item => item?.name==='sword'); const original=g.items[index]; g.items[index]=null;
  g.api.depart(); await settle(); assert.match(g.errors[0], /missing/);
  g.items[index]=original; g.advance(); g.tick(null,'physical',150,false); await settle(); assert.equal(g.hands.mainhand.name,'sword');
});
test('departure during an in-flight swap serializes restoration', async () => {
  let release;
  const f = fixture(); const unequip=f.ports.unequip;
  f.ports.unequip=async slot => { await new Promise(resolve => { release=resolve; }); await unequip(slot); };
  f.tick(); f.api.depart(); release(); await settle();
  f.tick(null,'physical',30,false); await settle();
  assert.equal(f.hands.mainhand.name,'sword'); assert.equal(f.hands.offhand.name,'shield');
});
test('runtime adapter equips highest class-legal bow for warrior and future melee classes', async () => {
  const saved = Object.fromEntries(['parent','character','G','equip','unequip'].map(key => [key,global[key]]));
  try {
    for (const ctype of ['warrior','rogue','paladin']) {
      const f=fixture();
      global.parent={}; global.character={ctype,slots:f.hands,items:f.items};
      global.G={items:{bow:{wtype:'bow'},forbidden:{wtype:'bow',class:['ranger']}},classes:{[ctype]:{doublehand:{bow:{}}}}};
      f.items.push({name:'forbidden',level:13}); global.equip=f.ports.equip; global.unequip=f.ports.unequip;
      const api=installPorcupineEquipment({partyCombatState:{}}); api.tick(target,'physical',30,true); await settle();
      assert.equal(f.hands.mainhand.level,7,ctype); api.stop();
    }
  } finally { for (const [key,value] of Object.entries(saved)) { if(value===undefined)delete global[key];else global[key]=value; } }
});
