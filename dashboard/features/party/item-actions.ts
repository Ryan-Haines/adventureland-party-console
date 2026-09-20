// Matches the game server's can_equip_item types. Elixirs are consumed effects.
const equipmentTypes = new Set(['helmet', 'pants', 'chest', 'weapon', 'amulet', 'earring', 'shoes', 'gloves', 'ring', 'shield', 'belt', 'source', 'orb', 'quiver', 'cape', 'misc_offhand', 'tool']);
export function isEquipment(definition?: Record<string, unknown>): boolean {
  return equipmentTypes.has(String(definition?.type || ''));
}
export function isUsable(definition?: Record<string, unknown>): boolean {
  return ['elixir', 'licence', 'spawner'].includes(String(definition?.type || '')) || Array.isArray(definition?.gives);
}
