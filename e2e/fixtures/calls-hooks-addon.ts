// The call budget's fixture add-on: it hears every notice the budget sends and reads `calls.margin`
// at each one, so the hooks table checks the whole surface an add-on reaches. It answers no
// request: an add-on makes no game call. Each notice is kept in local storage as well as on the
// page, since the table's last row, the `limitdc`, relogs the character.
import type { CallNotice } from '../../runtime/hooks/addon-api';
import { switches } from './hooks-fixture-kit.ts';

export const CALLS_HOOKS_ADDON = 'calls-hooks-fixture';
export const CALLS_HOOKS_KEY = 'e2e-calls-hooks';
export const CALL_NOTICES = ['calls.held', 'calls.released', 'calls.waited', 'calls.raised', 'calls.unmatched', 'calls.limitdc'] as const;
// One heard notice, with the margin the add-on read at it.
export type HeardNotice = { event: (typeof CALL_NOTICES)[number]; at: number; payload: CallNotice; margin: number };

// Page source: registers the add-on on the character's hook registry once.
export const registerCallsHooksAddon = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(CALLS_HOOKS_ADDON)},key=${JSON.stringify(CALLS_HOOKS_KEY)};
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  const heard=globalThis.__e2eCallsHooks=[];
  const hear=event=>payload=>{const entry={event,at:Date.now(),payload,margin:hooks.calls.margin()};heard.push(entry);
    try{const kept=JSON.parse(localStorage.getItem(key)||'[]');kept.push(entry);localStorage.setItem(key,JSON.stringify(kept.slice(-200)));}catch{}};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Hears every call budget notice and reads the margin.',
    hooks:Object.fromEntries(${JSON.stringify(CALL_NOTICES)}.map(event=>[event,hear(event)]))});})()`;

// The saved add-on switches with this add-on on or off, from the character's own registry.
export const callsHooksSwitches = (enabled: boolean) => switches(CALLS_HOOKS_ADDON, enabled);

// Page source: every notice heard since `from`, from local storage, which outlives a relog.
export const heardSince = (from: number) => `(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(CALLS_HOOKS_KEY)})||'[]').filter(e=>e.at>=${from});}catch{return [];}})()`;
