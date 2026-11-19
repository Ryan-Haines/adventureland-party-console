"use client";
import {useState, type ReactNode} from 'react';
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  ChartNoAxesCombined,
  Landmark,
  Mail,
  Store,
  Settings,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { PartyGold } from "./party-gold";
import type { PartyConsoleModel } from "./use-party-console";
import { MailCount } from "./mail-count";
import { ConsoleUpdateIndicator, useUpdates } from './console-updates';
import { ConsoleBuildControl } from './console-build-control';
import { usePinTopBar } from './pin-top-bar';
import { ConsoleControls, ConsolePausedIndicator, ConsoleResumeBanner } from './console-controls';
import { HandControlCount } from './hand-control';
import { RECONNECTING_NOTICE } from './query-cache';
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';

// The header's one connection line. It reads the core poll the cards draw from, so a stopped
// coordinator shows "Reconnecting" beside the last numbers it sent.
export function ConnectionLine({ loading, unavailable }: { loading: boolean; unavailable: boolean }) {
  const tone = unavailable ? 'border-rose-500 bg-rose-950 text-rose-100' : loading ? 'border-slate-500 bg-slate-950 text-slate-200'
    : 'border-emerald-600 bg-emerald-950 text-emerald-100';
  return <output data-connection className={`ml-3 rounded border px-2 py-0.5 font-mono text-xs ${tone}`}>
    {unavailable ? RECONNECTING_NOTICE : loading ? 'Connecting...' : 'Live'}
  </output>;
}

function HornedMonster({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M5 10 2 2l7 5m10 3 3-8-7 5M5 10c0-5 14-5 14 0v6c0 7-14 7-14 0Z M7 12l3 2m7-2-3 2M9 18h6" />
    </svg>
  );
}
function ListCode({className}:{className:string}) { return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 4h18M3 8h18M3 12h7M7 16l-4 3 4 3m10-6 4 3-4 3m-3-7-3 8" /></svg>
  ); }

