# Completed commerce receipt recovery

Failure inventory before implementation: completing the authoritative production
receipt removes its journal before the native CODE continuation writes the
commerce outcome. A lost completion response followed by CODE replacement can
therefore retain a pending paid upgrade without its result. Ordinary completed
receipt recovery currently discards the local journal without updating commerce.
Historical unlinked receipts cannot identify an order or inventory survivor.

The native scenario holds a real successful completion response after server
processing, moves that actual survivor without changing its properties, and
declares loss of only the local production journal while retaining paid commerce
progress, and replaces the actual native CODE iframe through upstream
`start_runner` with the maintained loader, retaining the game connection. It must finish the original
order with exactly one native result, preserved spending/attempts, no duplicated
native upgrade, and a durable receipt/fault artifact. Recovery must use only
the exact order key, progress sequence, input item and expected output level;
unrelated, older, failed or unlinked receipts must not claim inventory.

The initial scenario stopped before recovery: orderly Steam restore correctly
rejected reconnecting a character with an active inventory operation (HTTP502).
That guard must remain intact. The fixture instead uses the existing native
abrupt CODE replacement boundary and verifies a new runtime plus a connected
game client; the initial setup failure does not establish product RED.
