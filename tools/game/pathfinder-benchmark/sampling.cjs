// The bounded plan: a route whose pilot query took SLOW_PILOT_MS or longer, or failed, gets
// SLOW_ROUTE's measured passes and no warm-ups; every other route keeps the run's own plan
// (b9b5c91e:tools/game/pathfinder-benchmark/sampling.cjs:19, :25).
const SLOW_PILOT_MS = 2000;
const SLOW_ROUTE = { passes: 3, warmups: 0 };
function measurementCounts(pilot, metadata) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (
    pilot.metadata.version !== metadata.version ||
    !same(pilot.metadata.hashes, metadata.hashes) ||
    pilot.metadata.provenance.revision !== metadata.provenance.revision ||
    pilot.metadata.lockHash !== metadata.lockHash ||
    !same(pilot.metadata.routes, metadata.routes)
  ) {
    throw Error(
      "Pilot must match game sources, ALClient revision, dependency lock, and route fixtures",
    );
  }
  return Object.fromEntries(
    metadata.routes.map((route) => {
      const samples = pilot.results.filter((r) => r.route === route.id);
      const engines = metadata.engines.length;
      if (samples.length !== engines || new Set(samples.map((r) => r.engine)).size !== engines)
        throw Error(`Incomplete pilot for ${route.id}`);
      const slow = samples.some((r) => r.error || r.ms >= SLOW_PILOT_MS);
      return [route.id, slow ? SLOW_ROUTE : { passes: metadata.passes, warmups: metadata.warmups }];
    }),
  );
}
function shouldMeasure(metadata, id, pass) {
  const plan = metadata.measurementsByRoute?.[id] || metadata;
  return pass < plan.passes && pass >= -plan.warmups;
}
module.exports = { measurementCounts, shouldMeasure, SLOW_PILOT_MS, SLOW_ROUTE };