export function PartyHeader({ model, onLogs, metricsActive, onMetrics, recordIcon }: { model: PartyConsoleModel; onLogs: () => void; metricsActive: boolean; onMetrics: () => void;
  recordIcon?: ReactNode;
}) {
  const [artifact,setArtifact]=useState<string>();
  const { state: updates } = useUpdates();
  const [pinned] = usePinTopBar();
  const {
    state,
    setMailOpen,
    setCatalogOpen,
    setBestiaryOpen,
    setSkillsOpen,
    setStandOpen,
    setMarketOpen,
    setBankOpen,
    setSettingsOpen,
    setRealmDestination,
    aldataKey,
    aldataAction,
  } = model;
  return (
    <>
      {/* "Pin top bar" (pin-top-bar.tsx) makes the header sticky; dialogs and popovers (z-50) stay
          above it. The card name strips measure it through data-party-header. */}
      <header data-area="top-bar" data-party-header className={`${pinned ? 'sticky top-0 z-30 ' : ''}border-b border-emerald-900/70 bg-[#091614] px-4 py-2 md:px-10 md:py-5`}>
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-x-5 gap-y-2 md:gap-5">
          <div className="relative"><div className="flex items-center"><h1 className="text-xl font-semibold md:text-3xl">Party Console</h1><ConsoleBuildControl onActiveChange={setArtifact} />
            <ConsoleControls polled={state.consoleControl} />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                setSettingsOpen(true);
                setRealmDestination(
                  state.realmControl?.activeRealm ||
                    state.realmControl?.currentRealm ||
                    '',
                );
                if (state.aldata?.hasKey && !aldataKey)
                  void aldataAction('reveal');
              }}
              className="ml-2 size-6 rounded-full border-slate-700 bg-transparent text-slate-300"
              aria-label="Interface settings"
              title="Interface settings"
            >
              <Settings className="size-3.5" />
            </Button>
            <ConsoleUpdateIndicator open={() => setSettingsOpen(true)} /><ConnectionLine loading={model.coordinatorLoading} unavailable={model.coordinatorUnavailable} /><ConsolePausedIndicator control={state.consoleControl} /><HandControlCount hands={state.handControlByCharacter} slots={state.activeSlots} /><AddonSlot name="top-bar" part="status" state={state} /></div>
            <span className="mt-1 block font-mono text-[10px] leading-3 text-emerald-100/70">{state.gameVersion ? `Game v${state.gameVersion} · ` : ''}Console{' '}
              {updates
                ? `v${updates.displayVersion || updates.current}`
                : 'loading…'}
            </span>
            {artifact && (
              <span
                data-console-artifact
                title={artifact}
                className="absolute left-0 top-full mt-1 whitespace-nowrap font-mono text-[10px] leading-3 text-emerald-100/70"
              >
                Artifact {artifact.slice(0, 12)}
              </span>
            )}
          </div>
          {/* Phone widths scroll one row of buttons sideways so the header stays short. Wider
              screens put the data views on the top row and the game actions below it. */}
          <div className="-mx-4 flex w-[calc(100%+2rem)] flex-nowrap items-center gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:w-auto md:flex-1 md:justify-end md:overflow-visible md:px-0 md:pb-0 [&>*]:shrink-0">
            <div className="contents md:flex md:flex-col md:items-end md:gap-2">
              <div data-header-row="views" className="contents md:flex md:gap-3 [&>*]:shrink-0">
              <Button
                variant="outline"
                onClick={onMetrics}
                aria-pressed={metricsActive}
                aria-controls="party-metrics-view"
                className={
                  metricsActive
                    ? 'border-cyan-300 bg-cyan-950 text-cyan-100 hover:bg-cyan-900 hover:text-white'
                    : 'border-cyan-700 bg-[#10201f] text-cyan-200 hover:bg-cyan-950 hover:text-white'
                }
              >
                <ChartNoAxesCombined className="mr-2 h-4 w-4" />
                Metrics
              </Button>
              <Button
                variant="outline"
                onClick={() => setCatalogOpen(true)}
                className="border-cyan-700 bg-transparent text-cyan-300"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                Catalog
              </Button>
              <Button
                variant="outline"
                onClick={() => setBestiaryOpen(true)}
                className="border-rose-700 bg-transparent text-rose-300"
              >
                <HornedMonster className="mr-2 h-4 w-4" />
                Bestiary
              </Button>
              <Button
                variant="outline"
                onClick={() => setSkillsOpen(true)}
                className="border-violet-700 bg-transparent text-violet-300"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Skills
              </Button>
              <Button
                onClick={onLogs}
                aria-label="Show logs"
                className="border border-slate-600 bg-slate-950 text-slate-100 hover:bg-slate-800"
              >
                <ListCode className="mr-2 size-4" />
                Logs
              </Button>
              {recordIcon}
              <AddonSlot name="top-bar" part="views" state={state} />
              </div>
              <div data-header-row="actions" className="contents md:flex md:gap-3 [&>*]:shrink-0">
              <Button
                variant="outline"
                onClick={() => setMailOpen(true)}
                className="border-sky-600 bg-black text-sky-200 hover:bg-sky-950 hover:text-white"
              >
                <Mail className="mr-2 h-4 w-4" />
                Mail
                <MailCount />
              </Button>
              <Button
                variant="outline"
                onClick={() => setStandOpen(true)}
                className="border-amber-700 bg-transparent text-amber-300"
              >
                <Store className="mr-2 h-4 w-4" />
                Stand ·{' '}
                {state.standSlots?.used ?? '-'}
                /{state.standSlots?.slots ?? '-'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setMarketOpen(true)}
                className="border-cyan-700 bg-transparent text-cyan-300"
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Market
              </Button>
              <Button
                variant="outline"
                onClick={() => setBankOpen(true)}
                className="border-emerald-700 bg-transparent text-emerald-300"
              >
                <Landmark className="mr-2 h-4 w-4" />
                Bank
              </Button>
              <AddonSlot name="top-bar" part="actions" state={state} />
              </div>
            </div>
            <PartyGold state={state} />
          </div>
        </div>
        <ConsoleResumeBanner polled={state.consoleControl} />
      </header>
    </>
  );
}
