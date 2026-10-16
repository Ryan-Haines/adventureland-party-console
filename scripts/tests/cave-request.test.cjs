const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestCave } = require('../../runtime/characters/cave-request.ts');
function fixture() {
  const socket = new EventEmitter(); socket.connected = true;
  let expire;
  const timers = { setTimeout(fn) { expire = fn; return 1; }, clearTimeout() {} };
  return { socket, timers, expire: () => expire() };
}
test('cave query sends correlated interaction and accepts only matching reply', async () => {
  const f = fixture(); let packet;
  f.socket.on('interaction', data => { packet = data; });
  const result = requestCave(f.socket, 'q', 'info', {}, f.timers);
  assert.deepEqual(packet, { type: 'cave', action: 'info', request_id: 'q' });
  f.socket.emit('game_response', { request_id: 'other', place: 'interaction', visit: {} });
  f.socket.emit('game_response', { request_id: 'q', place: 'attack' });
  assert.equal(f.socket.listenerCount('game_response'), 1);
  f.socket.emit('game_response', { request_id: 'q', place: 'interaction', visit: { available: true } });
  assert.equal((await result).visit.available, true);
  assert.equal(f.socket.listenerCount('game_response'), 0);
  assert.equal(f.socket.listenerCount('disconnect'), 0);
});
for (const reason of ['timeout', 'disconnected']) test('cave query cleans up on ' + reason, async () => {
  const f = fixture(); const result = requestCave(f.socket, 'q', 'info', {}, f.timers);
  const rejection = assert.rejects(result, error => error.reason === reason);
  if (reason === 'timeout') f.expire(); else f.socket.emit('disconnect');
  await rejection;
  assert.equal(f.socket.listenerCount('game_response'), 0);
  assert.equal(f.socket.listenerCount('disconnect'), 0);
});
test('server ineligibility and failures are preserved', async () => {
  const f = fixture();
  f.socket.on('interaction', data => f.socket.emit('game_response', { request_id: data.request_id, place: 'interaction', visit: { available: false } }));
  assert.equal((await requestCave(f.socket, 'q', 'info', {}, f.timers)).visit.available, false);
});

test('native cave response is captured before a throwing game UI listener', async () => {
  const f = fixture(); let incoming;
  f.socket.prependAny = listener => { incoming = listener; };
  f.socket.offAny = listener => { if (incoming === listener) incoming = undefined; };
  f.socket.on('game_response', () => { throw Error('UI failure'); });
  const result = requestCave(f.socket, 'q', 'info', {}, f.timers);
  const reply = { request_id: 'q', place: 'interaction', visit: { available: true } };
  incoming('game_response', reply);
  assert.throws(() => f.socket.emit('game_response', reply), /UI failure/);
  assert.equal((await result).visit.available, true);
  assert.equal(incoming, undefined);
  assert.equal(f.socket.listenerCount('game_response'), 1);
});

test('request failures reject and remove catch-all listeners without retrying', async () => {
  const f = fixture(); let incoming, sends = 0;
  f.socket.prependAny = listener => { incoming = listener; };
  f.socket.offAny = () => { incoming = undefined; };
  f.socket.on('interaction', data => {
    sends++;
    incoming('game_response', { request_id: data.request_id, place: 'interaction', failed: true, reason: 'unavailable' });
  });
  await assert.rejects(requestCave(f.socket, 'q', 'enter', {}, f.timers), error => error.reason === 'unavailable');
  assert.equal(sends, 1);
  assert.equal(incoming, undefined);
});
test('browser timers are invoked with their native global receiver', async () => {
  const vm = require('node:vm');
  const ts = require('typescript');
  const fs = require('node:fs');
  const js = ts.transpileModule(fs.readFileSync(require.resolve('../../runtime/characters/cave-request.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const context = vm.createContext({ exports: {} });
  vm.runInContext(`globalThis.setTimeout = function () { if (this !== globalThis) throw Error('Illegal invocation'); return 1; };
    globalThis.clearTimeout = function () { if (this !== globalThis) throw Error('Illegal invocation'); };`, context);
  vm.runInContext(js, context);
  const f = fixture();
  f.socket.on('interaction', data => f.socket.emit('game_response', { request_id: data.request_id, place: 'interaction', visit: { available: true } }));
  assert.equal((await context.exports.requestCave(f.socket, 'q', 'info')).visit.available, true);
});

// Native interaction deferreds: docs/repeated-diagnostics.md failure modes 1-5.
function nativeDeferreds(socket) {
 const pushed=[];
 return {pushed,push_deferred(name){pushed.push({name,emitted:socket.sent});return new Promise(()=>{});}};
}
test('a cave request registers one native interaction deferred before it emits',async()=>{
 const f=fixture();f.socket.sent=0;f.socket.on('interaction',()=>{f.socket.sent++;});
 const native=nativeDeferreds(f.socket);
 const result=requestCave(f.socket,'q','info',{},f.timers,native);
 assert.deepEqual(native.pushed,[{name:'interaction',emitted:0}]);assert.equal(f.socket.sent,1);
 f.socket.emit('game_response',{request_id:'q',place:'interaction',visit:{available:true}});
 assert.equal((await result).visit.available,true);
});
test('a disconnected cave request registers no native deferred',async()=>{
 const f=fixture();f.socket.connected=false;const native=nativeDeferreds(f.socket);
 await assert.rejects(requestCave(f.socket,'q','info',{},f.timers,native),/disconnected/);
 assert.equal(native.pushed.length,0);
});
test('a client without push_deferred still sends and settles a cave request',async()=>{
 const f=fixture();f.socket.on('interaction',data=>f.socket.emit('game_response',{request_id:data.request_id,place:'interaction',visit:{available:true}}));
 assert.equal((await requestCave(f.socket,'q','info',{},f.timers,{})).visit.available,true);
});
test('a rejected native deferred never surfaces as an unhandled rejection',async()=>{
 const f=fixture();const unhandled=[];const listener=e=>unhandled.push(e);process.on('unhandledRejection',listener);
 f.socket.on('interaction',data=>f.socket.emit('game_response',{request_id:data.request_id,place:'interaction',visit:{}}));
 await requestCave(f.socket,'q','info',{},f.timers,{push_deferred:()=>Promise.reject({reason:'queue_overflow'})});
 await new Promise(resolve=>setImmediate(resolve));process.off('unhandledRejection',listener);
 assert.equal(unhandled.length,0);
});
