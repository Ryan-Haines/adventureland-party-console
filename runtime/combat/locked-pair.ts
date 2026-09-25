import type {Fight, Group} from './grouped.ts';
import {targetIdentity} from './lost-target.ts';

export const fightIdentity = (t: Fight) => JSON.stringify([targetIdentity(t), t.startedAt]);
export const fightSelection = (key: string, t: Fight) => JSON.stringify([key,t.id,t.server,t.map,t.in,t.startedAt]);
export function pairRevision(key: string, reset: number, queue: Fight[]): string | null {
  return queue.length >= 2 ? JSON.stringify([key,reset,queue.slice(0,2).map(fightIdentity)]) : null;
}
/** Lock two identities; observations and the third candidate remain live. */
export function lockedQueue(old: Group | null | undefined, target: Fight | null, ordered: Fight[], candidates: Fight[], key: string): Fight[] {
  if (!target) return [];
  if(!old?.pairRevision)return [target,...ordered.filter(t=>t!==target),...candidates.filter(t=>t!==target)].slice(0,Math.max(3,ordered.length));
  const available = [...ordered,...candidates].filter(t=>targetIdentity(t)!==targetIdentity(target));
  const previous = old?.key===key ? old.queue : [];
  const next = previous.find(t=>targetIdentity(t)!==targetIdentity(target) &&
    available.some(c=>fightIdentity(c)===fightIdentity(t)));
  const retained = next && available.find(t=>fightIdentity(t)===fightIdentity(next));
  // Existing engaged fights and higher-priority rare encounters retain priority.
  const urgent = available.find(t=>t.state!=='planned' || (t as Fight & {passiveRare?:boolean}).passiveRare &&
    ((t as Fight & {priority?:number}).priority??50)>((retained as Fight & {priority?:number}|undefined)?.priority??50));
  const successor=urgent||retained||available[0];
  return [target,...(successor?[successor]:[]),...available.filter(t=>t!==successor)].slice(0,Math.max(3,ordered.length));
}
