export function liveCharacter<T extends { name: string }>(selected: T | null, characters: Record<string, T>): T | null {
  return selected ? characters[selected.name] || selected : null;
}

export function displayRunSpeed(character: { ctype: string; speed?: number; unrestrictedSpeed?: number | null; standOpen?: boolean }): number | null {
  if (character.ctype === "merchant") {
    if (typeof character.unrestrictedSpeed === "number" && Number.isFinite(character.unrestrictedSpeed)) return character.unrestrictedSpeed;
    if (character.standOpen) return null;
  }
  return character.speed ?? null;
}
