"use client";
// The settings menu's Account tab: the sections that were the Interface settings dialog
// (Import/Export, Realm, Characters, ALData and the display, app, hosting and console sections)
// and the Marketplace settings that were the stand sheet's dialog.
import { useState } from "react";
import { RefreshCw, Copy, Eye, EyeOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddonSlot } from "../../../runtime/hooks/dashboard/slots";
import { AccountSettings } from "./account-settings";
import { AppKeysSettings } from "./app-keys-settings";
import { ConsoleUpdateSettings } from "./console-updates";
import { DashboardStateImport } from "./dashboard-state-import";
import { HostingSettings } from "./hosting-settings";
import { MarketplaceSettings } from "./marketplace-settings";
import { PinTopBarSetting } from "./pin-top-bar";
import type { AccountSection } from "./settings-target";
import type { PartyConsoleModel } from "./use-party-console";

export function AccountSections({ model, section }: { model: PartyConsoleModel; section: AccountSection }) {
  switch (section) {
    case "import": return <ImportSection model={model} />;
    case "realm": return <RealmSection model={model} />;
    case "characters": return <CharactersSection model={model} />;
    case "aldata": return <ALDataSection model={model} />;
    case "marketplace": return <MarketplaceSettings model={model} />;
    case "display": return <PinTopBarSetting />;
    case "apps": return <AppKeysSettings />;
    case "hosting": return <HostingSettings />;
    case "console": return <section data-area="interface-settings" className="space-y-4"><ConsoleUpdateSettings /><AddonSlot name="dialog-section" part="interface-settings" /></section>;
  }
}

function ImportSection({ model }: { model: PartyConsoleModel }) {
  const { state } = model;
  return <>
    {state.steamSwitch?.phase === 'failed' && (
      <Button
        type="button"
        variant="outline"
        onClick={() => void model.recoverSteamHandoff()}
        className="border-amber-700 bg-[#171007] text-amber-100 hover:bg-amber-950 hover:text-white"
      >
        Recover Steam handoff after characters are offline
      </Button>
    )}
    <DashboardStateImport />
  </>;
}

