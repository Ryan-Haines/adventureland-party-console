// npm run addon:map [-- --with <file>] [-- --root <dir>]: prints the owner map (run/map.mts).
import { ROOT, writeInstalled } from '../build/installed.mts';

writeInstalled(ROOT);
await import('./run/map.mts');
