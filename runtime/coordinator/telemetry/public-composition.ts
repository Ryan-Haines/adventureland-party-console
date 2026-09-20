import { createPublicStateRoute } from "./public-state.ts";
import { projectEventSchedules } from "../events/schedule-reports.ts";
import { projectBankbois, projectMerchantJob } from "./merchant-projection.ts";
import type { PublicState, PublicStatePorts } from "./public-state-types.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { plannedOperationStage } from '../merchant/activity.ts';
import { requestObject } from '../http/contracts.ts';

type OverviewState<Handoff> = PublicState & {
  leader: string | null;
  steamSwitch: Handoff;
  itemCollectionThreshold: number;
  statuses: Parameters<typeof projectEventSchedules>[0];
  bankbois: Parameters<typeof projectBankbois>[0];
  bankboiTransaction: Parameters<typeof projectBankbois>[1];
};
type OverviewPorts<Handoff> = Omit<
  PublicStatePorts,
  "handoff" | "eventSchedules" | "bankbois" | "job"
> & {
  accountCharacter?: Parameters<typeof projectBankbois>[2];
  handoff: (value: Handoff) => unknown;
  stamp: (job: MerchantWork) => MerchantWork;
  collectionSlots: (name: string | null | undefined) => number;
  collectionNearby: (name: string | null | undefined) => boolean;
};

/** Present current event feeds, storage workers and queue metadata through one overview boundary. */
export function createCoordinatorPublicOverview<Handoff>(
  state: OverviewState<Handoff>,
  ports: OverviewPorts<Handoff>,
) {
  const job = (value: MerchantWork | null | undefined) =>
    projectMerchantJob(value && value.target === state.merchantCharacter ? {...value, operationStage: value.operationStage || plannedOperationStage(value.reason,
      state.statuses[String(value.target)]?.items || [], requestObject(state.autoCompounds)[String(value.target)], requestObject(state.upgrades)[String(value.target)])} : value, {
      stamp: ports.stamp,
      slots: ports.collectionSlots,
      threshold: () => state.itemCollectionThreshold,
      nearby: ports.collectionNearby,
    });
  const route = createPublicStateRoute(state, {
    ...ports,
    job,
    handoff: () => ports.handoff(state.steamSwitch),
    eventSchedules: () => projectEventSchedules(state.statuses, state.leader, () => ports.now()),
    bankbois: () => projectBankbois(state.bankbois, state.bankboiTransaction, ports.accountCharacter),
  });
  return { route, job };
}
