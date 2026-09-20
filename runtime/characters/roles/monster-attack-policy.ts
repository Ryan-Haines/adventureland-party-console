const reflectors = new Set(["slenderman", "tiger", "goblin"]);

/** Server retaliation depends on damage type and range stat, not proximity. */
export function monsterAttackBlock(
  monster: string | undefined,
  damageType: string | undefined,
  range: number,
): string | null {
  if (monster === "porcupine" && damageType !== "magical" && damageType !== "pure" &&
      !(Number.isFinite(range) && range >= 75))
    return "Porcupine damage return: physical attacks require range >= 75";
  if (reflectors.has(monster ?? "") && damageType !== "physical" && damageType !== "pure")
    return "Monster reflection: magical basic attacks disabled";
  return null;
}
