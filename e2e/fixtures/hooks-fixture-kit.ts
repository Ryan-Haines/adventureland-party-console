// The parts every hook fixture add-on shares. A fixture builds its hooks as a typed object literal of
// `FixtureHooks`, the published Registration's hooks, so a handler whose answer drifts from its
// hook's declared shape fails tsc over e2e. The types come from the add-on API only.
import type { Registration } from '../../runtime/hooks/addon-api.ts';

export type FixtureHooks = Registration['hooks'];

// A heard list keeps its newest `cap` entries, so a long table run holds a bounded page or process.
export function keepCapped<E>(list: E[], cap: number): (entry: E) => void {
  return entry => { list.push(entry); if (list.length > cap) list.shift(); };
}

// The two registry calls a fixture's join makes, as the realm's `__partyHooks` answers them.
export interface JoiningRegistry {
  map(): { registrations: readonly { name: string }[] };
  register(registration: Registration): { ok: true } | { ok: false; message: string };
}
// Joins `registration` to a realm's registry once: a second register of the same name answers ok,
// since a row may ask before each step.
export function registerOnce(hooks: JoiningRegistry, registration: Registration): { ok: true } | { ok: false; message: string } {
  return hooks.map().registrations.some(r => r.name === registration.name) ? { ok: true } : hooks.register(registration);
}

// Page source: the saved add-on switches with the add-on `name` on or off, from the character's own
// registry, for a row that posts them to /party-api/settings `addons`.
export const switches = (name: string, enabled: boolean) => `(()=>{const hooks=globalThis.__partyHooks,out={};
  for(const r of hooks.map().registrations)if(r.folder==='addons'&&r.name!==${JSON.stringify(name)})out[r.name]={enabled:hooks.enabled(r.name),settings:hooks.settings(r.name)};
  if(${enabled})out[${JSON.stringify(name)}]={enabled:true,settings:{}};return out;})()`;
