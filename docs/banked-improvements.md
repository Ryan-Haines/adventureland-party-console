# Banking and automatic improvements

Automatic bank marks remain storage preferences. Crafting, compounding, and upgrading
do not remove them. A running job temporarily keeps its ingredients out of bank
errands; later ordinary banking uses the same saved marks again.

## Shared stock

The merchant evaluates saved upgrade and compound rules across characters against
shared bank stock, including BankBoi storage. Finished bank-stock work remains with
the merchant and follows its normal storage rules; it is not a delivery request to
the character whose inventory was used to configure the rule. Existing improvement
work on a fighter's carried equipment retains its ordinary delivery behavior.

Identical goals are deduplicated: unlimited quantity wins over a finite quantity,
otherwise the largest quantity applies. Different target levels retain their own
quantity limits and are processed highest-first, with higher-level results counting
toward lower-level goals.
Finished copies in observed character inventories and storage count toward finite
targets. Locked items are not withdrawn as improvement ingredients.

Bank marks and upgrade starting-level rules are level-specific. Banking `ring +0`
does not automatically bank `ring +3`; that requires its own bank rule. Compound
rules consume matching lower-level triples toward their target.

## Execution

- Compounding reserves ingredients before evaluating a fighter's bank marks and
  retrieves only the missing members of a triple from bank storage.
- Bank upgrades prepare at most three items per job, preserve merchant inventory
  headroom, recheck live bank contents, and use the normal upgrade executor.
- BankBoi improvement withdrawals identify the waiting routine. Once staged, that
  routine gets the storage-handoff priority and consumes its own ingredients.
- Crafting still validates material availability and preserves the existing recipe
  reservations, but no longer requests permission to delete automatic bank marks.
- Explicit manual withdrawals retain their separate confirmation behavior.

Coverage: `bank-improvements.test.cjs`, `craft-bank-confirmation.test.cjs`,
`merchant-commerce-dialog.test.cjs`, and the existing bank/compound/exchange tests.

Delivery marks reserve individual copies ahead of automatic compounding and its
leftover banking. Protection checkpoints refresh these reservations before each
automatic action. Confirmed delivery-and-equip transfers retain a persisted
`awaitingEquip` mark at the recipient until a successful equipment receipt;
failed attempts remain protected and retry when no other command owns the
character. Other copies and the underlying automatic rules remain eligible.
