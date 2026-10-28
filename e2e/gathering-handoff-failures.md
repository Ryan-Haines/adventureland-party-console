# Gathering equipment handoff (#153)

Failure modes recorded before implementation:

- A deferred Ponty command is accepted after casting releases its attempt, leaving the tool equipped.
- Cancelling a preparing/settling attempt releases it without restoring either hand.
- A casting merchant command interrupts a cast instead of deferring.
- A gathering command or manual movement restores gear it does not own.
- An obsolete gathering generation mutates equipment after a CODE replacement.
- Missing saved equipment silently admits the next job with the tool still equipped.

Extend the retained gathering-equipment isolation regression to deterministically
exercise the no-attempt and cancellation boundaries with the real restore helper.
Native timing cannot reliably select both sides of the attempt-release boundary;
this exception supplements the native equipment gathering/restart journey, rather
than claiming native Ponty purchase coverage. Observe both hands and retain TAP
output. Run the existing native equipment journey through ChronAL as well.
