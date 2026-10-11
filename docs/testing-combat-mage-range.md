# Mage selected-target range recovery

Before changing scoring, validate these failure modes: a fast selected enemy's
predicted safety radius must not outrank getting within the mage's attack range;
other enemies must retain their avoidance priority; a mage already within range
must still prefer safe separation from its target; priest and warrior scoring
must remain unchanged; terrain-blocked movement must recover through the shared
combat recovery workflow rather than interpreting this scoring change as routing.

Native regression: grouped Phoenix combat with a level-80 mage, priest and
merchant. Record the mage's selected target, actual range, distance, movement and
successful native attack receipts over a bounded encounter. Require the mage to
enter its own range and attack instead of indefinitely settling outside range.
Retain the scenario timeline and terminal status as repeatable artifacts.

Fixture failure inventory: the requested mage class must be persisted before
native login, its weapon must come from the native mage base slots, and the
native server must calculate range/stats. Do not mutate a connected character's
class or fabricate attack receipts. Seed a single durable-HP Phoenix initially
outside the mage's range, preserving native speed, range and combat handlers.
The default +100 class weapon inflates mage range to 483 and can seed the
encounter outside visibility; use a native level-zero weapon with durable armor
and assert normal range before admitting the encounter.
