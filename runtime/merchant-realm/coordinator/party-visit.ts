// The party visit's realm half: one
// realm transition per visit to a member on another realm, and the realm errors the merchant's reply
// carries. The move itself is the realm owner's `job:<id>` want (owner.ts `visit`).
import { fresh } from '../../protocol/reports.ts';
import { partyHooks } from '../../hooks/index.ts';
import { realmRetry, type MerchantWork, type ServiceStatus } from '../../merchant-jobs/api.ts';
import { ARRIVAL_WINDOW_MS } from '../rules.ts';
import { bareRealm, normalizedRealm, realmLabel } from '../../protocol/realm.ts';
import { boundFired } from '../../status/coordinator/api.ts';

// The merchant's reply carries each queued party visit's realm error, which the character
// shows on its line.
export function merchantRealmErrors(state: { merchantCharacter?: string | null; merchantQueue?: { id: string; realmError?: string }[] },
  name: string): Record<string, unknown> {
  if (name !== state.merchantCharacter || !state.merchantQueue?.some(job => job.realmError)) return {};
  return { merchantRealmErrors: state.merchantQueue.filter(job => job.realmError).map(job => ({ id: job.id, message: job.realmError })) };
}

// From runtime/coordinator/merchant/party-realm.ts.
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
  // The realm owner refuses an automatic want for the member's realm.
  realmRefuses?(realm: string): boolean;
  persist(): void;
  log(message: string, level: "info" | "error", details?: unknown): void;
}

/** A party visit owns one bounded realm transition, independently of home-return routing. */
export function createPartyRealmCheck(state: State, ports: Ports) {
  function freshStatus(name: string | null) {
    const status = ports.status(name);
    return status && fresh(status.seenAt, ports.now(), 'presence') && status.server ? status : null;
  }
  function blockedReason(job: MerchantWork): string | undefined {
    const target = freshStatus(job.target),
      merchant = freshStatus(ports.merchant());
    if (!target || !merchant) return "Waiting for fresh realm observations";
    const realm = normalizedRealm(target.server);
    if (realm && realm !== normalizedRealm(merchant.server) && ports.realmRefuses?.(realm))
      return "Waiting for " + job.target + " to leave " + bareRealm(realm) + ", which is on your realm blacklist";
    if (normalizedRealm(target.server) !== normalizedRealm(merchant.server) && !ports.headless?.())
      return (
        "merchant job failed: wrong realm (target was on " +
        realmLabel(target.server) +
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
  // A missed visit switch requeues the job with the row's retry
  // (`realmRetry`).
  function fail(job: MerchantWork, message: string): void {
    if (state.current !== job) return;
    state.current = null;
    const now = ports.now(), retry = realmRetry(job.realmAttempts, now), wait = retry.retryAt - now;
    // An add-on may wait longer before the realm retry or give the job up.
    const asked = partyHooks().retry.policy({ owner: 'merchant-realm', subject: job.reason, failure: 'realm-switch', attempt: retry.realmAttempts - 1 },
      { wait, giveUp: false, counts: false });
    delete job.phase;
    ports.log(message, "error", { jobId: job.id });
    if (asked.giveUp) { ports.persist(); return; }
    Object.assign(job, retry, { retryAt: now + asked.wait });
    state.queue.push(job);
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
    ports.log("Switching merchant to " + bareRealm(realm) + " for " + job.target, "info");
    void ports
      .travel(realm)
      .catch((error) => fail(job, "Merchant realm switch failed: " + String(error)));
    return true;
  }
  function advance(): boolean {
    const job = state.current;
    if (job?.phase !== "switching party realm") return false;
    const merchant = freshStatus(ports.merchant()),
      target = freshStatus(job.target);
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
    if (ports.now() - Number(job.realmStartedAt) >= ARRIVAL_WINDOW_MS) {
      boundFired({ bound: 'realmArrivalWindow', owner: '09', subject: job.id, state: { realm: job.destinationRealm, ms: ARRIVAL_WINDOW_MS } });
      fail(job, "Merchant realm switch timed out");
      return false;
    }
    return true;
  }
  return { eligibility, begin, advance };
}
