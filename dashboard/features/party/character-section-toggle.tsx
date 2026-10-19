import {ChevronDown, ChevronRight} from 'lucide-react';
import type {ReactNode} from 'react';

export function CharacterSectionToggle({label, open, onToggle, controls, count}: {
  label:string; open:boolean; onToggle:()=>void; controls:string; count?:ReactNode;
}) {
  return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
    className="flex w-full items-center justify-between gap-2 bg-[#0b1916] py-4 text-left text-emerald-100/65 hover:bg-[#10251e] hover:text-emerald-100 focus-visible:outline-2 focus-visible:outline-cyan-400">
    <span className="flex items-center gap-2 font-mono text-xs uppercase">
      {open?<ChevronDown aria-hidden="true" className="h-4 w-4"/>:<ChevronRight aria-hidden="true" className="h-4 w-4"/>}
      {label}
    </span>
    {count}
  </button>;
}
