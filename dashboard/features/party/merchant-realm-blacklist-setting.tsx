"use client";
import { useSettingsWrite } from "./settings-write";
import type { RealmOption } from "./realm-option";

// The realm list of the call budget owner's `merchantRealmBlacklist`. Automatic merchant
// work skips a listed realm; an order you give for one asks your confirmation first. PVP realms are
// not listed: every switch refuses them already, and the setting's check refuses them too.
export function MerchantRealmBlacklistSetting({ realms = [], blacklist = [] }: { realms?: RealmOption[]; blacklist?: string[] }) {
  const settings = useSettingsWrite();
  const save = (realm: string, listed: boolean) => {
    const value = listed ? [...blacklist, realm] : blacklist.filter(key => key !== realm);
    void settings.write([{ field: "merchantRealmBlacklist", value }]);
  };
  return <fieldset disabled={!settings.ready || settings.pending} aria-busy={!settings.ready} aria-describedby="merchant-realm-blacklist-help"
    className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <legend className="font-mono text-xs uppercase tracking-wider text-violet-300">Realm blacklist</legend>
    <p id="merchant-realm-blacklist-help" className="text-xs text-slate-300">
      Automatic merchant work never travels to a listed realm. An order you give for one asks you to confirm it first.
    </p>
    <div className="grid gap-1 sm:grid-cols-3">
      {realms.filter(realm => !realm.pvp).map(realm => <label key={realm.key} className="flex items-center gap-2">
        <input type="checkbox" checked={blacklist.includes(realm.key)} onChange={event => save(realm.key, event.target.checked)}
          className="size-4 border border-slate-400 bg-slate-950 accent-violet-400" />
        {realm.label}
      </label>)}
    </div>
    {settings.notice ? <p role="alert" className="text-amber-200">{settings.notice}</p> : null}
  </fieldset>;
}
