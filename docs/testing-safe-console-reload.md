# Safe console reload failure inventory

Record these risks before implementation: selecting a menu option must pin the
displayed candidate, even if another build finishes; immediate reload requires
an explicit combat/death warning and cancel must do nothing; waiting must not
pause attacks or healing in the existing fight; new farm, passive, event and
dungeon targets must be rejected while genuine attackers remain defensible;
a visible current red-circle target must prevent activation; stale or missing
character reports and Steam handoffs must never count as safe. No connected
participants is safe only after the coordinator acknowledges the lease.

The waiting operation must persist across page reloads, retain its candidate
during build-history cleanup, and spin the icon through waiting, activation and
rollback. A failed wait must not restart unchanged code. Host interruption must
release an expiring acquisition hold, and restart must retire the interrupted
wait. Activation retains its existing acknowledgement and rollback checks.

Validate the actual browser menu, cancel/confirmation, spinning SVG animation,
exact candidate selection, waiting and successful page reload using real build
controller/store/routes with declared process-readiness boundaries. Validate
native combat continuation, actual attack/death receipts, blocked second-target
acquisition, fresh maintenance acknowledgements and resumed normal acquisition
after release. Retain screenshots, native hits, status timelines and build
journals as verifiable artifacts.

Introduce the second native monster only after every participant acknowledges
the hold, excluding a fight that was already selected before the request. Capture
the current red-circle target rather than an unrelated personal nomination;
coordinator pull blocking also revokes successor handoffs. Expire the lease after
combat-free acknowledgement to verify targeting recovers if the host disappears.
