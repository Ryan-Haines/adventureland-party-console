import { ranger } from './gameplay-scenarios';
import { test } from './live-fixtures';

test.use({ primaryClass: 'ranger' });

// Failure modes: a singleton leader receives no group; its first pre-heartbeat
// shot hides starvation; automatic Scatter masks the broken group; another
// fighter supplies the kills. Require native class, singleton membership,
// committed Goo authorization and continued native quest progress in Group mode.
test('a single ranger leader continuously farms native Goos in Group mode', async ({ live }, info) => {
  test.setTimeout(240000);
  await ranger(live, info);
});
