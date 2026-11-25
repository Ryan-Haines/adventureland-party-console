// One registry with the core registrations and every installed add-on, loaded the way the
// console loads them (runtime/hooks/index.ts), plus any `--with <file>` registration to try.
// `--root <dir>` reads the add-on folders of another checkout, as the add-on tests do.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRegistry, type Registration } from '../../registry.ts';
import { registerConsole } from '../../core.ts';
import { rootOf, writeInstalled } from '../../build/installed.mts';

export { rootOf };

export async function loadRegistry(args: string[]) {
  const root = rootOf(args), registry = createRegistry(), extra: Registration[] = [];
  writeInstalled(root);
  const { installed } = await import(pathToFileURL(path.join(root, '.build/addons/runtime.ts')).href) as { installed: readonly { folder: string; registration: Registration }[] };
  for (let i = 0; i < args.length; i++) if (args[i] === '--with') {
    const module = await import(pathToFileURL(args[++i]).href) as { registration?: Registration; default?: Registration };
    const registration = module.registration ?? module.default;
    if (!registration) throw Error(`${args[i]} exports no registration`);
    extra.push(registration);
  }
  registerConsole(registry, installed);
  for (const registration of extra) registry.register(registration);
  return registry;
}
