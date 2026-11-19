// The add-on commands' registry for a caller outside them, such as a test: it writes this
// checkout's installed list, then loads run/load.mts, whose imports reach the list.
import { ROOT, rootOf, writeInstalled } from '../build/installed.mts';
import type { loadRegistry as Load } from './run/load.mts';

export { rootOf };
export async function loadRegistry(args: string[]): ReturnType<typeof Load> {
  writeInstalled(ROOT);
  return (await import('./run/load.mts')).loadRegistry(args);
}
