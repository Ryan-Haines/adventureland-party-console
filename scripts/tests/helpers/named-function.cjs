const ts = require('typescript');

/** Each function declaration in `text` by name, as its source text. The first one in source order
 *  wins, so a name a nested helper reuses finds the outer declaration. A `.ts` file parses as
 *  TypeScript, any other text as JavaScript. */
exports.functionDeclarations = (text, file = 'fixture.js') => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const found = new Map();
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && !found.has(node.name.text)) found.set(node.name.text, node.getText(source));
    ts.forEachChild(node, visit);
  })(source);
  return found;
};

/** Extract the actual named function without depending on an unrelated neighboring declaration. */
exports.namedFunction = (text, name) => {
  const found = exports.functionDeclarations(text).get(name);
  if (!found) throw Error('Missing production function: ' + name);
  return found;
};
