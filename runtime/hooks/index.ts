// The one registry per JavaScript realm. The character's bundles (the class bundles and
// party-member.js) and the coordinator's bundles share it through `globalThis`, so the
// switches and settings the coordinator sends reach every hook point.
import { createRegistry, type HookRegistry } from './registry.ts';
import { registerConsole } from './core.ts';
// The add-on folders the build found (build/installed.mts), in code-point order.
import { installed } from '../../.build/addons/runtime.ts';

export function partyHooks(): HookRegistry {
  const root = globalThis as { __partyHooks?: HookRegistry };
  if (root.__partyHooks) return root.__partyHooks;
  const registry = createRegistry();
  registerConsole(registry, installed);
  return root.__partyHooks = registry;
}
