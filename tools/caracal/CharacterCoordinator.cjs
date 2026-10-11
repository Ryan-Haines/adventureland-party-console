// Adventure Land coordinator application launcher; implementation lives in runtime/coordinator/application.ts.
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const artifact = process.env.AL_CONSOLE_ARTIFACT;
const artifactRequire = artifact ? createRequire(path.join(path.resolve(artifact), ".caracal/standalones/CharacterCoordinator.js")) : require;
// Repository code comes from the immutable artifact. Native caracAL modules and
// its mutable storage continue resolving through the installed launcher.
const codeRequire = Object.assign((id) => id.startsWith("../../") ? artifactRequire(id) : require(id), require);
codeRequire.resolve = (id, options) => id.startsWith("../../") ? artifactRequire.resolve(id, options) : require.resolve(id, options);
const { startCoordinatorApplication } = codeRequire("../../.build/runtime/coordinator-application.cjs");

module.exports = startCoordinatorApplication({
  require: codeRequire,
  directory: __dirname,
  codeDirectory: artifact ? path.join(path.resolve(artifact), ".caracal/standalones") : __dirname,
  loadFetch: async () => (await import(artifact ? pathToFileURL(artifactRequire.resolve("node-fetch")).href : "node-fetch")).default,
});
