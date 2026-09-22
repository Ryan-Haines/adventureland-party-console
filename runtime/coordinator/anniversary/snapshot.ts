import {
  anniversaryLabels,
  anniversarySlices,
  type AnniversarySchedule,
  type AnniversarySnapshotPorts,
  type AnniversaryState,
} from "./contracts.ts";
import { createAnniversaryLive } from "./live.ts";
import { anniversaryHandoffs } from "./handoffs.ts";
import { sliceBalances, tradeAdvertisement } from "./slices.ts";

export function createAnniversarySnapshot(
  state: AnniversaryState,
  ports: AnniversarySnapshotPorts,
) {
  const event = createAnniversaryLive(state, ports);
  function roundState(live: AnniversarySchedule | null) {
    const current = live && String(live.round || live.next || live.target || "unknown");
    return {
      round: (current && state.rounds[current]) || null,
      advertised: !!(current && state.advertisedRounds[current]),
    };
  }

  function returnState() {
    return {
      returnDestination: state.returnDestination || null,
      eventCycle: state.eventCycle || null,
      chatAdvertisement: state.chatAdvertisement || null,
      pendingReturns: Object.values(state.pendingReturns || {}),
    };
  }
  function snapshot() {
    const balance = sliceBalances(ports.counts(), state.nativeSlice);
    const { live, schedule } = event.observe();
    const merchant = ports.merchant();
    const server = ports.statuses()[String(merchant)]?.server || ports.realm(String(merchant)) || "SR_USII";
    const advertisement = tradeAdvertisement(balance, state.nativeSlice, merchant, server);
    return {
      ...balance,
      ...advertisement,
      slices: anniversarySlices,
      labels: anniversaryLabels,
      attempts: state.attempts,
      nativeSlice: state.nativeSlice,
      live,
      schedule,
      ...roundState(live),
      partyFeatured: !!state.partyHold,
      ...returnState(),
      abortedRounds: state.abortedRounds,
      activity: state.activity.slice(-100),
      crafted: state.crafted,
      // Older character runtimes must also leave cake crafting to the exchange menu.
      craftReady: false,
      handoffTargets: anniversaryHandoffs(state, ports),
      merchant: ports.merchant(),
    };
  }
  return { snapshot };
}
