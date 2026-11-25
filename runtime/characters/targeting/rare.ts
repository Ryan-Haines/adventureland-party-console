// The rare target and tinyp's policy.
import { eventFacts } from '../../events/api.ts';
import { GAME_FIELD_REACH } from '../../hunting/api.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';

// Moved whole from shared.js.
export function createRare(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  function ownedRareTarget() {
    if(!t.groupedFresh() || p.walkState.intent.cancelled || character.rip || t.view().joinedEventNow || eventFacts().travellingEventName() || t.escaping())return null;
    var tgt=s.groupedCombat && s.groupedCombat.target, control=typeof p.hunting.hunt.control==='function' && p.hunting.hunt.control();
    var c=p.walks.groupWalk.travel;
    if(!c || c.phase!=='defending' || c.holdRequested || c.communication || Number(c.navigationRevision)!==Number(p.walkState.intent.revision))return null;
    if(!tgt || !control || !control.defending || !(control.committed||[]).some(function(e: any){return t.passingKey(e)===t.passingKey(tgt);}))return null;
    if(tgt.map!==character.map || String(tgt.in)!==String(character.in||character.map) || tgt.server!==t.view().reunionRealm)return null;
    var e=get_entity(tgt.id);
    return e && e.visible && !e.dead && e.hp>0 && !t.isExternallyClaimedMonster(e) ? e : null;
    }
  function rareTarget() {
    if (!t.view().rareActive || t.view().rareControlNow.kind !== "encounter") return t.ownedRareTarget();
    var wanted = t.view().rareControlNow.target;
    if (wanted.map !== character.map || String(wanted.in) !== String(character.in || character.map)) return null;
    var e = get_entity(wanted.id);
    return e && e.visible && !e.dead && e.mtype === wanted.mtype && !t.isExternallyClaimedMonster(e) ? e : null;
    }
  function nativeAttackProjectile(skill: any) {
    var actorClass: any = G.classes && G.classes[character.ctype] || {};
    var weapon = character.slots && character.slots.mainhand;
    var item: any = weapon && G.items && G.items[weapon.name] || {};
    var projectile = actorClass.projectile || null;
    if ((character as any).projectile) projectile = (character as any).projectile;
    if (item.projectile) projectile = item.projectile;
    if ((character as any).tskin === "konami") projectile = "stone_k";
    var definition = G.skills && (G.skills as any)[skill] || {};
    if ((skill !== "attack" || !projectile || skill === "heal") && definition.projectile) projectile = definition.projectile;
    return projectile;
    }
  function tinyProjectileProtected(target: any, skill: any) {
    if (!t.nativeAttackProjectile(skill)) return true;
    var x = Number(target.real_x !== undefined ? target.real_x : target.x);
    var y = Number(target.real_y !== undefined ? target.real_y : target.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return Object.values(parent.entities || {}).some(function (field: any) {
      return field && field.mtype === "fieldgen0" && field.visible !== false && !field.dead && field.hp > 0 &&
        (!field.map || field.map === character.map) && (!field.in || String(field.in) === String(character.in || character.map)) &&
        Math.hypot(Number(field.real_x !== undefined ? field.real_x : field.x) - x,
          Number(field.real_y !== undefined ? field.real_y : field.y) - y) < GAME_FIELD_REACH;
    });
    }
  function rareAttackAllowed(target: any, skill: any) {
    if (!target) return false;
    if (target.mtype === "fieldgen0") return false;
    if (target.mtype !== "tinyp") return true;
    // Native escapist monsters warp before an unprotected projectile lands.
    // Keep genuine melee attacks eligible when the boss leaves the field.
    if (skill === "attack" && !t.tinyProjectileProtected(target, skill)) return false;
    if (t.isPassingEncounter(target) || skill === "attack" && t.passingTarget() === target) return skill === "attack";
    if (!t.view().rareTarget || t.view().rareTarget.id !== target.id || skill !== "attack") return false;
    return !t.view().rareActive || !t.view().rareControlNow.deployer;
    }
  return { ownedRareTarget, rareTarget, nativeAttackProjectile, tinyProjectileProtected, rareAttackAllowed };
}
