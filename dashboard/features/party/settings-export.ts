import { API } from './api';
interface SaveHandle { createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }
export async function exportSettings() {
  const filename = `party_console_settings_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')}.json`;
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<SaveHandle> }).showSaveFilePicker;
  const handle = picker ? await picker.call(window, { suggestedName: filename, types: [{ description: 'JSON settings', accept: { 'application/json': ['.json'] } }] }) : null;
  const response = await fetch(`${API}/dashboard-state/export`);
  if (!response.ok) { const body = await response.text(); let message = body; try { message = JSON.parse(body).error || body; } catch { /* Preserve non-JSON server errors. */ } throw new Error(message || `HTTP ${response.status} ${response.statusText}`); }
  const text = JSON.stringify(await response.json(), null, 2);
  if (handle) { const writer = await handle.createWritable(); await writer.write(text); await writer.close(); }
  else { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
