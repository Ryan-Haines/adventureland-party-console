# Add-ons

An add-on is a feature the console does not ship, kept in its own folder under `runtime/addons/`.
It answers the console's hooks, reads any owner's published state, asks the owners for game
actions, keeps its own stores and adds pieces to the dashboard. The owner of each game call carries
out an add-on's action through its own door, after survival and under the call limit.

A bug fix in a console feature is not an add-on. Fix it in core, in the module that decides
wrongly, and send it to the console's repo.

The hooks, events, slots, actions, reads, movement tiers, spend ranks, setting kinds, published
functions and load refusals are all in [HOOKS.md](HOOKS.md), generated from the code. This guide
says how to use them and does not repeat them.

## Install and remove

- Install: copy the add-on's folder into `runtime/addons/`, then rebuild and restart the console
  the way the root README's "Making changes" describes for coordinator code.
- Remove: delete the folder, then rebuild and restart.

The build finds the folders itself, so neither step edits a core file. A new add-on starts
switched off.

## The folder

The folder name is the add-on's name: lower case letters, digits and dashes, starting with a
letter. The add-on manager shows it title-cased with each dash as a space, so `tank-hold` shows as
"Tank Hold". There is no second display name.

| File | Required | What it holds |
|---|---|---|
| `index.ts` | yes | `export const registration: Registration`, below |
| `README.md` | yes | what the add-on does, in the question list `addon:new` writes |
| `dashboard.tsx` | no | its Farming settings section, its dashboard pieces and its dialogs: `export const dashboard: AddonDashboard`, starting with `/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */` |
| `tests/` | no | its unit tests (`*.test.cjs`) and its rows of shared E2E tables (`rows.ts`) |

A bad name, a folder with no `index.ts` or `README.md`, or a loose file in `runtime/addons/` stops
the build, and the message names the folder.

## Commands

Each command writes the installed list (`.build/addons/`) before it loads anything, so it works on a
fresh checkout and sees a folder you copied in.

- `npm run addon:new <name>` writes `runtime/addons/<name>/` with the question list and an empty
  registration. Answer Part 1 of the questions in your own words before writing code.
- `npm run addon:map` prints every hook with who answers it, the movement tiers in rank order with
  their movers, the slots and the installed registrations.
- `npm run addon:check` loads every registration the way the console does and prints each
  conflict and rule break in plain words. It exits 1 on any. Run it before writing behaviour and
  again before calling the add-on done, with `npm run typecheck` and your tests.
- `npm run test:addon-neutral` runs the console's own unit suite with a switched-off fixture add-on
  installed that answers every hook. Run it after a change to the add-on system; every core row
  passes as it does without the fixture.

## The registration

```ts
import type { Registration } from '../../hooks/addon-api.ts';

export const registration: Registration = {
  name: 'tank-hold', folder: 'addons', author: 'you',
  summary: 'What it changes, in player terms.',
  settings: { tank: { label: 'Tank', kind: 'character', default: null, scope: 'scope' } },
  hooks: { 'group.anchor'(members, settings, ctx) { return settings.tank as string | undefined; } },
};
```

- `name` is the folder name.
- `hooks` maps a hook or event name from HOOKS.md to its answer. Each answer receives the hook's
  own arguments, then the add-on's `settings` for the farming scope the call is for, then its
  context `ctx` (below).
- `slots` fills a dashboard slot (HOOKS.md "Dashboard slots"). A target mode entry is
  `{ slot: 'target-mode', mode, fills: 'choice', button: { label, description, color }, status: { title, field, idle } }`;
  `color` is one of HOOKS.md "Slot buttons", and `status.field` is the store field the status line
  shows.
- `overlays` lists the player's settings this add-on's `settings.overlay` answers. Its value plays
  in place of the player's for that read only: the saved value stays the player's, the control
  shows "Overlaid by <Add-on> while it is on", and switching the add-on off plays the player's value
  again. The value passes the setting's own check.
- `settings` declares each setting the player sees, with `label`, `kind`, `default`, `choices`,
  `min`, `max`, `importable`, `scope`, `check`, `fit` and, for a `records` setting, `fields`.
  `kind` is one of HOOKS.md "Settings", and `default` passes its own kind. `scope: 'scope'` keeps
  one value per farming scope, and every hook reads the value of the scope its call is for.
  `importable: true` puts it in the settings export. `fit` turns an imported value into one the
  setting takes, such as a level past `max` into `max`; the import runs it before the kind and
  `check`, and a dashboard write never runs it.
- A `records` setting is a list of rows the player adds, removes and edits in a table:
  `{ kind: 'records', label, fields: { <key>: { label, kind, choices?, min?, max? } }, default: [] }`.
  A field's kind is `boolean`, `choice`, `number`, `text`, `character`, `monsters` or `items`, and
  the writer checks each field by its own kind.

