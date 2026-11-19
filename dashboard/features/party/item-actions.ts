import { DASHBOARD_EQUIPMENT_TYPES } from "../../../runtime/merchant-hands/api.ts";
// The Equip menu offers the types the call budget owner's hands owner equips (merchant-hands/rules.ts
// DASHBOARD_EQUIPMENT_TYPES). Elixirs are consumed effects.
export function isEquipment(definition?: Record<string, unknown>): boolean {
  return DASHBOARD_EQUIPMENT_TYPES.includes(String(definition?.type || ''));
}
export function isUsable(definition?: Record<string, unknown>): boolean {
  return ['elixir', 'licence', 'spawner'].includes(String(definition?.type || '')) || Array.isArray(definition?.gives);
}
