# Settings menu

The dashboard has one settings menu (`dashboard/features/party/settings-menu.tsx`). It is a wide
window the player drags by its title bar; the position stays for the browser session. Its header
is pinned and holds two rows of tabs:

- Row 1: Account, Events, Addons, then one tab per character card.
- Row 2: the sections of the selected row-1 tab. The body shows the selected section.

| Row-1 tab | Sections |
|---|---|
| Account | Import/Export, Realm, Characters, ALData, Marketplace, Display, Apps, Hosting, Console |
| Events | Cave, then one section per character: the event list with its priority order, the selection and each event's settings, which open under the event's row |
| Addons | All add-ons, then one section per installed add-on |
| A fighter | Farming, Combat, Restock |
| The merchant | Combat, Restock, Merchant, Routines |

The Combat section holds "Heal first below", the HP and MP potion lines, the two reflect lists
and the add-on routine picks. Each reflect list picks from the monsters game data rates for it
(`reflection` above 0 for "Don't hit with magic", `dreturn` above 0 for "Don't hit with
physical"); a character with no saved list shows the targeting owner's default list.

## The buttons that open it

Every settings button keeps its place and look on the dashboard, and opens the menu at its own
tab and section (`settings-target.ts`):

| Button | Opens |
|---|---|
| Header gear "Interface settings" | Account > Import/Export |
| Header new-version indicator | Account > Console |
| Card "Farming settings" gear | that character > Farming |
| Card "Events (n)" | Events > that character |
| Events list "Cave of Many Dreams settings" gear | Events > Cave |
| Merchant card "Settings" | merchant > Merchant |
| Merchant card "Routines" | merchant > Routines |
| Card inventory "Merchant restock" | that character > Restock |
| Stand sheet "Marketplace settings" gear | Account > Marketplace |
| Market "ALData" setup | Account > ALData |

The menu replaced the Interface settings, Farming settings, Event settings, Cave, Merchant
settings, Routine priorities and Marketplace settings dialogs and the card's Events popover.
The card face keeps its play controls: Leader, Follow, hand control, the mode rows, the monster
focus, the gold target and the merchant's action buttons.

## The card's status icons

The card's status icons sit in the empty space right of the XP bar and the location row
(`status-icon-row.tsx`). The XP line takes the icons that fit its one line, and the location row
takes the rest, wrapping onto more lines when they do not fit, so every status shows.
