'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CharacterPortrait } from './character-portrait';
import { CharacterStatsDialog } from './character-stats-dialog';
import { GearComparisonDialog } from './gear-comparison-dialog';
import { ItemCard } from './item-card';
import { comparisonSlotsFor } from './comparison-slots-for';
import type { Char } from './char';
import type { InventoryEntry } from './inventory-entry';
export function OfflineCharacterView({
  character,
  onClose,
  offline = true,
}: {
  character: Char & { updatedAt?: number };
  onClose: () => void;
  offline?: boolean;
}) {
  const [stats, setStats] = useState(false),
    [item, setItem] = useState<InventoryEntry | null>(null),
    [comparison, setComparison] = useState<InventoryEntry | null>(null);
  const button =
    'rounded border border-slate-500 bg-slate-950 p-2 text-slate-100 hover:bg-slate-800 hover:text-white';
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto border-slate-600 bg-[#0b1916] text-white">
          <DialogHeader>
            <DialogTitle>{character.name} inventory and equipment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-300">
            {offline ? 'Offline · saved observation' : 'Read-only inspection'}
            {character.updatedAt
              ? ` · ${new Date(character.updatedAt).toLocaleString()}`
              : ''}
          </p>
          {character.inspection && <p className="text-sm text-slate-300">{character.inspection.note}<br/>Last game sync: {character.inspection.synchronizedAt ? new Date(character.inspection.synchronizedAt).toLocaleString() : 'unknown'}</p>}
          <button
            className={`${button} relative h-24 w-20`}
            aria-label={`View ${character.name} stats`}
            onClick={() => setStats(true)}
          >
            <CharacterPortrait
              html={character.characterDollHtml}
              sprite={character.characterSprite}
              skin={character.skin}
              centered
            />
          </button>
          <p>
            Level {character.level} {character.ctype} ·{' '}
            {character.gold.toLocaleString()} gold
          </p>
          {(['Equipment', 'Inventory'] as const).map((section) => (
            <section key={section}>
              <h3 className="my-2 font-semibold">{section}</h3>
              <div className="grid grid-cols-3 gap-2">
                {(section === 'Equipment'
                  ? Object.entries(character.slots).flatMap(([slot, entry]) =>
                      entry ? [{ ...entry, slot: -1, label: slot }] : [],
                    )
                  : character.items
                      .filter((e): e is InventoryEntry => !!e)
                      .map((e) => ({ ...e, label: `Slot ${e.slot}` }))
                ).map((entry, index) => {
                  const label = `${entry.meta?.definition.name || entry.item.name} +${entry.item.level || 0}`;
                  return (
                    <div key={index}>
                      <button
                        aria-label={`Inspect ${label}`}
                        className={`${button} w-full text-sm`}
                        onClick={() => setItem(entry)}
                      >
                        {entry.label}
                        <br />
                        {label}
                      </button>
                      {comparisonSlotsFor(entry.meta, character).length > 0 && (
                        <button
                          className={`${button} mt-1 w-full text-xs`}
                          aria-label={`Compare ${label}`}
                          onClick={() => setComparison(entry)}
                        >
                          Compare with equipped
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {item && (
            <section aria-label="Inspected item">
              <ItemCard
                item={item.item}
                meta={item.meta}
                level={item.item.level || 0}
                properties={item.meta?.properties || {}}
                usable={false}
                skillName={() => undefined}
                skillHint={() => undefined}
                onSkill={() => {}}
              />
            </section>
          )}
        </DialogContent>
      </Dialog>
      {stats && (character.inspection && !character.inspection.calculated ? <Dialog open onOpenChange={open=>{if(!open)setStats(false);}}><DialogContent className="border-slate-600 bg-[#0b1916] text-white"><DialogHeader><DialogTitle>{character.name} saved stats</DialogTitle></DialogHeader><p>{character.inspection.note}</p><p>Level: {character.level}</p><p>XP: {character.xp.toLocaleString()}</p><p>HP: {character.hp}</p><p>MP: {character.mp}</p><p>Gold: {character.gold.toLocaleString()}</p><p>Maximum HP/MP, attack, armor, resistance and attributes: unavailable</p></DialogContent></Dialog> : <CharacterStatsDialog offline={offline} character={character} onOpenChange={open=>{if(!open)setStats(false);}}/>)}
      <GearComparisonDialog
        comparison={comparison ? { character, entry: comparison } : null}
        currentCharacter={character}
        onOpenChange={(open) => {
          if (!open) setComparison(null);
        }}
      />
    </>
  );
}
