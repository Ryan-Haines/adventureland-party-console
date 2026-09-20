'use client';
import { useRef, useState, type RefObject } from 'react';
import type { Char } from './char';
import { useCharacterData } from './dashboard-live';
import { CharacterStatsDialog } from './character-stats-dialog';
import { CharacterPortrait } from './character-portrait';
import { SpriteCrop } from './sprite-crop';

// Keep this interaction below the console and card so opening stats does not
// rerender the workspace or mount unrelated reference panels.
export function CharacterStatsTrigger({ character }: { character: Char }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${character.name} stats`}
        title={`View ${character.name} stats`}
        className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-emerald-800/80 bg-[#07100f] text-left text-emerald-100 transition hover:bg-[#10251f] hover:text-white hover:border-emerald-400 hover:shadow-[0_0_14px_rgba(52,211,153,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <CharacterPortrait
          html={character.characterDollHtml}
          sprite={character.characterSprite}
          skin={character.skin}
        />
        {character.tracktrix?.active && character.tracktrix.sprite && Object.values(character.tracktrix.bonuses || {}).some(value => value !== 0) && (
          <span role="img" aria-label="Tracktrix bonuses active" title="Tracktrix bonuses active" className="absolute right-0.5 top-0.5 h-5 w-5 rounded border border-violet-600 bg-[#101724]">
            <SpriteCrop sprite={character.tracktrix.sprite} size={18} />
          </span>
        )}
      </button>
      {open && (
        <ConnectedCharacterStats character={character} onOpenChange={setOpen} returnFocus={triggerRef} />
      )}
    </>
  );
}

function ConnectedCharacterStats({
  character,
  onOpenChange,
  returnFocus,
}: {
  character: Char;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  // Inventory is only needed while inspecting stats (weapon attack). Vitals
  // and diagnostics already arrive through the card's live subscriptions.
  const inventory = useCharacterData(character.name, 'inventory');
  return (
    <CharacterStatsDialog
      character={{ ...character, ...inventory }}
      onOpenChange={onOpenChange}
      returnFocus={returnFocus}
    />
  );
}
