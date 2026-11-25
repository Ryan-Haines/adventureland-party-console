// The coverage ledger of the live suite rebuild (test-windows DESIGN.md section 5). The "before"
// list is every live assertion at c573fc423: each expect with its message (or its source when it
// has none) and each lettered check id (TC33, SV11, CB30 ...) in the code a catalog test or row
// runs, keyed by its catalog id. ledger.tsv maps each before line to where it lives now: an
// observer of a window, a unit or harness test, a removal with its why, or the old table while
// its window is not ported, or a later window it moves to before that one is. A before line with
// no mapping fails the check.
//
// Usage:
//   node e2e/coverage/ledger.mts before   scan the e2e code and write before.tsv (run at c573fc423)
//   node e2e/coverage/ledger.mts seed     add an old: row to ledger.tsv for each unmapped line
//   node e2e/coverage/ledger.mts [--final] check; --final also refuses every old: row (step 13)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Before = { id: string; kind: 'expect' | 'check'; text: string; at: string };
export type Mapping = { id: string; kind: string; text: string; target: string };
export type Sources = { windows: Record<string, { observers: string[]; text: string }>; read(file: string): string | null };
const key = (l: { id: string; kind: string; text: string }) => `${l.id}\t${l.kind}\t${l.text}`;

export function check(catalog: { id: string; window: string }[], before: Before[], ledger: Mapping[], sources: Sources, final = false): string[] {
  const findings: string[] = [], windowOf = new Map(catalog.map(c => [c.id, c.window]));
  const ids = new Set(before.map(b => b.id));
  for (const c of catalog) if (!ids.has(c.id)) findings.push(`${c.id} has no before line: the scan found no assertion in its test or row`);
  const mapped = new Map(ledger.map(m => [key(m), m]));
  for (const b of before) {
    const m = mapped.get(key(b)), label = `${b.id} ${b.kind} "${b.text.slice(0, 80)}" (${b.at})`;
    if (!m) { findings.push(`${label} has no mapping`); continue; }
    const [kind, ...rest] = m.target.split(':'), value = rest.join(':');
    // A catalog window split by the code (W10 into W10a-W10f, DEVIATIONS.md) is ported once any part is.
    const ported = (w: string) => Object.keys(sources.windows).some(k => k === w || k.replace(/[a-z]$/, '') === w);
    if (kind === 'window') {
      const [w, observer] = value.split(':'), win = sources.windows[w];
      if (!win) findings.push(`${label} maps to ${w}, which no window spec declares`);
      else {
        if (observer && !win.observers.includes(observer)) findings.push(`${label}: ${w} declares no observer ${observer}`);
        if (!win.text.includes(b.kind === 'check' ? b.text : b.text.slice(0, 120))) findings.push(`${label}: ${w} holds no "${b.text.slice(0, 80)}"`);
      }
    } else if (kind === 'unit') {
      const [file, title] = value.split('::'), text = sources.read(file);
      if (text == null) findings.push(`${label} maps to ${file}, which does not exist`);
      else if (!title || !text.includes(title)) findings.push(`${label}: ${file} has no test "${title}"`);
    } else if (kind === 'removed') {
      if (!value.trim()) findings.push(`${label} is removed with no why`);
    } else if (kind === 'moves') {
      // A line whose check moves to a later window (M62's answering hooks to W09 by QUESTIONS.md
      // L5) waits for that window's port, which maps it there. A line bound for a unit row
      // (T43's planted checks) waits for step 12, which writes the row and maps it as unit:.
      const w = value.split(':')[0];
      if (final) findings.push(`${label} still waits for ${w} at the final step`);
      else if (!/^(W\d+[a-z]?|step12)$/.test(w)) findings.push(`${label} moves to no window or step: ${m.target}`);
      else if (ported(w)) findings.push(`${label} moves to ${w}, which is ported: map it to its observer there`);
    } else if (kind === 'old') {
      const w = windowOf.get(b.id);
      if (final) findings.push(`${label} still maps to the old table at the final step`);
      else if (w && ported(w)) findings.push(`${label} still maps to the old table though ${w} is ported`);
    } else findings.push(`${label} has an unknown target ${m.target}`);
  }
  return findings;
}

