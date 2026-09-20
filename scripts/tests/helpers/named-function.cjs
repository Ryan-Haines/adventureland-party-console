const ts = require('typescript');

/** Extract the actual named function without depending on an unrelated neighboring declaration. */
exports.namedFunction = (text, name) => {
  const source = ts.createSourceFile('fixture.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw Error('Missing production function: ' + name);
  return found.getText(source);
};
