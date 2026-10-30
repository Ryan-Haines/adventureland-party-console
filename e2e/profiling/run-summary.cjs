// node e2e/profiling/run-summary.cjs [--timers] <PROF_DIR>...
// One line per process: CPU share of one core, RSS, event-loop delay and the reaction
// samples from thread-profile-preload.cjs. --timers adds the per-timer and per-socket-event
// handler time recorded in full (non-light) runs.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), timers = args.includes('--timers');
const quantile = (values, q) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))];
};
const fixed = value => Number.isFinite(value) ? value.toFixed(1) : '-';
for (const dir of args.filter(arg => arg !== '--timers')) {
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const latency = summary.latency;
  console.log('## ' + dir + ' (' + summary.scenario + ', ' + summary.windowS + ' s) inventory change to /party-api/state ms p50/p90/max: ' +
    [quantile(latency, 0.5), quantile(latency, 0.9), Math.max(...latency)].join('/'));
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json') && name !== 'summary.json').sort()) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), speed = run.speed;
    console.log([run.name.padEnd(12), 'cpu', fixed(run.cpuPercent).padStart(5) + '%', 'rss', (run.rss / 1e6).toFixed(0) + 'MB',
      'loop delay p50/p99/max', fixed(run.eventLoopDelay.p50) + '/' + fixed(run.eventLoopDelay.p99) + '/' + fixed(run.eventLoopDelay.max),
      'attacks', speed.attacksTotal, 'heals', speed.heals, 'moves', speed.moves, 'kills', speed.kills,
      'ready-to-attack p50/p90', fixed(quantile(speed.attacks, 0.5)) + '/' + fixed(quantile(speed.attacks, 0.9)),
      'death-to-action p50/p90', fixed(quantile(speed.deathToAction, 0.5)) + '/' + fixed(quantile(speed.deathToAction, 0.9))].join(' '));
    if (!timers) continue;
    for (const row of run.timers.slice(0, 15))
      console.log('   timer ' + row.ms.toFixed(0).padStart(6) + ' ms ' + String(row.calls).padStart(6) + ' calls ' +
        (row.ms / row.calls).toFixed(2).padStart(6) + ' ms mean ' + row.max.toFixed(1).padStart(6) + ' ms max  ' + row.key.slice(0, 110));
    for (const row of run.events.slice(0, 8))
      console.log('   event ' + row.ms.toFixed(0).padStart(6) + ' ms ' + String(row.calls).padStart(6) + ' calls  ' + row.key);
  }
}
