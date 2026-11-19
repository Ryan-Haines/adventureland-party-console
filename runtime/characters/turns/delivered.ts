// "Heal first below" on the character: this character's
// entry as the last reply that carried the setting delivered it. The reply carries every character's
// entry only when the setting is in it, so the value holds between such replies. shared.js installs
// it before survival, whose escape reads it, and the turns pass reads it through the role runner.
export function installHealFirstBelow(ports: { name(): string }) {
  let delivered: unknown, routine: unknown;
  return {
    /** Table A's `heal-first` row. */
    reply(state: { healFirstBelow?: Record<string, unknown> | null; routines?: Record<string, Record<string, unknown> | undefined> | null }): void {
      if ('healFirstBelow' in state) delivered = state.healFirstBelow && state.healFirstBelow[ports.name()];
      // P13: the combat routine entry this character runs, its `combat-routine` pick in the settings owner's `routines`.
      if ('routines' in state) routine = state.routines?.[ports.name()]?.['combat-routine'];
    },
    read: (): unknown => delivered,
    routine: (): unknown => routine,
  };
}

Object.assign(globalThis, { installHealFirstBelow });
