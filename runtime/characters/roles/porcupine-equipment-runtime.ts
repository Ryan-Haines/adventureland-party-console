import { createPorcupineEquipment, type WeaponItem, type WeaponMemory } from "./porcupine-equipment.ts";
import type { CombatRoot } from "./types.ts";

export function installPorcupineEquipment(root: CombatRoot) {
  const host = parent as unknown as { __partyPorcupineEquipment?: WeaponMemory };
  const memory = host.__partyPorcupineEquipment ??= {};
  const data = G as unknown as {
    items: Record<string, { wtype?: string; class?: string | string[] } | undefined>;
    classes: Record<string, { mainhand?: Record<string, unknown>; doublehand?: Record<string, unknown> } | undefined>;
  };
  const definition = () => data.classes[character.ctype];
  const classSupportsBow = () => !!definition()?.mainhand?.bow || !!definition()?.doublehand?.bow;
  const fingerprint = (item: WeaponItem | null) => {
    if (!item) return null;
    const result: WeaponItem = { name: item.name };
    for (const key of ["level", "p", "stat_type", "data", "rid", "b", "m", "l", "v"])
      if (item[key] !== undefined) result[key] = item[key];
    return result;
  };
  root.partyPorcupineEquipment?.stop();
  return root.partyPorcupineEquipment = createPorcupineEquipment({
    now: Date.now,
    hands: () => ({ mainhand: character.slots.mainhand as WeaponItem | null, offhand: character.slots.offhand as WeaponItem | null }),
    items: () => character.items as (WeaponItem | null)[],
    fingerprint,
    same: (item, wanted) => JSON.stringify(fingerprint(item)) === JSON.stringify(fingerprint(wanted)),
    usableBow(item) {
      const info = data.items[item.name];
      if (info?.wtype !== "bow") return false;
      const classes = typeof info.class === "string" ? [info.class] : info.class;
      return (!classes || classes.includes(character.ctype)) && classSupportsBow();
    },
    twoHanded: item => !!definition()?.doublehand?.[data.items[item.name]?.wtype || ""],
    equip: (index, slot) => Promise.resolve(equip(index, slot)),
    unequip: slot => Promise.resolve(unequip(slot)),
    report(message) {
      if (root.partyCombatState) {
        root.partyCombatState.error = message;
        root.partyCombatState.errorAt = Date.now();
      }
    },
  }, memory);
}
