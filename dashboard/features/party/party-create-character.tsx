"use client";
import { CreateCharacter } from "./create-character";
import type { PartyConsoleModel } from "./use-party-console";

export function PartyCreateCharacter({ model }: { model: PartyConsoleModel }) {
  const {
    state,
    createOpen,
    setCreateOpen,
    newName,
    setNewName,
    newClass,
    setNewClass,
    setNewLook,
    newLook,
    creating,
    createCharacter,
  } = model;
  return (
    <CreateCharacter
      open={createOpen}
      onOpenChange={setCreateOpen}
      name={newName}
      setName={setNewName}
      ctype={newClass}
      setCtype={(value) => {
        setNewClass(value);
        setNewLook(0);
      }}
      look={newLook}
      setLook={setNewLook}
      appearances={state.appearanceChoices?.[newClass] || []}
      classes={state.classChoices || []}
      busy={creating}
      onCreate={createCharacter}
    />
  );
}
