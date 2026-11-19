// The settings owner's character door: the install the character bundles'
// entries call (runtime/characters/common.ts, legacy-entry.ts). runtime/settings/api.ts stays free of
// the character install, so the dashboard and the coordinator load no character code through it.
export { installCharacterSettings } from './install.ts';
