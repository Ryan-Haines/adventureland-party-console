// The one loader for a production function a test runs by itself. A test names the function and
// productionFunction finds the file it lives in, so a function that moves out of shared.js
// keeps its tests:
// - characters/shared.js first, so a name it declares loads from there;
// - otherwise the owners' character modules (runtime/<owner>/character/**/*.ts), the files a
//   function moves into. A name that two of them declare throws, since the test would not know
//   which one it runs.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {functionDeclarations} = require('./named-function.cjs');
// A function that moved into targeting's module needs no slice: a context that builds the module
// (targeting-module.cjs `targetingModule`) reads it from there.
const targetingModule = require('./targeting-module.cjs');

const repo = path.join(__dirname, '../../..');
const shared = 'characters/shared.js';
function characterModules(dir) {
  return fs.readdirSync(path.join(repo, dir), {withFileTypes: true}).flatMap(entry => {
    const file = dir + '/' + entry.name;
    return entry.isDirectory() ? characterModules(file) : file.endsWith('.ts') ? [file] : [];
  });
}
// Each file's function declarations by name (named-function.cjs, the one parse-and-find).
const declarations = file => ({file, found: functionDeclarations(fs.readFileSync(path.join(repo, file), 'utf8'), file)});
let homes;
function readHomes() {
  const owners = fs.readdirSync(path.join(repo, 'runtime'), {withFileTypes: true})
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(repo, 'runtime', entry.name, 'character')))
    .flatMap(entry => characterModules('runtime/' + entry.name + '/character')).sort();
  return {shared: declarations(shared), owners: owners.map(declarations)};
}

/** The file a production function lives in, relative to the console root. */
const functionHome = name => {
  homes ??= readHomes();
  if (homes.shared.found.has(name)) return shared;
  const found = homes.owners.filter(home => home.found.has(name));
  if (!found.length) throw Error('Missing production function: ' + name);
  if (found.length > 1) throw Error(name + ' is declared in ' + found.map(home => home.file).join(' and '));
  return found[0].file;
};

/** A production function's declaration, as JavaScript a vm context can run. */
exports.productionFunction = name => {
  if (targetingModule.MOVED().includes(name)) return '';
  const file = functionHome(name);
  if (file === shared) return homes.shared.found.get(name);
  // An owner module is TypeScript, so its declaration loses its types and `export` here.
  const text = homes.owners.find(home => home.file === file).found.get(name);
  return ts.transpileModule(text.replace(/^export\s+/, ''), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
};

/** Several production functions' declarations, one after another. */
exports.productionFunctions = names => names.map(exports.productionFunction).join('\n');
