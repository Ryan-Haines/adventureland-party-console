# Engaged-target terrain detour failure inventory

Before implementation, validate these risks through native combat journeys:

- Inflated fixture weapons can turn a warrior into a ranged fighter and hide
  melee approach failures. Use the combat-range loadout and verify range <100
  before treating native damage as evidence of melee terrain recovery.
- Ambient monsters can claim the party's committed fight before the seeded
  encounter. Suppress native spawn regions and remove existing ambient monsters
  before setup, wait for clients to retire their observations, and restore held
  native respawns in cleanup.
- Repeated full-character snapshots include inventory and runtime state and can
  produce excessive evidence. Poll only coordinates, ranges, HP, targets, and
  compact positioning diagnostics; retain actual native hit receipts separately.
- A bearing approach point is blocked even though another side of the same target is reachable; the fighter must reach attack range rather than hold indefinitely.
- A selected open-side goal must survive subsequent formation ticks instead of switching back to the blocked bearing point.
- Both legs of a local detour must retain native terrain and monster-clearance checks.
- A healthy unattacked melee fighter may temporarily leave priest coverage while its target attacks another party member.
- A fighter being attacked, a fighter below 60% HP, ranged classes, and the priest must retain coverage restrictions.
- A target switch or map/instance change must discard the old local detour.
- A moving target must invalidate an old open-side goal when it moves materially,
  while a stationary target must preserve that goal as the fighter rounds a wall.
- Reengaging a new target must admit a new approach rather than reuse a previous
  target's held formation segment or healing escort destination.
- The ordinary formation optimizer must not inherit the temporary coverage exemption.

Record native positions, target identities, movement owners, HP, and the geometry
of the blocked and reachable paths in repeatable test artifacts. Require clear,
combat-owned segments that bend around the initially blocked bearing and actual
weapon damage on both target IDs. A particular diagnostic reason is not required
when the ordinary combat optimizer already finds the safe approach.
