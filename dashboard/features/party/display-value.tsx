"use client";

export function displayValue(value: unknown): string {
  if (value === null) return "None";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  return value === undefined ? "" : "Unsupported value";
}
