# Collateral convoy defense failure inventory

Live death recovery repeatedly stopped at UHills (-315,-170). Native CODE
reported recent Targetron defensive hits while every engaged visible monster
targeted outsider Jinori, no current party attackers, and no selected party
combat target. The role correctly respected external claims, but the hit listener
repeatedly stopped walking, collected loot, and restarted the same route.
Native 17665 Targetron defines explosion 15; upstream hit processing marks these
collateral packets `splash: true` and `unintentional: true`.

Filter only explicit splash packets from a visible native aggressor whose
current target is an identified nonparty player. Preserve direct hits, actual
party-target aggression, missing aggressors and unknown target safety. Do not
change external claims, route deadlines, loot acknowledgements or farm bounds.

The native journey declares initial Targetron stats/target and an outsider
merchant's stand position. The upstream monster produces the real hits. Require
positive splash receipts, an owned convoy's actual arrival, and a separate
party-target control that retains native defensive interruption. Preserve native
positions, hit receipts and ownership reports even on failure.

The first native run failed during setup: Main (400,-120) had no native route,
and direct assignment of monster.target skipped the upstream target_player
initialization. Use the native Town spawn with a collision-clear endpoint and
the upstream target_player admission while the initial stats are declared.
The hit recorder already includes native hit packets; do not fabricate receipts.
