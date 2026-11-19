// The debug instance's display wait (tools/debug/desktop.ts displayReady) on a stand-in Xvfb process:
// it needs no gateway, so it shares no setup with debug-gateway.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {displayReady}=require('../../tools/debug/desktop.ts');

// The wait ends on the socket file or on Xvfb's exit, never on an attempt count.
test('the display wait ends when the socket appears and fails when Xvfb exits',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'party-debug-display-')),socket=path.join(dir,'X99');
 try {
  const xvfb=new EventEmitter(),ready=displayReady(xvfb,socket);
  await fs.writeFile(socket,'');
  await ready;
  const exited=new EventEmitter(),failing=displayReady(exited,path.join(dir,'absent'));
  exited.emit('exit',1);
  await assert.rejects(failing,/display failed to start/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
