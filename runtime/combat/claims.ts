import type {Member, Death} from './grouped.ts';
export interface ClaimObservation extends Death {external: boolean}
export interface ClaimState extends ClaimObservation {releasedAt?: number}
export const monsterIdentity = (t: Omit<Death, 'at'>) => JSON.stringify([t.server,t.map,t.in,t.id]);
export function reconcileClaims(previous: ClaimState[], members: Member[], now: number, resetAt: number) {
  const states = new Map(previous.map(c=>[monsterIdentity(c),{...c}]));
  for (const member of members) {
    const s=member.status;
    if (!s || s.rip || s.hp<=0 || now-s.seenAt>3000 || s.activeEvent || s.joinedEvent || s.mapEvent) continue;
    const restored=s.groupedCombat?.state;
    if (restored && restored.seenAt>=resetAt && restored.seenAt<=now+500) for(const c of restored.claims||[]) {
      if(c.at<resetAt || c.at>now+500)continue;
      const id=monsterIdentity(c), prior=states.get(id);
      const latest=!prior || c.at>prior.at || c.at===prior.at && c.external ? c : prior;
      states.set(id,{...latest,releasedAt:Math.max(c.releasedAt||0,prior?.releasedAt||0)||undefined});
    }
  }
  for (const member of members) {
    const s=member.status;
    if (!s || s.rip || s.hp<=0 || now-s.seenAt>3000 || s.activeEvent || s.joinedEvent || s.mapEvent) continue;
    for (const observation of s.groupedCombat?.claims || []) {
      if (observation.server!==s.server || observation.map!==s.map || observation.in!==s.in ||
          !Number.isFinite(observation.at) || observation.at<resetAt || now-observation.at>3000 || observation.at>now+500) continue;
      const id=monsterIdentity(observation), prior=states.get(id);
      if (!prior && !observation.external) continue;
      if (prior && (prior.at>observation.at || prior.at===observation.at && prior.external)) continue;
      states.set(id,{...observation,releasedAt:observation.external ? Math.max(prior?.releasedAt||0,observation.at) : prior?.releasedAt});
    }
  }
  return [...states.values()];
}
