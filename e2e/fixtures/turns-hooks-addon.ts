// The turns owner's fixture add-on: one registration that answers both decision hooks and hears every event, and reads
// each published read, so W04's hooks steps (e2e/windows/W04-low-vitals.spec.ts) check the whole surface an
// add-on reaches. It asks for the warrior's Charge at `task` whenever its target is out of weapon
// range: no core source casts Charge outside the escape
// (runtime/characters/survival/escape.ts `charge`), and Charge has no level or MP requirement (game
// data 18285), so a Charge whose diagnostic names this add-on came from this registration alone. Its
// refusal holds the warrior's damage casts while `__e2eHoldPull` is set in its page. Each notice is
// kept on the page with the reads the add-on made at it.
import type { SkillsNotice } from '../../runtime/hooks/addon-api';
import { switches } from './hooks-fixture-kit.ts';

export const TURNS_CHARGE_ADDON = 'turns-charge-fixture';
export const TURNS_NOTICES: readonly SkillsNotice[] = ['skills.sent', 'skills.settled', 'skills.dropped', 'skills.waiting', 'skills.readied',
  'skills.held', 'skills.released', 'skills.shot', 'skills.landed', 'skills.passed'];
// Two of the role loop's events, which the hooks table's rows time.
export const LOOP_EVENTS = ['targeting.changed', 'report.sent'] as const;
// One heard notice, with what the add-on read at it.
export type HeardTurns = { event: SkillsNotice | (typeof LOOP_EVENTS)[number]; at: number; payload: Record<string, unknown>; reads: Record<string, unknown> };

// Page source: registers the add-on on the character's hook registry once.
export const registerTurnsChargeAddon = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(TURNS_CHARGE_ADDON)};
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  const heard=globalThis.__e2eTurnsHooks=[];
  const reads=()=>({potion:hooks.turns.ready('use_hp'),allows:hooks.skills.allows({rank:'damage'}),
    incoming:character.target?hooks.turns.incoming(character.target,character.name):0});
  // The list keeps 2000 notices per event, so the role loop's many skills.passed never push out
  // the few report.sent a window reads.
  const kept={},hear=event=>payload=>{heard.push({event,at:Date.now(),payload,reads:reads()});
    if((kept[event]=(kept[event]||0)+1)>2000){heard.splice(heard.findIndex(e=>e.event===event),1);kept[event]--;}};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Charges toward a target out of weapon range, and hears every turns notice.',
    hooks:{'skills.request':[{name:'charge',rank:'task',answer(view){
      const me=view&&view.character,t=view&&view.target&&view.target.target;
      if(!me||me.ctype!=='warrior'||!t)return undefined;
      // Out of weapon range: the distance between the two, as the game's own range check reads it.
      if(Math.hypot((t.real_x??t.x)-me.real_x,(t.real_y??t.y)-me.real_y)<=me.range)return undefined;
      return {skill:'charge',rank:'task',category:'maintenance',reason:'target out of weapon range'};}}],
    'skills.refuses'(ask){return globalThis.__e2eHoldPull&&character.ctype==='warrior'&&ask.category==='damage'?'holding a pull':undefined;},
    ...Object.fromEntries(${JSON.stringify([...TURNS_NOTICES, ...LOOP_EVENTS])}.map(event=>[event,hear(event)]))}});})()`;

// The saved add-on switches with this add-on on or off, from the character's own registry.
export const addonSwitches = (enabled: boolean) => switches(TURNS_CHARGE_ADDON, enabled);

// Page source for the `c25report` red plant: the add-on's report.sent listener, as the registry
// holds it, hears only one notice in three. Every other listener stays as registered.
export const breakReportListener = `(()=>{const r=globalThis.__partyHooks.registrations().find(r=>r.name===${JSON.stringify(TURNS_CHARGE_ADDON)});
  const listen=r.hooks['report.sent'];let n=0;r.hooks['report.sent']=function(){if(n++%3===0)return listen.apply(this,arguments);};return true;})()`;

// Page source: every notice heard since `from`.
export const turnsHeardSince = (from: number) => `(globalThis.__e2eTurnsHooks||[]).filter(e=>e.at>=${from})`;
