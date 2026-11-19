#!/usr/bin/env node
// Lists text that should not reach the upstream repository: finding ids (F-01234), the names Ryan
// and Fonze, plan file names (r2b-, r4-plan, BUILD-PLAN, BUILD-RULES), and em or en dashes in
// code comments. It reads only tracked files, so node_modules, .build and other ignored bundles
// never reach it.
//
//   node scripts/check-copy.mjs [--allow <file>]... [--allow-list <file>]
//
// --allow skips one path; --allow-list reads paths to skip, one per line, so a partial pass can
// run before the rest of the tree is clean. Exits 1 with file:line for every hit, 0 when clean.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['runtime', 'scripts', 'dashboard', 'tools'];
const TEXT = /\.(?:[cm]?[jt]s|tsx|jsx|mts|cts|json|md|ps1|sh|css|html|ya?ml)$/;
const CODE = /\.(?:[cm]?[jt]s|tsx|jsx|mts|cts)$/;
// Built and vendored files ship in the tree as they came, and this file names every pattern it
// looks for.
const SKIP = /(?:^|\/)(?:node_modules|\.build|dist|public)\/|\.min\.js$|package-lock\.json$|\.tsbuildinfo$|^scripts\/check-copy\.mjs$/;
const WORDS = [
  [/\bF-\d{5}\b/, 'finding id'],
  [/\bRyan\b/, 'name Ryan'],
  [/\bFonze\b/, 'name Fonze'],
  [/\br2b-|\br4-plan\b|\bBUILD-PLAN\b|\bBUILD-RULES\b/, 'plan file name'],
];

const allowed = new Set();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow') allowed.add(norm(args[++i]));
  else if (args[i] === '--allow-list') {
    for (const line of fs.readFileSync(args[++i], 'utf8').split(/\r?\n/)) if (line.trim()) allowed.add(norm(line.trim()));
  } else { console.error(`unknown argument ${args[i]}`); process.exit(2); }
}
function norm(p) { return p.replace(/\\/g, '/').replace(/^\.\//, ''); }

// The comment part of a code line: `//` outside a string, or a block comment line.
function commentOf(line, inBlock) {
  if (inBlock || /^\s*(?:\/\*|\*)/.test(line)) return line;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) return line.slice(i);
  }
  return '';
}

const files = execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: root, encoding: 'utf8' })
  .split('\0').filter((f) => f && TEXT.test(f) && !SKIP.test(f) && !allowed.has(f));
const hits = [];
for (const file of files) {
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  const code = CODE.test(file);
  let inBlock = false;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [pattern, what] of WORDS) if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${what}`);
    if (code) {
      const comment = commentOf(line, inBlock);
      if (/[–—]/.test(comment)) hits.push(`${file}:${i + 1}: em or en dash in a comment`);
      const open = line.lastIndexOf('/*'), close = line.lastIndexOf('*/');
      if (open > close && !/^\s*\/\//.test(line)) inBlock = true;
      else if (close >= 0) inBlock = false;
    }
  });
}
for (const hit of hits) console.log(hit);
console.log(`${hits.length} hit(s) in ${files.length} file(s)`);
process.exit(hits.length ? 1 : 0);
