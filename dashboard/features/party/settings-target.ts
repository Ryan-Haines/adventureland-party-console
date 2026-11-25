// Where the settings menu opens: a row-1 tab and, in it, a row-2 section. Every settings button
// on the dashboard names its own target, so each one opens the one menu at its place.
// - `account`, `events` and `addons` are the shared tabs; `character` is one character's tab and
//   names the character.
// - In the Events tab the section is "cave" or a character's name; `event` opens that event's
//   settings under its row.
export type SettingsTarget =
  | { tab: 'account'; section?: AccountSection }
  | { tab: 'events'; section?: string; event?: string }
  | { tab: 'addons'; section?: string }
  | { tab: 'character'; character: string; section?: CharacterSection };

export const ACCOUNT_SECTIONS = [
  { id: 'import', label: 'Import/Export' },
  { id: 'realm', label: 'Realm' },
  { id: 'characters', label: 'Characters' },
  { id: 'aldata', label: 'ALData' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'display', label: 'Display' },
  { id: 'apps', label: 'Apps' },
  { id: 'hosting', label: 'Hosting' },
  { id: 'console', label: 'Console' },
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number]['id'];

export type CharacterSection = 'farming' | 'combat' | 'restock' | 'merchant' | 'routines';
const CHARACTER_SECTIONS: { id: CharacterSection; label: string }[] = [
  { id: 'farming', label: 'Farming' },
  { id: 'combat', label: 'Combat' },
  { id: 'restock', label: 'Restock' },
  { id: 'merchant', label: 'Merchant' },
  { id: 'routines', label: 'Routines' },
];
// A character's sections by its part in the party: the merchant has no farming line, so no
// Farming section, and only the merchant has the Merchant and Routines sections.
export function characterSections(merchant: boolean) {
  return CHARACTER_SECTIONS.filter(entry => merchant ? entry.id !== 'farming' : entry.id !== 'merchant' && entry.id !== 'routines');
}
