/** Whether a launcher source is the maintained coordinator-application launcher: install.mts checks
 *  the shipped template with it, and setup.mts accepts an installed launcher with it. */
export function isCoordinatorApplicationLauncher(source: string): boolean {
  return (
    (source.includes('require("../../.build/runtime/coordinator-application.cjs")') || source.includes('codeRequire("../../.build/runtime/coordinator-application.cjs")')) &&
    source.includes("module.exports = startCoordinatorApplication({")
  );
}
