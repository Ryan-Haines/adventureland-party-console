"use client";
// The settings menu's Account > Marketplace section, which was the stand sheet's Marketplace
// settings dialog: the automatic stand buy orders, the ignored market items and the merchant
// blacklist. The stand sheet's gear opens the menu here.
import { useState } from "react";
import { AddonSlot } from "../../../runtime/hooks/dashboard/slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClock } from "@/hooks/use-clock";
import { IgnoredMarketItems, MarketSettingsSection } from "./market-preferences";
import { usePartyAction } from "./query-actions";
import { WTBPreference, autoStandExplanation } from "./wtb-preferences";
import { emptyRecord } from "./empty-values";
import type { MarketItemIdentity } from "../../../runtime/items/api.ts";
import type { PartyConsoleModel } from "./use-party-console";

export function MarketplaceSettings({ model }: { model: PartyConsoleModel }) {
  const { state, post } = model;
  const now = useClock();
  const action = usePartyAction();
  const [confirmBlacklistClear, setConfirmBlacklistClear] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [blacklistName, setBlacklistName] = useState('');
  const [blacklistMinutes, setBlacklistMinutes] = useState('60');
  const autoStandBuys = state.autoStandBuys === true, autoBlacklistMerchants = state.autoBlacklistMerchants !== false;
  const marketIgnoredItems = state.marketIgnoredItems || [];
  const blacklist = state.merchantBlacklist || emptyRecord();
  const catalog = state.merchantCatalog?.allItems || [];
  const marketItemLabel = (item: MarketItemIdentity) => {
    const known = catalog.find(entry => entry.id === item.name);
    return `${known?.name||item.name}${known?.upgradeable||known?.compoundable||known?.meta?.upgradeable||known?.meta?.compoundable||item.level?' +'+(item.level??0):''}`;
  };
  // Answers whether the save went through; a refusal shows in settingsError.
  const saveMarketSetting = async (save: () => Promise<unknown>) => {
    setSettingsSaving(true);
    setSettingsError('');
    try {
      await save();
      return true;
    } catch (failure) {
      setSettingsError(failure instanceof Error ? failure.message : 'Could not save marketplace settings');
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };
  const onAutoStandBuys = (enabled: boolean) => post('/merchant/native-stand', { action: 'configure', enabled });
  const updateIgnored = (actionName: 'remove' | 'clear', item?: MarketItemIdentity) =>
    saveMarketSetting(() => action.mutateAsync({ path: '/market/ignored-items', body: { action: actionName, ...item, level: item?.level ?? 0 } }));
  const updateBlacklist = (payload: Record<string, unknown>) =>
    saveMarketSetting(() => action.mutateAsync({ path: '/merchant/blacklist', body: payload }));
  const blacklistRecords = Object.entries(blacklist).sort(([, a], [, b]) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return (
    <section data-area="market-settings" className="space-y-4">
      <section className="space-y-3 rounded border border-violet-700 bg-black p-3">
        <h3 className="text-sm font-semibold text-violet-100">
          Stand buy orders
        </h3>
        <WTBPreference
          label="Automatically fill empty stand slots with highest priority buy order"
          description={autoStandExplanation}
          checked={autoStandBuys}
          disabled={settingsSaving}
          onChange={(value) =>
            void saveMarketSetting(() => onAutoStandBuys(value))
          }
        />
      </section>
      <IgnoredMarketItems items={marketIgnoredItems} label={marketItemLabel} disabled={settingsSaving}
        onRemove={item=>void updateIgnored('remove',item)} onClear={()=>void updateIgnored('clear')}/>
      <MarketSettingsSection title="Marketplace merchant blacklist" count={blacklistRecords.length} disabled={settingsSaving}
        clearLabel={confirmBlacklistClear?'Really clear all?':'Clear all'} clearAriaLabel={confirmBlacklistClear?'Confirm clearing all merchant blacklist entries':'Clear all merchant blacklist entries'}
        onClear={()=>{if(confirmBlacklistClear){setConfirmBlacklistClear(false);void updateBlacklist({action:'clear'});}else setConfirmBlacklistClear(true);}}>
        <WTBPreference
          label="Enable blacklisting unavailable merchants"
          description="Adds a strike when the merchant reaches an advertised seller but the seller is not visible or their stand stays closed during the bounded wait. Retries pause for 1, 2, 4, 8... minutes after successive strikes. Changed or sold listings and unreachable routes do not cause strikes. Disabling this ignores automatic strikes and stops new ones; manual blocks still apply."
          checked={autoBlacklistMerchants}
          disabled={settingsSaving}
          onChange={(enabled) =>
            void updateBlacklist({ action: 'configure', enabled })
          }
        />
        <div className="grid grid-cols-[1fr_8rem_auto] gap-2">
          <Input
            value={blacklistName}
            onChange={(event) => setBlacklistName(event.target.value)}
            placeholder="Merchant name"
            className="border-slate-700 bg-black"
          />
          <Input
            inputMode="numeric"
            value={blacklistMinutes}
            onChange={(event) =>
              setBlacklistMinutes(
                event.target.value.replace(/[^0-9-]/g, ''),
              )
            }
            placeholder="Minutes / -1"
            className="border-slate-700 bg-black"
          />
          <Button
            onClick={async () => {
              const saved = await updateBlacklist({
                action: 'add',
                seller: blacklistName.trim(),
                minutes: Number(blacklistMinutes),
              });
              if (saved) setBlacklistName('');
            }}
            className="bg-rose-700 text-white hover:bg-rose-600"
          >
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {blacklistRecords.length ? (
            blacklistRecords.map(([key, entry]) => {
              const coolingDown = entry.until === -1 || entry.until > now;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 rounded border bg-black p-2 ${coolingDown ? 'border-rose-800' : 'border-amber-800'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        coolingDown
                          ? 'font-semibold text-rose-200'
                          : 'font-semibold text-amber-200'
                      }
                    >
                      {entry.seller}
                    </p>
                    <p className="font-mono text-[10px] text-slate-300">
                      {entry.serverRegion || 'all regions'}{' '}
                      {entry.serverIdentifier || 'all servers'} ·{' '}
                      {entry.reason || 'manual'} · {entry.failures || 0}{' '}
                      strikes ·{' '}
                      {entry.until === -1
                        ? 'blocked forever'
                        : coolingDown
                          ? `${Math.max(1, Math.ceil((entry.until - now) / 60000))}m until retry`
                          : 'eligible for retry'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void updateBlacklist({ action: 'clear', key })
                    }
                    className="border-emerald-700 bg-black text-emerald-200 hover:bg-emerald-950 hover:text-white"
                  >
                    Clear
                  </Button>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-emerald-100/45">
              No merchant strike records.
            </p>
          )}
        </div>
      </MarketSettingsSection>
      {settingsError && (
        <p role="alert" className="text-sm text-rose-200">
          {settingsError}
        </p>
      )}
      <AddonSlot name="dialog-section" part="market-settings" />
    </section>
  );
}
