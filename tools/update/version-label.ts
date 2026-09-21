import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readJson } from './files.ts';
import type { Release } from './contracts.ts';
const execute = promisify(execFile);
export async function versionLabel(root: string, release?: Release): Promise<string> {
  if (release) return release.version;
  async function git(args: string[]) {
    try { return (await execute('git', ['-C', root, ...args], { timeout: 3000, windowsHide: true })).stdout.trim(); }
    catch { return ''; }
  }
  const [tag, branch, exact, dirty] = await Promise.all([
    git(['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0']),
    git(['branch', '--show-current']),
    git(['describe', '--tags', '--match', 'v[0-9]*', '--exact-match']),
    git(['status', '--porcelain', '--untracked-files=no']),
  ]);
  const valid = (value: string) => /^v?\d+\.\d+\.\d+$/.test(value);
  if (valid(exact) && !dirty) return exact.replace(/^v/, '');
  const base = valid(tag) ? tag.replace(/^v/, '') : (await readJson<{version:string}>(path.join(root, 'package.json'))).version;
  return base + ' + ' + (branch || (await git(['rev-parse', '--short', 'HEAD'])) || 'development');
}
