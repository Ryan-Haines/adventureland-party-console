"use client";
import { ConditionDetails } from "./condition-details";
import type { PartyConsoleModel } from "./use-party-console";

export function PartyConditionDetails({ model }: { model: PartyConsoleModel }) {
  const { setSelectedCondition, selectedCondition } = model;
  return (
    <ConditionDetails
      selected={selectedCondition}
      onOpenChange={(open) => {
        if (!open) setSelectedCondition(null);
      }}
    />
  );
}
