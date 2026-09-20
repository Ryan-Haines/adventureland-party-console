interface FocusMigrationState {
  leader: string | null;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  followers: Record<string, unknown>;
}

/** Remove the legacy leader copy after promoting it, so it cannot overwrite later shared edits. */
export function migrateSharedMonsterFocus(state: FocusMigrationState): void {
  const leader = state.leader;
  if (!leader || !Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, leader))
    return;
  state.monsterFocus = state.monsterFocusByCharacter[leader].slice();
  for (const name of Object.keys(state.followers)) {
    if (state.followers[name]) delete state.monsterFocusByCharacter[name];
  }
  delete state.monsterFocusByCharacter[leader];
}

/** Old empty focus selections must cancel resumable farming when no navigation intents were saved. */
export function migrateEmptyFocusIntents(
  savedIntents: unknown,
  state: {
    leader: string | null;
    monsterFocus: unknown;
    monsterFocusByCharacter: Record<string, unknown>;
  },
  navigation: {
    members(): string[];
    invalidate(names: string[], reason: string, shared?: boolean): void;
  },
): void {
  if (savedIntents) return;
  if (Array.isArray(state.monsterFocus) && !state.monsterFocus.length)
    navigation.invalidate(navigation.members(), "empty focus on migration", true);
  for (const [name, focus] of Object.entries(state.monsterFocusByCharacter)) {
    if (name !== state.leader && Array.isArray(focus) && !focus.length)
      navigation.invalidate([name], "empty focus on migration");
  }
}
