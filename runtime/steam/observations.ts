import type { SteamObservation } from "../roster/connection-status.ts";
interface Host {
  character?: { name: string };
  code_active?: boolean;
  socket?: { connected: boolean };
  get_active_characters?(): Record<string, string>;
}
export function steamObservations(
  host: Host,
  stopped: (name: string) => boolean,
  starting: Set<string>,
  errors: Map<string, string>,
): SteamObservation[] {
  const active = { ...host.get_active_characters?.() };
  for (const name of starting) active[name] ||= "loading";
  for (const name of errors.keys()) active[name] ||= "waiting";
  if (host.character)
    active[host.character.name] = host.socket?.connected
      ? host.code_active
        ? "code"
        : "loading"
      : "waiting";
  return Object.entries(active).map(([name, value]) => {
    const state = stopped(name)
      ? "stopped"
      : value === "code"
        ? "code"
        : value === "loading"
          ? "loading"
          : "waiting";
    if (state === "code") errors.delete(name);
    return { name, state, primary: name === host.character?.name, error: errors.get(name) };
  });
}
