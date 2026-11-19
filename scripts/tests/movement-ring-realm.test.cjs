const test=require('node:test');const assert=require('node:assert/strict');
const {createMovementRing}=require('../../runtime/protocol/records.ts');

// Observed on the live console 2026-11-18: the characters' CODE realm had no structuredClone, so every
// movement ring read failed and the diagnostics view crashed on the failure record.
test('the movement ring reads copies in a realm without structuredClone',t=>{
 const saved=globalThis.structuredClone;delete globalThis.structuredClone;t.after(()=>{globalThis.structuredClone=saved;});
 let clock=1;const ring=createMovementRing(()=>clock++,2);
 ring.push({decision:'a',by:{kind:'k'}});ring.push({decision:'b'});ring.push({decision:'c'});
 const read=ring.entries();
 assert.deepEqual(read.map(e=>[e.decision,e.seq]),[['b',2],['c',3]]);
 read[0].decision='changed';
 assert.equal(ring.entries()[0].decision,'b','a reader cannot change the ring');
});
