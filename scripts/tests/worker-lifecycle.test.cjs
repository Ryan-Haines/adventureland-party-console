const test=require('node:test'),assert=require('node:assert/strict');
const {fixture:managerFixture}=require('./helpers/coordinator-workers.cjs');
function fixture(replaced){const f=managerFixture(),worker=f.manager.start('W');
 const replacement=replaced?f.manager.start('W'):{};let destroyed=0;
 const block=f.blocks.W;block.connected=true;block.enabled=false;block.monitor={destroy(){destroyed++;}};
 f.lifecycle.W='online';
 return {handlers:{exit:(code,signal)=>worker.emit('exit',code,signal)},worker,replacement,block,c:{party:{lifecycle:f.lifecycle}},destroyed:()=>destroyed};}
test('old worker exit cannot mark the replacement offline or destroy its monitor',()=>{const f=fixture(true);f.handlers.exit(0,null);assert.equal(f.block.instance,f.replacement);assert.equal(f.block.connected,true);assert.equal(f.destroyed(),0);assert.equal(f.c.party.lifecycle.W,'online');});
test('current worker exit records reason and clears its connection',()=>{const f=fixture(false);f.worker.partyStopReason='shared code changed';f.handlers.exit(0,null);assert.equal(f.block.instance,null);assert.equal(f.block.connected,false);assert.equal(f.block.lastExit.reason,'shared code changed');assert.equal(f.destroyed(),1);});
