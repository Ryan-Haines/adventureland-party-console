const semanticGrant=(grant:{expiresAt:number}|undefined)=>grant ? {...grant,expiresAt:undefined} : undefined;
import type { HttpResponse } from "../http/contracts.ts";
/** Long polling is separate from full inventory/status ingestion. One waiter per character. */
export function createCombatChannel(response: (name: string, mode?: "combat") => unknown) {
  const waiting = new Map<
    string,
    { res: HttpResponse; revision: string; timer: ReturnType<typeof setTimeout> }
  >();
  const snapshot = (name: string) => {
    const full = response(name, "combat") as {
      convoySignal?: { id: string; epoch: number; phase: string; farmingEngagement?: unknown; validUntil?: number } | null;
      groupedCombat?: unknown;
      passingEncounters?: unknown;
      passingControl?: unknown;
      combatRecovery?: unknown;
      travelCombat?: unknown;
      rareControl?: unknown;
      serverNow?: number;
      combatResetByCharacter?: Record<string, number>;
    };
    const control = {
      passingEncounters:full.passingEncounters,
      passingControl:full.passingControl,
      rareControl: full.rareControl,
      convoySignal: full.convoySignal || null,
      combatRecovery: full.combatRecovery,
      travelCombat: full.travelCombat,
      combatResetAt: full.combatResetByCharacter?.[name] || 0,

    };
    const revisionControl = {...control, convoySignal: control.convoySignal && {...control.convoySignal, validUntil: undefined}};
    const group = full?.groupedCombat as {
      queueRevision?: string;
      pairRevision?:string; successorGrant?:{expiresAt:number};
      selection?: string;
      committed?: boolean;
      pursuit?: {revoking?: string};
      formationRecovery?: {id:string;phase:string;attempt:number};
      seenAt?: number;
      observers?: {seenAt?:number;[key:string]:unknown}[];
      target?: { x: number; y: number; state?: string };
    } | null;
    if (!group)
      return { ...control, serverNow: full.serverNow, groupedCombat: null, combatRevision: JSON.stringify(["null", revisionControl]) };
    const target = group.target;
    const position = target ? [target.state, target.x, target.y] : null;
    return {
      ...control,
      serverNow: full.serverNow,
      groupedCombat: group,
      combatRevision: JSON.stringify([
        group.queueRevision, group.pairRevision, semanticGrant(group.successorGrant),
        group.selection,
        group.committed,
        group.pursuit?.revoking,
        group.formationRecovery,
        position,
        group.observers?.map(({seenAt: _seenAt,...observer})=>observer),
        revisionControl,
      ]),
    };
  };
  function finish(name: string) {
    const w = waiting.get(name);
    if (!w) return;
    waiting.delete(name);
    clearTimeout(w.timer);
    w.res.json(snapshot(name));
  }
  function flush() {
    for (const [name, w] of waiting) if (snapshot(name).combatRevision !== w.revision) finish(name);
  }
  function wait(name: string, revision: string, res: HttpResponse) {
    const current = snapshot(name);
    if (current.combatRevision !== revision) return res.json(current);
    finish(name);
    const timer = setTimeout(() => finish(name), 1000);
    timer.unref?.();
    waiting.set(name, { res, revision, timer });
  }
  return { snapshot, flush, wait };
}
