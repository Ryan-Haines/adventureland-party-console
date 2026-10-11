import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {createManagedConsole} from './hosting.ts';
import {ConsoleBuildStore} from './store.ts';

/** Stable checkout entrypoint: completed gameplay assets activate independently;
 * a deliberate host restart loads its managed controller from the active build.
 * First setup has no active artifact, so it uses the installed bootstrap code. */
export async function loadManagedConsole(...args: Parameters<typeof createManagedConsole>): Promise<Awaited<ReturnType<typeof createManagedConsole>>> {
  const [root] = args;
  const store = new ConsoleBuildStore(root);
  const refs = await store.references();
  const implementation: typeof import('./hosting.ts') = refs.active
    ? await import(pathToFileURL(path.join((await store.verify(refs.active)).directory, 'tools/console-build/hosting.ts')).href)
    : await import('./hosting.ts');
  if (typeof implementation.createManagedConsole !== 'function') throw new Error('Active candidate lacks its managed host implementation');
  return implementation.createManagedConsole(...args);
}
