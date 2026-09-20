import type { MerchantWork, ServiceStatus } from "./work.ts";

export function normalizedRealm(server: string | undefined): string | null {
  return server ? "SR_" + server.replace(/^SR_/, "") : null;
}
interface State {
  queue: MerchantWork[];
  current: MerchantWork | null;
}
interface Ports {
  now(): number;
  merchant(): string | null;
  status(name: string | null): ServiceStatus | undefined;
  travel?(realm: string): Promise<unknown>;
  headless?(): boolean;
  persist(): void;
  log(message: string, level: "info" | "error", details?: unknown): void;
}

/** A party visit owns one bounded realm transition, independently of home-return routing. */
export function createPartyRealmCheck(state: State, ports: Ports) {
  function fresh(name: string | null) {
    const status = ports.status(name);
    return status && status.seenAt >= ports.now() - 10_000 && status.server ? status : null;
  }
  function blockedReason(job: MerchantWork): string | undefined {
    if (job.realmRetryExhausted) return "Merchant realm switch failed; manual retry required";
    const target = fresh(job.target),
      merchant = fresh(ports.merchant());
    if (!target || !merchant) return "Waiting for fresh realm observations";
    if (normalizedRealm(target.server) !== normalizedRealm(merchant.server) && !ports.headless?.())
      return (
        "merchant job failed: wrong realm (target was on " +
        target.server!.replace(/^SR_/, "").replace(/^(US|EU|ASIA)/, "$1 ") +
        ")"
      );
    return undefined;
  }
  function eligibility(job: MerchantWork): void {
    if (job.target === ports.merchant()) return;
    const reason = blockedReason(job);
    if (job.realmBlockedReason === reason) return;
    job.realmBlockedReason = reason;
    if (reason?.startsWith("merchant job failed")) {
      job.realmError = reason;
      ports.log(reason, "error", { jobId: job.id });
    } else delete job.realmError;
    ports.persist();
  }
  function fail(job: MerchantWork, message: string): void {
    if (state.current !== job) return;
    state.current = null;
    job.realmAttempts = Number(job.realmAttempts || 0) + 1;
    job.realmRetryExhausted = job.realmAttempts >= 3;
    job.retryAt = ports.now() + 10_000;
    delete job.phase;
    state.queue.push(job);
    ports.log(message, "error", { jobId: job.id });
    eligibility(job);
    ports.persist();
  }
  function begin(job: MerchantWork, target: ServiceStatus): boolean {
    const realm = normalizedRealm(target.server);
    if (realm === normalizedRealm(ports.status(ports.merchant())?.server)) return false;
    if (!realm || !ports.travel || !ports.headless?.()) return false;
    job.phase = "switching party realm";
    job.destinationRealm = realm;
    job.realmStartedAt = ports.now();
    state.current = job;
    ports.persist();
    ports.log("Switching merchant to " + realm.replace(/^SR_/, "") + " for " + job.target, "info");
    void ports
      .travel(realm)
      .catch((error) => fail(job, "Merchant realm switch failed: " + String(error)));
    return true;
  }
  function advance(): boolean {
    const job = state.current;
    if (job?.phase !== "switching party realm") return false;
    const merchant = fresh(ports.merchant()),
      target = fresh(job.target);
    if (
      merchant &&
      merchant.seenAt > Number(job.realmStartedAt) &&
      normalizedRealm(merchant.server) === job.destinationRealm &&
      target
    ) {
      if (normalizedRealm(target.server) !== job.destinationRealm) {
        fail(job, "Merchant target changed realm during reconnect");
        return false;
      }
      state.current = null;
      delete job.phase;
      state.queue.unshift(job);
      ports.persist();
      return false;
    }
    if (ports.now() - Number(job.realmStartedAt) >= 60_000) {
      fail(job, "Merchant realm switch timed out");
      return false;
    }
    return true;
  }
  return { eligibility, begin, advance };
}
