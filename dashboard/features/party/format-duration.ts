/** Definition durations are milliseconds, except elixir item durations (hours). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "Unknown";
  if (ms <= 0) return "0s";
  if (ms < 1) return "<0.001s";
  const total = Math.round(ms);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = (total % 60000) / 1000;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", seconds ? `${seconds}s` : ""].filter(Boolean).join(" ") || "0s";
}

export function durationStat(key: string, value: unknown, definition: Record<string, unknown> = {}): string | null {
  if (!/^(duration(?:_min|_max)?|cooldown(?:_min|_max)?|reuse_cooldown|ms|remainingMs)$/.test(key) || typeof value !== "number") return null;
  return formatDuration(value * (key === "duration" && definition.type === "elixir" ? 3600000 : 1));
}