// ---- The scan: a catalog test or row's own function and every e2e function it calls. ----
const root = path.resolve(import.meta.dirname, '../..'), e2e = path.join(root, 'e2e');
const rel = (file: string) => path.relative(root, file).replaceAll('\\', '/');
const program = new Map<string, ts.SourceFile>();
const source = (file: string) => {
  let sf = program.get(file);
  if (!sf && existsSync(file)) { sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true); program.set(file, sf); }
  return sf;
};
// The live suite's code: e2e/ and the add-on rows a live spec imports (runtime/addons/*/tests).
const addonTests = path.join(root, 'runtime/addons');
const e2eFiles = () => [...readdirSync(e2e).filter(f => f.endsWith('.ts')).map(f => path.join(e2e, f)),
  ...readdirSync(addonTests).flatMap(a => { const d = path.join(addonTests, a, 'tests'); return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.ts')).map(f => path.join(d, f)) : []; })];
const literal = (n: ts.Node | undefined) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
// A title the code builds from a template (a row per rare, a test per mode) matches with each
// substitution read as any text.
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titled = (n: ts.Node | undefined, want: string) => literal(n) === want || (!!n && ts.isTemplateExpression(n) &&
  new RegExp('^' + [n.head.text, ...n.templateSpans.map(t => t.literal.text)].map(escaped).join('.*') + '$').test(want));

// A function's body by name in a file: a declaration, or a const bound to an arrow or function.
function declared(sf: ts.SourceFile, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer;
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
// Where a name used in `sf` is defined: in `sf` itself, or in the relative module it imports it from.
function resolve(sf: ts.SourceFile, name: string): [ts.SourceFile, ts.Node] | undefined {
  const own = declared(sf, name);
  if (own) return [sf, own];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    const spec = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!spec.startsWith('.')) continue;
    const el = st.importClause.namedBindings.elements.find(e => e.name.text === name);
    if (!el) continue;
    const base = path.resolve(path.dirname(sf.fileName), spec), file = [base, base + '.ts', base.replace(/\.ts$/, '') + '.ts'].find(f => existsSync(f) && f.endsWith('.ts'));
    const target = file && source(file);
    if (target) { const d = declared(target, el.propertyName?.text ?? name); if (d) return [target, d]; }
  }
  return undefined;
}
const checkId = /\b(?:[A-Z]{2,3}\d{1,3}[a-z]?)\b/g;
function collect(id: string, sf: ts.SourceFile, start: ts.Node, out: Map<string, Before>) {
  const seen = new Set<ts.Node>();
  const walk = (file: ts.SourceFile, node: ts.Node) => {
    if (seen.has(node)) return;
    seen.add(node);
    const at = (n: ts.Node) => `${rel(file.fileName)}:${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`;
    for (const m of node.getFullText(file).matchAll(checkId)) {
      if (!/^E2E/.test(m[0])) { const b: Before = { id, kind: 'check', text: m[0], at: at(node) }; out.set(key(b), out.get(key(b)) ?? b); }
    }
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        let callee: ts.Expression = n.expression;
        const isExpect = (ts.isIdentifier(callee) && callee.text === 'expect')
          || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'expect' && ['poll', 'soft'].includes(callee.name.text));
        if (isExpect) {
          const second = n.arguments[1];
          const message = literal(second) ?? (second && ts.isTemplateExpression(second) ? second.getText(file) : undefined)
            ?? (second && ts.isObjectLiteralExpression(second) ? second.properties.map(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'message' ? p.initializer : undefined).filter(Boolean).map(x => literal(x) ?? x!.getText(file))[0] : undefined);
          let chain: ts.Node = n;
          while (chain.parent && (ts.isPropertyAccessExpression(chain.parent) || (ts.isCallExpression(chain.parent) && chain.parent.expression === chain))) chain = chain.parent;
          const b: Before = { id, kind: 'expect', text: flat(message ?? chain.getText(file)).slice(0, 240), at: at(n) };
          out.set(key(b), out.get(key(b)) ?? b);
        }
        // A wait helper that wraps expect.poll (gameplay-clock.ts poll) carries its assertion's
        // message in a { message } option.
        if (!isExpect) for (const arg of n.arguments) if (ts.isObjectLiteralExpression(arg)) for (const p of arg.properties) {
          if (!ts.isPropertyAssignment(p) || p.name.getText(file) !== 'message') continue;
          const b: Before = { id, kind: 'expect', text: flat(literal(p.initializer) ?? p.initializer.getText(file)).slice(0, 240), at: at(n) };
          out.set(key(b), out.get(key(b)) ?? b);
        }
        if (ts.isIdentifier(callee)) { const r = resolve(file, callee.text); if (r) walk(r[0], r[1]); }
      }
      // A row or helper passed by name (a table's row list, `run(world, someRow)`).
      if (ts.isIdentifier(n) && n.parent && !ts.isCallExpression(n.parent) && (ts.isArrayLiteralExpression(n.parent) || ts.isCallExpression(n.parent.parent ?? n))) {
        const r = resolve(file, n.text); if (r && r[1] !== node && (ts.isArrowFunction(r[1]) || ts.isFunctionExpression(r[1]) || ts.isFunctionDeclaration(r[1]))) walk(r[0], r[1]);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };
  walk(sf, start);
}
// A catalog entry's own code: the row tuple named by its row, else the test( call named by its title.
function rootOf(spec: string, test: string, row: string): [ts.SourceFile, ts.Node] | undefined {
  const files = [path.join(e2e, spec), ...e2eFiles()].filter((f, i, a) => a.indexOf(f) === i && existsSync(f));
  const title = test.split(/ [>›] /).at(-1)!;
  for (const want of row ? [row] : [title]) for (const file of files) {
    const sf = source(file)!;
    let hit: ts.Node | undefined;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if (row && ts.isArrayLiteralExpression(n) && titled(n.elements[0], want) && n.elements[1]) hit = n.elements[1];
      else if (!row && ts.isCallExpression(n) && titled(n.arguments[0], want) && n.arguments.length > 1) hit = n.arguments.at(-1);
      else ts.forEachChild(n, visit);
    };
    visit(sf);
    if (hit) {
      if (ts.isIdentifier(hit)) { const r = resolve(sf, hit.text); if (r) return r; }
      return [sf, hit];
    }
    if (!row) continue;
  }
  return undefined;
}

