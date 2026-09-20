import { routineEnabled } from '../merchant/routines.ts';
import {
  isRequestObject,
  requestObject,
  type HttpRequest,
  type HttpResponse,
} from "./contracts.ts";
import type { MerchantJob } from "../merchant/queue.ts";

interface RoutineState {
  priorities: Record<string, number>;
  automations: Record<string, boolean>;
  queue: MerchantJob[];
}
interface RoutinePorts {
  gathering?(values: Record<string, unknown>): void;
  priorities: Readonly<Record<string, number>>;
  automations: Readonly<Record<string, boolean>>;
  bidPurchaseReasons: ReadonlySet<string>;
  stamp(job: MerchantJob): MerchantJob;
  persist(): void;
  dispatch(): void;
}

/** Keeps the existing partial-update ordering and automatic-job cancellation rules. */
export function createRoutinePriorityRoute(state: RoutineState, ports: RoutinePorts) {
  function setPriorities(values: Record<string, unknown>): boolean {
    for (const [reason, raw] of Object.entries(values)) {
      if (!(reason in ports.priorities)) continue;
      const priority = Number(raw);
      if (!Number.isInteger(priority) || priority < 0 || priority > 100) return false;
      state.priorities[reason] = priority;
    }
    return true;
  }

  function updateAutomations(values: Record<string, unknown>): void {
    for (const reason of Object.keys(ports.automations)) {
      const enabled = values[reason];
      if (typeof enabled === "boolean") state.automations[reason] = enabled;
    }
    state.queue = state.queue.filter(job => routineEnabled(job, state.automations));
  }

  return function routinePriorities(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!isRequestObject(body.priorities))
      return response.status(400).json({ error: "provide routine priorities" });
    if (!setPriorities(body.priorities))
      return response.status(400).json({ error: "priorities must be whole numbers from 0 to 100" });
    if (isRequestObject(body.enabled)) {
      updateAutomations(body.enabled);
      ports.gathering?.(body.enabled);
    }
    state.queue = state.queue.map((job) => ports.stamp(job));
    ports.persist();
    ports.dispatch();
    return response.json({ ok: true, priorities: state.priorities, enabled: state.automations });
  };
}
