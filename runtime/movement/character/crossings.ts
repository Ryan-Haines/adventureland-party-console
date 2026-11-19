// The farm reunion's crossings (appendix A2 REU and the REUW split of `farmReunionTick`). The
// reunion's walk to the farm with its Blink and Magiport crossings, the Magiport handshake over
// `on_cm` and the `on_magiport` answer, moved from shared.js with today's order and fields. Each
// window ends on its CF1 and CF14 signal: a failed try climbs the reunion's task round, the Blink
// and the Magiport end on the game's answer, and the handshake waits for the other side's next
// report. Whether a reunion runs, for whom and when it ends stay the tasks owner's (shared.js
// `beginFarmReunion`, `farmReunionTick`, edit E01-3), which hand the walk its token and its target.
import { RENDEZVOUS_RANGE, taskRound } from "../../protocol/ladder.ts";
import { partyHooks } from "../../hooks/index.ts";
import { sendBand, type Requester } from "../rules.ts";
import { boundFired } from "../../status/api.ts";

// The movement service, the game objects and the reunion token are shared.js's untyped values.
type Value = any;
interface Request { kind: string; owner: string; tier?: string }
// The game's functions the crossings call, on shared.js's runtime root.
interface CrossingsHost {
  parent: { server_region?: string; server_identifier?: string; socket?: unknown };
  can_move(query: Value): boolean;
  can_move_to(x: number, y: number): boolean;
  is_on_cooldown(skill: string): boolean;
  can_use(skill: string): boolean;
  is_transporting(entity: Value): boolean;
  game_log(message: string, color: string): void;
  send_cm(name: string, data: Value): Promise<unknown>;
}
// What shared.js hands the crossings: the tasks owner's reunion (its token and its three reads), the escape's
// Magiport accept, the requesters' identities and casts, and one read each of its other
// state until that state moves.
export interface CrossingsPorts {
  now(): number;
  character(): Value;
  G(): Value;
  movement(): Value;
  // Where the game reads the two handlers.
  root(): Value;
  reunion(): Value;
  reunionBlocked(): boolean;
  reunionMembers(): Value[];
  reunionCurrent(token: Value): boolean;
  // The escape's own accept of a Magiport offer (survival/escape.ts `acceptPort`): true while an
  // escape owns the character, so the reunion never takes an escape's offer.
  acceptEscapePort(name: string): boolean;
  partyLocation(): Value;
  partyPositions(): Value[];
  desiredPartyMembers(): string[];
  leader(): string | null;
  scatter(): boolean;
  clockOffset(): number;
  intent(): { revision: number; cancelled?: boolean };
  engagedMonster(): Value;
  entryPoint(location: Value): Value;
  sharedPartyWalk(destination: Value, activity: string, tier: string, command: Value, current: () => boolean): Promise<unknown>;
  smartMove(destination: Value, callback?: Value, options?: Value): Promise<unknown>;
  stop(request: Request): Promise<unknown>;
  sleep(ms: number): Promise<unknown>;
  // The next report, or the report-freshness bound of silence (owner.ts `reportOrSilence`).
  reportOrSilence(holder: string): Promise<boolean>;
  // Resolves on the movement owner's next scheduler pass (owner.ts `nextPass`).
  nextPass(holder: string): Promise<void>;
  timed(request: Request): Value;
  blinkAs(request: Request, x: number, y: number): Promise<unknown>;
  reunionRequest(token: Value): Request;
}
// The member's crossing in progress, and the Magiport offer a mage made. The tasks owner's tick reads and writes
// `working` around its arrival report, and the escape drops the offer, until E01-3 and E05-1 land.
export interface CrossingState {
  working: boolean;
  offer: { id: string; name: string; revision: number; ownRevision: number; asked: Asked; cast: boolean } | null;
}
// A handshake message waiting for `name`'s answer: the coordinator time it went, and the stamp of
// the first report `name` made after it.
interface Asked { name: string; at: number; after?: number }
// The tasks owner's choice for one travel try: the member or saved waypoint to reach, how far it is, whether the
// command's own location is reached, and whether the return was dispatched alone.
export interface ReunionTarget { member: Value; distance: number; arrived: boolean; independent: boolean }