## Where a hook runs

Each row in HOOKS.md names its side: `character` (in a character's own realm), `coordinator` (on
the console) or `both`. An answer runs on the side its row names, and `ctx.side` says which.

## The context every answer gets

`ctx` is `AddonContext` from `addon-api.ts`:

- `side`, and `character`: the character the call is for, on either side.
- `scope`: the farming scope's owner the character plays in, and `settings`: the add-on's values for
  that scope.
- `store`: the add-on's own `character`, `scope` and `party` stores (below).
- `read(name, ...args)`: any request HOOKS.md marks "Add-on may ask" and any row of HOOKS.md "Reads".
- `act(ask)`: asks a character for a game action (below). Events get no `act`.
- `outcome(id)`: an action's outcome for one report interval after it settles.

## Reading state

Call `ctx.read(name, ...args)` in an answer, or `read(name, ...args)` from `addon-api.ts`, with the
name written as a string literal. HOOKS.md "Reads" lists each read with its owner, its side and the
type it returns;
a read asked on the other side fails with that side named. A dashboard piece reads through the
`read` in its props, which `GET /party-api/addon-read` answers for each coordinator read.
`ask(name, ...)` is the same call under its older name.

## Asking for an action

`ctx.act({ action, args, reason })` asks for one offered game action from HOOKS.md "Actions", which
gives each action's owner, side, args and bound, and each closed one with its reason. On the
coordinator the ask also names its `character`. It returns a ticket `{ id }` at once and makes no
call, so it fits inside any answer, `addon.tick` and `addon.command`.

- The character's dispatcher runs the action's owner door after the console's holds: Pause and the
  deploy lease, the player's hand under Manual, and survival's escape and death. The owner's own
  rules and the call limit's `background` band apply as they do to the console's calls.
- Each add-on has one action in flight and one pending per character. A new ask replaces the
  pending one, which settles `refused` with `replaced`.
- The outcome, `sent`, `refused` or `failed`, arrives as the event `addon.acted` on the side that
  asked, and through `ctx.outcome(id)`.
- A movement action becomes a mover at the tier the add-on declares, a spend becomes a spend ask at
  the add-on spend rank, and an item action works on copies the items owner's fate rule hands it.

An add-on merchant job names its steps: `merchant.step` receives the job and the outcomes of the
steps it ran, and answers `{ steps }` with actions or walks, or `{ end: 'done' | 'failed' }`. A step
runs at the job's tier and in the call limit's `job` band.

## Stores

