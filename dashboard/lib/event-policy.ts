import { validMix, type CipherSettings } from '../../runtime/events/october.ts';
export interface EventLimits {
  deathLimit: number | null;
  timeLimitMinutes: number | null;
  monsters?: string[];
  cipher?: CipherSettings;
}
export function validEventLimits(value: unknown): value is EventLimits {
  if (!value || typeof value !== "object") return false;
  const { deathLimit, timeLimitMinutes, monsters, cipher } = value as EventLimits;
  if (monsters !== undefined && (!Array.isArray(monsters) || new Set(monsters).size !== monsters.length || monsters.some(id => !['zombie','ghoul','gargoyle'].includes(id)))) return false;
  if (cipher !== undefined && (!cipher || typeof cipher.automatic !== 'boolean' ||
    cipher.gatherMinutes !== undefined && (!Number.isFinite(cipher.gatherMinutes) || cipher.gatherMinutes < 0 || cipher.gatherMinutes > 20) ||
    !Number.isSafeInteger(cipher.minClues) || cipher.minClues < 0 || cipher.minClues > 1024 ||
    cipher.gatherMonsters !== undefined && (!Array.isArray(cipher.gatherMonsters) || cipher.gatherMonsters.length !== 4 || cipher.gatherMonsters.some(id => typeof id !== 'string' || !id)) ||
    cipher.manual !== undefined && (!cipher.manual || typeof cipher.manual.id !== 'string' || !cipher.manual.id || typeof cipher.manual.round !== 'string' || !cipher.manual.round || !Number.isSafeInteger(cipher.manual.cracks) || cipher.manual.cracks < 0 || !validMix(cipher.manual.mix)))) return false;
  return (deathLimit === null || Number.isSafeInteger(deathLimit) && deathLimit >= 0) &&
    (timeLimitMinutes === null || typeof timeLimitMinutes === "number" && Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0);
}
export interface EventFormation {
  leader?: string | null;
  merchantCharacter?: string | null;
  followers?: Record<string, boolean>;
  eventsByCharacter?: Record<string, boolean>;
  eventLimitsByCharacter?: Record<string, Record<string, EventLimits>>;
  eventPrioritiesByCharacter?: Record<string, string[]>;
  eventSelectionsByCharacter?: Record<string, string[]>;
}

// Persisted legacy all-events flags cover the catalog available when saved.
// Newly supported fights require an explicit selection, rather than opt-in on upgrade.
const legacyDefaultEvents = ["anniversary", "abtesting", "goobrawl", "crabxx", "franky", "icegolem", "snowman"];
// A client built before the October events sends a priority list without them.
export const octoberEvents = ["horseman", "graveyard", "trickortreat", "witchcipher"];
export const supportedEvents = [...legacyDefaultEvents, "slenderman", "mrgreen", "mrpumpkin", ...octoberEvents];
export const eventDisplayNames: Record<string, string> = {
  anniversary: "Anniversary", abtesting: "A/B Testing", goobrawl: "Goobrawl",
  crabxx: "Crabxx", franky: "Franky", icegolem: "Ice Golem", snowman: "Snowman",
  slenderman: "Slenderman", mrgreen: "Mr. Green", mrpumpkin: "Mr. Pumpkin",
  horseman: "Headless Horseman", graveyard: "Graveyard Rising", trickortreat: "Trick or Treat", witchcipher: "Witch's Cipher",
};

export function selectedEvents(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...(party.eventsByCharacter?.[source] ? legacyDefaultEvents.filter(id => id !== "anniversary") : [])];
  const accountCipher = name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes('witchcipher');
  return eventPriorityOrder(party, name).filter(id => selections.includes(id) || accountCipher && id === 'witchcipher');
}

export function eventEnabled(party: EventFormation, name: string, event: string) {
  return selectedEvents(party, name).includes(event);
}

export function eventPolicy(party: EventFormation, name: string) {
  const inherited = Boolean(
    party.leader &&
    name !== party.leader &&
    name !== party.merchantCharacter &&
    party.followers?.[name],
  );
  const source = inherited ? party.leader! : name;
  return {
    inherited,
    source,
    enabled: !!(name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes('witchcipher')) || (party.eventSelectionsByCharacter?.[source]
      ? party.eventSelectionsByCharacter[source].some(id => id !== "anniversary" && supportedEvents.includes(id))
      : Boolean(party.eventsByCharacter?.[source])),
  };
}

// Order is independent of attendance checkboxes; new supported events append.
export function eventPriorityOrder(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  return [...new Set([...(party.eventPrioritiesByCharacter?.[source] ?? []), ...supportedEvents])]
    .filter(id => supportedEvents.includes(id));
}

export function eventLimits(party: EventFormation, name: string): Record<string, EventLimits> {
  const limits = party.eventLimitsByCharacter?.[eventPolicy(party, name).source] ?? {};
  if (name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes('witchcipher'))
    return {...limits, witchcipher: party.eventLimitsByCharacter?.[party.leader]?.witchcipher ?? {deathLimit:null,timeLimitMinutes:null}};
  return limits;
}