// What the tasks owner's farm reunion (runtime/tasks/character/assignment.ts `installFarmReunion`) asks movement on
// the character. install.ts builds it, and runtime/movement/api/character.ts publishes the type. The
// reunion asks the rank rule `farmWalkHeld` (rules.ts) from that door too.
export interface ReunionMovement {
  reunionRequest(token: { id: string }): unknown;
  reunionRealm(): string;
  reunionCrossing: { working: boolean };
  reunionAt(c: unknown, location: unknown): boolean;
  reunionArrived(walk: ReunionTarget): boolean;
  reunionTravel(token: unknown, walk: ReunionTarget): Promise<void>;
  reunionWait(token: unknown): void;
  reunionEnded(token: { id: string }): void;
  sharedWalkActivity(): string | null;
  reunionStarts(): void;
}

// b9b5c91e's 150 (shared.js `farmReunionTick`), kept as base geometry: no design row gives it a source.
const REUNION_NEAR = 150;
export function installReunionCrossings(host: CrossingsHost, ports: CrossingsPorts) {
  const character = () => ports.character();
  const crossing: CrossingState = { working: false, offer: null };
  const root = ports.root();
  const previousCm = root.on_cm, previousMagiport = root.on_magiport;

  // The other side answers a handshake message as soon as it reads it, so its answer comes before
  // its second report after the message (CF14: the Magiport offer waits for the mage's answer, at
  // its measured report cadence). A side whose report is no longer fresh has no answer to give.
  function asked(name: string): Asked { return { name, at: ports.now() + ports.clockOffset() }; }
  function unanswered(message: Asked): boolean {
    const now = ports.now() + ports.clockOffset();
    const report = ports.partyPositions().find(function (entry) { return entry.name === message.name; });
    if (!report || !ports.movement().fresh(report.seenAt, now, 'presence', 0, true)) return false;
    const seenAt = Number(report.seenAt);
    if (message.after === undefined) { if (seenAt > message.at) message.after = seenAt; return true; }
    return seenAt <= message.after;
  }
  // The game answers a Blink once it reads it (class G): within one measured round trip.
  // The game's own promise has no end of its own when the answer is lost, and a lost answer tells
  // The status owner's bound record.
  function answered(crossing: Promise<unknown>, label: string): Promise<unknown> {
    let settled = false;
    const ms = ports.movement().roundTrip();
    crossing.then(function () { settled = true; }, function () { settled = true; });
    return Promise.race([crossing, ports.sleep(ms).then(function () {
      if (!settled) boundFired({ bound: "crossingRoundTrip", owner: "02", state: { label: label, ms: ms } });
      throw new Error(label + " had no answer within a round trip");
    })]);
  }
  // The game sets the realm from its socket's `welcome` (game.js `server_region`, `server_identifier`),
  // and a socket connects to one server, so the realm is read again only on a new socket.
  let realm: { socket: unknown; name: string } | null = null;
  function reunionRealm(): string {
    const socket = host.parent.socket;
    const known = realm;
    if (known && known.socket === socket) return known.name;
    const name = String(host.parent.server_region || "") + String(host.parent.server_identifier || "");
    realm = { socket, name };
    return name;
  }
  function reunionOrdinaryMap(map: string): boolean {
    const G = ports.G();
    return !!(G.maps && G.maps[map] && !G.maps[map].event && !/^bank/.test(map));
  }
  function reunionBlinkLanding(x: number, y: number): boolean {
    return host.can_move({ map: character().map, x: x, y: y, going_x: x, going_y: y, base: character().base });
  }
  function reunionEntrance(map: string): { x: number; y: number } | undefined {
    const c = character();
    const doors: Value[] = (ports.G().maps[c.map] || {}).doors || [], points: { x: number; y: number }[] = [];
    doors.forEach(function (door) {
      if (door[4] !== map) return;
      [[0,40],[0,-40],[40,0],[-40,0]].forEach(function (offset) {
        const point = { x: door[0] + offset[0], y: door[1] + offset[1] };
        if (reunionBlinkLanding(point.x, point.y)) points.push(point);
      });
    });
    return points.sort(function (a, b) {
      return Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y);
    })[0];
  }
  function reunionManaAllowed(skill: string, reserve: number): boolean {
    const G = ports.G(), c = character();
    const definition = G.skills && G.skills[skill];
    const cost = definition && Number(definition.mp) * (100 - (Number(c.mp_reduction) || 0)) / 100;
    return !!definition && c.mp - cost >= c.max_mp * reserve &&
      !host.is_on_cooldown(skill) && host.can_use(skill);
  }
  function reunionMageEligible(): boolean {
    const c = character(), partyLocation = ports.partyLocation();
    return c.ctype === "mage" && !ports.reunionBlocked() && !crossing.working &&
      !c.moving && !ports.engagedMonster() && !host.is_transporting(c) &&
      !Object.keys(c.c || {}).length && reunionOrdinaryMap(c.map) && partyLocation &&
      c.map === partyLocation.map && Math.hypot(c.x - partyLocation.x, c.y - partyLocation.y) <= 800 &&
      reunionManaAllowed("magiport", 0.1);
  }
  // Each handshake message asks the call budget its band in the turn it goes (the request table's band, a job's with
  // no request). Held, the message does not go and the handshake's state stays as it was: the asker
  // asks again on its next pass, and an answer waits for the asker's next message. The message goes in
  // the same turn the band answers; the caller records the handshake's state after the send starts and
  // before it awaits it, so no reply can arrive in between. Null when held.
  function sendCm(name: string, message: Value, request?: Request): Promise<unknown> | null {
    if (partyHooks().calls.band({ band: sendBand(request as Requester | undefined), method: 'cm', data: { to: [name], message: JSON.stringify(message) } }) !== 'send') return null;
    return host.send_cm(name, message);
  }
  async function reunionCm(name: string, data: Value): Promise<unknown> {
    if (!data || data.type !== "farm-reunion") {
      if (typeof previousCm === "function") return previousCm(name, data);
      return;
    }
    if (ports.desiredPartyMembers().indexOf(name) < 0 || data.realm !== reunionRealm()) return;
    const offer = crossing.offer, reunion = ports.reunion();
    if (data.action === "request" && reunionMageEligible() && (!offer || !unanswered(offer.asked))) {
      const member = ports.partyPositions().find(function (entry) { return entry.name === name; });
      if (!member || member.rip || !reunionOrdinaryMap(member.map) || member.server !== reunionRealm() ||
          !ports.movement().fresh(member.seenAt, ports.now() + ports.clockOffset(), 'presence', 0, true)) return;
      const answer = { type: "farm-reunion", action: "offer", id: data.id, realm: reunionRealm() };
      const sent = sendCm(name, answer);
      if (!sent) return;
      crossing.offer = { id: data.id, name: name, revision: data.revision,
        ownRevision: ports.intent().revision, asked: asked(name), cast: false };
      await sent;
    } else if (data.action === "offer" && reunion && reunion.id === data.id && reunion.mage === name &&
        reunion.portAsked && unanswered(reunion.portAsked) && ports.reunionCurrent(reunion) && !ports.reunionBlocked() &&
        ports.reunionMembers().some(function (entry) { return entry.name === name; })) {
      const answer = { type: "farm-reunion", action: "ready", id: data.id, revision: reunion.revision, realm: reunionRealm() };
      const sent = sendCm(name, answer);
      if (!sent) return;
      reunion.phase = "accepting-magiport"; reunion.portAsked = asked(name);
      await sent;
    } else if (data.action === "ready" && offer && offer.name === name &&
        offer.id === data.id && offer.revision === data.revision &&
        offer.ownRevision === ports.intent().revision && !offer.cast &&
        unanswered(offer.asked) && reunionMageEligible()) {
      offer.cast = true;
      // The mage casts as the reunion it serves, at the reunion walk's farming tier.
      await ports.movement().magiport(ports.timed({ kind: "task-walk", owner: "reunion-port:" + data.id, tier: "farming" }), name);
      host.game_log("Magiport reunion requested for " + name, "#51D2E1");
    }
  }
  const cmHandler = function (name: string, data: Value) { reunionCm(name, data).catch(function (error) {
    host.game_log("Reunion message failed: " + (error.reason || error.message || error), "#f0b429");
  }); };
  const magiportHandler = function (name: string) {
    if (ports.acceptEscapePort(name)) return;
    const token = ports.reunion();
    if (!token || token.mage !== name || token.phase !== "accepting-magiport" ||
        !token.portAsked || !unanswered(token.portAsked) || !ports.reunionCurrent(token) || ports.reunionBlocked() ||
        !reunionOrdinaryMap(character().map) || !ports.reunionMembers().some(function (entry) { return entry.name === name; })) return;
    token.phase = "magiport-arrival";
    Promise.resolve(ports.stop(ports.reunionRequest(token))).then(function () {
      if (ports.reunionCurrent(token) && !ports.reunionBlocked()) return ports.movement().acceptMagiport(ports.timed(ports.reunionRequest(token)), name);
    }).catch(function (error) { token.lastError = String(error.reason || error.message || error); });
  };
  root.on_cm = cmHandler;
  root.on_magiport = magiportHandler;
  // Unloading the runtime gives the game back the handlers it found, unless another runtime has
  // installed its own since.
  function restoreReunionHandlers(): void {
    if (root.on_cm === cmHandler) root.on_cm = previousCm;
    if (root.on_magiport === magiportHandler) root.on_magiport = previousMagiport;
  }

  // The reunion's travel is one task walk: its tries climb the task round (protocol/ladder.ts
  // `taskRound`) under the reunion's identity, and the round's wait rung, like a failed handoff or
  // arrival report (`reunionWait`), waits for this character's next report, or the report-freshness
  // bound once its reports fall silent.
  function reunionClimb(token: Value) {
    return ports.movement().climb("reunion:" + token.id, taskRound(ports.G(), "the farm"), "Rejoining the farm");
  }
  function reunionWait(token: Value): void {
    token.retryAt = Infinity;
    void ports.reportOrSilence("reunion:" + token.id).then(function () { if (token.retryAt === Infinity) token.retryAt = 0; });
  }
  function reunionEnded(token: Value): void { ports.movement().endClimb("reunion:" + token.id); }
  function here(): Value { const c = character(); return { map: c.map, in: c.in, x: c.x, y: c.y }; }

  // The reunion's arrival rule (one rally range).
  // A character returning on its own arrives inside the rally range of its waypoint. One rejoining a
  // survivor arrives within REUNION_NEAR of it once the command's own destination is reached.
  function reunionAt(c: Value, location: Value): boolean {
    return c.map === location.map && Math.hypot(c.x - location.x, c.y - location.y) <= REUNION_NEAR;
  }
  function reunionArrived(target: ReunionTarget): boolean {
    return target.distance <= (target.independent ? RENDEZVOUS_RANGE : REUNION_NEAR) && target.arrived;
  }

  // One travel try of the reunion toward the tasks owner's target: the Magiport request to a mage near it, a
  // Blink to the map's entrance or to the member, then the shared party walk or the route's rung.
  async function reunionTravel(token: Value, target: ReunionTarget): Promise<void> {
    const { member, distance, arrived: commandArrived, independent: independentReturn } = target;
    if (crossing.working || token.retryAt) return;
    token.destination = { map: member.map, x: member.x, y: member.y };
    if (token.command && distance <= REUNION_NEAR && !commandArrived) token.destination = token.command.location;
    // A Magiport asked waits for the mage's answer.
    if (token.portAsked && unanswered(token.portAsked) && ports.reunionMembers().some(function (entry) { return entry.name === token.mage; })) return;
    if (!independentReturn && !token.portAttempted && distance > 300 && reunionOrdinaryMap(character().map)) {
      const mage = ports.reunionMembers().find(function (entry) { return entry.ctype === "mage"; });
      const ask = mage && { type: "farm-reunion", action: "request", id: token.id, revision: token.revision, realm: reunionRealm() };
      const sent = mage && sendCm(mage.name, ask, ports.reunionRequest(token));
      if (mage && !sent) return;
      if (mage) {
        token.portAttempted = true; token.mage = mage.name; token.portAsked = asked(mage.name);
        token.phase = "requesting-magiport";
        await sent;
        return;
      }
    }
    token.portAsked = null;
    const ladder = reunionClimb(token);
    crossing.working = true; token.moving = true; token.phase = "travelling";
    try {
      // Blink stays on this map: shorten a direct entrance leg, then use the
      // normal map transition before attempting Blink near the survivors.
      if (character().map !== member.map && character().ctype === "mage" && reunionOrdinaryMap(character().map) &&
          reunionOrdinaryMap(member.map) && !ports.engagedMonster() && !host.is_transporting(character()) &&
          !Object.keys(character().c || {}).length && reunionManaAllowed("blink", 0.3)) {
        const entrance = reunionEntrance(member.map);
        if (entrance && Math.hypot(character().x - entrance.x, character().y - entrance.y) > 300) {
          token.phase = "blinking-to-entrance";
          try { await answered(ports.blinkAs(ports.reunionRequest(token), entrance.x, entrance.y), "Reunion entrance Blink"); }
          catch (error: Value) { token.lastError = String(error.reason || error.message || error); }
          if (!ports.reunionCurrent(token) || ports.reunionBlocked()) return;
        }
      }
      const destination = character().map !== member.map ? { map: member.map } : token.destination;
      const near = () => character().map === member.map && Math.hypot(character().x - member.x, character().y - member.y) <= REUNION_NEAR;
      if (character().map === member.map && character().ctype === "mage" && distance > 300 &&
          (character().in == null || member.in == null || character().in === member.in) && reunionBlinkLanding(member.x, member.y) &&
          reunionOrdinaryMap(member.map) && !ports.engagedMonster() && !host.is_transporting(character()) &&
          !Object.keys(character().c || {}).length && reunionManaAllowed("blink", 0.3)) {
        token.phase = "blinking";
        await ports.stop(ports.reunionRequest(token));
        let landing = false;
        try { await answered(ports.blinkAs(ports.reunionRequest(token), member.x, member.y), "Reunion Blink"); landing = true; }
        catch (error: Value) { token.lastError = String(error.reason || error.message || error); }
        // An answered Blink lands with the game's map update, which ends its `blink` condition. The
        // condition reaches the client within one round trip of the answer.
        const shown = ports.now() + ports.movement().roundTrip();
        while (landing && ports.reunionCurrent(token) && !ports.reunionBlocked() && !near() &&
            (character().s && character().s.blink || ports.now() < shown)) await ports.nextPass("reunion:" + token.id + ":blink");
        if (!token.command && near()) { reunionEnded(token); return; }
      }
      if (!ports.reunionCurrent(token) || ports.reunionBlocked()) return;
      if (!independentReturn && !ports.reunionMembers().length && ports.leader() && !ports.scatter()) {
        await ports.sharedPartyWalk(ports.entryPoint(token.destination), "farm-recovery", "farming", token.command, function () { return ports.reunionCurrent(token); });
        return;
      }
      // The route's rung: the try ends on its own end, the planner's budget or the walking stall.
      const attempt = ladder.next(here(), {});
      if (attempt.rung === "wait") {
        token.phase = "retry-wait";
        await ports.reportOrSilence("reunion:" + token.id);
        if (ports.reunionCurrent(token)) ladder.waited();
        return;
      }
      await ports.smartMove(attempt.destination || ports.entryPoint(destination), undefined,
        Object.assign({}, attempt.options, { request: ports.reunionRequest(token) }));
      if (!attempt.destination) reunionEnded(token); else ladder.result({ arrived: false, at: here() });
    } catch (error: Value) {
      if (!ports.reunionCurrent(token)) return;
      token.lastError = String(error.reason || error.message || error);
      ladder.result({ arrived: false, at: here() });
      // The card and the log keep b9b5c91e's words (shared.js:13713-13714); the ladder decides the
      // next try, so `retry-wait` lasts until that try starts.
      token.phase = "retry-wait";
      host.game_log("Farming reunion retry: " + token.lastError, "#f0b429");
    } finally {
      if (ports.reunionCurrent(token) && !ports.reunionBlocked()) { try { await ports.stop(ports.reunionRequest(token)); } catch (_) {} }
      token.moving = false; crossing.working = false;
    }
  }

  return { reunionCrossing: crossing, reunionRealm, reunionOrdinaryMap, reunionBlinkLanding, reunionEntrance,
    reunionManaAllowed, reunionMageEligible, reunionCm, restoreReunionHandlers, reunionAt, reunionArrived, reunionTravel, reunionWait, reunionEnded };
}

