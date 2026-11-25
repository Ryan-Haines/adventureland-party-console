# Class combat skills

The class policies in `runtime/characters/turns/skills/` use the installed `G.skills`
catalog for unlocks, costs, cooldown families, stat requirements and equipment.
They extend typed-adventureland 0.0.57 only for the verified September 2026
Paladin/Fan of Knives fields. Review those extensions when upgrading the package.

## Ownership and scheduling

The configured leader owns Taunt and Absorb Sins. Warrior followers never taunt,
including porcupine pulls. A priest leader can absorb any threatened combat ally,
including another priest, without a low-HP prerequisite. Transfers require fresh
observations, enough MP for a subsequent heal, and a two-second incoming-damage
projection leaving more than 30% HP. Unknown attack rates defer protection.
Paladins protect allies with Guardian's Oath without changing monster targets.

Melee formation behavior applies to warriors, paladins and rogues with short
weapon range. Queue observations no longer let a warrior replace the leader as
the designated fighter. Healing coverage still uses an available priest;
compositions without one use the existing leader anchor.

The turns owner (`runtime/characters/turns/`) makes every cast. Its attack source
chooses between the basic attack and the attack-cooldown skills; the engine's
choices and the class decisions are requests too. Once per pass the owner reads
its hold table (`rules.ts`), sends the highest request of each ready cooldown
family, and books the reply; a reply that never comes counts lost after the
cooldown and the largest recent round trip. The role loop runs a pass on each
game event that can change a need (`turns/loop.ts`), not on a timer. Every cast
rechecks eligibility, targeting's gates, range and MP. Multi-target skills
receive explicit target IDs and settle queue evidence per accepted target; a
skill whose game data names no target, such as Cleave, is sent with none.

## Mana and damage

Optional damage preserves survival MP: paladins retain the greater of 30% or two
Self-Heals plus Guardian's Oath; priests retain the greater of 35% or two heals
plus Party Heal; rogues/rangers retain 20%. Only unlocked, equipped skills count
toward the reserve. Warrior leader reservations include Taunt and usable emergency
defenses. Emergency healing/protection can spend below the optional reserve, and
so can a cast the server centres on the caster (Cleave) while it hits two or more
monsters that attack the party in Default or an event, or at Franky (Ryan's 1.5
Cleave).

