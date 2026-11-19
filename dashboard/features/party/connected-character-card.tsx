'use client';
import { CharacterSessionControls } from './character-session-controls';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { EventSelectionControl } from './event-selection-control';
import { Coins } from 'lucide-react';
import { abbreviatedGold } from './abbreviated-gold';
import { CharacterMapSection } from './character-map-section';
import { MonsterDetailsDialog } from './monster-details-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FarmingModeControl } from './farming-mode-control';
import { AddonCard, AddonSlot, addonSections, useAddonSlots } from '../../../runtime/hooks/dashboard/slots';
import { CardRoutinePicks } from './card-routine-picks';
import { CardNameStrip } from './card-name-strip';
import { StatusIconRow } from './status-icon-row';
import { usePinTopBar } from './pin-top-bar';
import { farmingContext } from './farming-context';
import { GoldTargetControl } from './gold-target-control';
import { MerchantCardControls } from './merchant-card-controls';
import { Meter } from './meter';
import { MonsterFocusPicker } from './monster-focus-picker';
import { RestockControls } from './restock-controls';
import { CharacterStatsTrigger } from './character-stats-trigger';
import type { CharacterCardModel, InventoryModel } from './character-card-model';
import { XpMeter } from './xp-meter';
import { MonsterRouteButton } from './monster-route-button';

import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useCharacterData } from './dashboard-live';
import { ConnectedInventory } from './connected-inventory';
import { ConnectedCombatLog } from './connected-combat-log';
import { emptyArray, emptyRecord } from './empty-values';
import type { Char } from './char';
import type { PassivePatch } from './passive-hunting-menu';
import type { PartyState } from './party-state';
import type { SlotChoice } from './farming-mode-control';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { audited } from './field-read-audit';
import { HandControlToggle } from './hand-control';
import { useSettingsWrite } from './settings-write';
import { CardCombatFields } from './card-combat-fields';
import { defaultSearchRadius } from '../../../runtime/hunting/api.ts';
import { normalizedRealm } from '../../../runtime/protocol/realm.ts';
import { CC_MAX, ccWarning } from './call-meter';

