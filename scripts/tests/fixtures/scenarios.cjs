// Scenario tables: cases of one behaviour that share a
// setup are rows of one test, not separate test declarations. `scenarioTable` declares one test;
// each row runs as a subtest on a fresh setup from `build`, so a failing row names itself and the
// other rows still run. A row is `[name, run, ...args]`: `args` go to `build`, and `run` receives
// what `build` returns, awaited when `build` is async, and the row's own test context (for
// `skip`). A row whose setup differs only by input passes that input in `args`. A row whose `run`
// takes no parameter builds its own setup, so the table never builds one it does not use. Each row
// has its own timeout, so a hung row fails alone and the rows after it still run.
const test = require('node:test');

const ROW_TIMEOUT_MS = 60_000;

function scenarioTable(title, build, rows) {
  if (!rows.length) throw Error(`Scenario table "${title}" has no rows`);
  const names = new Set();
  for (const [name] of rows) {
    if (names.has(name)) throw Error(`Scenario table "${title}" repeats the row "${name}"`);
    names.add(name);
  }
  return test(title, async t => {
    for (const [name, run, ...args] of rows)
      await t.test(name, { timeout: ROW_TIMEOUT_MS }, async row => run.length ? run(await build(...args), row) : run(row));
  });
}

module.exports = { scenarioTable };
