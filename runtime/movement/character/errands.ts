// The errand walk to a player (appendix A2 MER and the split of `pursueMerchantTarget`). The
// rendezvous route with its map itinerary, the doorway and transporter crossings, the direct leg,
// the failed try that climbs the errand round, and the target's status freshness (`errand-target`),
// moved from shared.js with today's order and fields, all sent as the one `errand` request. Each of
// its windows ends on its CF1 and CF14 signal. Whom the merchant meets and why stay the merchant
// jobs owner's (shared.js `rendezvous` and `waitForPlayer`, edit E08-1), which hand the walk the
// name, its bound and the target's status reader.
import { ARRIVAL_TOLERANCE, errandRound } from "../../protocol/ladder.ts";
import type { ScopeHandle } from '../../lifecycle/api.ts';
import { bareRealm, realmLabel } from '../../protocol/realm.ts';

// The movement service, the game objects and the target's status are shared.js's untyped values.
type Value = any;
interface Request { kind: string; owner: string; tier?: string }
// The game's functions and state the errand reads, on shared.js's runtime root.
interface ErrandHost {
  get_player(name: string): Value;
  can_move_to(x: number, y: number): boolean;
  smart?: { moving?: boolean; found?: boolean };
}
// What shared.js hands the errand: the command and navigation revision a walk is bound to, the merchant jobs owner's
// anniversary reservation, the realm, and the requesters' identity, sends and report waits.
export interface ErrandPorts {
  now(): number;
  character(): Value;
  G(): Value;
  movement(): Value;
  current(): boolean;
  command(): number;
  intent(): { revision: number };
  // the merchant jobs owner's hold: the merchant's anniversary work takes the merchant from any errand.
  reserved(): boolean;
  realm(): string;
  clockOffset(): number;
  request: Request;
  smartMove(destination: Value, callback?: Value, options?: Value): Promise<unknown>;
  xmove(request: Request, x: number, y: number): Promise<unknown>;
  transport(request: Request, map: string, spawn: number): Promise<unknown>;
  stop(kind: "smart" | "move", request: Request): Promise<unknown>;
  withTimeout(promise: Promise<unknown>, ms: number, label: string): Promise<unknown>;
  nextReport(): Promise<unknown>;
  // Resolves on the movement owner's next scheduler pass (owner.ts `nextPass`).
  nextPass(holder: string): Promise<void>;
  reportGap(): number;
  // Movement's run scope handle, `act`: the errand's waits hold
  // with the character and resume at release.
  scope: ScopeHandle;
}
// A map exit on the itinerary: the point to walk to on the first map and the crossing it takes.
// A transporter leg's `reach` is how far past its point the transport still goes (door-approach.ts
// `transporterApproach`).
interface Leg { map: string; x?: number; y?: number; to?: string; spawn?: number; transporterPoint?: number[] | null; reach?: number }

