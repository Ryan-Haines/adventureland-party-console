import type { ConvoyNavigationPlatform } from '../infrastructure/convoy-platform.ts';
import { contains } from '../../../dashboard/lib/farming-zones.ts';
import { samePlace, type SharedState, type SharedConvoy, type SharedCommand } from './shared-route-types.ts';
type Options = Parameters<ConvoyNavigationPlatform['engage']>[2];
export function engageFarming(state: SharedState, body: Record<string, unknown>, options: Options,
  legacy: Pick<ConvoyNavigationPlatform, 'validReport'>,
  commandFor: (state: SharedState, c: SharedConvoy, phase: string, name: string) => SharedCommand, now = Date.now()): boolean {
  const c = state.activeConvoy;
  if (!c || !acquiring(c, now)) return false;
  if (!legacy.validReport(state, body)) return false;
  if (!authorized(state, c, options, body)) return false;
  const target = body.target as NonNullable<SharedConvoy['farmingEngagement']>['target'];
  const lead = state.statuses[c.leader];
  if (!leaderTarget(state, c, body, target, options, now)) return false;
  c.farmingEngagement = { target: {...target, server:lead!.server}, at: now };
  if (arrivedForCombat(state, c, target, options.radius, now)) {
    for (const name of c.participants) delete state.commands[name];
    state.activeConvoy = null;
    return true;
  }
  c.phase = 'defending'; c.departAt = null;
  for (const name of c.participants) state.commands[name] = commandFor(state, c, 'defending', name);
  return true;
}
function leaderTarget(state: SharedState, c: SharedConvoy, body: Record<string, unknown>,
  target: NonNullable<SharedConvoy['farmingEngagement']>['target'], options: Options, now: number): boolean {
  const lead = state.statuses[c.leader];
  return body.character === c.leader && !!lead && validTarget(target, lead, options, now);
}
function arrivedForCombat(state: SharedState, c: SharedConvoy,
  target: NonNullable<SharedConvoy['farmingEngagement']>['target'], radius: number, now: number): boolean {
  return contains(c.location, target, 0, radius) && c.participants.every(name => {
    const member = state.statuses[name];
    return member && now - member.seenAt <= 3000 && samePlace(member, target) &&
      contains(c.location, member, 150, radius);
  });
}
function acquiring(c: SharedConvoy, _now: number): boolean {
  return c.cause !== 'farming-conflict' && ['', 'party-travel', 'farm-relocation', 'manual-monster-override'].includes(c.purpose || '') && c.combatHandoffAllowed && !c.force && !c.farmingEngagement &&
    ['shared-prepare','scheduled','travel'].includes(c.phase);
}
function authorized(state: SharedState, c: SharedConvoy, options: Options, body: Record<string,unknown>): boolean {
  if (Number(body.navigationRevision)!==options.revisions[String(body.character)]) return false;
  return c.participants.every(name => {
    const intent = state.navigationIntents?.[name], command = state.commands[name];
    return !intent?.cancelled && intent?.revision === options.revisions[name] &&
      command?.convoyId === c.id && command.navigationRevision === options.revisions[name];
  });
}
function validTarget(target: NonNullable<SharedConvoy['farmingEngagement']>['target'],
  lead: NonNullable<SharedState['statuses'][string]>, options: Options, now: number): boolean {
  return now-lead.seenAt<=3000 && !!target?.id && Number.isFinite(target.x) && Number.isFinite(target.y) && samePlace(target,lead) &&
    Math.hypot(target.x-lead.x,target.y-lead.y)<=options.radius &&
    (options.focus.includes('all') || options.focus.includes(target.mtype));
}
