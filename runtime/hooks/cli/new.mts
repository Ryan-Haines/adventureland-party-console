// npm run addon:new <name> [-- --root <dir>]: writes runtime/addons/<name>/ (run/new.mts).
import { ROOT, writeInstalled } from '../build/installed.mts';

writeInstalled(ROOT);
await import('./run/new.mts');
