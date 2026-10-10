# BankBoi deletion reconciliation

Failure inventory before changing the route:

- A stale local snapshot with inventory, equipment, gold, pending work or an
  unexpired creation cooldown can prevent removing an already deleted character.
- A cached account roster can falsely report that a character is absent; refresh
  must finish before absence can authorize local removal.
- A failed refresh must return 502 without deleting or persisting local state or
  invoking game deletion.
- A character still listed after refresh must retain every asset, pending-work
  and cooldown guard. Accepted game deletion still requires a second refreshed
  roster to confirm removal.
- An unknown local entry remains 404 and does not invoke account mutations.
- The bank UI can disable deletion from stale nonempty inventory before the
  coordinator has any opportunity to refresh ownership. Keep its confirmation
  action available; enforce asset safety against freshly refreshed ownership
  in the coordinator, and display its refusal for characters still present.

The existing retained isolated account-route regression covers the destructive
transport boundary: it can explicitly prove no `delete_character` request was
issued when only stale console state should be removed. Add these cases before
implementation and run `node --test scripts/tests/coordinator-bankboi-routes.test.cjs`.

The focused console journey uses the existing declared historical BankBoi stock
and the external account fixture's actual roster, which does not list that worker.
Game deletion transport is forbidden by the fixture. It clicks the enabled
two-stage Delete control despite stale items, verifies `alreadyDeleted`, restarts
the real coordinator, and verifies both the row and merchant booster availability
remain removed. Retain screenshots and before/after state plus response JSON.

Focused validation passes: 11 retained route regressions, the browser deletion
and restart journey, type checking, and lint of the changed route and BankSheet.
The browser report and 15 hash-verified evidence files are retained under
`.build/issue92-isolated/`. Repeat the browser check with:

```powershell
npm test -- -- --project=console --workers=1 --grep "BankBoi deleted outside the console"
npm run test:e2e:verify
```
