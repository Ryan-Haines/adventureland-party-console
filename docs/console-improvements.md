# Console configuration and usability

## Headless login realms

After choosing a character for a headless slot, the roster picker offers separate
Home world and Login realm controls. Home world is a saved Party Console preference
for that character. It does not change the game's native home. Login realm defaults
to the saved preference; choosing another realm affects only the current login.
Steam login retains its existing behavior.

The home preference is persisted in the roster journal. Roster display, explicit
headless login and restoration of saved slots share the same resolution order:
saved preference, native game home, then the current/configured party realm.
The coordinator validates the realm against the account catalog and rejects PVP
destinations for these headless login controls. Worker assignment applies the chosen
realm before starting the character.

Merchant home recovery and its HTTP route defer during the switching and
setting-home phases of a party realm transition. Event-selection migration updates
event selections only; it no longer overwrites restored worker realms.

## Character cards and restock settings

Inventory, Equipped, Merchant restock and Combat Log use collapsible sections.
The equipment display sits below inventory, and restock controls live with the
inventory controls instead of appearing separately on the character card.

Restock edits save automatically after a 500 ms pause. The control shows unsaved,
saving, saved and retryable failure states. Newer edits made during a save are
submitted afterward. Status refreshes do not overwrite unsaved local edits, and
request failures reach the control's retry feedback.

Geist and Geist Mono are served from checked-in WOFF2 files under
`dashboard/public/fonts/`, with the accompanying Open Font License. The dashboard
no longer depends on remote font fetching for this configuration.

Expiring activated items use the item's `skin_a` artwork when available, matching
the game's activated booster display. Other items retain the existing skin fallback.

## Build reliability

Build-store cleanup compares the resolved root using Windows-aware relative paths,
so casing differences do not report an ordinary root as redirected. Existing
containment and redirected-path checks remain in place.

Abandoned operation locks can be reclaimed when their recorded PID no longer
exists. An ownerless lock is re-read after a short wait before reclamation; a lock
whose metadata cannot be inspected is retained. Reclamation moves the directory
aside and rechecks owner metadata before removing it. Live owners and uncertain
PID lookup failures retain the lock. Locks are not reclaimed merely because they
are old. See [Build history](../tools/BUILD-HISTORY.md).

Production dashboard fingerprints include imported `runtime/` sources and the
`tools/dashboard/` pipeline. Changes to those dependencies invalidate the cached
dashboard release even when dashboard files themselves have not changed.

## Manual review and activation

PR preparation uses TypeScript checks only. No tests or E2E scenarios are created,
modified or run, and no builds or process restarts are performed for this PR.

For manual review, choose distinct saved homes for headless characters, use a
temporary login override, reopen the picker, and inspect restored worker realms.
Check merchant recovery during a realm transition. Collapse and expand card
sections, edit restock values rapidly, and inspect saving and retry feedback.
Verify local font requests and activated booster artwork. Inspect dashboard build
identity changes after editing an imported runtime helper, and lock handling for
interrupted and still-running build owners.

Activation remains a separate user action. Coordinator/dashboard changes use the
supported coordinator-only workflow in the coordinator README. Publishing the
booster artwork change also requires character assets through the full supported
workflow. A typecheck alone does not build, publish or activate these changes.
