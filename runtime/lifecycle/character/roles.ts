// The role runner composition: each owner's install and stop in order, each install with its owner's
// run scope handle (`lifecycle.scope`). Moved from runtime/characters/roles/runner.ts.
import { installPorcupineEquipment } from "../../characters/targeting/api.ts";
import { installTurns, type TurnsInstall } from '../../characters/turns/api.ts';
import { installTargeting } from '../../characters/targeting/api.ts';
import { effectiveAttackDamageType } from '../../characters/targeting/api.ts';
import { createCrabRangeRecovery } from '../../characters/targeting/api.ts';
import { installSurvival } from '../../characters/survival/api.ts';
import {installQueueClient} from '../../characters/targeting/api.ts';
import {installQueueMarkers} from '../../status/character/api.ts';
import {installLootClient} from '../../hunting/api.ts';
import type { SelectionPass } from "../../characters/targeting/api.ts";
import type { Role, CombatRoot, Target } from "../../characters/turns/api.ts";
import { errorReason, defaultRole } from "../../characters/turns/api.ts";
import type { SkillsAllowsAsk } from "../../hooks/registry.ts";
import { partyHooks } from "../../hooks/index.ts";
import { scope } from "../api.ts";
export function installRoleRunner(
  classRole: Partial<Role>,
  root = globalThis as unknown as CombatRoot,
) {
  root.partyRoleRunner?.stop();
  let equipment: ReturnType<typeof installPorcupineEquipment> | null = null;
  function resolvedRole(): Role {
    return { ...defaultRole, ...classRole };
  }
  let started = false;
  let active = true;
  // The movement owner's tick, started and stopped with the runner's timers (movers.ts).
  let stopMovementTick: (() => void) | null = null;
  let turns: TurnsInstall | null = null;
  let survival: ReturnType<typeof installSurvival> | null = null;
  let targeting: ReturnType<typeof installTargeting> | null = null;
  // The spend table (the turns owner's `skills.allows`): the selection asks it in place of
  // today's `combatAllowed` and `passingTarget` gates.
  const allows = (ask: SkillsAllowsAsk) => !partyHooks().skills.allows(ask);
  // The targeting owner's selection pass, over the module shared.js built
  // at load: the runner hands it its reads and binds what the turns owner and the movement tick ask.
  // shared.js loads first (legacy-entry.ts), so a runner with no module stops here, before any timer.
  if (!root.sharedRoutine?.targeting) throw new Error("Shared party code is not ready; refusing to start combat timers");
  const queueClient = installQueueClient(root, root.sharedRoutine, scope('04','act'), (hook, payload) => { partyHooks().notify(hook, payload); });
  const queueMarkers = installQueueMarkers(root.partyStatus.character.queueMarkers);
  const lootClient = installLootClient(root, root.partyHunting);
  const selection: SelectionPass = root.sharedRoutine.targeting.selectionPass({ root, allows, reset: () => { turns?.reset(); queueClient?.reset(); },
    retire: () => targeting?.retire ?? null, covers: (target: Target) => !!targeting?.skip.covers(target),
    equipment: () => equipment, notify: (hook: 'targeting.changed' | 'targeting.passed', payload: Record<string, unknown>) => partyHooks().notify(hook, payload),
    follow: (ask: { character: string }) => partyHooks().ask('movement.followIfFar', ask), errorReason });
  const { attackTarget, currentTarget, passingTarget, dropTarget, reportError } = selection;
  function startTurns() {
    const hooks = partyHooks();
    // The crab range recovery is targeting's, one per install:
    // targeting adopts its corrected distance and books its rejections.
    const recovery = createCrabRangeRecovery();
    // The targeting owner answers `targeting.target` and
    // `targeting.allows` from today's selection and gates, read through these ports.
    targeting = installTargeting(root, { hooks, attackTarget, currentTarget, passingTarget,
      selected: selection.selected, drop: dropTarget, due: selection.due,
      equipmentBusy: () => !!equipment?.busy(), world: () => turns?.skills.gateWorld() ?? null,
      pullSafe: (w, t) => !turns || turns.skills.pullSafe(w as Parameters<TurnsInstall['skills']['pullSafe']>[0], t),
      module: sharedRoutine.targeting, recovery, state: () => root.partyCombatState });
    // The survival owner installs before the turns owner's sources, so the
    // pass asks its needs first, in today's chain order.
    survival = installSurvival(root, { hooks, character: sharedRoutine.survival, turns: () => turns?.turns as never, state: () => root.partyCombatState as unknown as Record<string, unknown>,
      dead: () => { selection.respawned(); turns?.reset(); } });
    // The turns owner: its install takes the selection's reads.
    turns = installTurns(root, { hooks, scope: scope('03', 'act'), epoch: selection.epoch, active: () => active, role: resolvedRole, state: () => root.partyCombatState,
      target: attackTarget, selected: () => attackTarget()?.id || null,
      passing: target => target.id !== currentTarget()?.id && target.id === passingTarget()?.id,
      preparePassing: target => queueClient?.preparePassing(target) ?? false, equipmentBusy: () => !!equipment?.busy(),
      recovery,
      damageType: () => effectiveAttackDamageType(character, typeof G === 'undefined' ? undefined : G), report: reportError });
  }
  return (root.partyRoleRunner = {
    hasStartedTarget: selection.hasStartedTarget,
    engagedTargetId: selection.engagedTargetId,
    isKnownDead: selection.isKnownDead,
    retiring: (id: string) => !!targeting?.retire.retiring(id),
    invalidateTarget: selection.invalidateTarget,
    wake: selection.wake,
    advanceTarget: selection.advanceTarget,
    resetTargeting: selection.resetTargeting,
    role: function () {
      return resolvedRole();
    },
    start: function () {
      if (!root.sharedRoutine || !root.partyTurns)
        throw new Error("Shared party code is not ready; refusing to start combat timers");
      if (started) return;
      started = true;
      startTurns();
      equipment = installPorcupineEquipment(root, () => targeting!.reflect());
      game_log(character.name + " loaded generic " + resolvedRole().name + " behavior", "#51D2E1");
      active = true;
      // The selection's target timer is the targeting owner's `act` registration.
      selection.start(scope('04', 'act'));
      root.partyCombatState = { at: Date.now(), stage: "start", error: null };
      // The loot pass is the items owner's (runtime/items/character/market.ts), an `act` registration of its
      // run scope handle.
      root.partyItems.loot.start(reportError);
      // The movement owner's tick runs the movers in the mover table's order with these reads of the runner. The
      // tick is movement's `act` registration, so table P holds it; `held` is the tasks owner's hand hold (Manual).
      stopMovementTick = root.partyMovement.startMovementTick({
        held: () => !!root.partyTasks.holds.handControl(), equipment: selection.equipmentTick,
        reselect: selection.reselect, target: currentTarget, refresh: selection.refresh, report: reportError,
      });
      selection.wake();
      // The member's death recovery is survival's. It steps on each completed
      // status report and on the game's `player` and `death` packets (survival/install.ts `start`).
      survival?.start();
    },
    stop: function () {
      turns?.stop();
      turns = null;
      survival?.stop();
      survival = null;
      targeting?.stop();
      targeting = null;
      equipment?.stop();
      queueClient?.stop();queueMarkers?.stop();
      lootClient?.stop();
      active = false;
      selection.stop();
      stopMovementTick?.();
      stopMovementTick = null;
      root.partyMovement.resetCombatMovement();
      root.partyItems.loot.stop();
      started = false;
    },
  });
}
