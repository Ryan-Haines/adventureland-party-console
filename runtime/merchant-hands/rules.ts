// The hands owner's rules: who holds the
// merchant's two hands, highest first.
// 1. A manual equipment command takes them at once, ending a gathering attempt; at its report its
//    hands become the normal record.
// 2. The gathering lease takes them when gathering arrives at its spot and no row 1 holder runs; it
//    ends when a command the lease does not own reaches `settle`.
// 3. Normal holds them whenever no lease is held.
// The owner's character half (character/owner.ts) reads these rules and nothing else decides them.

// The gathering tools are the weapon types the game's two gathering skills take: G.skills.fishing
// .wtype ["rod"] and G.skills.mining.wtype ["pickaxe"] (game data v18285). A tool is never the
// normal record.
type GatheringSkills = Record<'fishing' | 'mining', { wtype: string | readonly string[] }>;
export function gatheringTools(skills: GatheringSkills): string[] {
  return [skills.fishing.wtype, skills.mining.wtype].flat();
}

// What `settle` does with a command that reaches the hands: with no lease the command
// passes untouched; otherwise the lease ends and both hands go back to normal before the command
// runs. A `merchant-gather` never reaches settle: runner.accept answers it first
// (merchant-jobs/character/runner.ts accept).
export type SettleAnswer = 'pass' | 'restore';
export function settleAnswer(leased: boolean): SettleAnswer {
  return leased ? 'restore' : 'pass';
}

// A normal item: a tool or an item listed for stand sale is never normal.
export function normalItem(item: { name?: string } | null | undefined, listed: (item: unknown) => boolean, tools: readonly string[]): boolean {
  return !!item && !!item.name && !tools.includes(item.name) && !listed(item);
}

// The equipment types a dashboard equip may put on: character/owner.ts isDashboardEquipment
// accepts these, and the dashboard's Equip menu offers the same list through api.ts. They are the
// game server's can_equip_item types.
export const DASHBOARD_EQUIPMENT_TYPES: readonly string[] = ['helmet', 'pants', 'chest', 'weapon', 'amulet', 'earring', 'shoes', 'gloves',
  'ring', 'shield', 'belt', 'source', 'orb', 'quiver', 'cape', 'misc_offhand', 'tool'];