export function installErrands(host: ErrandHost, ports: ErrandPorts) {
  const character = () => ports.character();
  const errandRequest = ports.request;

  // The first leg toward another map: a breadth-first map itinerary, then the exit on the current
  // map that starts it. A transporter's exit is the approach movement picks beside it.
  function travelLeg(destination: { map: string }): Leg {
    const G = ports.G();
    if (!G || !G.maps) return { map: destination.map };
    const queue: { map: string; first: Leg | null }[] = [{ map: character().map, first: null }], seen: Record<string, boolean> = {};
    seen[character().map] = true;
    for (let index = 0; index < queue.length; index++) {
      const entry = queue[index], map = G.maps[entry.map];
      if (!map) continue;
      const exits = (map.doors || []).filter(function (door: Value[]) { return door[8] !== "complicated"; })
        .map(function (door: Value[]) { return { map: door[4], spawn: door[5] || 0, point: map.spawns && map.spawns[door[6]] || [door[0], door[1]], transporter: false }; });
      const transporter = (map.npcs || []).find(function (npc: Value) { return npc.id === "transporter"; });
      if (transporter) {
        const places = G.npcs && G.npcs.transporter && G.npcs.transporter.places || {};
        Object.keys(places).forEach(function (name) { exits.push({ map: name, spawn: places[name], point: transporter.position, transporter: true }); });
      }
      for (let i = 0; i < exits.length; i++) {
        const exit = exits[i], next = G.maps[exit.map], spawn = next && next.spawns && next.spawns[exit.spawn];
        if (!spawn || seen[exit.map] || next.instance || next.event) continue;
        seen[exit.map] = true;
        const approach = !entry.first && exit.transporter ? ports.movement().transporterApproach(exit.map, exit.spawn) : null;
        if (!entry.first && exit.transporter && !approach) continue;
        const first: Leg = entry.first || { map: entry.map, x: approach ? approach.x : exit.point[0], y: approach ? approach.y : exit.point[1], to: exit.map, spawn: exit.spawn,
          transporterPoint: exit.transporter ? exit.point : null, reach: approach ? approach.reach : undefined };
        if (exit.map === destination.map) return first;
        queue.push({ map: exit.map, first: first });
      }
    }
    return { map: destination.map };
  }

  // Walks to `name` until it stands within 180 and returns its entity. The walk is bound to the
  // command and navigation revision it started under and to `timeout`; `readStatus` reads the
  // target's last report when it may be out of sight. Each window ends on its own signal
  //: the target's status is read on each of the merchant's own
  // reports, and only `timeout` bounds that read; a smart route plans within the planner's own budget (`movementPlanningMs`); a try
  // that ends without arriving, by the planner's error or the executor's walking stall, climbs
  // the errand round; a route is planned again when its try ends or the target leaves it; and a
  // doorway crossing ends on the game's answer and the map change, bound by `timeout`.
  async function meet(name: string, timeout: number, readStatus?: () => Promise<Value>): Promise<Value> {
    const deadline = ports.now() + timeout, owner = ports.command(), revision = ports.intent().revision;
    let route: Leg | null = null, routePending = false, routeTargetMap: string | null = null, status: Value = null, moving = false;
    let recoveries = 0, phase = "waiting-for-target", routeError: string | null = null;
    // `failed` is the reason the live try ended without arriving. `climbed` holds the next legs to
    // a smart route after a climb, until that route's try ends. `direct` names the live direct leg.
    let failed: string | null = null, climbed = false, direct: object | null = null;
    let statusDue = !!readStatus, active = true;
    const awaitReport = () => { void ports.nextReport().then(function () { statusDue = !!readStatus; if (active) awaitReport(); }); };
    if (readStatus) awaitReport();
    function current() { return ports.current() && owner === ports.command() && revision === ports.intent().revision; }
    // A newer command ends the meet with I7's `interrupted` code (items/rules.ts), which the
    // merchant's visit and the coordinator's completion read.
    const interrupted = () => Object.assign(new Error("interrupted"), { code: "interrupted", reason: "interrupted" });
    function reason(error: Value) { return String(error && (error.reason || error.message) || error); }
    // A failed try climbs the movement owner's ladder: the route again,
    // the other route, then the next report and the round again. Only the pursuit's own bound
    // (`timeout`) ends it. `recoveries` counts the climbs for the error details.
    const climbOwner = "errand:meet:" + name, pass = () => ports.nextPass(climbOwner), ladder = ports.movement().climb(climbOwner, errandRound(name), "Meeting " + name);
    let ladderOptions = {};
    function here() { return { map: character().map, in: character().in, x: character().x, y: character().y }; }
    try {
      while (ports.now() < deadline) {
        if (!current()) throw interrupted();
        if (ports.reserved()) throw Object.assign(new Error("merchant_anniversary_reserved"), { code: "merchant_anniversary_reserved" });
        if (character().rip) throw new Error("Merchant died during rendezvous with " + name);
        if (readStatus && statusDue) {
          statusDue = false;
          status = await ports.withTimeout(readStatus(), Math.max(1, deadline - ports.now()), "Merchant target status");
          if (!current()) throw interrupted();
        }
        const fresh = status && ports.movement().fresh(status.seenAt, ports.now() + ports.clockOffset(), 'errand-target');
        if (fresh && status.server && bareRealm(status.server) !== bareRealm(ports.realm()))
          throw new Error("merchant job failed: wrong realm (target was on " + realmLabel(status.server) + ")");
        let player = host.get_player(name);
        if (fresh && player && (status.map !== (player.map || character().map) ||
            status.in != null && player.in != null && status.in !== player.in)) player = null;
        const visible = player && player.visible !== false && !player.rip && (!player.map || player.map === character().map) &&
          (player.in == null || character().in == null || player.in === character().in);
        const distance = visible ? Math.hypot(player.x - character().x, player.y - character().y) : Infinity;
        if (distance <= 180) { ports.movement().endClimb(climbOwner); return player; }
        const destination = visible ? { map: character().map, x: player.x, y: player.y } : fresh && !status.rip ? status : null;
        // Path calculation is the planner's work within its own budget, so a searching route is
        // never restarted here.
        const searching = routePending && !!host.smart && !!host.smart.moving && !host.smart.found;
        if (searching) phase = "pathfinding";
        if (failed) {
          ladder.result({ arrived: false, at: here() });
          routeError = failed; failed = null; route = null; direct = null;
          await ports.stop("smart", errandRequest); if (!current()) throw interrupted();
          await ports.stop("move", errandRequest); if (!current()) throw interrupted();
          recoveries++; routePending = false; moving = false;
          let attempt = ladder.next(here(), {});
          if (attempt.rung === "wait") {
            phase = "waiting-for-report";
            await Promise.race([ports.nextReport(), ports.scope.sleep(2 * ports.reportGap())]);
            if (!current()) throw interrupted();
            ladder.waited(); attempt = ladder.next(here(), {});
          }
          ladderOptions = attempt.options || {}; climbed = true;
        }
        if (!climbed && visible && distance <= 600 && host.can_move_to(player.x, player.y)) {
          if (route) { route = null; routePending = false; await ports.stop("smart", errandRequest); if (!current()) throw interrupted(); }
          phase = "direct"; const leg = direct = {};
          Promise.resolve(ports.xmove(errandRequest, Number(player.x), Number(player.y))).catch(function (error: Value) { if (direct === leg) failed = reason(error); });
          moving = true;
        } else if (destination) {
          // A local leg may use a transporter shortcut through another map.
          // Let that owned route return to its endpoint instead of replacing it
          // with a new itinerary from the intermediate map on every heartbeat.
          if (routePending && route && character().map !== route.map && destination.map === routeTargetMap) {
            await pass();
            continue;
          }
          // Solve map transitions separately from the moving recipient's exact
          // position, as gathering travel does. Do not replan a running
          // cross-map leg because the recipient moved within that map.
          const crossMap = destination.map !== character().map;
          const nextRoute: Leg = crossMap ? travelLeg(destination) : { map: destination.map, x: destination.x, y: destination.y };
          // A transporter crossing goes once movement's transport check passes where the merchant
          // stands (1.5 row 22); a doorway once the walk arrived at the door's spawn.
          if (nextRoute.to && (nextRoute.transporterPoint ? ports.movement().transportAllowed(nextRoute.to, nextRoute.spawn!) :
              Math.hypot(character().x - nextRoute.x!, character().y - nextRoute.y!) <= ARRIVAL_TOLERANCE)) {
            route = null; routePending = false; direct = null;
            await ports.stop("smart", errandRequest); if (!current()) throw interrupted();
            await ports.stop("move", errandRequest); if (!current()) throw interrupted();
            phase = "transport"; moving = true;
            await ports.withTimeout(ports.transport(errandRequest, nextRoute.to, nextRoute.spawn!), Math.max(1, deadline - ports.now()), "Merchant doorway transport");
            if (!current()) throw interrupted();
            while (character().map === nextRoute.map && ports.now() < deadline) {
              await pass();
              if (!current()) throw interrupted();
            }
            if (character().map === nextRoute.map) throw new Error("Merchant doorway transport did not reach " + nextRoute.to);
            continue;
          }
          if (!route || !routePending || route.map !== nextRoute.map || route.to !== nextRoute.to || !crossMap && !searching &&
              (route.x == null || Math.hypot(route.x - nextRoute.x!, route.y! - nextRoute.y!) > 160)) {
            direct = null;
            if (route || moving) { await ports.stop("smart", errandRequest); if (!current()) throw interrupted(); await ports.stop("move", errandRequest); if (!current()) throw interrupted(); }
            phase = "smart"; route = nextRoute; routeTargetMap = destination.map; routePending = true;
            const started = route;
            // A transporter leg's walk ends inside the transport's reach of its point.
            const reach = route.reach !== undefined ? { arrivalTolerance: route.reach } : {};
            Promise.resolve(ports.smartMove(route, undefined, Object.assign({}, ladderOptions, reach, { request: errandRequest }))).catch(function (error: Value) {
              if (route === started) failed = routeError = reason(error);
            }).finally(function () { if (route === started) { routePending = false; climbed = false; } });
            moving = true;
          }
        }
        await pass();
      }
      throw new Error(name + " rendezvous timed out");
    } catch (error: Value) {
      error.details = { target: name, merchant: { map: character().map, x: character().x, y: character().y }, destination: status ? { map: status.map, x: status.x, y: status.y } : route,
        phase: phase, recoveries: recoveries, routeError: routeError, pauseReason: String(error.message || error) };
      throw error;
    } finally {
      active = false;
      ports.movement().endClimb(climbOwner);
      if (current() && moving) { try { await ports.stop("smart", errandRequest); } catch (_) {} if (current()) { try { await ports.stop("move", errandRequest); } catch (_) {} } }
      if (!current()) throw interrupted();
    }
  }

  return { meet };
}

