"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PartyActionError, usePartyAction } from "./query-actions";
import { key, read, useDomain } from "./query-cache";

// The settings controls' side of the settings owner's writer.
// - A settings control stays locked, showing loading, until the dashboard's first `config`
//   read and the page's settings read have arrived, so no control writes from a default it shows
//   before the console answered.
// - The page's basis: each write through the settings route sends the `settingsAt` of the page's
//   `GET /party-api/settings` read, and the page reads it again after each write.
// - A write refused as out of date shows the console's current value and a notice saying
//   the change was not saved because the page was out of date.

interface SettingsPage { settingsAt: number; settings: DeclaredSetting[] }
function useSettingsPage() {
  const client = useQueryClient();
  return useQuery({ queryKey: ['party', 'settings-page'], queryFn: ({ signal }) => read<SettingsPage>(client, '/settings', signal),
    staleTime: Infinity });
}
/** True once the controls may write: the config read and the page's settings read have arrived. */
export function useSettingsReady(): boolean {
  const config = useDomain('config'), page = useSettingsPage();
  return config.data !== undefined && page.data !== undefined;
}

export interface SettingsChange { field: string; value: unknown; character?: string }
// One declared setting as the settings owner's settings read lists it (runtime/settings/coordinator/routes/settings.ts).
export interface DeclaredSetting { field: string; label?: string; value?: unknown; min?: number; max?: number }

export function useSettingsWrite() {
  const client = useQueryClient();
  const ready = useSettingsReady();
  const page = useSettingsPage();
  const action = usePartyAction();
  const [notice, setNotice] = useState<string | null>(null);
  async function write(changes: SettingsChange[]): Promise<boolean> {
    action.reset();
    setNotice(null);
    try {
      await action.mutateAsync({ path: '/settings', body: { changes, basis: page.data?.settingsAt } });
      return true;
    } catch (error) {
      // `notice` holds every refusal, so a control that draws it shows each failed write (issue #14).
      if (error instanceof PartyActionError && error.status === 409 && error.details.reason === 'out of date') {
        const field = String(error.details.field ?? 'This setting'), who = error.details.character ? ` for ${error.details.character}` : '';
        setNotice(`${field}${who} was not saved: the page was out of date, so it now shows the console's current value. Make the change again if you still want it.`);
      } else setNotice(error instanceof Error ? error.message : String(error));
      action.reset();
      // performAction refreshes config and core after a saved write; a refused one reads them here,
      // so the controls show the console's values.
      void client.invalidateQueries({ queryKey: key('config') });
      void client.invalidateQueries({ queryKey: key('core') });
      return false;
    } finally {
      // The next write's basis is the page's new read.
      void page.refetch();
    }
  }
  // A declared setting's value from the page's read (the settings owner's settings list), for a field with no
  // section of its own.
  const value = (field: string): unknown => page.data?.settings.find(entry => entry.field === field)?.value;
  // Every declared setting the page shows, for the lock list, the card's labels and a
  // control's range.
  const fields = page.data?.settings ?? [];
  const declared = (field: string) => fields.find(entry => entry.field === field);
  return { ready, write, value, fields, declared, notice, pending: action.isPending };
}
