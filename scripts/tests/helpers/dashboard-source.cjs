// Temporary adapter for legacy source-slicing assertions during module migration.
// New tests should import the feature under test directly.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../../dashboard/node_modules/typescript');
module.exports = function dashboardSource() {
  const root = path.resolve(__dirname, '../../..');
  const manifest = require('../fixtures/dashboard-modules.json');
  return manifest.flatMap(entry => {
    const text = fs.readFileSync(path.join(root, entry.file), 'utf8');
    const source = ts.createSourceFile(entry.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return entry.declarations.map(declaration => {
      const statement = source.statements.find(node => node.name?.text === declaration.name ||
        ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.text === declaration.name));
      if (!statement) throw new Error(`Missing migrated declaration: ${declaration.name}`);
      return { position: declaration.position, text: statement.getText(source).replace(/^export (default )?/, '') };
    });
  }).sort((a, b) => a.position - b.position).map(entry => entry.text).join('\n\n');
};
