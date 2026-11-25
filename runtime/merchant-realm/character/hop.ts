// The realm owner's character half: the one hop executor every merchant executor
// asks, the client's page change for a Steam move, and the set-home command. A move goes through
// the coordinator's realm owner first; the route's `alreadyThere` is the one fact that says no
// restart is coming, so the hop continues on it and otherwise ends the job's code at the hop:
// the runner holds `realm` until the restart replaces this runtime, and the job resumes
// from its saved state.
import { partyHooks } from '../../hooks/index.ts';
import { bareRealm, gameRealm } from '../../protocol/realm.ts';

// What the hop reads and calls on the character: shared.js builds it at load (hopPorts()).
interface HopPorts {
  // The game window; caracAL's carries `caracAL`, which marks a headless worker.
  parent(): { server_region?: unknown; server_identifier?: unknown; caracAL?: unknown; window: { location: { search?: string; href: string } } };
  character(): { name: string; rip?: unknown };
  // The coordinator's HTTP door.
  request(route: string, options: { method: 'POST'; body: Record<string, unknown> }): Promise<{ alreadyThere?: boolean } | null | undefined>;
  // The job runner holds `realm` until the restart replaces this runtime.
  holdRealm(realm: string): void;
  sleep(ms: number): Promise<void>;
  log(text: string, color: string): void;
  // survival's combat end and respawn, and the game's set_home.
  afterCombat(work: () => Promise<void>, label: string): Promise<void>;
  respawn(reason: string): Promise<unknown>;
  setHome(): Promise<{ failed?: unknown; success?: unknown; reason?: string; message?: string } | null | undefined>;
}
// The realm commands the coordinator writes into the slot: `native-realm-switch` and `realm-set-home`.
interface RealmCommand { realm: string; operationId?: string }
interface JobCommand { jobId: unknown }
type HopAnswer = 'here' | 'yielded';

// The realm name a client region and server name make. The game client always reports both once
// connected; the US and II fallback is v1.5.0's for a missing field (shared.js:8709,
// 8825, 8969).
export function realmOf(region: unknown, identifier: unknown): string {
  return gameRealm(region || 'US', identifier || 'II');
}

export function createMerchantHop(p: HopPorts) {
  function liveRealm(): string { return realmOf(p.parent().server_region, p.parent().server_identifier); }
  const headless = (): boolean => !!p.parent().caracAL;

  function pagePath(realm: string): string | null {
    const match = String(realm || '').match(/^SR_(US|EU|ASIA)([IVX]+|PVP)$/);
    if (!match) return null;
    // Native companions need their bot flags and managed CODE slot after navigation; a bare
    // character URL changes the window's startup behaviour.
    const launch = String(p.parent().window.location.search || '').replace(/^\?/, '').split('&')
      .filter((entry: string) => /^(no_html|is_bot|code)=/.test(entry)).join('&');
    return '/character/' + encodeURIComponent(p.character().name) + '/in/' + match[1] + '/' + match[2] + '/' + (launch ? '?' + launch : '');
  }

  // The Steam client changes realm by its own page change, a new login (`change_server`), so it asks
  // the call budget's job band first. A `not-now` asks again once
  // the game's call window has passed, when every charge counted against the band has left it.
  async function changePage(realm: string): Promise<void> {
    const path = pagePath(realm);
    if (!path) throw new Error('Invalid realm switch destination');
    const hooks = partyHooks();
    while (hooks.calls.band({ band: 'job', method: 'change_server' }) !== 'send') await p.sleep(hooks.calls.window());
    p.parent().window.location.href = path;
  }

  // One hop for every executor: the job's realm route (`/merchant/realm-switch`) or the stand
  // return's home route (`/merchant/ensure-home-realm`). A headless worker is restarted on the
  // destination by the coordinator; a Steam page changes here.
  async function hop(route: string, body: Record<string, unknown>, realm: string): Promise<HopAnswer> {
    const answer = await p.request(route, { method: 'POST', body });
    if (answer && answer.alreadyThere) return 'here';
    p.holdRealm(realm);
    if (!headless()) await changePage(realm);
    return 'yielded';
  }

  // A job's hop: its realm route names the job, so the realm owner weighs it as the job's want.
  function jobHop(command: JobCommand, realm: string): Promise<HopAnswer> {
    return hop('/merchant/realm-switch', { jobId: command.jobId, character: p.character().name, realm }, realm);
  }

  // `native-realm-switch`: the realm owner's Steam move and `realm.reconnect`.
  async function nativeSwitch(command: RealmCommand): Promise<void> {
    if (headless()) throw new Error('Native realm switching requires the Steam game client');
    if (!pagePath(command.realm)) throw new Error('Invalid realm switch destination');
    p.log('Switching realm to ' + bareRealm(command.realm), '#51D2E1');
    await changePage(command.realm);
  }

  // `realm-set-home`: the game's `set_home` from where the character stands, after combat and after
  // a respawn the survival owner allows. The answer goes to the coordinator as soon as the game
  // gives it: its confirmHome reads the new home from the next fresh report or the account refresh.
  async function setHome(command: RealmCommand): Promise<void> {
    try {
      await p.afterCombat(async () => {
        if (p.character().rip) await p.respawn('realm-set-home');
        // The game's set_home is a socket send ('set_home', runner_functions.js:1922), so it asks the
        // job band first, as changePage does for change_server.
        const hooks = partyHooks();
        while (hooks.calls.band({ band: 'job', method: 'set_home' }) !== 'send') await p.sleep(hooks.calls.window());
        const result = await p.setHome();
        if (result && (result.failed || result.success === false))
          throw new Error(result.reason || result.message || 'Adventure Land rejected the home realm change');
      }, 'setting home realm');
      await p.request('/realm/home-complete', { method: 'POST', body: { operationId: command.operationId, character: p.character().name, success: true } });
    } catch (setHomeError) {
      try { await p.request('/realm/home-complete', { method: 'POST', body: { operationId: command.operationId, character: p.character().name, success: false,
        error: errorText(setHomeError) } }); } catch (_homeCompleteError) { /* The operation's window ends it. */ }
      throw setHomeError;
    }
  }

  return { liveRealm, pagePath, hop, jobHop, nativeSwitch, setHome };
}

// The text of a thrown game answer or error: its reason, its message, or itself.
function errorText(error: unknown): string {
  const answer = error as { reason?: unknown; message?: unknown } | null;
  return String(answer?.reason || answer?.message || error);
}

// The realm owner's job errors (coordinator/owner.ts `merchantRealmErrors`) arrive with each reply,
// and the character logs each error's text once, in red, as v1.5.0 did. The status
// owner's apply table calls it after the status apply.
const loggedRealmErrors = new Map<string, string>();
export function logRealmErrors(errors: readonly { id: string; message: string }[] | null | undefined, log: (text: string, color: string) => void): void {
  for (const error of errors ?? []) {
    if (loggedRealmErrors.get(error.id) === error.message) continue;
    loggedRealmErrors.set(error.id, error.message);
    log(error.message, 'red');
  }
}

const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.realm = Object.assign(merchant.realm || {}, { hop: createMerchantHop, realmOf, logRealmErrors });
