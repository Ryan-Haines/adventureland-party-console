"use client";
// Interface settings "Apps": the app keys screen and the per-setting app lock. The player issues a
// key per app with the scopes it may use and its "Counts as my own commands" switch, sees each key's
// last use and revokes it. The console shows a new key once. Each setting has its lock against
// app changes, saved through the settings owner's writer.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppKey, AppScope } from "../../../runtime/status/api.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePartyAction } from "./query-actions";
import { read } from "./query-cache";
import { useSettingsWrite } from "./settings-write";

const SCOPE_WORDS: Record<AppScope, string> = {
  read: "Read state",
  command: "Movement and task commands",
  settings: "Change settings",
  spend: "Spend or send gold and items",
};
const APPS_KEY = ["party", "apps"] as const;

export function AppKeysSettings() {
  const client = useQueryClient();
  const apps = useQuery({ queryKey: APPS_KEY, queryFn: ({ signal }) => read<{ apps: AppKey[]; scopes: AppScope[] }>(client, "/apps", signal) });
  const action = usePartyAction();
  const settings = useSettingsWrite();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AppScope[]>(["read"]);
  const [ownCommands, setOwnCommands] = useState(false);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: APPS_KEY });
  async function issue() {
    const result = await action.mutateAsync({ path: "/apps", body: { name: name.trim(), scopes, ownCommands } }).catch(() => null);
    if (!result) return;
    setIssued({ name: name.trim(), key: String(result.key) });
    setName("");
    void refresh();
  }
  async function send(path: `/apps/${string}/${"revoke" | "own-commands"}`, body: unknown = {}) {
    await action.mutateAsync({ path, body }).catch(() => null);
    void refresh();
  }
  const locks = (settings.value("appLocks") as string[] | undefined) ?? [];
  const lock = (field: string, locked: boolean) =>
    void settings.write([{ field: "appLocks", value: locked ? [...locks, field] : locks.filter(entry => entry !== field) }]);
  const live = (apps.data?.apps ?? []).filter(app => app.revokedAt === null);
  const when = (at: number | null) => (at ? new Date(at).toLocaleString() : "never");
  return <section data-area="apps" className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100" aria-label="Apps">
    <h3 className="font-semibold">Apps</h3>
    <p className="text-slate-300">Each app that talks to this console gets its own key. A key acts only within the scopes you tick, and its
      commands rank below yours unless it counts as your own. Your paired browsers, the PWA and the Android app need no key.</p>
    <div className="space-y-2">
      <Input value={name} onChange={event => setName(event.target.value)} placeholder="App name" aria-label="App name" />
      {(apps.data?.scopes ?? []).map(scope => <label key={scope} className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-emerald-500" checked={scopes.includes(scope)}
          onChange={event => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter(entry => entry !== scope))} />
        {SCOPE_WORDS[scope]}
      </label>)}
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-emerald-500" checked={ownCommands} onChange={event => setOwnCommands(event.target.checked)} />
        Counts as my own commands
      </label>
      <Button disabled={!name.trim() || !scopes.length || action.isPending} onClick={() => void issue()}>Issue key</Button>
      {action.error ? <p className="text-rose-300">{action.error.message}</p> : null}
      {issued ? <p className="break-all rounded border border-amber-500 p-2 text-amber-200" data-testid="issued-app-key">
        Key for {issued.name}, shown only now: <code>{issued.key}</code></p> : null}
    </div>
    <ul className="space-y-2">
      {live.map(app => <li key={app.name} className="flex flex-wrap items-center gap-3 rounded border border-slate-700 p-2" data-testid="app-key">
        <span className="font-semibold">{app.name}</span>
        <span className="text-slate-400">{app.scopes.map(scope => SCOPE_WORDS[scope]).join(", ")}</span>
        <span className="text-slate-400">Last used {when(app.lastUsedAt)}</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-emerald-500" checked={app.ownCommands}
            onChange={event => void send(`/apps/${app.name}/own-commands`, { ownCommands: event.target.checked })} />
          Counts as my own commands
        </label>
        <Button variant="destructive" onClick={() => void send(`/apps/${app.name}/revoke`)}>Revoke</Button>
      </li>)}
    </ul>
    <details>
      <summary className="cursor-pointer">Settings locked against apps</summary>
      <fieldset disabled={!settings.ready} className="mt-2 grid gap-1 sm:grid-cols-2">
        {settings.fields.filter(entry => entry.field !== "appLocks").map(entry => <label key={entry.field} className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-emerald-500" checked={locks.includes(entry.field)}
            onChange={event => lock(entry.field, event.target.checked)} />
          {entry.label ?? entry.field}
        </label>)}
      </fieldset>
      {settings.notice ? <p className="text-amber-300">{settings.notice}</p> : null}
    </details>
  </section>;
}
