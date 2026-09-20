import { isTransition, distance, point, type Point, type Step } from '../navigation/contracts.ts';
import { stepIssue, type ValidationPorts } from '../navigation/validation.ts';
import type { MovementHost, MovementOptions, MoveState } from './movement-host.ts';
function transitionLabel(step: Step): string {
  return step.method === 'leave' ? 'leave transition' : step.town ? 'town warp' : 'map transition';
}
interface Issued { step: Step; from: Point; at: number; progressAt: number; position: Point; error?: string; acknowledged?: boolean; finished?: boolean; aligned?: boolean }
export function createMovementExecutor(host: MovementHost, state: MoveState, validation: ValidationPorts, now: () => number, townReady = () => true, lootCollected = () => true) {
  let issued: Issued | undefined, index = 0, barrierPending = false, barrierReady = false, lastBarrier = 0, waitingBarrier = false;
  let sampledAt = now(), sampledPhase = 'idle';
  let lootWaitAt: number | undefined;
  let durations: Record<string,number> = {};
  const position = () => ({ map: host.character.map, in: host.character.in, x: host.character.real_x, y: host.character.real_y });
  function reset() { issued = undefined; index = 0; barrierPending = false; barrierReady = false; lastBarrier = 0; waitingBarrier=false; lootWaitAt=undefined; sampledAt=now();sampledPhase='idle';durations={}; }
  function cancel() {
    if (issued) {
      void Promise.resolve(host.move(host.character.real_x, host.character.real_y)).catch(() => {});
      if (issued.step.town) void Promise.resolve(host.stop('town')).catch(() => {});
    }
    reset();
  }
  function pause() { if (issued) { issued.progressAt = now(); issued.at = now(); } }
  function barrier(options: MovementOptions, step: Step, completed: boolean): boolean {
    if (!options.barrier) return true;
    if (barrierReady) { barrierReady = false; waitingBarrier=false; return true; }
    waitingBarrier=true;
    if (barrierPending || now() - lastBarrier < 250) return false;
    barrierPending = true; lastBarrier = now();
    const captured = issued;
    options.barrier(step, index, completed).then(ready => { if (issued === captured) barrierReady = ready; }, error => {
      if (issued === captured && issued) issued.error = String(error);
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
    if (!transitionReady(current, options, !!transition)) return false;
    state.plot.shift(); if (transition) index++; issued = undefined; barrierReady = false; return true;
  }
  function alignArrival(current: Issued, p: Point) {
    if (current.aligned || distance(p, current.step) <= 1 || distance(p, current.step) > 150) return;
    // The server scatters Town/door arrivals around their advertised spawn. Join
    // the shared route at its exact spawn using a newly collision-checked leg.
    if (!validation.walk(p, current.step)) throw Error(`Arrival connector collision between ${JSON.stringify(p)} and ${JSON.stringify(current.step)}`);
    current.aligned = true; current.progressAt = now();
    void Promise.resolve(host.move(current.step.x, current.step.y)).catch(error => { if (issued === current) current.error = String(error); });
  }
  function transitionReady(current: Issued, options: MovementOptions, transition: boolean): boolean {
    if (transition && !barrier(options, current.step, true)) { current.progressAt = now(); return false; }
    return true;
  }
  function observe(current: Issued, options: MovementOptions) {
    if (current.error) throw Error(isTransition(current.step) ? transitionLabel(current.step) + ': ' + current.error : current.error);
    if (complete(current, options)) return;
    const p = position();
    // Once arrival is confirmed, wait for the party barrier, not the cast timer.
    if (arrivedTransition(current,p)) return;
    if (distance(p, current.position) >= 2) { current.position = p; current.progressAt = now(); }
    const transition = isTransition(current.step);
    if (transition && now() - current.at > 12000) throw Error(`Failed ${transitionLabel(current.step)}`);
    if (!transition && now() - current.progressAt > 5000) throw Error('Stalled walking movement (5 seconds without progress)');
  }
  function arrivedTransition(current: Issued, p: Point): boolean {
    return isTransition(current.step) && !!current.acknowledged && distance(p,current.step)<=1;
  }
  function send(current: Issued) {
    const step = current.step;
    if (step.method === 'leave') {
      const promise = host.parent.push_deferred('leave');
      host.parent.socket.emit('leave', undefined); return promise;
    }
    if (step.town) return host.town ? host.town() : host.use('town');
    if (step.transport) {
      const promise = host.parent.push_deferred('transport');
      host.parent.socket.emit('transport', { to: step.map, s: step.s }); return promise;
    }
    return host.move(step.x, step.y);
  }
  function dispatch(current: Issued, options: MovementOptions) {
      if (current.error) throw Error(current.step.method === "leave" ? "Leave transition failed: " + current.error : current.error);
      if (!lootReady(current.step)) return;
      if ((isTransition(current.step)) && !barrier(options, current.step, false)) return;
      if (current.step.town && !townReady()) throw Error('Town warp unavailable during combat or pending loot');
      current.finished = false; current.at = now(); current.progressAt = now();
      const captured = current;
      try { void Promise.resolve(send(captured)).then(result => {
        if (result && typeof result === 'object' && 'failed' in result && result.failed) throw Error('Movement command rejected by game');
        if (issued === captured) captured.acknowledged = true;
      }).catch(error => { if (issued === captured) captured.error = String(error); }); }
      catch (error) { captured.error = String(error); }
  }
  function tick(options: MovementOptions): boolean {
    sample();
    if (issued && state.plot[0] !== issued.step) reset();
    if (issued?.finished) { dispatch(issued, options); return false; }
    if (issued) { observe(issued, options); return false; }
    if (!state.plot.length) return true;
    if (!canStart()) return false;
    const step = state.plot[0], p = position(), reason = stepIssue(validation, p, step, state.use_town);
    if (reason) throw Error(`${reason} between ${p.map} (${p.x}, ${p.y}) and ${step.map} (${step.x}, ${step.y})`);
    checkTownAvailability(step);
    issued = { step, from: point(p), at: now(), progressAt: now(), position: p, finished: true };
    dispatch(issued, options);
    return false;
  }
  function lootReady(step: Step): boolean {
    if (!isTransition(step) || lootCollected()) { lootWaitAt = undefined; return true; }
    lootWaitAt ??= now();
    if (now() - lootWaitAt >= 30000) throw Error('Pending nearby loot prevented map transition for 30 seconds');
    return false;
  }
  function sample(): void {
    const at=now();durations[sampledPhase]=(durations[sampledPhase]||0)+Math.max(0,at-sampledAt);
    sampledAt=at;sampledPhase=phase();
  }
  function phase(): string {
    if(lootWaitAt !== undefined)return 'pending loot';
    if(waitingBarrier)return 'barrier';
    if(!issued)return 'idle';
    return isTransition(issued.step)?transitionLabel(issued.step):'walking';
  }
  function canStart(): boolean { return !host.character.moving && host.can_walk(host.character) && !host.is_transporting(host.character); }
  function checkTownAvailability(step: Step) {
    if (step.town && !host.can_use('use_town')) throw Error('Town warp currently unavailable');
  }
  return { tick, reset, cancel, pause, progress: () => ({step:index,phase:phase(),destination:issued?.step,durations:{...durations}}),
    transition: () => issued && isTransition(issued.step) ? (issued.step.town ? 'town' : 'transport') : null,
    remaining: () => state.plot.map(p => ({ ...p })) };
}
