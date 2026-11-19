// CB20: a window above the bound
// fails only where the turns executor's own calls rose against the before runs' figure. Isolated:
// a live row cannot plant an extra executor send into one chosen 4 s window above the bound.
const test=require('node:test'),assert=require('node:assert/strict');
const {cb20Windows,CB20_TURNS_BEFORE,CB20_P95}=require('../../e2e/call-budget-cb20.ts');
const P='E2EPriest';
const sample=(at,server,calls)=>({at,server:{[P]:server},calls:{[P]:calls}});
test('CB20: a window above the bound fails only where the executor\'s calls rose',()=>{
  const bound=CB20_P95.up2[P],before=CB20_TURNS_BEFORE.up2[P];
  // Movement's and the background reads' calls above the bound, the executor's at the before figure.
  const window=[[1,'players',12],[2,'cruise',8],[3,'equip',4],[4,'heal',4],[5,'heal',4],[6,'equip',4]];
  const samples=[sample(1000,20,[[1,'move',1.5]]),sample(2000,36,window)];
  assert.deepEqual(cb20Windows(samples,P,bound,before).rose,[],'the executor at its before figure passes');
  // A planted extra executor send in the same window.
  const planted=[...window,[7,'attack',2]];
  const result=cb20Windows([sample(1000,20,[]),sample(2000,38,planted)],P,bound,before);
  assert.deepEqual(result.rose,[{at:2000,server:38,turns:18}],'one more executor call fails it');
});
