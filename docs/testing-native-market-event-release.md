# Release 1.5 native market and event follow-ups

Failure inventories are in `e2e/wtb-unconfirmed-purchase-failures.md` and
`tools/sim/FAILURE-MODES.md`. Keep ChronAL enabled and run one worker.

- #124: `live-wtb-unconfirmed-purchase.spec.ts` exercises browser decisions for
  both outcomes, exact remaining bid counts, unrelated-order preservation,
  duplicate refusal and persistence across coordinator restart. A third live case
  refuses both decisions while the historical job remains queued, then cancels
  through the public action and permits one resolution. The original implementation
  and browser journeys retain Thefonze74065's commit authorship.
- #125: `new farming focus resumes after natural Halloween completion` uses the
  same `/focus` action as MonsterFocusPicker during real Pumpkin attendance.
  The event must remain active after the change. A native attack then kills the
  declared boss, and both fighters must later hit native Bees on the new focus.
  `explicit monster travel skips only the current native event occurrence`
  separately covers the stronger, immediate `/navigate-to-monster` user action.
- #126: `native mrgreen walk yields to a newly visible boss before the advertised
  spawn` and its Pumpkin counterpart introduce a reachable native boss during an
  already moving owned event route. Both fighters must attack it before reaching
  the obsolete announcement location. The retained terrain-separated boss case
  ensures merely seeing an unreachable boss cannot discard the maintained path.

These scenarios must pass in the integrated candidate before marking the issues
validated. No live console activation is part of this validation.
