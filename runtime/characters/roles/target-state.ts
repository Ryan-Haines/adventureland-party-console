import type { Target } from "./types.ts";

export function targetRejection(target: Target | null | undefined): string | null {
  if (!target || !target.visible) return "selected monster not visible";
  if (target.dead || target.rip) return "selected monster died";
  if (target.map && target.map !== character.map) return "selected monster on another map";
  if (!sharedRoutine.allowsTarget(target))
    return sharedRoutine.targetRejectionReason?.(target) ?? "target rejected";
  return null;
}
export function eligibleSelection(target: Target | null): Target | null {
  return target && target.visible && !target.dead && sharedRoutine.allowsTarget(target) ? target : null;
}
