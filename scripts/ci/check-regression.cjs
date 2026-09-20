const fs = require('node:fs');

function checkRegression(output) {
  const totals = {};
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${field} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP summary: ${field}`);
    totals[field] = Number(matches[0][1]);
  }
  if (!/^TAP version 13\r?$/m.test(output) || !/^1\.\.[1-9]\d*\r?$/m.test(output) ||
      /^\s*(?:not ok\b|Bail out!)/m.test(output) ||
      totals.tests === 0 || totals.pass !== totals.tests ||
      ['fail', 'cancelled', 'skipped', 'todo'].some(field => totals[field] !== 0)) {
    throw new Error(`Regression must pass completely: ${JSON.stringify(totals)}`);
  }
  return totals;
}

if (require.main === module) {
  const totals = checkRegression(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(`Regression verified: ${totals.tests} passed; zero failures, cancellations, skips, or TODOs.`);
}
module.exports = { checkRegression };
