"use client";

export function statBadgeClass(statType?: string) {
  switch (statType?.toLowerCase()) {
    case "int":
      return "bg-blue-950/90 text-blue-200 ring-blue-500/50";
    case "str":
      return "bg-red-950/90 text-red-200 ring-red-500/50";
    case "dex":
      return "bg-green-950/90 text-green-200 ring-green-500/50";
    case "vit":
      return "bg-amber-950/90 text-amber-200 ring-amber-500/50";
    default:
      return "bg-slate-950/90 text-slate-200 ring-slate-500/50";
  }
}
