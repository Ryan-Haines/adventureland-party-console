"use client";
import { CharacterTravelDialog } from "./character-travel-dialog";
import type { PartyConsoleModel } from "./use-party-console";

export function PartyCharacterTravelDialog({ model }: { model: PartyConsoleModel }) {
  const { travelCharacter, places, setTravelCharacter, submitCharacterTravel } = model;
  return (
    <CharacterTravelDialog
      character={travelCharacter}
      places={places}
      onClose={() => setTravelCharacter(null)}
      onTravel={submitCharacterTravel}
    />
  );
}
