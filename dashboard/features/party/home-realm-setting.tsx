"use client";
// The settings menu's Account > Realm home realm setting: the realm the console treats as the
// party's home, written through the settings owner's writer. "Follow the account" saves null, and
// the console then uses the one home every account character shares in the game
// (runtime/merchant-realm/rules.ts `consoleHomeRealm`).
import { realmLabel } from "../../../runtime/protocol/realm.ts";
import { useSettingsWrite } from "./settings-write";
import type { PartyState } from "./party-state";

export function HomeRealmSetting({ state }: { state: PartyState }) {
  const settings = useSettingsWrite();
  const saved = settings.value('homeRealm');
  const chosen = typeof saved === 'string' ? saved : '';
  const accountHome = state.realmControl?.homeRealm || null;
  const realms = (state.realmControl?.realms || []).filter(realm => !realm.pvp);
  return <section data-area="home-realm" aria-label="Home realm" className="mt-4 space-y-2 rounded border border-violet-800 bg-[#07090d] p-4 text-sm text-slate-100">
    <label className="grid justify-items-start gap-2">
      <span className="font-semibold text-violet-100">Home realm</span>
      <select aria-label="Home realm" value={chosen} disabled={!settings.ready || settings.pending}
        onChange={event => void settings.write([{ field: 'homeRealm', value: event.target.value || null }])}
        className="h-9 rounded border border-violet-600 bg-black px-2 text-violet-50">
        <option value="">Follow the account{accountHome ? ` (${realmLabel(accountHome)})` : ''}</option>
        {realms.map(realm => <option key={realm.key} value={realm.key}>{realm.label}</option>)}
      </select>
    </label>
    <p className="text-xs text-slate-300">
      The realm the console treats as home: characters log in there unless a move or switch names another realm.
      Following the account uses the home every character shares in the game.
    </p>
    {chosen && accountHome && chosen !== accountHome ? <p className="text-xs text-amber-200">
      Your characters&apos; game home is {realmLabel(accountHome)}, so they get Hop Sickness on {realmLabel(chosen)}. Change realm with
      &quot;Set as home realm&quot; moves the game home too.
    </p> : null}
    {settings.notice ? <p role="alert" className="text-xs text-amber-200">{settings.notice}</p> : null}
  </section>;
}
