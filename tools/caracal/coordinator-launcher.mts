/** Recognize the maintained launcher before applying legacy source-text migrations. */
export function isCoordinatorApplicationLauncher(source: string): boolean {
  return (
    source.includes('require("../../.build/runtime/coordinator-application.cjs")') &&
    source.includes("module.exports = startCoordinatorApplication({")
  );
}
