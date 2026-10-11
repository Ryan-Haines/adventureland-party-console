# Targetron terrain combat recovery

Failure inventory recorded before adding the native regression:

- In the reported UHills layout near (-573, -80), a fighter can hold forever when terrain blocks its direct bearing to the engaged Targetron.
- Ordinary follower movement can conceal a broken combat detour; require combat-owned movement, native collision-clear segments, a path bending away from the blocked original bearing, and an actual weapon attack receipt. Successful optimizer steps need not enter the fallback detour mode.
- Inflated +100 weapon range can conceal healing-coverage constraints and skip meaningful approach movement. Use ordinary native weapon ranges with defensive survival gear.
- Screenshot coordinates can fall on a collision edge in the native catalog. Choose a collision-safe target near the reported priest position (-805, -224), retaining a blocked direct approach from the initial warrior position.
- A forced game-world encounter must preserve native hitboxes, movement collision, targeting and attacks. A stationary, durable encounter is declared fixture setup only.
- Tests must retain the selected coordinates, collision observations, combat positions and native hit receipts so the terrain scenario can be reproduced.
