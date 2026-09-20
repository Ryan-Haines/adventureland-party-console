import type { Item } from './item';
export type DeconstructionMark = {
  id: string;
  origin: string;
  owner: string;
  slot: number;
  item: Item;
  quantity: number;
  state: string;
  error?: string;
  auto?: boolean;
};
export type DeconstructionCatalog = Record<
  string,
  { compound: boolean; cost?: number; rewards?: { name: string; quantity: number; chance: number }[] }
>;
// Matches the official server's dismantle handler: recipe rolls are independent;
// compounded items return three items at one lower level.
export function deconstructionRewards(item: Item, catalog: DeconstructionCatalog) {
  const definition = catalog[item.name];
  if (!definition) return null;
  if (definition.compound && Number(item.level) > 0)
    return [{ name: item.name, level: Number(item.level) - 1, quantity: 3, chance: 1 }];
  return definition.rewards?.map(reward => ({ ...reward, level: 0 })) || null;
}
export function canDeconstruct(item: Item, catalog: DeconstructionCatalog) {
  const entry = catalog[item.name];
  return (
    !!entry &&
    !item.l &&
    !(item as Item & { b?: boolean }).b &&
    (!entry.compound || Number(item.level) > 0)
  );
}