const tsv = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t')) : [];
const here = (f: string) => path.join(import.meta.dirname, f);
function readCatalog() {
  return tsv(here('catalog.tsv')).slice(1).map(([id, spec, window, test, row, verdict]) => ({ id, spec: spec.replace(/ \(.*$/, ''), window, test, row, verdict }));
}
function windowSources(): Sources['windows'] {
  const dir = path.join(e2e, 'windows'), out: Sources['windows'] = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.spec.ts'))) {
    // The window's text is its spec and every relative module it reaches, where its observers keep
    // the old rows' assertions.
    const files = new Set<string>(), queue = [path.join(dir, f)];
    while (queue.length) {
      const file = queue.pop()!;
      if (files.has(file) || !existsSync(file)) continue;
      files.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
        const base = path.resolve(path.dirname(file), m[1]);
        queue.push(base.endsWith('.ts') || base.endsWith('.mts') ? base : base + '.ts');
      }
    }
    const text = [...files].map(file => readFileSync(file, 'utf8')).join('\n');
    const flatText = flat(text);
    const own = readFileSync(path.join(dir, f), 'utf8');
    for (const m of own.matchAll(/liveWindow\(\{\s*id:\s*'(W\d+[a-z]?)'/g)) {
      const observers = [...own.matchAll(/\bid:\s*'([A-Z]{1,2}\d+[a-z]?)'/g)].map(x => x[1]).filter(x => !/^W\d+[a-z]?$/.test(x));
      out[m[1]] = { observers, text: text + '\n' + flatText };
    }
  }
  return out;
}

if (import.meta.main) {
  const mode = process.argv[2] ?? 'check', catalog = readCatalog();
  if (mode === 'before') {
    const lines: Before[] = [], missing: string[] = [];
    for (const c of catalog) {
      const r = rootOf(c.spec, c.test, c.row);
      if (!r) { missing.push(c.id); continue; }
      const out = new Map<string, Before>();
      collect(c.id, r[0], r[1], out);
      lines.push(...out.values());
    }
    writeFileSync(here('before.tsv'), ['id\tkind\ttext\tat', ...lines.map(l => [l.id, l.kind, l.text.replaceAll('\t', ' '), l.at].join('\t'))].join('\n') + '\n');
    console.log(`${lines.length} before lines for ${new Set(lines.map(l => l.id)).size} of ${catalog.length} catalog ids` + (missing.length ? `; not found: ${missing.join(' ')}` : ''));
  } else {
    const before = tsv(here('before.tsv')).slice(1).map(([id, kind, text, at]) => ({ id, kind, text, at }) as Before);
    const ledger = tsv(here('ledger.tsv')).slice(1).map(([id, kind, text, target]) => ({ id, kind, text, target }));
    if (mode === 'seed') {
      const have = new Set(ledger.map(key)), spec = new Map(catalog.map(c => [c.id, c.spec]));
      const added = before.filter(b => !have.has(key(b))).map(b => ({ id: b.id, kind: b.kind, text: b.text, target: `old:e2e/${spec.get(b.id)}` }));
      writeFileSync(here('ledger.tsv'), ['id\tkind\ttext\ttarget', ...[...ledger, ...added].map(m => [m.id, m.kind, m.text, m.target].join('\t'))].join('\n') + '\n');
      console.log(`${added.length} old: rows added`);
    } else {
      const findings = check(catalog, before, ledger, { windows: windowSources(), read: f => existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null }, process.argv.includes('--final'));
      for (const f of findings) console.log(f);
      console.log(findings.length ? `${findings.length} ledger findings` : `ledger complete: ${before.length} before lines mapped`);
      process.exitCode = findings.length ? 1 : 0;
    }
  }
}
