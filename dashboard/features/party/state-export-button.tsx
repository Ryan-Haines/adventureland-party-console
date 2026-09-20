"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { exportSettings } from './settings-export';
export function StateExportButton() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="flex flex-col items-end gap-2">
    {error && <p role="alert" className="w-full break-words text-sm text-rose-200">Error exporting state file: {error}</p>}
    <Button disabled={busy} variant="outline" className="border-cyan-600 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white" onClick={async () => {setBusy(true);setError('');try {await exportSettings();} catch(error) {if (!(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : String(error));} finally {setBusy(false);}}}>{busy ? 'Exporting…' : 'Export state file'}</Button>
  </div>;
}
