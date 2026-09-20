# Party escape

Escape controls the configured warrior, mage and priest; the merchant and saved event preferences are unchanged. The dashboard polls `/party-api/escape`. POST to that endpoint starts an operation; POST `/party-api/escape/resume` releases it. A new Town, travel, or monster-navigation command also releases it.

The mage Blinks to an outdoor Town spawn or a map door/transporter landing, ranking visible threat clearance before proximity. Door landings are offset to avoid automatically crossing a portal. Walkability is checked, but unseen monsters can still make a landing dangerous. The mage waits for the warrior's arrival before requesting the priest. Invitations require the current operation's mage, recipient, and stage.

During rescue, mage potions prioritize any missing MP. Warrior MP target is Hardshell plus two Dashes; priest target is Curse plus Party Heal plus Heal. Targets account for MP reduction and are capped at maximum MP. Warrior/priest use HP potions once their MP target is met. Shared potion cooldowns remain enforced. Priest healing takes priority over Curse, which only targets an existing party attacker. Warrior uses Hardshell and collision-checked retreat Dashes. Emergency behavior stops per rescued fighter.

Deaths, missing roles, disconnection or the 30-second deadline fail the escape. The error remains below the button. Fighters respawn and use map-exit recovery to reach Main, then the convoy system regroups them at (0, 0). Blocked recovery remains visible rather than being reported complete. Restarting the coordinator during rescue enters recovery.

Success and recovered failure both retain a movement/combat hold until Resume automation or explicit movement. Normal regeneration and priest healing continue while holding. The operation ID invalidates stale local casts and invitations; recovery movement uses cancellation guards so late cleanup cannot stop a replacement route.

Tests use simulated snapshots and skill calls; validation must not trigger a live escape, change event attendance, or intentionally kill characters.

After a death or failed rescue, survivors continue independently toward Main (0,0); casualties respawn. Emergency potion and defense pulses run independently of pending travel. A living mage can Blink to a same-map exit/Town landing before continuing. Recovery regrouping waits until every participant is alive and has reached safety; a casualty does not disable survivor defenses. The original failure remains visible.
