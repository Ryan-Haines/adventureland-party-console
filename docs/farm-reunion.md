# Farming reunion

Combat-party respawns and individual event returns use explicit reunion recovery.
An eligible survivor must be alive, on the same realm and farm map, within 800
units of the authorized farm waypoint, and have a status less than 10 seconds old.
This is independent of the monster search radius. Merchants and bankbois are excluded.

Event re-entry, anniversary staging, Town overrides and convoys keep priority.
New navigation commands cancel the old recovery. Pending recovery survives shared
code hot reloads; `farmReunion` in character status reports its phase and last error.

Magiport requests use a party-only CM request/offer/ready handshake, tied to the
recovery ID, navigation revisions and a 10-second expiry. Only the designated mage's
invitation is accepted. Each recovery requests one pull; timeout falls back to walking.
The mage rechecks eligibility before casting and must retain 10% of maximum MP.
Only ordinary map travel is eligible; bank and event-instance pulls are excluded.

Cross-map fallback uses normal smart navigation. On the destination map, a mage
may Blink once per travel attempt if more than 300 units away, with a reachable
landing point and 30% maximum MP left after the effective skill cost. Failed Blink
falls back to walking. Travel attempts time out after 90 seconds, stop their path,
and retry after 10 seconds. Pending recovery rechecks missing teammates every 5 seconds.

Reunion requires actual proximity within 150 units of the eligible teammate.
Individual event-return commands additionally require the saved destination's
arrival check before completion is reported. Magiport never completes a convoy.

Potion thresholds are unchanged: mage/priest HP below 50%, MP below 20%, with HP
priority and the existing shared cooldown. Occupied recovery continues passive
regeneration; it does not assume an MP potion can be consumed immediately.
