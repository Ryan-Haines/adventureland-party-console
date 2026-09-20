const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Legacy function-level fixtures still extract named adapters. Always derive them
// from maintained TypeScript, never from the locally installed game process.
function coordinatorSource() {
  const filename = path.resolve(__dirname, '../../../runtime/coordinator/application.ts');
  const source = fs.readFileSync(filename, 'utf8').replace(
    'import * as coordinatorPolicies from "./index.ts";',
    'const coordinatorPolicies = require("../../.build/runtime/coordinator-policies.cjs");',
  );
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (result.diagnostics?.length) throw new Error('Coordinator fixture transpilation failed');
  return result.outputText;
}

module.exports = { coordinatorSource };
