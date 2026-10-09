# Achievement Hunt failure modes (written before the E2E journey)

These cases describe the `console` project journey in `achievement-hunt.spec.ts`.
The fixture publishes one routable monster (Goo) and no kill-achievement counts,
so Goo's first milestone is the target. Isolated checks for the step sweep,
death thresholds and scope crossing stay in `scripts/tests/achievement-hunt.test.cjs`
(docs/achievement-hunt.md § Isolated tests).

- The settings section can render while its saves fail. The journey selects Goo
  through the dialog and reads the selection back from the coordinator's state,
  under the character's own farming profile.
- A monster without a route can be offered as a regular choice. The regular list
  holds only monsters with a spawn the fixture publishes; the rest are special.
- The Achievements mode can be offered before it can start. It must refuse with
  a reason while nothing is selected, and start once Goo is selected.
- A target switch can reset the farming mode to Auto, as a hand-picked monster
  does. After the coordinator picks Goo, the mode stays `achievements` and the
  focus becomes Goo.
- The status line can stay on its placeholder. It must show the coordinator's
  message with Goo's kill count and step.
- A restart can drop the selection or the target. Restart the real coordinator
  with the same journal and read both back.
- Leaving the mode can strand the target. Choosing Default clears the target,
  and the selection stays for next time.
