import type { SpawnRecord } from "./monster-choice";
import type { EventSource } from "./bestiary-monster";

function eventSourceText(source: EventSource) {
  if (source.role === "add") return `Spawns only during ${source.name}: raised by the boss at ${(source.at || []).map(at => `${Math.round(at * 100)}%`).join(" and ")} HP.`;
  if (source.role === "wave") return `Spawns only during ${source.name} in its waves.`;
  return `Spawns only during ${source.name} as its boss.`;
}

const reasons: Record<string, string> = {
  ignore: "Ignored map",
  instance: "Instance-only map",
  irregular: "Special-access map",
  "zero-count": "Zero-count spawn; no regular population",
  "missing-map": "Map definition unavailable",
  "invalid-geometry": "Spawn coordinates unavailable",
};

export function MonsterSpawns({ records, eventSources }: { records?: SpawnRecord[]; eventSources?: EventSource[] }) {
  return (
    <section className="rounded border border-emerald-800 bg-[#081713] p-3 text-sm text-emerald-100">
      <h3 className="mb-2 font-semibold">Recorded spawn locations</h3>
      {eventSources?.length ? <ul className="space-y-1 text-amber-200">
        {eventSources.map(source => <li key={`${source.id}:${source.role}`}>{eventSourceText(source)}</li>)}
      </ul> : records === undefined ? <p>Waiting for refreshed spawn data.</p> : !records.length ? (
        <p>No static spawn recorded in game data.</p>
      ) : <ul className="space-y-2">
        {records.map((record, index) => (
          <li key={`${record.sourceMap}:${record.map}:${index}`}>
            <p>{record.mapName || record.map} <span className="text-emerald-200">({record.map})</span>
              {Number.isFinite(record.x) && Number.isFinite(record.y) ? ` · (${record.x}, ${record.y})` : ""}
              {record.count !== undefined ? ` · Count: ${record.count}` : ""}</p>
            <p className={record.restrictions.length ? "text-amber-200" : "text-cyan-200"}>
              {record.restrictions.length
                ? `${record.restrictions.map(reason => reasons[reason] || reason).join("; ")}. Ordinary hunt routing unavailable.`
                : "Available for ordinary hunt routing."}
            </p>
          </li>
        ))}
      </ul>}
    </section>
  );
}