One damage ranking (`skills/ranking.ts`, REVIEW-QUEUE TRN-Q-DPS) chooses every
class's damage casts at each action edge, from that edge's reports; it keeps no
plan between edges. It has no class or skill branch: each skill joins by its game
data and the server's handling of it (`skills/server.ts`, read from the pinned
server). An
option's worth is the party's useful damage over a horizon as long as the longest
cooldown among the character's options: damage on every target it hits that
targeting's gates allow, capped by each target's remaining HP and the party's hits
in flight, plus what a damage-taken condition (Curse, Hunter's Mark) adds, less
what it strips (Purify) and less the Energize casts it silences by leaving the
mage at its reserve. The MP over the horizon (MP above the reserve, observed
income over the last 30 seconds, and an MP potion only where survival's potion
table drinks one) goes to the options by damage per MP, each up to the casts its
cooldown allows; an option still waiting for MP holds cheaper spends behind it.
Mana Burst spends the whole pool, so it goes only when income, the potion and an
Energize coming to the caster bring the reserve back within the horizon. An
Energize is coming when an ally's status report shows one set on this character,
from within Energize's range and ready within the horizon (the game's
`next_skill`); it counts at its ready time, and one set on another member counts
nothing. Each report also carries the damage per MP of the best option its
ranking left short of MP, and an Energize a cast would silence counts the MP it
moves at that ally's figure. Controlled Mana Burst sends `[id, mp]` pairs: each
target gets the MP whose lowest roll covers its remaining HP, from the MP above
the reserve. A hit whose skill has `procs` counts the splash of the attacker's
`explosion` or `blast` on monsters near its target, and a cast whose splash would
reach a refused monster is refused as an area cast is. A class that heals spends nothing on damage
while a member reads below the healthy share. For a caster-centred cast the
ranking may ask movement's combat step for a spot on an allowed monster where the
cast hits only monsters it may hit, when the gain pays for the travel and
survival's danger reading passes; an unengaged monster there counts only when the
cast kills it for certain (the server's lowest roll, no miss chance) and
targeting refuses it only because nobody engaged it. A monster that respawns as
another on death (game data `respawn_as`) never counts that way. Targeting's
group lock and Franky rows let through the victims of any skill whose damage the
server lands around the caster (Cleave, Shadow Strike).

Damage comparisons account for armor/resistance, piercing, critical eligibility,
Rogue Stack, fortitude and reported incoming-damage amplification. Pure damage is
exact: no roll, crit or defence. Conservative executes exclude criticals and use
the low damage roll.
## Skill decisions

| Class | Skill | Policy |
|---|---|---|
| Warrior | Warcry | Maintain when its own effect is absent and cooldown is ready; emergency defense takes priority and survival MP is reserved. |
| Priest | Dark Blessing | Maintain when its own effect is absent and cooldown is ready; aggro rescue and healing take priority and healing MP is reserved. |
| Ranger | 3-Shot (60), 5-Shot (75) | Choose useful damage across authorized targets; five-shot is not automatically better against three targets. |
| Ranger | Piercing Shot (72) | Replace a basic shot only when the armor-piercing result is better. |
| Ranger | Supershot | Ranked like any skill; remaining HP caps its damage. |
| Ranger | Hunter's Mark | Ranked by the damage its `marked` condition adds; none while a mark holds. |
| Ranger | Poison Arrow | Disabled: consumes poison. |
| Ranger | Track, 4 Fingers (64) | Player detection/control; no automatic PvE use. |
| Rogue | Fan of Knives (65) | Equipped Knife Belt required; up to five explicit targets, compared with basic attack. |
| Rogue | Mental Burst (64 INT) | Ranked like any skill, magical damage through resistance. |
| Rogue | Quick Stab, Quick Punch | Require dagger/fist respectively; share one cooldown lock. |
| Rogue | Invisibility | Unengaged opener; never drop active tank responsibility. |
| Rogue | Swiftness (40) | Maintain self/party buffs; one rogue owns refreshes. |
| Rogue | Stack | Passive damage estimate, never a cast. |
| Rogue | Poisonous Touch, Shadow Strike (70) | Disabled consumable skills. |
| Rogue | Pickpocket (16) | No automatic player-item theft. |
| Paladin | Self-Heal | Below 70% HP or at least 80% of its level-scaled heal would be useful. |
| Paladin | Mana Shield | Enable under 40% HP with incoming damage and surplus MP; release above 65% or at the reserve. |
| Paladin | Aether Shield (60) | Safe magical pressure with missing MP; emergency Mana Shield takes precedence. |
| Paladin | Cleansing Light (30) | Cleanse affected allies, never self; urgent conditions can spend reserved MP. |
| Paladin | Guardian's Oath (50) | Endangered ally only, safe projected shared damage, no duplicate links. |
| Paladin | Beacon of Resolve (70) | Multiple allies under attack or a leader facing imminent danger; no redundant refresh. |
| Paladin | Aura (60) | Leader-first defensive coverage; followers prefer complementary auras. Ten-second change hold. |
| Paladin | Purify (60) | Ranked by its pure damage less the damage-taken debuffs it strips. |
| Paladin | Shield Slam (60) | Equipped shield; armor-scaled damage, ranked like any skill. |
| Paladin | Smash (10) | Equipped mace; independent damage filler. |

Ordinary grouped combat includes only the committed target and already engaged
authorized threats. Scatter can add farm targets only when the combined pull
passes survival checks. Goobrawl and other events retain their target authorization.
A/B Testing keeps its existing strategy; the new PvE policies cannot attack players.
Travel, recovery and rare-monster restrictions remain authoritative. This feature
does not purchase consumables or add automatic equipment changes.

## Diagnostics and activation

`combat.runner.skill` reports the last decision's skill, target IDs, reserve,
spending category, result and skip reason through the existing heartbeat.
Use `class-skills.test.cjs`, `priest-absorb-sins.test.cjs`, the attack/movement tests,
and the full regression suite. Build with `npm run build:runtime` and
`npm run build:characters`; activate character and coordinator changes with the
ordinary `scripts/start-console.ps1` workflow. A coordinator-only restart cannot
activate these character policies.