function RealmSection({ model }: { model: PartyConsoleModel }) {
  const { state, realmDestination, setRealmDestination, setRealmSetHome, setRealmConfirmOpen } = model;
  return (
      <div className="rounded border border-violet-800 bg-[#07090d] p-4 text-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-violet-100">Realm</p>
            <p
              className={`font-mono text-[10px] uppercase ${state.realmControl?.split ? "text-rose-300" : "text-slate-400"}`}
            >
              Current:{' '}
              {state.realmControl?.split
                ? 'Mixed realms'
                : state.realmControl?.realms.find(
                    (realm) =>
                      realm.key === state.realmControl?.currentRealm,
                  )?.label ||
                  state.realmControl?.currentRealm ||
                  'Unknown'}{' '}
              · Home:{' '}
              {state.realmControl?.realms.find(
                (realm) => realm.key === state.realmControl?.homeRealm,
              )?.label ||
                state.realmControl?.homeRealm ||
                'Unknown'}
            </p>
          </div>
          {state.realmControl?.operation &&
          !['complete', 'failed'].includes(
            state.realmControl.operation.phase,
          ) ? (
            <RefreshCw className="h-4 w-4 animate-spin text-violet-300" />
          ) : null}
        </div>
        {state.realmControl?.split ? (
          <div className="mt-3 grid gap-1 rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-100">
            {state.realmControl.characters.map((member) => (
              <span key={member.name}>
                {member.name}: {member.realm || 'offline'}
              </span>
            ))}
          </div>
        ) : null}
        {!state.realmControl?.homeRealm &&
        state.realmControl?.homeCharacters?.length ? (
          <div className="mb-3 rounded border border-amber-700 bg-black p-2 text-xs text-amber-100">
            <p>Home realms differ or are unconfirmed:</p>
            {state.realmControl.homeCharacters.map((member) => (
              <p key={member.name}>
                {member.name}: {member.home || 'unconfirmed'}
              </p>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Select
            value={realmDestination}
            onValueChange={(value) => {
              if (value) setRealmDestination(value);
              setRealmSetHome(false);
            }}
          >
            <SelectTrigger
              aria-label="Change realm"
              className="border-violet-600 bg-black text-violet-50 hover:border-violet-400"
            >
              <SelectValue placeholder="Change realm…" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="border-violet-700 bg-[#07090d] text-violet-50">
              {(state.realmControl?.realms || []).map((realm) => (
                <SelectItem
                  key={realm.key}
                  value={realm.key}
                  disabled={realm.pvp}
                  className="focus:bg-violet-950 focus:text-white disabled:text-slate-600"
                >
                  {realm.label} ({realm.players.toLocaleString()} players)
                  {realm.pvp ? ' — disabled' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            disabled={
              !realmDestination ||
              (!state.realmControl?.split &&
                realmDestination === state.realmControl?.currentRealm &&
                realmDestination === state.realmControl?.homeRealm) ||
              Boolean(
                state.realmControl?.operation &&
                !['complete', 'failed'].includes(
                  state.realmControl.operation.phase,
                ),
              )
            }
            onClick={() => setRealmConfirmOpen(true)}
            className="shrink-0 border-violet-500 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"
          >
            Change realm
          </Button>
        </div>
        {state.realmControl?.operation ? (
          <div
            className={`mt-3 rounded border p-2 text-xs ${state.realmControl.operation.phase === "failed" ? "border-rose-700 bg-rose-950/40 text-rose-200" : state.realmControl.operation.phase === "complete" ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-violet-700 bg-violet-950/30 text-violet-100"}`}
          >
            <p className="font-semibold capitalize">
              {state.realmControl.operation.phase.replace(/-/g, ' ')}
            </p>
            {state.realmControl.operation.error ? (
              <p>{state.realmControl.operation.error}</p>
            ) : null}
            {(state.realmControl.operation.characters || []).map(
              (member) => (
                <p key={member.name}>
                  {member.name}: {member.realm || 'waiting'}
                  {state.realmControl?.operation?.setHome
                    ? member.homeConfirmed
                      ? ' — home confirmed'
                      : ' — waiting for home confirmation'
                    : ''}
                </p>
              ),
            )}
          </div>
        ) : null}
      </div>
  );
}

function CharactersSection({ model }: { model: PartyConsoleModel }) {
  const { state, openSettings, setCreateOpen } = model;
  return (
      <div className="rounded border border-cyan-900/70 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Characters</p>
            <p className="font-mono text-[10px] uppercase text-slate-400">
              Create and add characters to your account roster.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              openSettings(null);
              setCreateOpen(true);
            }}
            className="border-cyan-600 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Create character
          </Button>
        </div>
        <AccountSettings state={state} />
      </div>
  );
}

function ALDataSection({ model }: { model: PartyConsoleModel }) {
  const { state, aldataBusy, aldataAction, aldataKeyVisible, aldataKey, setALDataKeyVisible } = model;
  // The browser gives the Clipboard API only to a secure origin, so on a console
  // reached by its LAN address over plain HTTP the Copy key control selects the key for Ctrl+C instead.
  const [secureOrigin] = useState(() => typeof window !== 'undefined' && window.isSecureContext);
  const [copyNote, setCopyNote] = useState(false);
  return (
      <div className="rounded border border-slate-800 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">ALData</p>
            {model.aldataAuthPending ? (
              <output className="block text-sm text-amber-200">
                Waiting for mail delivery and ALData verification… Do not
                resend; each message costs gold.
              </output>
            ) : null}
            <p className="font-mono text-[10px] uppercase text-slate-400">
              Auth: {model.aldataAuthStatus ?? state.aldata?.auth ?? 'NO'} ·
              Publish: {state.aldata?.publishStatus || 'idle'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={aldataBusy}
            onClick={() => void aldataAction('check')}
            className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
          >
            Check status
          </Button>
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            id="aldata-key"
            readOnly
            type={aldataKeyVisible ? 'text' : 'password'}
            value={aldataKey}
            placeholder={
              state.aldata?.hasKey
                ? 'Stored key — reveal to view'
                : 'No key generated'
            }
            className="border-slate-800 bg-black/40 font-mono text-xs"
          />
          <Button
            size="icon"
            variant="outline"
            onClick={() => {
              if (!aldataKey) void aldataAction('reveal');
              setALDataKeyVisible((value) => !value);
            }}
            aria-label="Reveal key"
            className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
          >
            {aldataKeyVisible ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={!aldataKey}
            onClick={() => {
              // With no clipboard, or a refused write, the key shows selected with the note.
              const select = () => {
                setALDataKeyVisible(true);
                setCopyNote(true);
                requestAnimationFrame(() => (document.getElementById('aldata-key') as HTMLInputElement | null)?.select());
              };
              if (secureOrigin) navigator.clipboard.writeText(aldataKey).catch(select);
              else select();
            }}
            aria-label="Copy key"
            className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        {copyNote ? <output className="block mt-1 text-xs text-slate-300">The key is selected: press Ctrl+C to copy it. The browser did not copy it to the clipboard.</output> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button
            disabled={aldataBusy}
            onClick={() => void aldataAction('generate')}
            className="bg-slate-700 text-white hover:bg-slate-600"
          >
            Generate key
          </Button>
          <Button
            disabled={aldataBusy || !state.aldata?.hasKey}
            onClick={() => void aldataAction('send')}
            className="bg-violet-700 text-white hover:bg-violet-600"
          >
            Prepare mail
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Public market browsing needs no key or separate ALData server.
          Publishing requires authentication: generate a unique key. Prepare
          mail opens a prefilled authentication mail. Review the postage and
          click Send; your merchant will send it. ALData stores this key in
          plaintext; never reuse a password. Allow about a minute, then
          check status.
        </p>
        {state.aldata?.error ? (
          <p className="mt-2 text-xs text-rose-300">{state.aldata.error}</p>
        ) : null}
      </div>
  );
}
