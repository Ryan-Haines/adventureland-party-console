import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function AutoActionIcon({ children }: { children: ReactNode }) {
  return (
    <span data-action-icons aria-hidden="true" className="mr-2 inline-flex shrink-0 items-center gap-1 [&>svg]:size-4">
      {children}
      <RotateCw />
    </span>
  );
}