export const ConnectedCharacterCard = memo(function ConnectedCharacterCard({
  name,
  model,
  inventoryModel,
}: {
  name: string;
  model: CharacterCardModel;
  inventoryModel: InventoryModel;
}) {
  const diagnostics = useCharacterData(name, 'diagnostics');
  const vitals = useCharacterData(name, 'vitals');
  // The two mode rows' entries and the add-on sections (runtime/hooks/dashboard/slots.tsx).
  const slots = useAddonSlots();
  // The name strip shows only while "Pin top bar" is on (pin-top-bar.tsx).
  const [pinned] = usePinTopBar();
  const identity = useRef<HTMLDivElement>(null);
  const baseCharacter = model.state.characters[name];
  const char = useMemo(() => audited('merged', {
    ...baseCharacter,
    ...diagnostics,
    ...vitals,
  } as Char), [baseCharacter, diagnostics, vitals]);
  const presence = useCharacterData(name, 'presence');
  const {
    state,
    formation,
    logout,
    monsters,
    post,
    setFarmingSlot,
    setSelectedCondition,
    command,
    bankParty,
    clearMerchantWork,
    setForceStand,
    cancelMerchantJob,
    setRoutinesOpen,
    gather,
    refresh,
    setCommerceMode,
    setDonationOpen,
    setGiveawayRealm,
    setGiveawayMerchant,
    setGiveawayOpen,
    findMonsterFor,
    selectedFocus,
    setFocus,
    saveRestock,
    setAnniversaryOpen,
    setSelectedBestiaryMonster,
    setActionError,
    setMonsterNavigateTarget,
    setSelected,
    monsterAchievements,
    thresholdError,
    itemCollectionThresholdError,
    clearCollectionErrors,
    threshold,
    editThreshold,
    save,
    itemCollectionThreshold,
    editItemCollectionThreshold,
    saveItemCollectionThreshold,
    farmingSettingsCharacter,
    setFarmingSettingsCharacter,
  } = model;
  const onFarmingSettingsOpenChange = useCallback((open: boolean) => {
    setFarmingSettingsCharacter(current => open ? name : current === name ? null : current);
  }, [name, setFarmingSettingsCharacter]);
  // MonsterFocusPicker is memoized, but formation={state} would hand it the
  // whole (frequently-changing) state object even though routing only needs
  // leader/followers; narrowing it lets unrelated state churn skip a re-render.
  const routingFormation = useMemo(
    () => ({ leader: state.leader, followers: state.followers, merchantCharacter: state.merchantCharacter }),
    [state.leader, state.followers, state.merchantCharacter],
  );
  const monsterFocusSelected = state.monsterFocusByCharacter?.[name] || selectedFocus;
  const monsterFocusPriorities = state.monsterPrioritiesByCharacter?.[name] || emptyRecord<number>();
  const renderMonsterRouteButton = useCallback(
    (focus: string[]) => (
      <MonsterRouteButton formation={routingFormation} character={name} onRoute={() => findMonsterFor(name, focus)} />
    ),
    [routingFormation, name, findMonsterFor],
  );
  const onMonsterFocusChange = useCallback((focus: string[]) => setFocus(name, focus), [setFocus, name]);
  const onMonsterPriorityChange = useCallback(
    (priorities: Record<string, number>) => setFocus(name, monsterFocusSelected, priorities),
    [setFocus, name, monsterFocusSelected],
  );
  const onSelectCondition = useCallback(
    (condition: import('./condition').Condition) => setSelectedCondition({ character: name, condition }),
    [setSelectedCondition, name],
  );
  const onAnniversary = useCallback(() => setAnniversaryOpen(true), [setAnniversaryOpen]);
  const onEventSelectionChange = useCallback(
    (eventSelections: string[]) => formation({ character: name, eventSelections }),
    [formation, name],
  );
  const onEventLimitsChange = useCallback(
    (event: string, limits: import('../../../runtime/events/api').EventLimits) => formation({ character: name, eventLimits: { event, limits } }),
    [formation, name],
  );
  const onEventPriorityChange = useCallback(
    (eventPriorities: string[]) => formation({ character: name, eventPriorities }),
    [formation, name],
  );
  const onHandChange = useCallback(
    (handControl: Partial<import('./hand-control').HandControl>) => formation({ character: name, handControl }),
    [formation, name],
  );
  const onFollowChange = useCallback(
    (checked: boolean) => formation({ character: name, follow: !!checked }),
    [formation, name],
  );
  const onGoldTargetSave = useCallback(
    (amount: number) => command(name, 'gold-target', undefined, { amount }),
    [command, name],
  );
  const onGoldTargetBank = useCallback(async () => { await command(name, 'bank'); }, [command, name]);
  const eventState = useMemo(
    () => ({
      leader: state.leader,
      merchantCharacter: state.merchantCharacter,
      followers: state.followers,
      eventsByCharacter: state.eventsByCharacter,
      eventAttendance: state.eventAttendance,
      eventLimitsByCharacter: state.eventLimitsByCharacter,
      eventPrioritiesByCharacter: state.eventPrioritiesByCharacter,
      eventSelectionsByCharacter: state.eventSelectionsByCharacter,
      eventSchedules: state.eventSchedules,
    }),
    [state.leader, state.merchantCharacter, state.followers, state.eventsByCharacter,
      state.eventSelectionsByCharacter, state.eventPrioritiesByCharacter, state.eventLimitsByCharacter, state.eventAttendance, state.eventSchedules],
  );
  const onRadiusSave = useCallback(
    (radius: number) => setFocus(name, monsterFocusSelected, monsterFocusPriorities, radius),
    [setFocus, name, monsterFocusSelected, monsterFocusPriorities],
  );
  const onRareChange = useCallback(
    async (settings: PassivePatch) => { await post('/rare-hunting', settings); },
    [post],
  );
  const onHuntSettingsSave = useCallback(
    async (patch: Partial<NonNullable<PartyState["huntSettings"]>>) => {
      await post("/hunt-settings", { ...patch, character: name });
    },
    [post, name],
  );
  // The party's root relocation switch, through the settings route with the page's basis.
  const settings = useSettingsWrite();
  // Every control on the card that writes a saved setting shows loading and stays locked until the
  // console's settings arrive. A disabled fieldset locks the native buttons, inputs and popover
  // triggers inside it; the Base UI Checkbox and Radio render a span that only their own
  // `disabled` locks.
  const locked = !settings.ready;
  const lock = { disabled: locked, 'aria-busy': locked };
  const onRelocate = useCallback(
    async (on: boolean) => { await settings.write([{ field: "relocateIfCompeting", value: on }]); },
    [settings],
  );
  const restockControls = useMemo(
    () => <RestockControls character={name} value={state.restockPolicies?.[name]} onSave={saveRestock}/>,
    [name, state.restockPolicies?.[name], saveRestock],
  );
  const merchantCatalogAllItems = useMemo(
    () => state.merchantCatalog?.allItems || emptyArray<MerchantCatalogItem>(),
    [state.merchantCatalog],
  );
  const renderMonsterDetails = useCallback(
    (id: string, close: () => void): ReactNode => {
      const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
      if (!monster) return <Dialog open onOpenChange={open => { if (!open) close(); }}>
        <DialogContent data-area="card-monster" className="border-emerald-700 bg-[#081713] text-emerald-50">
          <DialogHeader><DialogTitle>Monster details</DialogTitle><DialogDescription className="text-emerald-100">Details are not available for {id} yet.</DialogDescription></DialogHeader>
        </DialogContent>
      </Dialog>;
      return <MonsterDetailsDialog monster={monster} catalog={merchantCatalogAllItems}
        monsters={state.bestiaryCatalog || []} skills={state.skillCatalog || []}
        achievement={monsterAchievements[id] || null}
        onOpenChange={open => { if (!open) close(); }}
        onNavigate={setMonsterNavigateTarget}
        onInspectDrop={(itemId, monsterName) => {
          const item = state.merchantCatalog?.allItems?.find(entry => entry.id === itemId);
          if (item) { close(); setSelected({ character: `Dropped by ${monsterName}`, entry: { slot: -1, item: { name: itemId }, meta: item.meta } }); }
        }} />;
    },
    [state.bestiaryCatalog, merchantCatalogAllItems, monsterAchievements, setMonsterNavigateTarget,
      state.merchantCatalog, state.skillCatalog, setSelected],
  );
  const onInspectMonster = useCallback(
    (id: string) => {
      const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
      if (monster) setSelectedBestiaryMonster(monster);
      else setActionError(`Monster details are not available for ${id} yet.`);
    },
    [state.bestiaryCatalog, setSelectedBestiaryMonster, setActionError],
  );
  const onClearBlacklist = useCallback(
    async (monsterId?: string) => {
      await post(
        '/hunt-blacklist',
        monsterId
          ? { action: 'remove', monsterId, character: name }
          : { action: 'clear', character: name },
      );
    },
    [post, name],
  );
  const onAddBlacklist = useCallback(async (monsterId: string) => {
    await post('/hunt-blacklist', {action:'add',monsterId,character:name});
  }, [post,name]);
  const onSelectFarmingSlot = useCallback(
    (choice: SlotChoice) => void setFarmingSlot(choice, name),
    [setFarmingSlot, name],
  );
  const saveAddon = useCallback(async (addon: string, body: Record<string, unknown>) => {
    await post('/addon-farming', { name: addon, character: name, ...body });
  }, [post, name]);
  // An add-on's own command for this character (`addon.command`): a card piece's `send`, and the
  // `save` of a section whose add-on fills no target mode entry.
  const sendAddon = useCallback(async (addon: string, body: unknown) => {
    await post('/addon-command', { name: addon, character: name, body });
  }, [post, name]);
  const collectionSettings = useMemo(
    () => ({
      thresholdError, itemCollectionThresholdError, onClearErrors: clearCollectionErrors,
      threshold, onThresholdChange: editThreshold, onThresholdSave: save,
      itemCollectionThreshold, onItemCollectionThresholdChange: editItemCollectionThreshold,
      onItemCollectionThresholdSave: saveItemCollectionThreshold,
    }),
    [thresholdError, itemCollectionThresholdError, clearCollectionErrors, threshold, editThreshold,
      save, itemCollectionThreshold, editItemCollectionThreshold, saveItemCollectionThreshold],
  );
  const onRoutines = useCallback(() => setRoutinesOpen(true), [setRoutinesOpen]);
  const onBuy = useCallback(() => { void refresh(true); setCommerceMode('buy'); }, [refresh, setCommerceMode]);
  const onCraft = useCallback(() => { void refresh(true); setCommerceMode('craft'); }, [refresh, setCommerceMode]);
  const onExchange = useCallback(() => { void refresh(true); setCommerceMode('exchange'); }, [refresh, setCommerceMode]);
  const onDonate = useCallback(() => setDonationOpen(true), [setDonationOpen]);
  const onGiveaway = useCallback(() => {
    const current = state.merchantCharacter && state.characters[state.merchantCharacter]?.server;
    setGiveawayRealm(normalizedRealm(current) || state.giveawayRealms?.[0]?.key || '');
    setGiveawayMerchant('');
    setGiveawayOpen(true);
  }, [state.merchantCharacter, state.characters, state.giveawayRealms, setGiveawayRealm, setGiveawayMerchant, setGiveawayOpen]);
  const farming = farmingContext(state, name);
  // The card's hooks all run before the awaiting branch, so a status arriving between renders keeps
  // the hook order React checks.
  const memberNames = Object.keys(state.characters).sort().join(',');
  const addonCard = useMemo(() => ({ members: memberNames ? memberNames.split(',') : [], scope: farming.owner, send: sendAddon }), [memberNames, farming.owner, sendAddon]);
  if (!vitals || !diagnostics)
    return (
      <article data-area="card-awaiting" className="rounded border border-emerald-800 bg-[#0b1916] p-5 text-emerald-100">
        {name}: awaiting status
      </article>
    );
  const addonFarming = addonSections(slots, { state, owner: farming.owner, inherited: !!farming.followingLeader, save: saveAddon, command: sendAddon,
    monsters: { kills: char.monsterAchievementKills ?? {}, achievements: monsterAchievements, bestiary: state.bestiaryCatalog,
      choices: state.monsterChoices, catalog: monsters, inspect: onInspectMonster, renderDetails: renderMonsterDetails } });
  const online = !!presence?.seenAt;
  // What the card's add-on pieces read: the character and each add-on's own report; `addonCard`
  // adds the party's character names, the farming scope for the scope store and the send to the
  // add-on's own command.
  const card = { character: char.name, reports: char.addonReports };
  const slot = state.activeSlots?.find((entry) => entry.character === name);
  return (
    <AddonCard value={addonCard}>
    <article
      data-area="character-card"
      key={char.name}
      className={`relative isolate min-w-0 self-start overflow-clip rounded-lg border border-emerald-900/80 bg-[#0b1916] shadow-2xl shadow-black/20`}
    >
      {pinned ? <CardNameStrip char={char} identity={identity} /> : null}
      <div className="border-b border-emerald-900/70 p-5">
        <div ref={identity} className="flex items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CharacterStatsTrigger character={char} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                />
                <h2
                  className="min-w-0 flex-1 truncate text-xl font-semibold"
                  title={char.name}
                >
                  {char.name}
                </h2>
                <CharacterSessionControls
                  name={char.name}
                  slot={slot}
                  pending={
                    !!state.steamSwitch?.phase &&
                    state.steamSwitch.phase !== 'complete'
                  }
                  onLogout={logout}
                  onHeadless={model.moveSteamToHeadless}
                  onSteam={model.joinOrPromoteSteam}
                  primaryCharacter={state.activeSlots?.find(entry => entry.primary)?.character || null}
                />
              </div>
              <p className="mt-1 font-mono text-xs uppercase text-emerald-200/55">
                Lv {char.level} {char.ctype} {char.primaryStat || ''} ·{' '}
                {char.server || 'realm unknown'}
                <span className="normal-case">
                  {' '}
                  ·{' '}
                  {online &&
                  typeof char.ping === 'number' &&
                  Number.isFinite(char.ping) &&
                  char.ping >= 0
                    ? `${Math.round(char.ping)}ms`
                    : '—ms'}
                </span>
              </p>
              {char.activity ? (
                <p className="mt-0.5 truncate font-mono text-xs text-emerald-100/80" title={char.activity.text} data-testid="character-activity">
                  {char.activity.text}
                  {char.activity.notice ? (
                    <span className="ml-2 text-amber-300" data-testid="character-activity-notice">{char.activity.notice}</span>
                  ) : null}
                </p>
              ) : null}
              {/* The `card-line` slot (12 D4 part 4): each add-on's line under table L's, with its name. */}
              {char.activity?.addons?.map(({ addon, label }) => (
                <p key={addon} className="truncate font-mono text-xs text-sky-200/80" title={`${addon}: ${label}`} data-testid="character-addon-line" data-addon-slot="card-line">
                  <span className="text-slate-400">{addon}:</span> {label}
                </p>
              ))}
              <XpMeter value={char.xp || 0} max={char.max_xp || 0} />
              {char.banking ? (
                <span className="rounded bg-amber-300/10 px-2 py-1 font-mono text-xs text-amber-300">
                  BANKING
                </span>
              ) : char.bankQueued ? (
                <span className="rounded bg-cyan-300/10 px-2 py-1 font-mono text-xs text-cyan-300">
                  BANK QUEUED
                </span>
              ) : char.stocking ? (
                <span className="rounded bg-violet-300/10 px-2 py-1 font-mono text-xs text-violet-300">
                  STOCKING UP
                </span>
              ) : null}
              <AddonSlot name="card-section" part="identity" {...card} />
            </div>
          </div>
        </div>
        <CharacterMapSection char={char} />
        <fieldset {...lock} className="mt-4 flex min-w-0 flex-wrap gap-x-5 gap-y-2 rounded border border-emerald-900/70 bg-black/20 p-3 text-sm">
          <label
            htmlFor={`leader-${char.name}`}
            className="flex items-center gap-2"
          >
            <RadioGroupItem id={`leader-${char.name}`} value={char.name} disabled={locked} />
            <span>Leader</span>
          </label>
          {/* A78: the merchant farms in its own scope, so its card offers no Follow mark. */}
          {char.name !== state.merchantCharacter && <label
            htmlFor={`follow-${char.name}`}
            className="flex items-center gap-2"
          >
            <Checkbox
              id={`follow-${char.name}`}
              checked={!!state.followers?.[char.name]}
              disabled={locked}
              onCheckedChange={onFollowChange}
            />
            <span>Follow</span>
          </label>}
          <HandControlToggle name={char.name} slot={slot} value={state.handControlByCharacter?.[char.name]} onChange={onHandChange} />
          <EventSelectionControl onAnniversary={onAnniversary}
            state={eventState}
            name={char.name}
            onChange={onEventSelectionChange} onPriorityChange={onEventPriorityChange} onLimitsChange={onEventLimitsChange}
          />
          <AddonSlot name="card-section" part="controls" {...card} />
        </fieldset>
        <div className="mt-5 grid gap-3">
          <Meter
            label="HP"
            value={char.hp}
            max={char.max_hp}
            color="bg-rose-400"
          />
          <Meter
            label="MP"
            value={char.mp}
            max={char.max_mp}
            color="bg-cyan-400"
          />
          <Meter
            label="CC"
            value={char.cc || 0}
            max={CC_MAX}
            color={ccWarning(char.cc) ? "bg-red-900" : "bg-white"}
          />
          <AddonSlot name="card-section" part="vitals" {...card} />
        </div>
        <StatusIconRow conditions={char.conditions || emptyArray()} onSelect={onSelectCondition} />
        {settings.notice ? <p role="alert" className="text-xs text-amber-200">{settings.notice}</p> : null}
        <fieldset {...lock} className="contents">
        {char.ctype !== 'merchant' ? (
          <FarmingModeControl
            settingsOpen={farmingSettingsCharacter === name}
            onSettingsOpenChange={onFarmingSettingsOpenChange}
            farmArea={farming.farmArea}
            radius={state.monsterSearchRadiusByCharacter?.[char.name] || defaultSearchRadius}
            radiusContext={
              farming.followingLeader
                ? `Following ${state.leader}: effective radius ${state.monsterSearchRadiusByCharacter?.[String(state.leader)] || defaultSearchRadius}. This input saves ${char.name}'s own radius.`
                : "Radius for Leader"
            }
            onRadiusSave={onRadiusSave}
            passiveRareHunts={state.passiveRareHunts}
            passiveHunting={state.passiveHunting}
            onRareChange={onRareChange}
            followingLeader={farming.followingLeader}
            effectiveCombat={farming.effectiveCombat}
            settingsOwner={farming.owner}
            blacklist={farming.blacklist}
            huntSettings={farming.settings}
            onHuntSettingsSave={onHuntSettingsSave}
            relocate={state.relocateIfCompeting}
            onRelocate={onRelocate}
            catalog={monsters}
            renderMonsterDetails={renderMonsterDetails}
            onInspectMonster={onInspectMonster}
            onClearBlacklist={onClearBlacklist}
            onAddBlacklist={onAddBlacklist}
            effectiveMode={
              char.farmingMode || state.partyFarmingMode || 'default'
            }
            hunt={farming.hunt}
            huntLine={char.activity?.task === 'hunt' ? char.activity.text : undefined}
            characterHunt={char.monsterHunt}
            combatEntries={slots.slots['combat-mode']}
            targetEntries={slots.slots['target-mode']}
            slotsError={slots.error}
            combatMode={farming.combatMode}
            targetMode={farming.targetMode}
            effectiveTarget={farming.effectiveTarget}
            onSelect={onSelectFarmingSlot}
            addonSettings={addonFarming.sections}
            addonStatus={addonFarming.status}
            addonCard={card}
          />
        ) : null}
        </fieldset>
        <CardCombatFields character={char.name} merchant={char.ctype === 'merchant'} />
        <CardRoutinePicks character={char.name} ctype={char.ctype} />
        {char.name === state.merchantCharacter ? (
          <fieldset {...lock} className="contents">
            <GoldTargetControl
              gold={char.gold}
              target={state.goldTargets?.[char.name] ?? 0}
              onSave={onGoldTargetSave}
              onBank={onGoldTargetBank}
            />
          </fieldset>
        ) : (
          <div
            className="mt-4 flex items-center gap-1.5 font-mono text-sm text-amber-300"
            title={`${char.gold.toLocaleString()} gold`}
          >
            <Coins className="h-4 w-4" />
            {abbreviatedGold(char.gold)}
          </div>
        )}
        <AddonSlot name="card-section" part="combat" {...card} />
      </div>
      {char.name === state.merchantCharacter ? (
        <MerchantCardControls
          collectionSettings={collectionSettings}
          state={state}
          onBank={bankParty}
          onClear={clearMerchantWork}
          onForceStand={setForceStand}
          onCancelJob={cancelMerchantJob}
          onRoutines={onRoutines}
          onGather={gather}
          onBuy={onBuy}
          onCraft={onCraft}
          onExchange={onExchange}
          onDonate={onDonate}
          onGiveaway={onGiveaway}
        />
      ) : (
        <div className="border-b border-emerald-900/70 p-4">
          <p className="mb-2 font-mono text-[10px] uppercase text-emerald-100/45">
            Monster focus -{' '}
            {state.monsterSearchRadiusByCharacter?.[
              state.leader || char.name
            ] || defaultSearchRadius}
          </p>
          <fieldset {...lock} className="flex min-w-0 items-center gap-2">
            <MonsterFocusPicker
              renderRouteButton={renderMonsterRouteButton}
              monsters={monsters}
              selected={monsterFocusSelected}
              onChange={onMonsterFocusChange}
              priorities={monsterFocusPriorities}
              onPriorityChange={onMonsterPriorityChange}
            />
          </fieldset>
          <AddonSlot name="card-section" part="focus" {...card} />
        </div>
      )}
      <ConnectedInventory name={char.name} model={inventoryModel} restock={restockControls}/>
      <div className="border-t border-emerald-900/70 p-5"><ConnectedCombatLog character={char.name} /><AddonSlot name="card-section" part="foot" {...card} /></div>
    </article>
    </AddonCard>
  );
});
