# Skill card

A skill's details show two boxes in the game's item-card style
(`docs/item-card.md`) wherever the console shows a skill: the Class skills
dialog and the skill an item grants (the Zapper's "Ability: Zap" link in item
details). One component, `SkillCards`, renders both places.

- **Skill card** replicates the stat lines of the game's skill card
  (`render_skill` in the game's `js/html.js`), with the game's English labels
  (`interface.skill.*`): MP, Duration, Cooldown, Reuse Cooldown, a shared
  cooldown, Range, Level Requirement, Weapon and Offhand Requirement, Max,
  Passive, Damage Type, Condition, Output per level, HP loss to MP and Required
  stats. The game prints most of these in gray; the card colors each by its
  meaning from the shared palette (`docs/stat-colors.md`) instead: cooldowns
  `#4EB7DE`, Duration `#E1924D`, Range `#93A6A2`, Level Requirement orange, weapon
  requirements `#56A244`, Max `#FFDE2F`, Output `#D93319` and each Required
  stat in that stat's color. MP, Damage Type and Condition keep the game's
  colors. The surrounding header keeps the name, `G.skills.<id>` and
  the explanation, as the dialogs already show them.
- **Skill extras** holds the definition fields the game's card has no line for
  (target, hostile, projectile, damage multiplier and the like), with readable
  labels and Yes/No booleans, each label colored by meaning (Hostile red,
  Target light blue, Procs green, Projectile purple) or light gray.

They replace the raw definition grid. Everything else in both dialogs stays.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/skill-card.case.ts`.

1. The card drifts from the game's. Lines, labels, colors and order must match
   `render_skill`: Supershot reads "MP: 400", "Cooldown: 30 seconds",
   "Range: Character Range", "Range: 3X + 20", "Weapon Requirement: "Bow",
   "Crossbow"" and "Damage Type: Physical", with MP in the MP color.
2. Levelled values collapse. Party Heal shows one Output line per level
   ("Output: 600 (Lv. 60)"), and a level 0 value without the level.
3. Shared cooldowns lose the skill's name. 3-Shot reads "Cooldown: 1×
   Attack", naming the shared skill from the catalog.
4. A field from the old grid goes missing. Every definition field must appear
   on the card or in the extras box, except the name, skin and explanation the
   header shows.
5. The two places drift apart. The Class skills dialog and the item's skill
   link must render the same card and extras for the same skill.
6. The layout breaks. The boxes sit side by side when the panel has room and
   stack when it doesn't, with nothing scrolling sideways. The details panel
   animates its width, so the check waits for the layout to settle.
7. The card reads as a wall of gray. Its lines and the extras labels carry
   their meaning colors.
