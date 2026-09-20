# BankBoi storage handoffs

BankBoi inventory acts as an extension of the normal bank. Compatible stackable
items share a preferred home; the seven reserved items1 slots (35–41) are a
transfer row, not permanent storage. Deposits also merge compatible stacks in
that row instead of allocating a new slot for every deposit.

Merchant auto-compound rules include BankBoi inventories. When the merchant is
idle and no withdrawal or storage transaction is pending, the scheduler requests
only the missing unlocked ingredients for the next complete triple, preferring
the highest level below the target. The existing storage handoff brings them to
the merchant before compounding. Finished items held by BankBois count toward
the rule's quantity limit. Other characters' rules remain inventory-only.

Merchant bank visits publish a fresh snapshot at their safe checkpoints. When
storage work is available, the job yields through its normal completion handler,
retaining its queued intent and confirmed withdrawals. Storage runs ahead of
queued commerce and gathering, without requiring an open stand or a return to
Mainland. Active merchant operations must release ownership before the slot swap.

Workers drain inbound staging before staging requested withdrawals. Outbound
slots are protected from re-adoption as deposits; merchant pickup outranks
optional gathering and runs before another outbound batch fills the row.

The worker holds the banking activity lock during service to prevent automatic
restocking or gathering from pulling it away. On failure it reports completed
transfers, current inventory, and the bank snapshot. Transient bank-unavailable,
not-in-bank, and interrupted errors permit another service pass after a ten-second
backoff. Other errors remain visible for diagnosis. Capacity limits still apply:
a new worker is not created automatically when all storage is genuinely full.

Before sorting a visited bank floor, compatible normal-pane stacks consolidate.
Same-pane consolidation needs no inventory space; cross-pane consolidation uses
two empty inventory buffers and restores them on failure. Reserved transfer slots
are excluded. Stack limits and item properties remain compatibility constraints.
Automatic bank retrieval can merge into any compatible inventory slot, so deposits
use the server-reported receiving slot when returning the merged stack to its home.

Exchange orders request missing materials from BankBoi through the merchant's
withdrawal queue and yield with bankboi_pending until storage returns them.
Required exchange materials are excluded from that job's optional auto-bank
errands. Duplicate order lines are combined, and all remaining inventory amounts
are checked before each NPC route. Confirmed exchanges checkpoint remaining work
and reward fingerprints so a later storage pause resumes without repeating them.
