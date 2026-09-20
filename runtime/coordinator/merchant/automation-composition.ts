import { createGiveawayScheduler } from "./giveaway-scheduler.ts";
import { createImprovementScheduler } from "./improvement-scheduler.ts";
import { createMerchantHomeRecovery } from "./home-recovery.ts";
import { createAutomaticMerchantSales } from "./automatic-sales.ts";
import { createLuckScheduler } from "./luck-scheduler.ts";

type AutomationState = Parameters<typeof createGiveawayScheduler>[0] &
  Parameters<typeof createImprovementScheduler>[0] &
  Parameters<typeof createMerchantHomeRecovery>[0] &
  Parameters<typeof createAutomaticMerchantSales>[0] &
  Parameters<typeof createLuckScheduler>[0] & { nextCommandId: number };
type ScheduledJob =
  | Parameters<Parameters<typeof createGiveawayScheduler>[1]["stamp"]>[0]
  | Parameters<Parameters<typeof createImprovementScheduler>[1]["stamp"]>[0];
type LuckPorts = Parameters<typeof createLuckScheduler>[1];
interface AutomationPorts<Block> {
  now: () => number;
  stamp: <Job extends ScheduledJob>(job: Job) => Job;
  log: (message: string, level: string, details?: unknown) => void;
  persist: () => void;
  queue: (names: string[], reason: string) => void;
  publish: () => void;
  syncStand: () => boolean;
  idle: () => void;
  dispatch: () => void;
  names: () => string[];
  strong: (...args: Parameters<LuckPorts["strong"]>) => boolean;
  remaining: (...args: Parameters<LuckPorts["remaining"]>) => number;
  lead: (...args: Parameters<LuckPorts["lead"]>) => number;
  block: (name: string) => Block;
  realmLabel: (realm: string) => string;
  stop: (block: Block) => Promise<unknown>;
  later: (callback: () => Promise<unknown>, milliseconds: number) => unknown;
}

/** Automatic merchant work shares a live command sequence and the same durable dispatch pipeline. */
export function createCoordinatorMerchantAutomation<Block extends { realm?: string }>(
  state: AutomationState,
  ports: AutomationPorts<Block>,
) {
  const shared = {
    now: ports.now,
    nextCommand: () => state.nextCommandId++,
    stamp: ports.stamp,
    log: ports.log,
    persist: ports.persist,
    queue: ports.queue,
  };
  const giveaways = createGiveawayScheduler(state, shared);
  const improvements = createImprovementScheduler(state, shared);
  const home = createMerchantHomeRecovery(state, {
    ...shared,
    block: ports.block,
    realmLabel: ports.realmLabel,
    restart: (block, delay) => ports.later(() => ports.stop(block), delay),
  });
  const sales = createAutomaticMerchantSales(state, {
    ...shared,
    publish: ports.publish,
    syncStand: ports.syncStand,
    idle: ports.idle,
  });
  const luck = createLuckScheduler(state, {
    ...shared,
    names: ports.names,
    strong: ports.strong,
    remaining: ports.remaining,
    lead: ports.lead,
    dispatch: ports.dispatch,
  });
  return { giveaways, improvements, home, sales, luck };
}
