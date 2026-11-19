import type { QueryClient } from '@tanstack/react-query';
import { performAction } from './query-actions';
interface SaveHandle { createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }
export async function exportSettings(client: QueryClient) {
  const filename = `party_console_settings_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')}.json`;
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<SaveHandle> }).showSaveFilePicker;
  const handle = picker ? await picker.call(window, { suggestedName: filename, types: [{ description: 'JSON settings', accept: { 'application/json': ['.json'] } }] }) : null;
  const text = JSON.stringify(await performAction(client, '/dashboard-state/export', {}, { method: 'GET' }), null, 2);
  if (handle) { const writer = await handle.createWritable(); await writer.write(text); await writer.close(); }
  else { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
