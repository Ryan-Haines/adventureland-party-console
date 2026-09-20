type Values = Record<string, unknown>;
export interface DashboardSample {
  vitals: Values;
  items: Values;
  slots: Values;
}
interface Lease {
  epoch: string;
  generation: string;
  duration: number;
}
interface Ports {
  now(): number;
  current(): boolean;
  name(): string;
  runtime(): string;
  sample(): DashboardSample;
  entry(value: unknown, slot: string, equipment: boolean): unknown;
  send(body: Values): Promise<unknown>;
}
function changes(before: Values, after: Values, entry?: (value: unknown, slot: string) => unknown) {
  const result: Values = {};
  for (const slot of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[slot]) !== JSON.stringify(after[slot]))
      result[slot] = after[slot] == null ? null : entry ? entry(after[slot], slot) : after[slot];
  }
  return result;
}
/** One in-flight request, one newest pending sample, and no sampling outside the viewer lease. */
export function createDashboardSampler(ports: Ports) {
  let lease: Lease | undefined,
    expires = 0,
    sequence = 0,
    busy = false;
  let confirmed: DashboardSample = { vitals: {}, items: {}, slots: {} };
  let pending: { data: DashboardSample; at: number } | undefined;
  function renew(value?: Lease) {
    if (!value?.generation || !value.duration) {
      expires = 0;
      pending = undefined;
      return;
    }
    if (lease?.generation !== value.generation || lease?.epoch !== value.epoch) {
      confirmed = { vitals: {}, items: {}, slots: {} };
      sequence = 0;
    }
    lease = value;
    expires = ports.now() + Math.min(3000, value.duration);
  }
  async function flush() {
    if (busy || !pending || !lease || !ports.current() || ports.now() >= expires) return;
    const next = pending;
    pending = undefined;
    const sentLease = lease;
    const data = {
      vitals: changes(confirmed.vitals, next.data.vitals),
      items: changes(confirmed.items, next.data.items, (value, slot) =>
        ports.entry(value, slot, false),
      ),
      slots: changes(confirmed.slots, next.data.slots, (value, slot) =>
        ports.entry(value, slot, true),
      ),
    };
    if (!Object.values(data).some((value) => Object.keys(value).length)) return;
    busy = true;
    try {
      await ports.send({
        name: ports.name(),
        runtime: ports.runtime(),
        epoch: sentLease.epoch,
        generation: sentLease.generation,
        sample: ++sequence,
        sampledAt: next.at,
        data,
      });
      if (sameLease(sentLease)) confirmed = next.data;
    } catch {
      /* The next sample retries the latest state, never an action. */
    } finally {
      busy = false;
    }
    if (pending) void flush();
  }
  function sameLease(sent: Lease) {
    return lease?.generation === sent.generation && lease?.epoch === sent.epoch;
  }
  function pulse() {
    if (!ports.current() || ports.now() >= expires) {
      pending = undefined;
      return;
    }
    // Detach mutable game objects before retaining an in-flight or pending observation.
    pending = {
      data: JSON.parse(JSON.stringify(ports.sample())) as DashboardSample,
      at: ports.now(),
    };
    void flush();
  }
  return { renew, pulse };
}
