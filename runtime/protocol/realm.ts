// The realm id rule: the console names a realm `SR_` plus the game's region and identifier
// ("SR_USII" for server_region "US", server_identifier "II"). Every owner builds, strips and
// labels a realm id here. The file imports nothing, so the characters, the coordinator and the
// dashboard all read it.
export function normalizedRealm(server: string | null | undefined): string | null {
  return server ? 'SR_' + bareRealm(server) : null;
}
// The realm id of the game's region and identifier, as a character's client reports them.
export const gameRealm = (region: unknown, identifier: unknown): string => 'SR_' + String(region) + String(identifier);
// The game's own name for the realm: the id with its prefix stripped.
export const bareRealm = (realm: unknown): string => String(realm ?? '').replace(/^SR_/, '');
// The realm's display name, which the realm lists, logs and the Steam bridge's realm dialog show:
// "SR_USII" reads "US II". A missing realm reads `missing`, each caller's word for that case.
export function realmLabel(realm: string | null | undefined, missing = ''): string {
  if (!realm) return missing;
  const parts = realmParts(realm);
  return parts ? parts.region + ' ' + parts.identifier : bareRealm(realm);
}
// The game's region and identifier of a realm id or a bare server name ("SR_USII" or "USII"), null
// for a name no game server has (the game's regions and identifiers, G node/server.js `servers`).
export function realmParts(realm: unknown): { region: string; identifier: string } | null {
  const match = /^(US|EU|ASIA)(I|II|III|IV|V|PVP)$/.exec(bareRealm(realm));
  return match ? { region: match[1]!, identifier: match[2]! } : null;
}
// A realm id, `SR_` and a game server's name.
export const isRealm = (value: unknown): value is string => typeof value === 'string' && value.startsWith('SR_') && realmParts(value) !== null;
// The realm id a player typed: any case, spaces and the prefix optional ("us ii", "SRUSII").
export function typedRealm(value: unknown): string {
  const name = typeof value === 'string' ? value.toUpperCase().replace(/\s+/g, '') : '';
  return name ? 'SR_' + bareRealm(name).replace(/^SR/, '') : '';
}
