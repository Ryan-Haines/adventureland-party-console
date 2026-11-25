// Scenario table rows collected where each is written:
// `row(group, name, check)` adds a row to its group's table, and `run()` declares one scenarioTable
// per group, in the order the groups first appear. Each check builds its own setup.
const { scenarioTable } = require('../fixtures/scenarios.cjs');

function rowTables() {
  const tables = new Map();
  return {
    row(group, name, check) {
      if (!tables.has(group)) tables.set(group, []);
      tables.get(group).push([name, () => check()]);
    },
    run() { for (const [group, rows] of tables) scenarioTable(group, () => undefined, rows); },
  };
}

module.exports = { rowTables };
