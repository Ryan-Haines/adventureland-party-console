// npm run addon:check [-- --with <file>] [-- --root <dir>]: the rules it runs are listed in
// run/check.mts. Every command entry here imports only build/installed.mts statically and writes the
// installed list before it loads its body, since the body's imports reach runtime/hooks/index.ts,
// which imports the list (rules/uses.mts `entryFindings`).
import { ROOT, writeInstalled } from '../build/installed.mts';

writeInstalled(ROOT);
await (await import('./run/check.mts')).main(process.argv.slice(2));
