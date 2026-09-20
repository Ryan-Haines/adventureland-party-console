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
      if (samples.length !== 3 || new Set(samples.map((r) => r.engine)).size !== 3)
        throw Error(`Incomplete pilot for ${route.id}`);
      return [route.id, samples.some((r) => r.ms >= 2000 || r.error === "timeout") ? 3 : 30];
    }),
  );
}
function shouldMeasure(metadata, id, pass) {
  const repetitions = metadata.measurementsByRoute?.[id] || metadata.passes;
  return pass < repetitions && !(pass < 0 && repetitions === 3);
}
module.exports = { measurementCounts, shouldMeasure };
