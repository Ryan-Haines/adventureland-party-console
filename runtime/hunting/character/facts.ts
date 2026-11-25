// The hunting owner's character port: the facts the hunting owner's rows
// for other owners read on the character (the turns rows, the targeting
// reads, survival's farm half) in place of the clients' state. The coordinator is the one
// runtime that answers `farming.focus` and `cave.state` (hunting/coordinator/install.ts); no
// character add-on asks them, so this object registers no hook. Each fact is a getter over the
// client that holds it, so a reader pays only for the fact it reads.
import type { installFarmClient } from './farm.ts';
import type { installHuntClient } from './hunt.ts';
import type { installRareClient } from './rares.ts';
import type { installCaveClient } from './cave.ts';

export interface HuntingFactsPorts {
  character(): { cave?: { paused?: unknown } | null };
  farm: ReturnType<typeof installFarmClient>;
  hunt: ReturnType<typeof installHuntClient>;
  rares: ReturnType<typeof installRareClient>;
  cave: ReturnType<typeof installCaveClient>;
  // The loot client the role runner installs (character/loot.ts).
  lootClient(): { huntPending(): boolean } | null | undefined;
  // The party's reports (the targeting owner's `positions`), the party outside a Cave.
  positions(): object[];
}

export function installHuntingFacts(ports: HuntingFactsPorts) {
  const { farm, hunt, rares, cave } = ports;
  // The farming facts: the focus, the farm area, the Hunt's type, the party's type
  // and mode, the rare state, the Hunt's loot hold and the Hunt walk's defense.
  const focus = {
    get focus() { return farm.focus(); },
    get huntTarget() { return farm.huntTarget(); },
    get partyType() { return farm.partyType(); },
    get mode() { return farm.mode(); },
    contains: farm.inArea,
    inRadius: farm.inRadius,
    rare: {
      get active() { return rares.active(); },
      get control() { return rares.control(); },
      get ownsWalk() { return rares.ownsWalk(); },
      candidate: rares.candidate,
    },
    get lootPending() { const loot = ports.lootClient(); return !!(loot && loot.huntPending()); },
    get huntDefense() { return hunt.defense(); },
  };
  // The Cave facts for this member: inside the Cave, owned by a Cave visit (inside, or its runtime
  // owns the character outside), the runtime's ownership alone, the Cave's pause, and the party
  // survival reads: the Cave floor's members inside a Cave, else the party's reports.
  const caveState = {
    get inside() { return !!ports.character().cave; },
    get owned() { return cave.owned(); },
    get runtimeOwns() { return cave.runtimeOwns(); },
    get paused() { const inside = ports.character().cave; return !!(inside && inside.paused); },
    members: (): unknown[] => ports.character().cave ? cave.partyMembers() : ports.positions(),
  };
  return { focus, cave: caveState };
}
