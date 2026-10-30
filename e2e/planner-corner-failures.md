# Planner corner edges: failure inventory

Written before the fix for [#147](https://github.com/Ryan-Haines/adventureland-party-console/issues/147).
The journey is `live-planner-corner.spec.ts`.

1. **The planner returns an edge the game rejects (seen live, 10-18).**
   `alpathfinder` 0.6.0 accepts main (135, 72) → (153, -51) through the
   building wall at x=144, and `getPath` returns it unchecked as the first edge
   of the route from there to the tunnel door. The client's `can_move` rejects
   it, so every such journey first spends a bounded repair. In 122 sampled
   Mainland routes, 16 (13.1%) carried such an edge, from 8 corners. The E2E
   game (15555) plans the same route with the same rejected edge.
   Expected: the planner worker checks every same-map walking edge with the
   game's own `can_move` for the request's base and replaces a rejected one
   with a detour that passes, so the route it returns validates as planned.
   **live**: the plan from (135, 72) to the tunnel door has no edge the game
   server's `can_move` rejects.
2. **Shared routes run out of repairs.** A party `/travel` route gets three
   repaired endpoints, then fails with "Shared connector repair failed".
   Expected: a corner-cutting route never reaches the client.
   **live**: both fighters travel from (135, 72) to the tunnel door with no
   "Repairing rejected walking segment" entry and arrive.
3. **No detour exists.** Some rejected edges may have no single intermediate
   point that passes both legs. Expected: the edge is left as it is and the
   client's repair remains the backstop; the plan does not fail and is not
   slower than the 2 s planning budget allows.
4. **A detour changes behaviour elsewhere.** Ways the fix could fail:
   - A valid edge is rewritten (only edges `can_move` rejects may change).
   - The detour leaves the map, enters a door, or crosses an instance.
   - Collision is checked with the wrong base, so heavier or lighter
     characters still get rejected edges.
   - The worker cannot load the game's functions (missing or failing source)
     and stops planning; it must plan as before without the check.
5. **A replaced planner worker loses collision sources.** Retain the installed
   source pair alongside each prepared geometry so automatic worker recreation
   uses the same native validation. Keep detour points in their source instance
   and use the shared Geometry contract for the requested movement footprint.

Integration validation also sends the other six reported corner pairs and two
additional footprints through the real movement-plan HTTP endpoint, checking
every returned walking edge with the native server's can_move. The party must
then arrive within 35 units of the tunnel approach with no client repair log.