Each add-on has three stores, each a set of keys with JSON values: `character` (one character's
own), `scope` (one farming scope's) and `party` (one record for the party). `ctx.store.<kind>`
has `get(key)`, `set(key, value)` and `rev()`.

- The coordinator keeps every store and saves it with the settings. Each key carries its own
  revision, so a character write and a dashboard write to different keys both stay.
- A character sees its own character store, its scope's store and the party store, refreshed on
  each status reply, and its writes go up in its next report.
- State the add-on writes as it plays, such as a count, a role list or a last target, goes in a
  store; a setting is what the player chose.
- `delivered(name)` from `addon-api.ts` reads the scope store's `deliver` key, where a target mode
  add-on's `target.mode` answer lands.
- A character's `status.report` answer reaches the coordinator as `addonReports[<name>]` in that
  character's status, and the coordinator reads it with `ctx.read('status.lastReport', character)`.

## Commands both ways

A dashboard piece's `send(body, character?)` posts the add-on's command. `addon.command` answers
on the coordinator first with the coordinator's context: it may act, write any store, or return
`{ forward: true }`. A forward reaches that character's `addon.command` with the character's
context, and its `reply` comes back in the next report and as the event `addon.commanded`.

## Answering hooks

- Answer a hook whose "Who answers" in HOOKS.md is `one`, `many` or `slot`.
- Hear an event by naming it in `hooks`.
- Play code imports the core through `runtime/hooks/addon-api.ts`. `dashboard.tsx` imports
  `dashboard/features/party/addon-kit.ts` and its own folder, and a section gets React through the kit
  and its JSX pragma. Either may import other packages, and `tests/` may import anything. The hook views, `ctx.read` and the stores carry the state an
  answer needs, and `ctx.act` carries out what it decides.
- A mover is a `movement.request` entry `{ name, tier, answer(view, settings, ctx) }`. Its tier is
  one HOOKS.md "Movement tiers" marks add-on, and it runs before the core positioning step of that
  tier. A spend asks at the HOOKS.md "Spend ranks" an add-on may use.
- Every add-on answers at one priority. Several add-ons answering one question answer in load
  order, the folder names in code-point order. When two switched-on add-ons conflict, the player
  switches one off.
- Take each number from game data, a setting with a default, or a rule of progress. When progress
  stops, try the next thing and say so on the status line.

## Dashboard pieces

`dashboard.tsx` adds to the dashboard through `pieces`, keyed by slot and part
(`addon-kit.ts` `ADDON_PLACES`; HOOKS.md "Dashboard slots" gives each slot's data and bound):

- `top-bar`: a button after Logs (`views`) or after Bank (`actions`), or an indicator after the
  hand count (`status`).
- `card-section`: a block in one of a character card's ten parts, with the character, the
  add-on's own `status.report` answer and the party's character names (`members`).
- `dialog-section`: a section at the end of one of 25 dialogs, above its footer.
- `list-view`: a control at the end of a list's filter row, with `keep(row, value)` to narrow the
  list and `order(a, b, value)` to sort it while the player has the control set. Each row is the
  list's own published row type, such as `MarketRow`, with every field the list draws. Setting the
  control takes over from the core sort, and picking a core sort clears it.
- `page-section`: a block under the top bar, after Send party to town, in the Cave panel, at the
  end of the metrics view or at the foot of the live logs.
- `map-layer`: a function that returns markers for the card, native-size or cave map.

Every piece and section gets `AddonPieceBase` beside its place's data: `settings`, the `stores` it
sees, `save(store, patch)`, `send(body, character?)`, `reload()` after it changes its own switches,
`read` and `open(dialog, subject?)`. A card piece sees the character store, and a scope piece the
scope store.

`dashboard.dialogs` maps a dialog id to a component that receives `AddonPieceBase`, the `subject`
it was opened with and `close()`. `open(id, subject)` from any of the add-on's own pieces shows it
with the console's other dialogs, drawn with the kit's components.

The routine slots `combat-routine`, `merchant-routine` and `formation` take a whole routine for the
characters the player picks on the card, beside the built-in entry, which stays first and is the
default. Safety, cooldowns, the call limit and the lost-reply checks run before the routine's
answer; an answer that throws or breaks its shape runs the built-in routine.

Each piece draws after its place's core content, inside its own error boundary, so a piece that
throws blanks itself. `npm run addon:check` rule 9 names each dashboard area and its slot.

## Switching and settings

- The add-on manager in the settings dialog lists each add-on with its title, author, summary,
  switch and settings. A change reaches every character on its next status reply, with no restart.
- Switched off, an add-on hears nothing. Turning it off sends `addon.off` to it, so it ends any
  state it keeps between ticks there; turning it on sends `addon.on`.
- A published type's fields are in the source file HOOKS.md names beside it.

## The add-ons in this repo

Each has its own README, and deleting its folder removes it.

- [achievement-hunt](achievement-hunt/README.md): per-character farming of the monsters you pick for their kill achievements.
- [tank-hold](tank-hold/README.md): the tank holds the monsters, an off tank covers it, and an optional puller brings one monster at a time.
- [cosmetics](cosmetics/README.md): a panel on each character's card to wear looks and play emotes.
- [market-filters](market-filters/README.md): a level, price, server and tier filter bar on the Market tabs.
- [npc-orders](npc-orders/README.md): standing buy orders from the NPC sellers Ponty and Ron.

## Worked example: Achievement Hunt

`runtime/addons/achievement-hunt/` farms the monsters you pick for their kill achievements and
keeps the party away from the bosses on their ground. Read it beside HOOKS.md.

- `index.ts` fills the `target-mode` slot with the entry `achievements`, a `choice` with its button
  and status line. The coordinator ticks the entry through `target.mode`, and the settings section
  saves through `target.settings`.
- It declares two `number` settings, `bossSpawns` and `bossHp`, for the boss cut-off the game does
  not flag. Its other choices live in the scope's store.
- On the characters it reads the avoid list with `delivered(...)`. It keeps zones with
  `step.safety`, narrows targets with `targeting.candidates`, walks out of a zone with the mover
  `boss-retreat` at the `farming` tier, and reports the bosses it sees through `status.report`.
- It asks `passive.rule` for each monster's priority. On `addon.off` each scope goes back to
  Farming with the priorities and rare rules it changed put back.
- `dashboard.tsx` is its settings section; `tests/` holds its unit tests and `rows.ts`, its rows of
  the shared E2E tables.

## When no hook fits

Do not edit core to make room. Ask for the hook instead: open an issue on the console's repo naming
the owner in HOOKS.md, the question your add-on needs to answer or ask, and what it would receive
and return. The owner adds the row, the regenerated HOOKS.md lists it, and the add-on uses it from
then on.

The console's owners add a hook as one row in `runtime/hooks/rows/<NN>-<area>.ts` and a published
type as one line in `runtime/hooks/api/<NN>-<area>.ts`, then regenerate the list with
`node runtime/hooks/cli/hook-list.mts`. HOOKS.md is generated, and `addon:check` fails while it
differs from the code.
