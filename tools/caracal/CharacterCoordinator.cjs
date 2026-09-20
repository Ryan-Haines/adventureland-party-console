// Adventure Land coordinator application launcher; implementation lives in runtime/coordinator/application.ts.
const { startCoordinatorApplication } = require("../../.build/runtime/coordinator-application.cjs");

module.exports = startCoordinatorApplication({
  require,
  directory: __dirname,
  loadFetch: async () => (await import("node-fetch")).default,
});
