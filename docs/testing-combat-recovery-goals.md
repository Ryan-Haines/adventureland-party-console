# Hitbox-aware terrain recovery goals

Failure inventory, recorded before implementation:

- Melee recovery around a large Phoenix can produce zero goals because attack reach is an edge distance but the sampling circle uses a center distance.
- A short native warrior reach (23 units) can be exceeded by the old safety-plus-12 margin (26 units). Recovery goals must stay inside actual weapon reach without weakening monster safety exclusions.
- Small monsters can reject every melee goal for the same reason.
- Feet-based vertical coordinates make above and below offsets asymmetric; adding half-height uniformly is incorrect.
- Solving only for the selected monster must not admit goals inside another monster's safety radius or inside terrain.
- Ranged recovery must continue to offer goals within native attack reach.
- A +100 fixture priest weapon inflates attack range enough to engage a Phoenix 425 units away immediately, bypassing planned terrain recovery. Use native ordinary-range weapons with defensive survival gear for this scenario.
- Recovery goals must remain finite and deterministic when native dimensions are absent.

Validate native party recovery around blocked approaches and retain actual goal coordinates, native hitbox distances, terrain checks and attack receipts in the focused combat E2E artifacts. A route proposal alone does not establish successful combat recovery.

The native journey observes read-only goal calculations through the existing `sharedRoutine.terrainRecoveryPorts()` consumed by the real recovery client, only when the actual selected encounter is the visible seeded Phoenix. Local combat recovery can now reach the target without requesting a coordinator-wide pause; therefore pause admission is not required to observe this geometry. Every retained goal must satisfy native hitbox distance, collision, safety and weapon reach, followed by an actual warrior attack receipt.
