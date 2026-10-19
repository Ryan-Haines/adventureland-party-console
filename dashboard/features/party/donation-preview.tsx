'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Char } from './char';
/** Native G.levels is the XP requirement indexed by current level. */
export function DonationPreview({
  amount,
  onAmountChange,
  character,
}: {
  amount: string;
  onAmountChange: (amount: string) => void;
  character?: Pick<
    Char,
    'level' | 'xp' | 'donationXpPerGold' | 'donationLevelXp'
  >;
}) {
  const rate = character?.donationXpPerGold || 3.2,
    levels = character?.donationLevelXp;
  let level = character?.level || 0,
    xp = (character?.xp || 0) + Math.floor((Number(amount) || 0) * rate);
  if (levels)
    while (Number(levels[level]) > 0 && xp >= levels[level]) {
      xp -= levels[level];
      level++;
    }
  const progress = levels?.[level]
    ? Math.min(100, (xp / levels[level]) * 100)
    : null;
  const known = !!levels?.[character?.level || 0];
  const [targetDraft, setTargetDraft] = useState(String(level));
  useEffect(() => setTargetDraft(String(level)), [amount, level]);
  function target(value: string) {
    const target = Number(value);
    if (
      !character ||
      !levels ||
      !Number.isSafeInteger(target) ||
      target < character.level ||
      target >= levels.length
    )
      return;
    let required = -character.xp;
    for (let i = character.level; i < target; i++) {
      if (!(levels[i] > 0)) return;
      required += levels[i];
    }
    onAmountChange(String(Math.max(0, Math.ceil(required / rate))));
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        Donation amount
        <Input
          aria-label="Donation amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) =>
            onAmountChange(e.target.value.replace(/[^0-9]/g, ''))
          }
          className="border-amber-800 bg-slate-950 text-amber-100"
        />
      </label>
      <label className="grid gap-1 text-sm">
        Merchant level after donation
        <Input
          aria-label="Merchant level after donation"
          type="number"
          min={character?.level || 0}
          max={levels ? levels.length - 1 : undefined}
          disabled={!known}
          value={known ? targetDraft : ''}
          onChange={(e) => {
            setTargetDraft(e.target.value);
            target(e.target.value);
          }}
          className="border-violet-700 bg-slate-950 text-violet-100"
        />
      </label>
      <p role="status" className="text-sm text-violet-200">
        {known
          ? `Level ${level} · ${progress === null ? 'maximum level' : `${progress.toFixed(2)}% to next level`}`
          : 'Connect the merchant to load its native XP curve.'}{' '}
        · {Math.floor((Number(amount) || 0) * rate).toLocaleString()} XP ({rate}{' '}
        XP/gold)
      </p>
    </div>
  );
}
