import { requestObject, requestText } from "../http/contracts.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface Definition {
  stat?: unknown;
  grades?: number[];
}
interface Equipment {
  item: Item;
  meta?: { definition?: Definition };
}
interface Status {
  items?: ((InventoryEntry & Equipment) | null)[];
  slots?: Record<string, Equipment | undefined>;
  primaryStat?: string;
}
interface Mark {
  slot: string | number;
  item: Item;
  equipped?: boolean;
  statType: string;
  scroll: string;
}
interface StatState {
  merchantCharacter: string | null;
  statuses: Record<string, Status | undefined>;
  statScrolls: Record<string, Mark[] | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
}
interface Ports {
  persist(): void;
  queue(names: string[], reason: string): void;
}
type Request = Record<string, unknown>;
const primary = new Set(["str", "int", "dex", "vit"]);
const supported = new Set([
  ...primary,
  "for",
  "evasion",
  "reflection",
  "gold",
  "luck",
  "xp",
  "armor",
  "resistance",
  "speed",
  "lifesteal",
  "manasteal",
  "rpiercing",
  "apiercing",
  "crit",
  "dreturn",
  "frequency",
  "mp_cost",
  "output",
]);
function failure(error: string, status = 400): CommandOutcome {
  return { status, body: { error } };
}
function scrollName(stat: string): string {
  return stat === "mp_cost" ? "mpcostscroll" : stat + "scroll";
}
function requiredScrolls(item: Item, definition: Definition): number {
  const grades = Array.isArray(definition.grades) ? definition.grades : [9, 10, 11, 12],
    level = Math.max(0, Number(item.level) || 0);
  if (level >= (grades[2] ?? 11)) return 1000;
  if (level >= (grades[1] ?? 10)) return 100;
  return level >= (grades[0] ?? 9) ? 10 : 1;
}
function validSlot(body: Request, merchant: string | null): boolean {
  return (
    (typeof body.slot === "string" && /^[a-z0-9_]+$/i.test(body.slot)) ||
    (body.character === merchant && Number.isSafeInteger(body.slot))
  );
}
function count(entries: (InventoryEntry | null)[] | undefined, scroll: string): number {
  let owned = 0;
  for (const entry of entries || [])
    if (entry?.item?.name === scroll) owned += Math.max(1, Number(entry.item.q) || 1);
  return owned;
}
export function createStatScrollCommands(state: StatState, ports: Ports) {
  function available(scroll: string): number {
    const inventories = [
      state.statuses[String(state.merchantCharacter)]?.items,
      ...Object.values(state.bankSnapshot?.packs || {}),
    ];
    return inventories.reduce((owned, entries) => owned + count(entries, scroll), 0);
  }
  function supplies(
    body: Request,
    item: Item,
    definition: Definition,
    stat: string,
  ): CommandOutcome {
    if (body.remove === true || primary.has(stat)) return null;
    const required = requiredScrolls(item, definition),
      scroll = scrollName(stat);
    return available(scroll) < required
      ? failure("need " + required + " × " + scroll + " in merchant or bank inventory", 409)
      : null;
  }
  function save(body: Request, name: string, item: Item, inventory: boolean, stat: string): void {
    const list = (state.statScrolls[name] ||= []),
      index = list.findIndex(
        (entry) => entry.slot === body.slot && !!entry.equipped === !inventory,
      );
    if (body.remove === true) {
      if (index >= 0) list.splice(index, 1);
    } else {
      const mark: Mark = {
        slot: body.slot as string | number,
        item,
        ...(!inventory ? { equipped: true } : {}),
        statType: stat,
        scroll: scrollName(stat),
      };
      if (index >= 0) list[index] = mark;
      else list.push(mark);
    }
    ports.persist();
    if (inventory && body.remove !== true) ports.queue([name], "stat scrolls");
  }
  function validate(body: Request, equipped: Equipment, stat: string): CommandOutcome {
    const definition = equipped.meta?.definition;
    if (!definition || !Number(definition.stat))
      return failure("this equipment does not accept stat scrolls");
    if (!supported.has(stat)) return failure("unsupported stat scroll");
    const shortage = supplies(body, requestObject(body.item), definition, stat);
    if (shortage) return shortage;
    if (body.remove !== true && equipped.item.stat_type === stat)
      return failure("this equipment already has that stat scroll applied", 409);
    return null;
  }
  function selected(
    status: Status | undefined,
    body: Request,
    inventory: boolean,
  ): Equipment | undefined | null {
    return inventory
      ? status?.items?.find((entry) => entry?.slot === body.slot)
      : status?.slots?.[requestText(body.slot)];
  }
  function process(body: Request, item: Item, name: string, inventory: boolean): CommandOutcome {
    const status = state.statuses[name];
    const equipped = selected(status, body, inventory);
    if (!equipped || JSON.stringify(equipped.item) !== JSON.stringify(item))
      return failure(
        (inventory ? "inventory" : "equipped") + " item changed; refresh and try again",
        409,
      );
    const stat = requestText(inventory ? body.statType : status?.primaryStat || "").toLowerCase();
    const error = validate(body, equipped, stat);
    if (error) return error;
    save(body, name, item, inventory, stat);
    return null;
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item);
    if (
      body.type !== "stat-scroll-mark" ||
      typeof item.name !== "string" ||
      !validSlot(body, state.merchantCharacter)
    )
      return undefined;
    const name = requestText(body.character),
      inventory = name === state.merchantCharacter && Number.isSafeInteger(body.slot);
    return process(body, item, name, inventory);
  }
  return { handle };
}
