# UHills mage combat reengagement

Failure inventory before scenario implementation: the mage can select an
engaged Targetron without entering range; a direct step can cross screenshot
terrain and never recover; ordinary following can move the character and hide
the missing combat recovery; inflated fixture weapon range can bypass the
reported geometry; fixture monsters can walk toward the mage and mask failure.

Start a real native mage near screenshot one's (-873, -405), using the pinned
server's nearest interior sMap cell (-830, -310) in UHills, with a
normal level-zero class weapon. Find a native clear blocked approach near the
reported (-573, -80) target position. The priest reaches a nearby position around
(-805, -224), within healing coverage of the mage and native attack range of the
target, through native smart movement. Its actual Targetron damage receipt
confirms engagement before the priest joins the mage-led formation; the parked
Targetron targets it. The mage owns the group and never has ordinary follow
enabled, so a Town or rendezvous route cannot mask missing combat recovery.
Remove existing background Targetrons with native `nospawn:true` and hold any
already scheduled native respawns as declared world setup, restoring held native
respawns in unconditional cleanup. Native `remove_monster` otherwise schedules
replacement monsters using their saved `map_def`, independent of edited catalog
region counts. This encounter isolates movement recovery from unrelated queue changes;
native targeting, selection, walking and attack handlers remain unchanged.
Use native `method:'disappear'` notifications, rather than silent removal, and
wait for both clients to retire background target identities before configuring
focus. Otherwise stale renderer entities can masquerade as active encounters.
The original screenshot coordinates are absent from this backend's precomputed
sMap even though the client collision check accepts them. Validate the native
starting cell before movement and require the mage to remain in UHills, so jail
admission failures cannot masquerade as a combat stall.
Require actual mage damage and movement nearer, retaining native positioning
samples, native hit receipts and a screenshot as repeatable artifacts.

Additional recovery failure: when the priest is inside the selected monster's
safety radius, routing directly to the priest invalidates every otherwise clear
two-leg detour. Mage regroup goals must instead admit collision-safe native
attack-range ring positions inside priest healing coverage. Keep other-enemy
avoidance and segment safety, retain the selected open side, and invalidate it
when the priest/target moves. Do not relax mage healing coverage to force a route.
