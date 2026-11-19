import { ranger } from './gameplay-scenarios';
import { test } from './live-fixtures';
import { rangerNeedsRows } from './survival-rows';

test.use({ primaryClass: 'ranger' });

// Failure modes: a singleton leader receives no group; its first pre-heartbeat
// shot hides starvation; automatic Scatter masks the broken group; another
// fighter supplies the kills. Require native class, singleton membership,
// committed Goo authorization and continued native quest progress in Group mode.
test('a single ranger leader continuously farms native Goos in Group mode', async ({ live }, info) => {
  test.setTimeout(360000);
  await ranger(live, info);
  // The HP and MP potion rows, in the ranger's own fight.
  await rangerNeedsRows(live, info);
});
