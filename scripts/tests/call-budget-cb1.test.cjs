// CB1's model on the gameplay clock.
// ChronAL runs the server's handlers on its 250 ms step, so the server dates a call up to
// one step after the client books it, past the round trip the game measured. The f1 sample of
// 2026-11-05 in miniature: two moves booked at 10000 and dated 10250, and an attack booked at
// 14225 and dated 14250, both in the server's sum at 14250. Isolated: a live row cannot place a
// send at a chosen phase of the server's step.
const test=require('node:test'),assert=require('node:assert/strict');
const {callMeasures}=require('../../e2e/call-budget-cb1.ts');
const P='E2EPriest',MARGIN=200;
// [booked by the client, dated by the server, method, cost]
const calls=[[10_000,10_250,'move',3],[12_000,12_250,'target',0.5],[12_240,12_500,'target',0.5],[14_225,14_250,'attack',2]];
const read=at=>({at,used:0,margin:MARGIN,cc:null,ccAt:null,
  ledger:calls.filter(([sent])=>sent<=at&&sent>=at-4000-MARGIN).map(([sent,,method,cost])=>({at:sent,method,cost}))});
const sample=at=>{
  const held=calls.filter(([,dated])=>dated<=at&&dated>=at-4000);
  return {at,server:{[P]:held.reduce((sum,[, , ,cost])=>sum+cost,0)},calls:{[P]:held.map(([,dated,method,cost])=>[dated,method,cost])},used:{[P]:null}};
};
test('CB1: a call the server dates one clock step after the client booked it stays in the model',()=>{
  const samples=[];
  for(let at=9_000;at<=16_000;at+=250){
    const s=[10_500,12_750,14_250].includes(at)?sample(at):{at,server:{},calls:{},used:{}};
    s.used[P]=read(at);
    samples.push(s);
  }
  const m=callMeasures(samples,P);
  assert.equal(m.usedSamples,samples.length);
  // The server's sum at 14250 holds the moves, exactly 4000 ms old, beside the attack.
  assert.equal(samples.find(s=>s.at===14_250).server[P],6);
  assert.deepEqual(m.above,[],'every sample within the model of used');
  assert.equal(m.step,250,'the step read from the server dates');
  // A call the ledger never booked still fails the sample that holds it.
  const planted=samples.map(s=>s.at===14_250?{...s,server:{[P]:8},calls:{[P]:[...s.calls[P],[14_250,'attack',2]]}}:s);
  assert.deepEqual(callMeasures(planted,P).above.map(a=>a.at),[14_250],'an unbooked call fails');
});
