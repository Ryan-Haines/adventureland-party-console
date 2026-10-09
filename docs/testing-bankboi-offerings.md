# BankBoi upgrade offering sourcing

Failure inventory before implementation:

- Offering stock omits stored BankBoi items, disabling manual upgrade selection.
- Required automatic offerings stay asleep when only BankBoi stock changes.
- Bank-floor traversal finishes without requesting the stored offering.
- A storage handoff consumes/removes the original upgrade mark before retry.
- Repeated supply requests duplicate withdrawals, or stale jobs enqueue cargo.
- Locked, bound, delivery-reserved or crafting-reserved offerings become available.
- Native transfer loses a stack or replays the offering after restart.

Native E2E declares a real offline account merchant's offering inventory, then
uses the existing BankBoi slot handoff and native banking/withdrawal machinery.
Manual and required automatic upgrades must produce native transfer and offering
consumption evidence. Coordinator snapshots and native events remain attached;
input fixtures never fabricate transfer receipts or successful upgrades.
The BankBoi service owns managed headless slots. Convert the native browser
merchant to a managed headless worker before declaring stock; an external Steam
runner cannot be stopped through the service's worker ownership boundary.
After handoff, observe coordinator heartbeats and upstream inventory directly.
