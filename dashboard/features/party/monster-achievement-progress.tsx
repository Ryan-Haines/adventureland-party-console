"use client";
import { BestiaryMonster } from "./bestiary-monster";
import { displayValue } from "./display-value";

export function MonsterAchievementProgress({
  monster,
  achievement,
}: {
  monster: BestiaryMonster;
  achievement: { score: number; owner: string | null } | null;
}) {
  const achievements = Array.isArray(monster.definition.achievements)
    ? (monster.definition.achievements.filter(Array.isArray) as unknown[][])
    : [];
  if (!achievements.length) return null;
  const reward = (entry: unknown[]) => {
    const kind = displayValue(entry[1] || "reward");
    const stat = displayValue(entry[2] || "")
      .replaceAll("_", " ")
      .toUpperCase();
    const amount = Number(entry[3]);
    if (kind === "stat" && stat)
      return `${amount >= 0 ? "+" : ""}${amount.toLocaleString()} ${stat}`;
    return entry.slice(1).map(displayValue).join(" · ");
  };
  const kills = achievement ? Math.max(0, Number(achievement.score) || 0) : null;
  const unlocked =
    kills === null ? 0 : achievements.filter((entry) => kills >= Number(entry[0] || 0)).length;
  return (
    <section className="mb-4 rounded border border-violet-900/80 bg-violet-950/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="font-mono text-xs uppercase text-violet-300">Monster achievements</h4>
        <span className="font-mono text-[10px] text-emerald-200/75">
          {kills === null
            ? "Tracktrix data unavailable"
            : `${unlocked}/${achievements.length} unlocked · ${kills.toLocaleString()} score${achievement?.owner ? ` · ${achievement.owner}` : ""}`}
        </span>
      </div>
      <div className="space-y-1.5">
        {achievements.map((entry, index) => {
          const required = Math.max(0, Number(entry[0]) || 0);
          const complete = kills !== null && kills >= required;
          return (
            <div
              key={`${required}:${index}`}
              className={`flex items-center justify-between gap-3 rounded border px-2.5 py-2 ${complete ? "border-emerald-700/70 bg-emerald-950/25" : "border-slate-800 bg-black/25"}`}
            >
              <span className={complete ? "text-emerald-300" : "text-slate-400"}>
                {complete ? "✓ Unlocked" : "○ Locked"} · {reward(entry)}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-amber-200/80">
                {required.toLocaleString()} score
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
