# Cave of Many Dreams

Implement on `daily-dungeons` from main (including #11), in an isolated worktree.
Do not include #18 or publish unfinished assets to the running game.

## Dashboard

Pin Cave of Many Dreams first in Events; sort the other events alphabetically.
Its countdown is the next account entry, not remaining run time. Show Available
now only from fresh eligibility. Refresh at reset; unknown timing stays unknown.
Rename estimated event slots to Next chance and remove event not guaranteed.

The gear shows eligibility, participants, Enter now / Resume visit, and a saved
Don’t leave the Cave of Many Dreams for other events setting, enabled by default.
Entry is manual and excluded from automatic event selection counts. Use leader
and combat followers, never merchant; reject too many participants.

Show the dungeon controls below the header and above the party cards. Present
run time, objectives, currency, choices, votes and manual purchases in two columns. Use real objective/door names, not invented left/right.
Escape and Town exit all participants. Explicit exit holds outside.

## Ownership

Default protection blocks Anniversary and all automatic event departures through
one gate, including partial entry and reconnect. When disabled, an eligible
enabled event may request coordinated exit, then revalidate before event travel.
Re-enabling protection cancels only exits not yet dispatched. Never auto-reenter.
Suspend Hunt, farming, merchant service and ordinary death recovery for owned
participants. Preserve their settings. Disconnections do not release ownership.

## Runtime

Verify current official cave APIs and generated geometry. Add authenticated
status/actions, protocol capability, account eligibility/reset and live run
observations. Scope operations to run/choice/destination and durable operation IDs.
Gather at Dorr; validate party/eligibility; leader enters; reconcile partial entry.
Use native generated-map navigation and combat/loot barriers. Run the existing
class combat runner, skill engine, equipment handling, formation, approach and
kiting routines against live cave attackers; never select neutral encounters
automatically. Follow the live leader target, falling back to a shared deterministic
priority order. Use live cave allies for healing and formation. Pause room travel
during combat, but permit combat positioning; forced votes pause both. Keep farm
travel, rare hunting and ordinary respawn outside dungeon ownership. Votes fan out to
eligible unvoted characters. Purchases and Nera's paid revival require manual confirmation.

Priests automatically heal fallen participants' gravestones and revive them with
carried Essences of Life. Living teammates' healing takes priority. During combat,
recovery uses an offensive action opportunity and retains normal healing MP reserves;
out of combat, it waits for MP regeneration and can approach on the same floor.
The coordinator assigns one priest per death and persists authorization before
consumption. A local receipt prevents a second cast after reload or uncertain replies.
Nera remains manual and waits for any dispatched priest revival to resolve. Failed
or interrupted casts do not automatically consume another Essence. Recovery phases
and blocking reasons appear above the party cards. Validate full grave healing,
consumption and the eight-second channel on a repeat-entry development server before
live activation; automated tests do not establish live game behavior.
Persist dispatch state: safely retry pre-dispatch failures, never blindly repeat
uncertain entries or spending. Reconcile restart, expiry and partial exit.

## Validation and delivery

Test menu order/countdowns, settings migration, event protection and handoff,
entry/party limits, fresh identity, generated maps, choices/purchases, operation
replays, partial failure, death/disconnect/exit, and main’s Hunt/merchant regressions.
Run type checks, coordinator lint, full tests and production build. Verify responsive
dark controls and keyboard access. Document real-run validation gaps honestly.
Update README/changelog, open PR to main. Live activation is separate: use the
supported full restart with fresh character and coordinator verification.
