import type { Route } from '@playwright/test';

/**
 * Fetches the real state for a test that rewrites it. The dashboard sends its
 * cached revision for bank, logs and market (runtime/coordinator/telemetry/
 * section-revision.ts), and the coordinator answers 304 when its own body
 * still matches. A rewritten body never matches, so the read drops the
 * revision and always gets a full body to rewrite.
 */
export function fetchFullState(route: Route) {
  const url = new URL(route.request().url());
  url.searchParams.delete('revision');
  return route.fetch({ url: url.href });
}
