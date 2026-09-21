export type SteamObservation = {
  name: string;
  primary: boolean;
  state: "loading" | "code" | "stopped" | "waiting";
  error?: string;
};
export type CharacterConnection = SteamObservation & {
  since: number;
  seenAt: number;
  status: "loading" | "code" | "stopped" | "waiting" | "connected" | "lost";
  delayed: boolean;
};
type Observed = SteamObservation & { since: number; seenAt: number };
const observations = new WeakMap<object, Observed[]>();
export function recordConnections(owner: object, entries: SteamObservation[], now: number) {
  const previous = observations.get(owner) || [];
  observations.set(
    owner,
    entries.map((entry) => {
      const old = previous.find((value) => value.name === entry.name);
      return { ...entry, since: old?.state === entry.state ? old.since : now, seenAt: now };
    }),
  );
}
export function characterConnections(
  owner: object,
  now: number,
  ready: (name: string) => boolean,
): CharacterConnection[] {
  return (observations.get(owner) || []).map((entry) => {
    const status = ready(entry.name)
      ? "connected"
      : now - entry.seenAt >= 8000
        ? "lost"
        : entry.state;
    return { ...entry, status, delayed: status !== "connected" && now - entry.since >= 30000 };
  });
}
function observation(
  value: unknown,
  primary: unknown,
  owned: (name: string) => boolean,
): SteamObservation | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || !owned(entry.name)) return null;
  const state = ["loading", "code", "stopped"].includes(String(entry.state))
    ? (entry.state as SteamObservation["state"])
    : "waiting";
  return {
    name: entry.name,
    primary: entry.name === primary,
    state,
    ...(typeof entry.error === "string" ? { error: entry.error.slice(0, 200) } : {}),
  };
}
export function parseObservations(
  body: Record<string, unknown>,
  owned: (name: string) => boolean,
): SteamObservation[] {
  const raw = Array.isArray(body.observations) ? body.observations : [];
  const result = new Map<string, SteamObservation>();
  for (const value of raw.slice(0, 20)) {
    const entry = observation(value, body.character, owned);
    if (entry) result.set(entry.name, entry);
  }
  if (!raw.length)
    for (const name of [body.character, ...(Array.isArray(body.running) ? body.running : [])]) {
      if (typeof name === "string" && owned(name))
        result.set(name, { name, primary: name === body.character, state: "waiting" });
    }
  return [...result.values()];
}
