# Formation reach of monsters attacking a teammate: failure inventory

Written before the change (#121; found by Icelocked on Spooky Town booboos in #39).
`formationMonsterSafety` (characters/shared.js) reserves a no-go radius around each
monster for the formation solver. A monster that outranges the character keeps its full
reach (`range + 8`) unless it has no target at all, even while it is attacking a
teammate. Live journey: W22's C18 step (`e2e/windows/W22-main-terrain-fights.spec.ts`).

1. **Fenced out.** Two long-range monsters side by side attack the warrior; the mage
   must stand within its range of the selected one and 428 from the other, finds no
   point, holds as "formation-blocked" and never attacks.
2. **Own attacker ignored.** A long-range monster that targets the character itself
   loses its reach and the character walks into it.
3. **Idle monsters changed.** An outranging monster with no target stops getting the
   38-unit radius.
4. **Melee and selected monsters changed.** Monsters whose range does not exceed the
   character's, or the selected target, get a different radius.
5. **Retarget not honoured.** When a fenced-off monster switches to the character, its
   full reach does not come back on the next tick.

Fixture-owned native monster IDs are recorded immediately after creation and removed only after retained evidence, including setup failures. No live deployment is part of this change.
