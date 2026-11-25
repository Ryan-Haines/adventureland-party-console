// The setup choices for linking a game client: whether Adventure Land runs on the console's computer,
// and which client plays it. The saved preferences (preferences.ts) and the setup page
// (hosting/page.ts) read these lists, and page.ts inlines them into the page. This file imports
// nothing, so a browser bundle can load it as it is.
export const STEAM_PLACEMENTS = [
  { value: 'same', label: 'Same computer' },
  { value: 'remote', label: 'Different computers' },
] as const;
export const STEAM_CLIENTS = [
  { value: 'windows-steam', label: 'Windows \u2014 Steam client' },
  { value: 'windows-browser', label: 'Windows \u2014 browser' },
  { value: 'linux-steam', label: 'Linux \u2014 Steam client' },
  { value: 'linux-browser', label: 'Linux \u2014 browser' },
] as const;
export type SteamPlacement = typeof STEAM_PLACEMENTS[number]['value'];
export type SteamClient = typeof STEAM_CLIENTS[number]['value'];

export function validSteamSetup(setup: unknown): setup is { placement: SteamPlacement; client: SteamClient } {
  const value = setup as { placement?: unknown; client?: unknown } | null | undefined;
  return !!value && STEAM_PLACEMENTS.some(option => option.value === value.placement) &&
    STEAM_CLIENTS.some(option => option.value === value.client);
}
