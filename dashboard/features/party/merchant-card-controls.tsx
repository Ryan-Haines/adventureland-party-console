"use client";
import { MerchantCollectionSettings, type MerchantCollectionSettingsProps } from "./merchant-collection-settings";
import { AddonSlot } from "../../../runtime/hooks/dashboard/slots";
import { useClock } from "@/hooks/use-clock";
import { MerchantActivityLog } from "@/components/merchant-activity";
import { Button } from "@/components/ui/button";
import {
  Check,
  ChevronRight,
  Gift,
  Hammer,
  HandCoins,
  Store,
  Pickaxe,
  Fish,
  RefreshCw,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { usePartyAction } from "./query-actions";
import { domainOptions, useVisible } from "./query-cache";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { durationLabel } from "./duration-label";
import { MerchantJob } from "./merchant-job";
import { PartyState } from "./party-state";
import { SendToPartyControl } from "./send-to-party-control";
import { MerchantCancelJobControl } from "./merchant-cancel-job-control";
import { merchantRoutinePriority, routineFor } from '../../../runtime/merchant-jobs/api.ts';
import { coordinatorMerchantTransferBlocked } from '../../../runtime/merchant-jobs/api.ts';
import { merchantJobLabel, merchantKind, pickupReason } from '../../../runtime/merchant-jobs/api.ts';
import { protectedSlotsOf } from '../../../runtime/items/api.ts';
import { useCharacterData } from './dashboard-live';
import { audited } from './field-read-audit';
import { SettingsLock } from './settings-lock';

export const MerchantCardControls = memo(function MerchantCardControls({
  state: baseState,
  collectionSettings,
  onBank,
  onClear,
  onForceStand,
  onCancelJob,
  onRoutines,
  onGather,
  onBuy,
  onCraft,
  onExchange,
  onDonate,
  onGiveaway,
}: {
  state: PartyState;
  collectionSettings: MerchantCollectionSettingsProps;
  onBank: (group?: string) => Promise<void>;
  onClear: () => Promise<void>;
  onForceStand: (enabled: boolean) => Promise<void>;
  onCancelJob: (id?: string) => Promise<void>;
  onRoutines: () => void;
  onGather: (mode: string, enabled: boolean) => Promise<void>;
  onBuy: () => void;
  onCraft: () => void;
  onExchange: () => void;
  onDonate: () => void;
  onGiveaway: () => void;
}) {
  const now = useClock();
  const action = usePartyAction();
  const [activityOpen, setActivityOpen] = useState(false);
  const client = useQueryClient(), visible = useVisible();
  const logs = useQueries({ queries: [{ ...domainOptions(client, 'logs'), enabled: visible }].filter(() => activityOpen) })[0];
  const state = { ...baseState, ...logs?.data };
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  // A refused Retry, shown on its job's row (issue #14).
  const [retryRefusal, setRetryRefusal] = useState<{ id: unknown; message: string } | null>(null);
  const inventory = useCharacterData(state.merchantCharacter || "", 'inventory');
  const merchantStatus = state.merchantCharacter ? state.characters[state.merchantCharacter] : null;
  const merchant = merchantStatus ? audited('merged', {...merchantStatus, ...inventory}) : null;
  const readiness = (mode: "fishing" | "mining") => {
    const remaining = Math.max(
      0,
      Math.max(
        Number(merchant?.gatheringCooldowns?.[mode] || 0),
        Number(state.gatheringCooldowns?.[mode] || 0),
      ) - now,
    );
    if (!remaining)
      return (
        <span className="flex items-center gap-0.5 text-[10px] text-emerald-300">
          <Check className="h-3 w-3" /> Ready
        </span>
      );
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return (
      <span className="font-mono text-[10px] opacity-80">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
    );
  };
  const jobLabel = (job: MerchantJob) => merchantJobLabel(job, state.merchantCatalog?.allItems);
  const gatheringAtCapacity = Array.isArray(merchant?.items) &&
    merchant.items.filter((entry) => !entry).length <= protectedSlotsOf(state, state.merchantCharacter || '');
  // A queued gathering job waits until the merchant jobs owner's planner lists it ready.
  const ready = new Set((state.merchantReady || []).map((job) => job.id));
  const capacityBlocked = (job: MerchantJob) => {
    if (job.reason === "fishing" || job.reason === "mining") return !ready.has(String(job.id));
    const reason = pickupReason(job.reason, job.target, state.merchantCharacter);
    return coordinatorMerchantTransferBlocked(
      { merchantCharacter: state.merchantCharacter || null, statuses: {...state.characters, ...(merchant && state.merchantCharacter ? {[state.merchantCharacter]: merchant} : {})} },
      { ...job, reason: merchantKind(reason).collects ? "marked items" : reason },
    );
  };
  // The items owner's capacity rule holds a transfer; the merchant jobs owner's plan holds a gathering job.
  const blockedReason = (job: MerchantJob) => (job.reason === 'fishing' || job.reason === 'mining') && job.id
    ? "Not ready in the merchant's plan"
    : `Merchant capacity blocked (${merchant?.items?.filter(Boolean).length}/${merchant?.items?.length} slots occupied; protected free slots reserved)`;
  const merchantJobs: { job: MerchantJob; status: string }[] = [
    ...(state.merchantCurrent
      ? [
          {
            job: state.merchantCurrent,
            status:
              state.merchantCurrent.commandReport?.state === 'deferred'
                ? `Waiting: ${state.merchantCurrent.commandReport.reason || "temporarily blocked"}`
                : state.merchantCurrent.reason === 'marked items' &&
                    state.merchantCurrent.phase === 'processing'
                  ? 'finishing collection'
                  : state.merchantCurrent.phase || 'in progress',
          },
        ]
      : []),
    ...(state.merchantQueue || []).map((job) => ({
      job,
      status: capacityBlocked(job)
        ? job.reason === 'fishing' || job.reason === 'mining'
          ? 'BLOCKED'
          : 'blocked'
        : 'queued',
    })),
    // The gathering the console plans: each enabled mode past its cooldown, which gathering
    // runs on the character with no queued job. It waits while the bag is at the protected free
    // slots, the reserve gathering keeps (gathering.ts `blockedReason`).
    ...(state.gatheringModes || [])
      .filter(
        (mode): mode is 'fishing' | 'mining' =>
          (mode === 'fishing' || mode === 'mining') &&
          Math.max(
            Number(merchant?.gatheringCooldowns?.[mode] || 0),
            Number(state.gatheringCooldowns?.[mode] || 0),
          ) <= now &&
          ![state.merchantCurrent, ...(state.merchantQueue || [])].some(
            (job) => job?.reason === mode,
          ),
      )
      .map((mode) => ({
        job: {
          reason: mode,
          target: state.merchantCharacter || '',
        } satisfies MerchantJob,
        status: gatheringAtCapacity ? 'BLOCKED' : 'queued',
      })),
  ];
  return (
    <section data-area="merchant-controls" className="border-b border-amber-900/70 bg-amber-400/[0.03] p-4">
      <details className="group mb-3 rounded border border-amber-900/60 bg-black/20">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300">
          <span>
            Merchant logistics · {state.merchantQueue?.length || 0} queued
          </span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        </summary>
        <div className="space-y-1 border-t border-amber-900/50 px-3 py-2 font-mono text-[10px]">
          {!merchantJobs.length && (
            <p className="text-emerald-100/45">No queued work</p>
          )}
          {merchantJobs.map(({ job, status }, index) => (
            <div
              key={job.id || `${job.reason}-${index}`}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              {(status === 'queued' || status === 'blocked') &&
              job.reason !== 'fishing' &&
              job.reason !== 'mining' ? (
                <MerchantCancelJobControl
                  id={job.id}
                  reason={routineFor(job)}
                  label={jobLabel(job)}
                  onCancel={onCancelJob}
                />
              ) : null}
              <span
                title={`${jobLabel(job)}${job.target && job.reason !== "join giveaway" ? ` · ${job.target}` : ''}`}
                className={
                  `min-w-0 flex-1 truncate text-left ${index === 0 && state.merchantCurrent ? "text-amber-200" : "text-emerald-100/70"}`}
              >
                <span className="mr-1 text-amber-300">
                  P
                  {job.priority ??
                    merchantRoutinePriority(state.merchantRoutinePriorities || {}, routineFor(job))}
                </span>
                {jobLabel(job)}
                {job.target && job.reason !== 'join giveaway'
                  ? ` · ${job.target}`
                  : ''}
              </span>
              <span
                className={`max-w-32 shrink-0 truncate ${status.toLowerCase() === "blocked" ? "text-red-400" : "text-emerald-100/70"}`}
                title={
                  status.toLowerCase() === 'blocked'
                    ? blockedReason(job)
                    : job.realmBlockedReason || job.pauseReason || status
                }
              >
                {status.toLowerCase() === 'blocked'
                  ? status
                  : job.realmBlockedReason ||
                    (job.retryAt && job.retryAt > now
                      ? `Retry at ${new Date(job.retryAt).toLocaleTimeString()}`
                      : job.pauseReason || status)}
              </span>
              {!!job.realmAttempts && (
                <button
                  type="button"
                  className="rounded border border-amber-600 bg-zinc-950 px-2 py-1 text-amber-200 hover:border-amber-300 hover:bg-amber-950 hover:text-white"
                  onClick={() => {
                    setRetryRefusal(null);
                    action.mutateAsync({ path: '/merchant/job/retry', body: { id: job.id } })
                      .catch((error: unknown) => setRetryRefusal({ id: job.id, message: error instanceof Error ? error.message : String(error) }));
                  }}
                >
                  Retry
                </button>
              )}
              {retryRefusal && retryRefusal.id === job.id && (
                <span role="alert" className="text-rose-200">{retryRefusal.message}</span>
              )}
            </div>
          ))}
          {state.mluckSchedule &&
            !merchantJobs.some(
              ({ job }) =>
                !!merchantKind(job.reason).luck &&
                job.target === state.mluckSchedule?.target,
            ) && (
              <div className="flex min-w-0 items-center gap-3 text-left">
                <span className="text-emerald-100/70">
                  Merchant&apos;s Luck upkeep · {state.mluckSchedule.target}
                </span>
                <span className="shrink-0 text-emerald-100/40">
                  {state.mluckSchedule.status === 'scheduled'
                    ? `dispatch in ${durationLabel(state.mluckSchedule.dispatchInMs)}`
                    : state.mluckSchedule.status}
                </span>
              </div>
            )}
        </div>
      </details>
      <details
        className="mb-3"
        onToggle={(event) => setActivityOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-mono text-[10px] uppercase text-amber-300">
          Activity
        </summary>
        <div className="mt-2 flex items-center justify-end gap-2">
          {cleanupResult ? (
            <span className="mr-auto font-mono text-[9px] text-emerald-300">
              {cleanupResult}
            </span>
          ) : null}
          <button
            type="button"
            className="font-mono text-[9px] text-purple-300 hover:text-purple-200"
            onClick={async () => {
              try {
                const result = await action.mutateAsync({
                  path: '/merchant/stale-orders/clear',
                  body: {},
                });
                setCleanupResult(
                  `Removed ${Number(result.deliveriesRemoved) || 0} deliveries, ${Number(result.bankMarksRemoved) || 0} bank marks`,
                );
              } catch (error) {
                setCleanupResult(
                  error instanceof Error ? error.message : 'Cleanup failed',
                );
              }
            }}
          >
            Clear stale orders
          </button>
          <button
            type="button"
            className="font-mono text-[9px] text-rose-300 hover:text-rose-200"
            onClick={async () => {
              try {
                await action.mutateAsync({
                  path: '/merchant/activity/clear',
                  body: {},
                });
                setCleanupResult('Activity history cleared');
              } catch (error) {
                setCleanupResult(
                  error instanceof Error ? error.message : 'Cleanup failed',
                );
              }
            }}
          >
            Clear history
          </button>
        </div>
        <MerchantActivityLog entries={state.merchantActivity || []} />
      </details>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={onBuy}
          className="h-9 border-amber-700 bg-[#07100f] text-xs text-amber-300 hover:bg-amber-950"
        >
          <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
          Buy
        </Button>
        <Button
          variant="outline"
          onClick={onCraft}
          className="h-9 border-violet-700 bg-[#07100f] text-xs text-violet-300 hover:bg-violet-950"
        >
          <Hammer className="mr-1.5 h-3.5 w-3.5" />
          Craft
        </Button>
        <Button
          variant="outline"
          onClick={onExchange}
          className="h-9 border-cyan-700 bg-[#07100f] text-xs text-cyan-300 hover:bg-cyan-950"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Exchange
        </Button>
        <Button
          variant="outline"
          onClick={onDonate}
          className="h-9 border-amber-700 bg-[#07100f] text-xs text-amber-300 hover:bg-amber-950"
        >
          <HandCoins className="mr-1.5 h-3.5 w-3.5" />
          Donate gold
        </Button>
        <Button
          variant="outline"
          onClick={onGiveaway}
          className="h-9 border-cyan-700 bg-[#07100f] text-xs text-cyan-200 hover:bg-cyan-950 hover:text-cyan-50"
        >
          <Gift className="mr-1.5 h-3.5 w-3.5" />
          Join giveaway
        </Button>
        <SendToPartyControl state={state} onSend={onBank} />
        <Button
          variant="outline"
          aria-pressed={state.merchantForceStand === true}
          onClick={() => void onForceStand(state.merchantForceStand !== true)}
          className={
            state.merchantForceStand
              ? 'h-9 border-rose-300 bg-rose-600 text-xs font-semibold text-white hover:bg-rose-500'
              : 'h-9 border-amber-700 bg-[#07100f] text-xs text-amber-200 hover:bg-amber-950'
          }
        >
          <Store className="mr-1.5 h-3.5 w-3.5" />
          Force stand · {state.merchantForceStand ? 'On' : 'Off'}
        </Button>
        <Button
          variant="outline"
          onClick={onRoutines}
          className="h-9 border-violet-800 bg-[#07100f] text-xs text-violet-300 hover:bg-violet-950"
        >
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
          Routines
        </Button>

        <GatheringToggle mode="mining" label="Mining" icon={Pickaxe} state={state} onGather={onGather} readiness={readiness}
          on="h-9 border-emerald-300 bg-emerald-500 px-2 text-[11px] text-emerald-950 hover:bg-emerald-400"
          off="h-9 border-emerald-700 bg-[#07100f] px-2 text-[11px] text-emerald-300 hover:bg-emerald-950" />
        <GatheringToggle mode="fishing" label="Fishing" icon={Fish} state={state} onGather={onGather} readiness={readiness}
          on="h-9 border-cyan-300 bg-cyan-400 px-2 text-[11px] text-cyan-950 hover:bg-cyan-300"
          off="h-9 border-cyan-700 bg-[#07100f] px-2 text-[11px] text-cyan-300 hover:bg-cyan-950" />
        <Button
          variant="outline"
          onClick={() => void onClear()}
          className="h-9 border-rose-800 bg-[#07100f] text-xs text-rose-300 hover:bg-rose-950"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear job queue
        </Button>
        <SettingsLock><MerchantCollectionSettings toolCrafting={state.merchantAutomations} buyUpgradeBatchSize={state.buyUpgradeBatchSize} {...collectionSettings} merchantStandLocation={state.merchantStandLocation} bankSortState={state} deliveryTripsEnabled={state.merchantAutomations?.deliveries !== false} withdrawalTripsEnabled={state.merchantAutomations?.withdrawals !== false} realms={state.realmControl?.realms} realmBlacklist={state.merchantRealmBlacklist} /></SettingsLock>
      </div>
      <AddonSlot name="card-section" part="merchant" character={merchant?.name ?? ''} reports={merchant?.addonReports} />
    </section>
  );
});
// One gathering mode's switch on the merchant card: its state, a missing tool, or its readiness.
function GatheringToggle({ mode, label, icon: Icon, state, onGather, readiness, on, off }: {
  mode: 'mining' | 'fishing'; label: string; icon: typeof Pickaxe; state: PartyState;
  onGather(mode: 'mining' | 'fishing', enabled: boolean): unknown; readiness(mode: 'mining' | 'fishing'): ReactNode; on: string; off: string;
}) {
  const enabled = !!state.gatheringModes?.includes(mode);
  return (
    <Button variant="outline" aria-pressed={enabled} onClick={() => void onGather(mode, !enabled)} className={enabled ? on : off}>
      <span className="flex items-center justify-center gap-1 whitespace-nowrap">
        <Icon aria-hidden className="h-3.5 w-3.5" />
        <span>{label} · {enabled ? 'On' : 'Off'} ·</span>
        {state.gatheringNoTool?.[mode] && !enabled ? <span className="text-amber-200">No tool</span> : readiness(mode)}
      </span>
    </Button>
  );
}
