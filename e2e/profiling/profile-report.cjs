// Reads a .cpuprofile written by thread-profile-preload.cjs.
//   node e2e/profiling/profile-report.cjs <file.cpuprofile>            categories and top self time
//   node e2e/profiling/profile-report.cjs <file.cpuprofile> --inclusive [url regex]
//   node e2e/profiling/profile-report.cjs <file.cpuprofile> --callers <function name>
// Shares are of busy time: every sample except (idle).
const fs = require('node:fs');
const [file, mode, argument] = process.argv.slice(2);
const top = Number(process.env.TOP || 25);
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
const frameKey = frame => (frame.functionName || '(anonymous)') + '@' + (frame.url || '').split('/').pop() + ':' + (frame.lineNumber + 1);

// Headless CODE runs as one generated class bundle (characters/generated/<sha256>/<class>.js);
// the game client and its CODE runner run as vm scripts without a file URL (evalmachine).
function category(frame) {
  const url = frame.url || '';
  if (!url) {
    if (frame.functionName === '(garbage collector)') return 'gc';
    if (frame.functionName === '(program)') return 'native, unattributed';
    return 'native builtins';
  }
  if (/\/[a-f0-9]{64}\/\w+\.js$/.test(url)) return 'console CODE (shared.js, roles.js)';
  if (/^evalmachine/.test(url)) return 'game client and game CODE runner';
  if (/\.build\/runtime\//.test(url)) return 'console runtime (lifecycle.cjs)';
  if (/node_modules\/(jsdom|webidl-conversions|whatwg-url|tr46|nwsapi|parse5|whatwg-mimetype|whatwg-encoding|symbol-tree|xml-name-validator|is-potential-custom-element-name)\//.test(url)) return 'jsdom and its WebIDL helpers';
  if (/node_modules\/jquery\//.test(url)) return 'jquery';
  if (/node_modules\/(socket\.io|engine\.io|ws|@socket\.io)/.test(url)) return 'socket.io';
  if (/node_modules\//.test(url)) return 'other node_modules (' + url.split('node_modules/').pop().split('/')[0] + ')';
  if (/\.caracal\//.test(url)) return 'caracAL';
  if (/(thread-profile-preload|prof-preload)\.cjs$/.test(url)) return 'profiler wrappers (measurement)';
  if (/^node:/.test(url)) return 'node internals';
  return 'other (' + url.split('/').slice(-2).join('/') + ')';
}

let busy = 0;
const samples = [];
for (let index = 0; index < profile.samples.length; index++) {
  const id = profile.samples[index], frame = nodes.get(id).callFrame;
  if (frame.functionName === '(idle)') continue;
  const ms = (profile.timeDeltas[index + 1] ?? 0) / 1000;
  busy += ms;
  samples.push({ id, ms, frame });
}
const share = ms => (100 * ms / busy).toFixed(1).padStart(5) + '%  ' + ms.toFixed(0).padStart(7) + ' ms  ';
const print = (map, limit) => [...map].sort((a, b) => b[1] - a[1]).slice(0, limit).forEach(([key, ms]) => console.log(share(ms) + key));
const wall = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0) / 1e6;
console.log(file + ': ' + wall.toFixed(1) + ' s wall, ' + (busy / 1000).toFixed(2) + ' s busy');

if (mode === '--inclusive') {
  const filter = new RegExp(argument || '.');
  const inclusive = new Map();
  for (const sample of samples) {
    const seen = new Set();
    for (let current = sample.id; current !== undefined; current = parent.get(current)) {
      const frame = nodes.get(current).callFrame;
      if (!filter.test(frame.url || '')) continue;
      const key = frameKey(frame);
      if (seen.has(key)) continue;
      seen.add(key);
      inclusive.set(key, (inclusive.get(key) || 0) + sample.ms);
    }
  }
  print(inclusive, top);
} else if (mode === '--callers') {
  const stacks = new Map();
  for (const sample of samples) {
    if (sample.frame.functionName !== argument) continue;
    const chain = [];
    for (let current = parent.get(sample.id); current !== undefined && chain.length < 7; current = parent.get(current)) chain.push(frameKey(nodes.get(current).callFrame));
    const key = chain.join(' < ');
    stacks.set(key, (stacks.get(key) || 0) + sample.ms);
  }
  print(stacks, top);
} else {
  const categories = new Map(), self = new Map();
  for (const sample of samples) {
    const key = category(sample.frame);
    categories.set(key, (categories.get(key) || 0) + sample.ms);
    self.set(frameKey(sample.frame), (self.get(frameKey(sample.frame)) || 0) + sample.ms);
  }
  console.log('== categories');
  print(categories, 50);
  console.log('== top self time');
  print(self, top);
}
