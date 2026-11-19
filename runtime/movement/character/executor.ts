// The journey executor (R1.1 `executor.ts`): it walks a validated route step by step and owns
// the native sends a journey makes, sendLeave, sendTown, sendTransport and standStillSend, and
// the walking try that ends on the game's own movement (R2F3). Each send asks its request's call
// band first.
import { movementError, retryableMovementRequest } from './records.ts';
import { isTransition, distance, point, type Point, type Step } from '../geometry/contracts.ts';
import { stepIssue, type ValidationPorts } from '../geometry/validation.ts';
import type { MovementHost, MovementOptions, MoveState } from '../../protocol/records.ts';
import { partyHooks } from '../../hooks/index.ts';
import { boundFired } from '../../status/api.ts';
import type { CallBand } from '../../hooks/registry.ts';
import type { DepartureGate } from './walk-client.ts';
import { departureWaitsLoot, REPORT_STALL_DISTANCE, STOP_AND_STEP_BAND, type DepartureVerdict } from '../rules.ts';
function transitionLabel(step: Step): string {
  return step.method === 'leave' ? 'leave transition' : step.town ? 'town warp' : 'map transition';
}
// `reissuedAt` is when a step that stopped short was sent again since the last progress;
// `reportAt` the position at the character's last report while it showed moving.
interface Issued { reissuedAt?: number; reportAt?: Point; reportStall?: boolean; step: Step; from: Point; at: number; progressAt: number; position: Point; error?: Error | string; completionBarrierError?: Error; townUnavailable?: boolean; acknowledged?: boolean; answerPending?: boolean; finished?: boolean; aligned?: boolean; connectorFrom?: Point; connectorSentAt?: number; connectorVersion?: number; connectorOwed?: boolean; sendVersion?: number }
function retryableCompletionBarrier(error: Error & {partyRequest?: unknown}): boolean {
  const request=error.partyRequest as {path?:string;kind?:string;status?:number}|undefined;
  return request?.path==='/movement-barrier' && request.kind!=='aborted' && request.status!==409 && retryableMovementRequest(error);
}
// Each send asks the call budget its band first and makes the call in the same synchronous turn
// on `send`. On `not-now` it makes no call and returns NOT_NOW, and the caller asks again on
// its next pass.
export const NOT_NOW = 'not-now' as const;
export type Sent = Promise<unknown> | typeof NOT_NOW;
// The native transitions, sent the way the game's own leave(), town() and transport(map, s)
// send them. The executor sends them for a journey's steps; the owner sends them for a
// requester that crosses with no journey (owner.ts service `transport`, `leave`, `town`).
export function sendLeave(host: MovementHost, band: CallBand): Sent {
  if (partyHooks().calls.band({ band, method: 'leave' }) !== 'send') return NOT_NOW;
  const promise = host.parent.push_deferred('leave');
  host.parent.socket.emit('leave', undefined); return promise;
}
// The game's town() and use('town') both emit `town` (js/functions.js use_skill, runner_functions.js town).
export function sendTown(host: MovementHost, band: CallBand): Sent {
  if (partyHooks().calls.band({ band, method: 'town' }) !== 'send') return NOT_NOW;
  return host.town ? host.town() : host.use('town');
}
export function sendTransport(host: MovementHost, map: string, spawn: number | undefined, band: CallBand): Sent {
  const data = { to: map, s: spawn };
  if (partyHooks().calls.band({ band, method: 'transport', data }) !== 'send') return NOT_NOW;
  const promise = host.parent.push_deferred('transport');
  host.parent.socket.emit('transport', data); return promise;
}
// The game's cruise(speed), which caps the walk speed until the next cruise (runner_functions.js
// cruise). The group walk's cap and its reset, and the hunting owner's Cave run, send it here.
export function sendCruise(host: { cruise(speed?: number): unknown }, speed: number | undefined, band: CallBand): Sent {
  if (partyHooks().calls.band({ band, method: 'cruise', data: speed }) !== 'send') return NOT_NOW;
  return Promise.resolve(host.cruise(speed));
}
// Stops the character where it stands. The game's own stop is a move to the client's position, and
// the server takes a move only when its point differs from where the server has the character
// (node/server.js socket "move": `x != player.x || y != player.y`). A stop sent before the server
// moved on the last move names its start, which the server still holds, so the server drops it and
// walks that move to its end while the client stands: tank table saw the server's warrior walk a
// combat approach 120 units that the owner released in the millisecond it began. While the client
// still stands where its last move began (`from_x`, `from_y`, which the game's move() sets), the
// stop names a point 0.01 off it, which the server takes. A stop is a survival call. The owner
// decides it (`ExecutorCalls.standStill`), and one the budget holds goes on a later pass, from
// where the character stands then. A character that cannot walk gets no move: the game refuses it
// with no emit (runner_functions.js move, `can_walk`).
export function standStillSend(host: Pick<MovementHost, 'character' | 'move' | 'can_walk'>): Sent {
  const c = host.character as typeof host.character & { from_x?: number; from_y?: number };
  if (!host.can_walk(c)) return Promise.resolve();
  if (partyHooks().calls.band({ band: STOP_AND_STEP_BAND, method: 'move' }) !== 'send') return NOT_NOW;
  const unmoved = c.from_x === c.real_x && c.from_y === c.real_y;
  return Promise.resolve(host.move(c.real_x + (unmoved ? 0.01 : 0), c.real_y)).catch(() => {});
}
// `calls` names the band of the journey being walked, stops a Town cast through the owner's own
// stop, which asks its band (owner.ts `nativeStop`), and stands the character still through the
// owner's decided sends (owner.ts `decideSend`).
// `roundTrip` is the call budget's measured margin, the bound of a re-sent step (R2F3).
export interface ExecutorCalls { band(): CallBand; stopTown(): Promise<unknown>; standStill(): Promise<unknown>; roundTrip(): number }
export function createMovementExecutor(host: MovementHost, state: MoveState, validation: ValidationPorts, now: () => number, gate: Pick<DepartureGate, 'townReady' | 'transitionReady' | 'judge'>,
  calls: ExecutorCalls) {
  let issued: Issued | undefined, index = 0, barrierPending = false, barrierReady = false, lastBarrier = 0, waitingBarrier = false;
  // The walking try's counts since the install, for the step gate's climbs, stalls and re-sends
  // per hour (R2F3).
  const tries = { resends: 0, stalls: 0 };
  let walkingEdge: {from: Point; to: Step} | undefined;
  // Set when combat lets go of a paused journey: the next travel step goes out while the
  // character still walks its combat step, and replaces it (rule 5).
  let resuming = false;
  let sampledAt = now(), sampledPhase = 'idle';
  // The departure waits in progress (T4 `ready`): each judges its own fight and loot from its start.
  let lootWait: (() => DepartureVerdict) | undefined, townWait: (() => DepartureVerdict) | undefined, lootLeft = false;
  let durations: Record<string,number> = {};
  const position = () => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
  function reset() { issued = undefined; walkingEdge=undefined; resuming = false; index = 0; barrierPending = false; barrierReady = false; lastBarrier = 0; waitingBarrier=false; lootWait=undefined; townWait=undefined; lootLeft=false; sampledAt=now();sampledPhase='idle';durations={}; }
  function cancel() {
    if (issued) {
      void calls.standStill();
      if (issued.step.town) void calls.stopTown().catch(() => {});
    }
    reset();
  }
  // With `stop` false the character keeps moving, because a combat step replaces the
  // travel move.
  function pause(stop = true) {
    if (!issued) return;
    issued.progressAt = now(); issued.at = now();
    if (isTransition(issued.step)) return;
    // Stop the travel segment once; combat owns movement until travel resumes.
    issued = undefined;
    barrierReady = false;
    if (stop) void calls.standStill();
  }
  function resume() { resuming = true; }
  function barrier(options: MovementOptions, step: Step, completed: boolean): boolean {
    if (!options.barrier) return true;
    if (barrierReady) { barrierReady = false; waitingBarrier=false; return true; }
    waitingBarrier=true;
    // movement-executor.ts:125: the barrier asks again one measured round trip after its last ask.
    if (barrierPending || now() - lastBarrier < calls.roundTrip()) return false;
    barrierPending = true; lastBarrier = now();
    const captured = issued;
    options.barrier(step, index, completed, lootLeft).then(ready => { if (issued === captured) barrierReady = ready; }, error => {
      if (issued === captured && issued && !issued.error) {
        const failure=movementError(error);issued.error=failure;
        if(completed && retryableCompletionBarrier(failure))issued.completionBarrierError=failure;
      }
    }).finally(() => { if (issued === captured) barrierPending = false; });
    return false;
  }
  function complete(current: Issued, options: MovementOptions): boolean {
    const p = position(), transition = isTransition(current.step);
    if (host.character.moving || host.is_transporting(host.character)) return false;
    // A warp at its spawn must still be observed as issued and settled, not skipped.
    if (transition && !current.acknowledged) return false;
    if (transition) alignArrival(current, p);
    if (distance(p, current.step) > 1) return false;
    notifyTown(current,options,'complete');
    if (!transitionReady(current, options, !!transition)) return false;
    notifyTransition(current,options);
    state.plot.shift();
    if(transition){walkingEdge=undefined;index++;}
    else rememberWalkingEdge({...p,x:current.step.x,y:current.step.y},state.plot[0]);
    issued = undefined; barrierReady = false; return true;
  }
  // The arrival connector's resend spacing, v1.5.0's (runtime/characters/movement-executor.ts:72):
  // the walk request rate after a scattered landing stays at or below v1.5.0's.
  const CONNECTOR_RESEND_MS = 1000;
  function alignArrival(current: Issued, p: Point) {
    if (distance(p, current.step) <= 1 || distance(p, current.step) > 150) return;
    if (current.aligned) {
      // Native new_map can arrive after the first move's map counter. Retry only the
      // already checked connector, without renewing transition time, once the character made
      // no progress since its last send for CONNECTOR_RESEND_MS or a measured round trip,
      // whichever is longer.
      // Once the client stands still after a resend, alignArrival sends nothing more and observe
      // fails the crossing when that resend's round trip passes.
      if (connectorUnanswered(current)) return;
      const wait = Math.max(CONNECTOR_RESEND_MS, calls.roundTrip());
      if (current.connectorOwed || now() - current.progressAt >= wait && now() - (current.connectorSentAt || 0) >= wait) {
        // A later scatter correction moves the connector's origin, so the new leg is checked
        // again.
        if (!current.connectorFrom || distance(p, current.connectorFrom) >= 1) {
          if (!validation.walk(p, current.step)) throw Error('Arrival connector collision after native position correction');
          current.connectorFrom = point(p);
        }
        sendConnector(current);
      }
      return;
    }
    // The server scatters Town/door arrivals around their advertised spawn. Join
    // the shared route at its exact spawn using a newly collision-checked leg.
    if (!validation.walk(p, current.step)) throw Error(`Arrival connector collision between ${JSON.stringify(p)} and ${JSON.stringify(current.step)}`);
    current.aligned = true; current.connectorFrom = point(p); current.progressAt = now();
    sendConnector(current);
  }
  // The connector was sent again and the client stands with no progress since that send.
  function connectorUnanswered(current: Issued): boolean {
    return (current.connectorVersion || 0) >= 2 && !current.connectorOwed && !host.character.moving &&
      current.progressAt <= (current.connectorSentAt || 0);
  }
  // A connector the budget holds is owed: the next pass sends it (`connectorOwed`). A character
  // that cannot walk asks nothing: the game refuses its move with no emit.
  function sendConnector(current: Issued) {
    if (host.can_walk(host.character) && partyHooks().calls.band({ band: calls.band(), method: 'move' }) !== 'send') { current.connectorOwed = true; return; }
    current.connectorOwed = false;
    current.connectorSentAt = now();
    const version = current.connectorVersion = (current.connectorVersion || 0) + 1;
    void Promise.resolve(host.move(current.step.x, current.step.y)).catch(error => {
      if (issued === current && current.connectorVersion === version) current.error = String(error);
    });
  }
  function transitionReady(current: Issued, options: MovementOptions, transition: boolean): boolean {
    if (transition && !barrier(options, current.step, true)) { current.progressAt = now(); return false; }
    return true;
  }
  function observe(current: Issued, options: MovementOptions) {
    if (current.error) {
      notifyTownRejection(current,options);
      throw current.error instanceof Error ? current.error : Error(isTransition(current.step) ? transitionLabel(current.step) + ': ' + current.error : String(current.error));
    }
    if (complete(current, options)) return;
    const p = position();
    // Once arrival is confirmed, wait for the party barrier, not the cast timer.
    if (arrivedTransition(current,p)) return;
    if (distance(p, current.position) >= 2) { current.position = p; current.progressAt = now(); delete current.reissuedAt; }
    // A landing the server scattered was the game's answer: the arrival connector's walk to the exact
    // spawn takes longer than a round trip, and alignArrival sends it again while it makes no progress.
    // The connector is a walk, so it ends as the walking try does: once it was sent again and that
    // send's round trip passed with the client standing and no progress, the crossing failed.
    if (isTransition(current.step) && current.aligned) {
      if (connectorUnanswered(current) && now() - (current.connectorSentAt || 0) > calls.roundTrip()) {
        tries.stalls++;
        notifyTown(current,options,'interrupted');
        throw Error(`Failed ${transitionLabel(current.step)}`);
      }
      return;
    }
    const transition = isTransition(current.step);
    // Transition row: a crossing ends on the game's answer. While the game shows a Town channel or a
    // transport the try waits on it, and so does a Town cast the game has not answered: the game's
    // town() answers when the cast ends and bounds that itself with its 10 s timeout
    // (js/runner_functions.js), and a busy realm can show the cast seconds after the send. Otherwise
    // the answer is due within one measured round trip.
    if (transition && (current.answerPending && !!current.step.town || (host.character as { c?: { town?: unknown } }).c?.town || host.is_transporting(host.character))) current.at = now();
    else if (transition && now() - current.at > calls.roundTrip()) {
      // The same measured round trip as the reunion's crossings (crossings.ts `answered`), so a lost
      // answer tells the status owner's bound record under the same name.
      boundFired({ bound: 'crossingRoundTrip', owner: '02', state: { label: transitionLabel(current.step), ms: calls.roundTrip() } });
      notifyTown(current,options,'interrupted');
      throw Error(`Failed ${transitionLabel(current.step)}`);
    }
    observeWalk(current, p);
  }
  // The walking try (R2F3). A walk the game client shows moving is never cut on its position
  // alone. One that stops short of its step is sent again one measured round trip later, and
  // the try ends when that re-sent step's round trip has passed and the client still stands.
  // Two of the character's reports that show it moving with no 2-unit progress between them end
  // it too (`reported`). Progress of 2 units starts the test again.
  function observeWalk(current: Issued, p: Point): void {
    if (isTransition(current.step)) return;
    if (current.reportStall) { tries.stalls++; throw Error('Stalled walking movement (moving without progress across two reports)'); }
    if (host.character.moving) return;
    if (current.reissuedAt === undefined) { if (now() - current.progressAt > calls.roundTrip()) retryStoppedWalk(current, p); return; }
    if (now() - current.reissuedAt > calls.roundTrip()) { tries.stalls++; throw Error('Stalled walking movement (stopped short after its step was sent again)'); }
  }
  // A step that is no longer walkable from where the character stopped cannot be sent again, so
  // the try ends on that reason at once; while the game holds the character (it cannot walk or
  // it is transporting) the try waits on the game.
  function retryStoppedWalk(current: Issued, p: Point): void {
    if (!canStart()) return;
    const reason = stepIssue(validation, p, current.step, state.use_town);
    if (reason) { tries.stalls++; throw Error(`${reason} between ${p.map} (${p.x}, ${p.y}) and ${current.step.map} (${current.step.x}, ${current.step.y})`); }
    // Reissue only this owned segment and ignore its superseded deferred. A reissue the budget
    // holds was not sent, so the character's standing is not a stall of the step: the test
    // starts again, and the next pass asks again.
    if (!sendObserved(current)) { current.progressAt = now(); return; }
    current.reissuedAt = now(); tries.resends++;
  }
  // The character's own report went out: a walk it shows moving across two reports must have
  // moved REPORT_STALL_DISTANCE between them (R2F3), which covers server corrections and a window
  // whose frames stop.
  function reported(): void {
    const current = issued;
    if (!current || isTransition(current.step)) return;
    const p = position(), last = current.reportAt;
    current.reportAt = host.character.moving ? p : undefined;
    if (host.character.moving && last && distance(p, last) < REPORT_STALL_DISTANCE) current.reportStall = true;
  }
  function arrivedTransition(current: Issued, p: Point): boolean {
    return isTransition(current.step) && !!current.acknowledged && distance(p,current.step)<=1;
  }
  function send(current: Issued): Sent {
    const step = current.step, band = calls.band();
    if (step.method === 'leave') return sendLeave(host, band);
    if (step.town) return sendTown(host, band);
    if (step.transport) return sendTransport(host, step.map, step.s, band);
    // A character that cannot walk asks nothing: the game refuses its move with no emit, as in a
    // Dash (old_common_functions.js:782), and its rejection reaches the step as before.
    if (host.can_walk(host.character) && partyHooks().calls.band({ band, method: 'move' }) !== 'send') return NOT_NOW;
    return host.move(step.x, step.y);
  }
  function dispatch(current: Issued, options: MovementOptions) {
      if (current.error) throw current.error instanceof Error ? current.error : Error(current.step.method === "leave" ? "Leave transition failed: " + current.error : String(current.error));
      if ((options.departure === undefined || departureWaitsLoot(options.departure)) && !lootReady(current.step)) return;
      if(!readyTown(current,options))return;
      if ((isTransition(current.step)) && !barrier(options, current.step, false)) return;
      // A step the budget holds is not issued: it stays finished, so the next pass dispatches it
      // again, and its timers start when it is sent.
      const captured = current, at = now();
      if (!sendObserved(captured)) return;
      current.finished = false; current.at = at; current.progressAt = at;
      notifyTown(current,options,'casting');
  }
  // False when the budget held the send, which then made no call.
  function sendObserved(captured: Issued): boolean {
      let sent: Sent;
      try { sent = send(captured); } catch (error) { sent = Promise.reject(error); }
      if (sent === NOT_NOW) return false;
      const version = captured.sendVersion = (captured.sendVersion || 0) + 1;
      if(version===1)captureWalkingEdge(captured);
      captured.answerPending = true;
      const answered = () => { if (captured.sendVersion === version) captured.answerPending = false; };
      try { void Promise.resolve(sent).then(result => {
        answered();
        if (issued !== captured || captured.sendVersion !== version) return;
        if (result && typeof result === 'object' && 'failed' in result && result.failed) throw result;
        captured.acknowledged = true;
      }).catch(error => { answered(); if (issued === captured && captured.sendVersion === version) rejected(captured,error); }); }
      catch (error) { if (issued === captured) rejected(captured,error); }
      return true;
  }
  function captureWalkingEdge(current: Issued): void {
    if(walkingEdge?.to===current.step)return;
    rememberWalkingEdge(position(),current.step);
  }
  function rememberWalkingEdge(from: Point, next: Step | undefined): void {
    walkingEdge=next && !isTransition(next) && from.map===next.map && validation.walk(from,next)
      ? {from:{...from},to:next} : undefined;
  }
  function rejected(current:Issued,error:unknown):void {
    const reason=error && typeof error==='object' && 'reason' in error ? String(error.reason) : String(error);
    current.error=reason;
    current.townUnavailable=/cooldown|unavailable|not.ready|no.mp|disabled/i.test(reason);
  }
  function terminalIssued(current: Issued): boolean {
    return !current.finished && (!current.error || current.error===current.completionBarrierError) && !!current.acknowledged &&
      state.plot.length===1 && state.plot[0]===current.step && !!isTransition(current.step);
  }
  function settledPosition(p: Point, step: Step): boolean {
    return !host.character.moving && !host.is_transporting(host.character) && p.map===step.map &&
      String(p.in??p.map)===String(step.in??step.map) && distance(p,step)<=1;
  }
  function settleTerminal(options: MovementOptions) {
    const current=issued,p=position();
    if(!current || !terminalIssued(current) || !settledPosition(p,current.step))return undefined;
    // This is an acknowledgement of an already executed terminal transition.
    // Never align, dispatch, consult/release a barrier, or advance another step.
    const receipt={step:index,destination:{...current.step},acknowledged:true as const};
    notifyTown(current,options,'complete');notifyTransition(current,options);
    state.plot.shift();issued=undefined;barrierReady=false;walkingEdge=undefined;index++;
    return receipt;
  }
  function tick(options: MovementOptions): boolean {
    sample();
    if (issued && state.plot[0] !== issued.step) reset();
    if (issued?.finished) { dispatch(issued, options); return false; }
    if (issued) { observe(issued, options); return false; }
    if (!state.plot.length) return true;
    if (!canStart()) return false;
    const p = position();
    consumeReachedWalks(p);
    if (!state.plot.length) return true;
    const step = state.plot[0];
    issued = { step, from: point(p), at: now(), progressAt: now(), position: p, finished: true };
    resuming = false;
    dispatch(issued, options);
    return false;
  }
  function consumeReachedWalks(p: Point): void {
    while (state.plot.length) {
      const next = state.plot[0], reason = stepIssue(validation, p, next, state.use_town);
      if (reason) throw Error(`${reason} between ${p.map} (${p.x}, ${p.y}) and ${next.map} (${next.x}, ${next.y})`);
      // Even a zero-distance game move sets moving=true. Consume reached walking
      // points before issuing it; transitions still require dispatch and acknowledgement.
      if (isTransition(next) || distance(p, next) > 1) break;
      state.plot.shift(); rememberWalkingEdge({...p,x:next.x,y:next.y},state.plot[0]);
    }
  }
  // A map change waits while this character's eligible chests fall; once they stop falling across
  // its T4 window the transition goes ahead and the chests are left (`ready`: left to follow), and
  // the step's barrier says so.
  function lootReady(step: Step): boolean {
    if (!isTransition(step) || gate.transitionReady()) { lootWait = undefined; lootLeft = false; return true; }
    if (lootLeft) return true;
    lootWait ??= gate.judge(false);
    if (lootWait() !== 'stalled') return false;
    lootLeft = true;
    return true;
  }
  function notifyTownRejection(current:Issued,options:MovementOptions) {
    notifyTown(current,options,current.townUnavailable?'unavailable':'interrupted');
  }
  function notifyTown(current:Issued,options:MovementOptions,outcome:'casting'|'interrupted'|'complete'|'unavailable') {
    if(current.step.town)options.townAttempt?.(outcome,index,current.from,current.step);
  }
  function notifyTransition(current:Issued,options:MovementOptions) {
    if(isTransition(current.step))options.transitionComplete?.(current.step);
  }
  // A Town cast waits while the departure gate's fight or loot falls (R2F6 N-R5, Recheck 3 R3-S2); a
  // gate that stops falling across the walk phase table window, or a game that refuses the cast with the gate
  // clear, ends the try, and the request's ladder climbs.
  function readyTown(current:Issued,options:MovementOptions):boolean {
    if(!current.step.town || gate.townReady(lootLeft) && host.can_use('use_town')){townWait=undefined;return true;}
    if(!options.townAttempt)throw Error('Town warp currently unavailable');
    townWait ??= gate.judge(true);
    const verdict = townWait();
    if(verdict==='waiting' || verdict==='progress')return false;
    townWait=undefined;
    notifyTown(current,options,'unavailable');
    throw Error(verdict==='stalled' ? 'Town unavailable: the departure fight and loot stopped falling; use walking route' : 'Town unavailable: the game refused the cast; use walking route');
  }
  function sample(): void {
    const at=now();durations[sampledPhase]=(durations[sampledPhase]||0)+Math.max(0,at-sampledAt);
    sampledAt=at;sampledPhase=phase();
  }
  function phase(): string {
    if(lootWait !== undefined && !lootLeft)return 'pending loot';
    if(waitingBarrier)return 'barrier';
    if(!issued)return 'idle';
    return isTransition(issued.step)?transitionLabel(issued.step):'walking';
  }
  function canStart(): boolean { return (resuming || !host.character.moving) && host.can_walk(host.character) && !host.is_transporting(host.character); }
  return { tick, reported, tries: () => ({ ...tries }), settleTerminal, reset, cancel, pause, resume, progress: () => ({step:index,phase:phase(),destination:issued?.step,durations:{...durations},
    position:position(),noProgressMs:issued ? now()-issued.progressAt : 0,reissued:issued?.reissuedAt!==undefined}),
    transition: () => issued && isTransition(issued.step) ? (issued.step.town ? 'town' : 'transport') : null,
    // A prepared Town step can still be waiting on combat/loot/peers. Protect
    // only a sent cast, including the gap before its native channel report.
    townCasting: () => !!issued?.step.town && !!issued.sendVersion && !issued.error && !arrivedTransition(issued,position()),
    walkingEdge:()=>walkingEdge?.to===state.plot[0] ? walkingEdge : undefined,
    remaining: () => state.plot.map(p => ({ ...p })) };
}
