// The long-window record (tools/sim/browser-clock.cjs): the browser clock runs in a vm context
// with a stub ChronAL VirtualClock and a wall clock the row moves, so a window takes the clock's
// long-window threshold of wall time without the row waiting it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The pinned VirtualClock's surface the browser clock reads: installInto's timers, run until a
// time, the event count and the startup heap joinClock rebases.
class VirtualClock {
  constructor({ start }) { this.now = start; this.events = 0; this.heap = { a: [] }; }
  installInto(target) {
    target.setTimeout = (callback, ms = 0) => { const timer = { at: this.now, due: this.now + ms, callback }; this.heap.a.push(timer); return timer; };
    target.setInterval = target.setTimeout;
  }
  async run({ until }) {
    for (const timer of this.heap.a.splice(0).sort((a, b) => a.due - b.due)) { this.now = timer.due; this.events++; timer.callback(); }
    this.now = until;
  }
}

test('a long window names its slowest timers, and only their next registration captures a site', async () => {
  const file = path.resolve(__dirname, '../../tools/sim/browser-clock.cjs');
  let wall = 0, captures = 0, socket;
  const sockets = [];
  class FakeSocket { constructor() { this.readyState = 1; this.sent = []; socket = this; sockets.push(this); } send(data) { this.sent.push(data); } }
  const context = vm.createContext({
    __e2eClockConfiguration: { rate: 4, epoch: 5, broker: 'http://broker.test', token: 't', scope: 's' },
    setTimeout: (callback) => setImmediate(callback), performance: { now: () => wall, timeOrigin: 0 },
    WebSocket: FakeSocket, URL, location: { href: 'http://game.test/', pathname: '/' },
    requestAnimationFrame() {}, cancelAnimationFrame() {}, console: { error() {}, log() {} },
  });
  // Each stack capture is a `new Error()` in the clock's own frame.
  context.Error = new Proxy(vm.runInContext('Error', context), { construct(target, args) { captures++; return Reflect.construct(target, args); } });
  const local = { 'chronal-clock': { VirtualClock } };
  const load = (name) => local[name] || require(path.resolve(path.dirname(file), name));
  vm.runInContext(`(function(require){${fs.readFileSync(file, 'utf8')}\n})`, context)(load);
  while (!socket) await new Promise((resolve) => setImmediate(resolve));
  const clock = context.__e2eChronalClock;
  const window = async (now) => {
    const replies = socket.sent.length;
    socket.onmessage({ data: JSON.stringify({ now }) });
    while (socket.sent.length === replies) await new Promise((resolve) => setImmediate(resolve));
  };
  const { longWindowMs } = clock.timing;
  const slow = function slow() { wall += longWindowMs; }, quick = function quick() {};
  await window(5);
  context.setTimeout(quick, 10);
  await window(105);
  assert.equal(clock.timing.long.length, 0);
  context.setTimeout(slow, 10);
  context.setTimeout(quick, 20);
  await window(205);
  assert.equal(captures, 0, 'no registration captures a stack before a long window names its callback');
  const [first] = clock.timing.long;
  assert.equal(first.wallMs, longWindowMs);
  // The record is the context's own; JSON reads it across the vm boundary.
  assert.deepEqual(JSON.parse(JSON.stringify(first.timers.map((t) => [t.name, t.site]))), [['slow', null], ['quick', null]]);
  context.setTimeout(slow, 10);
  assert.equal(captures, 1);
  await window(305);
  const second = clock.timing.long[1].timers.find((t) => t.name === 'slow');
  assert.ok(second.site.length > 0, 'the next registration of a named callback carries its site');
  assert.equal(sockets.length, 1);
});
