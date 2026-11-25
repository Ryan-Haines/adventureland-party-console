const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Legacy function-level fixtures still extract named adapters. Always derive them
// from maintained TypeScript, never from the locally installed game process. The output keeps
// application.ts's import names as written, which withCoordinatorImports puts in a slice's scope.
function coordinatorSource() {
  const filename = path.resolve(__dirname, '../../../runtime/coordinator/application.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    fileName: filename,
    reportDiagnostics: true,
  });
  // The error carries each diagnostic's file, line and message, so a fixture names what broke.
  if (result.diagnostics?.length) throw new Error('Coordinator fixture transpilation failed:\n' + ts.formatDiagnostics(result.diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  return result.outputText;
}

// The names application.ts imports, each a lazy read of the file it imports it from, so a slice of its
// source runs in a vm context with its imports in scope. A name the context already holds wins.
function withCoordinatorImports(context) {
  const filename = path.resolve(__dirname, '../../../runtime/coordinator/application.ts');
  const file = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    for (const element of statement.importClause.namedBindings?.elements || []) {
      const local = element.name.text, name = (element.propertyName || element.name).text;
      if (element.isTypeOnly || Object.hasOwn(context, local)) continue;
      Object.defineProperty(context, local, { configurable: true, enumerable: true,
        get: () => require(path.resolve(path.dirname(filename), specifier))[name] });
    }
  }
  return context;
}

module.exports = { coordinatorSource, withCoordinatorImports };
