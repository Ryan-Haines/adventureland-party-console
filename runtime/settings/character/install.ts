// The settings owner on a character's runtime:
// the settings live on the coordinator, so the character's answer to `settings.write` refuses
// every write, naming its first field, and nothing is dropped silently. A read finds no value.
// The character's composition registers it once per realm (runtime/characters/common.ts,
// legacy-entry.ts).
import type { HookRegistry, Registration } from '../../hooks/registry.ts';

export const characterSettings: Registration = {
  name: 'core:settings', folder: 'core', author: 'adventureland-party-console',
  summary: 'Refuses a settings write on a character, since the coordinator holds every setting.',
  hooks: {
    'settings.write': batch => ({ ok: false, field: batch.changes[0]?.field ?? '', error: 'settings are written on the coordinator' }),
    'settings.read': () => undefined,
  } };
export function installCharacterSettings(hooks: Pick<HookRegistry, 'register' | 'registrations'>): void {
  if (hooks.registrations().some(r => r.name === characterSettings.name)) return;
  const result = hooks.register(characterSettings);
  if (!result.ok) throw Error(`The settings owner's core:settings did not load: ${result.message}`);
}
