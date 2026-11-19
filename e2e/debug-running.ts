import { expect } from '@playwright/test';

// The debug instance's start, shared by the container and dashboard specs: the poll ends when the
// instance reports running and fails at once on its error phase.
export async function untilRunning(state: () => Promise<{ phase: string; error?: string }>) {
  await expect.poll(async () => {
    const current = await state();
    if (current.phase === 'error') throw Error(current.error);
    return current.phase;
  }, { timeout: 1_500_000, intervals: [2000] }).toBe('running');
}
