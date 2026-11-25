# Character section failure inventory

- Combat log currently nests two disclosure controls; one click can expose another collapsed header rather than entries. Closed logs must not fetch full log history.
- Inventory/equipment/restock order can differ between merchant and combat cards. Observe visual positions in the real dashboard, not CSS class or source order alone.
- Collapsing one character must not hide another character's sections. Header capacity must remain visible when inventory is closed.
- The Merchant restock line opens the settings menu at that character's Restock section; saving must mutate the correct character's policy and survive coordinator restart.
- Hidden equipment/inventory must retain existing inspection/actions after reopening. Keyboard activation and aria-expanded must agree with visible content.
- Collapse preferences should survive refresh without changing commands, policies, or log history.

Inventory and Equipped start open; Combat log starts closed. Per-character browser preferences remember toggles across refresh. Shared chevron rows expose aria-expanded and associated content; closed combat logs retain lazy loading. The Merchant restock line keeps the chevron row's look and names no expanded state, since its content is the settings menu's Restock section. The visible order is Inventory, Equipped, Merchant restock before action lists. Run the console case matching `character sections collapse independently` and retain its narrow-layout screenshot and saved policy ledger.
