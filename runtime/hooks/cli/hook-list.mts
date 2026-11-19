// node runtime/hooks/cli/hook-list.mts: writes runtime/addons/HOOKS.md from the code (run/hook-list.mts).
import { ROOT, writeInstalled } from '../build/installed.mts';

writeInstalled(ROOT);
(await import('./run/hook-list.mts')).main();
