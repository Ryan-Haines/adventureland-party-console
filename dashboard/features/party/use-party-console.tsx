"use client";
import type { WTBOptions } from "./wtb-preferences";
import { levelPriceHistory } from "./level-price-history";
import { orderCharacters } from "./character-order";
import { aggregateMonsterAchievements } from "./monster-achievements";
import { canRouteToMonster, FOLLOWER_ROUTE_MESSAGE } from "@/lib/party-routing";
import { type FarmingArea } from "@/lib/farming-areas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALDataBuyOrder } from "./aldata-buy-order";
import { ALDataListing } from "./aldata-listing";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useDomain, domainOptions, key, read, useVisible } from "./query-cache";
import { usePartyAction, type ActionPath } from "./query-actions";
import { API } from "./api";
import { BestiaryMonster } from "./bestiary-monster";
import { Char } from "./char";
import { Condition } from "./condition";
import { FarmingPolicy } from "./farming-policy";
import { InventoryEntry } from "./inventory-entry";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";
import { Location } from "./location";
import { ModelContext } from "./model-context";
import { npcSaleValue } from "./npc-sale-value";
import { PartyState } from "./party-state";
import { PontyListing } from "./ponty-listing";
import { pontyPrice } from "./ponty-price";
import { RestockPolicy } from "./restock-policy";
import { SelectedItem } from "./selected-item";
import { StandListing } from "./stand-listing";
import { STAT_SCROLLS } from "./stat-scrolls";

export function usePartyConsole() {
  const npcSaleInFlight = useRef(false);
  const [npcSaleBusy, setNpcSaleBusy] = useState(false);
  const [threshold, setThreshold] = useState("100000"),
    [itemCollectionThreshold, setItemCollectionThreshold] = useState("1"),
    [_notice, setNotice] = useState(""),
    [selected, setSelected] = useState<SelectedItem | null>(null),
    [selectedCondition, setSelectedCondition] = useState<{
      character: string;
      condition: Condition;
    } | null>(null),
    [gearComparison, setGearComparison] = useState<{
      character: Char;
      entry: InventoryEntry;
      slot?: string;
    } | null>(null),
    [bankOpen, setBankOpen] = useState(false),
    [standOpen, setStandOpen] = useState(false),
    [marketOpen, setMarketOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [realmDestination, setRealmDestination] = useState(""),
    [realmConfirmOpen, setRealmConfirmOpen] = useState(false),
    [realmSetHome, setRealmSetHome] = useState(false),
    [realmBusy, setRealmBusy] = useState(false),
    [aldataKey, setALDataKey] = useState(""),
    [aldataKeyVisible, setALDataKeyVisible] = useState(false),
    [aldataBusy, setALDataBusy] = useState(false),
    [aldataAuthPending, setALDataAuthPending] = useState(false),
    [bestiaryOpen, setBestiaryOpen] = useState(false),
    [selectedBestiaryMonster, setSelectedBestiaryMonster] = useState<BestiaryMonster | null>(null),
    [monsterNavigateTarget, setMonsterNavigateTarget] = useState<BestiaryMonster | null>(null),
    [monsterNavigateBusy, setMonsterNavigateBusy] = useState(false),
    [huntSetup, setHuntSetup] = useState<string[] | null>(null),
    [huntSetupCharacter, setHuntSetupCharacter] = useState<string | null>(null),
    [farmAreaRequest, setFarmAreaRequest] = useState<{
      character: string;
      ids: string[];
    } | null>(null),
    [skillsOpen, setSkillsOpen] = useState(false),
    [catalogOpen, setCatalogOpen] = useState(false),
    [catalogComparison, setCatalogComparison] = useState<InventoryEntry | null>(null),
    [anniversaryOpen, setAnniversaryOpen] = useState(false),
    [mailOpen, setMailOpen] = useState(false),
    [mailDraft, setMailDraft] = useState<{ recipient: string; subject: string; message: string } | null>(null),
    [mailCount, setMailCount] = useState(0),
    [wtbItem, setWtbItem] = useState<{
      item: Item;
      meta?: ItemMeta | null;
    } | null>(null),
    [standItem, setStandItem] = useState<{
      id?: string;
      entry: InventoryEntry;
      price: string;
      quantity: string;
      defaultPrice: number;
      bankPack?: string;
      markAll: boolean;
      auto?: boolean;
    } | null>(null),
    [npcSaleItem, setNpcSaleItem] = useState<{
      targets?: { pack: string; entry: InventoryEntry }[];
      pack?: string;
      source: "bank" | "merchant" | "character";
      character?: string;
      entry: InventoryEntry;
      quantity: string;
      acknowledged: boolean;
    } | null>(null),
    [autoNpcSaleItem, setAutoNpcSaleItem] = useState<(InventoryEntry & { character?: string }) | null>(null),
    [routinesOpen, setRoutinesOpen] = useState(false),
    [commerceMode, setCommerceMode] = useState<"buy" | "craft" | "exchange" | null>(null),
    [donationOpen, setDonationOpen] = useState(false),
    [donationAmount, setDonationAmount] = useState(""),
    [giveawayOpen, setGiveawayOpen] = useState(false),
    [giveawayRealm, setGiveawayRealm] = useState(""),
    [giveawayMerchant, setGiveawayMerchant] = useState(""),
    [giveawayMerchantOpen, setGiveawayMerchantOpen] = useState(false),
    [travelCharacter, setTravelCharacter] = useState<string | null>(null),
    [createOpen, setCreateOpen] = useState(false),
    [pickerSlot, setPickerSlot] = useState<number | null>(null),
    [newName, setNewName] = useState(""),
    [newClass, setNewClass] = useState("ranger"),
    [newLook, setNewLook] = useState(0),
    [creating, setCreating] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const thresholdDirty = useRef(false);
  const itemCollectionThresholdDirty = useRef(false);
  const client = useQueryClient();
  const { mutateAsync } = usePartyAction();
  const post = useCallback((path: ActionPath, body: unknown) => mutateAsync({ path, body }), [mutateAsync]);
  const coreQuery = useDomain("core");
  const catalogQuery = useDomain("catalog");
  const state = useMemo(() => ({ threshold: 100000, marked: {}, characters: {},
    ...coreQuery.data, ...catalogQuery.data }) as PartyState, [coreQuery.data, catalogQuery.data]);
  useEffect(() => {
    if (!thresholdDirty.current && coreQuery.data?.threshold !== undefined) setThreshold(String(coreQuery.data.threshold));
    if (!itemCollectionThresholdDirty.current && coreQuery.data?.itemCollectionThreshold !== undefined)
      setItemCollectionThreshold(String(coreQuery.data.itemCollectionThreshold));
  }, [coreQuery.data?.threshold, coreQuery.data?.itemCollectionThreshold]);
  useEffect(() => {
    const revision = coreQuery.data?.referenceRevision;
    if (!revision) return;
    client.removeQueries({ type: 'inactive', predicate: query =>
      ['catalog', 'reference'].includes(String(query.queryKey[1])) && query.queryKey[2] !== revision });
  }, [client, coreQuery.data?.referenceRevision]);
  async function refresh(includeCatalog = false) {
    if (includeCatalog) await client.query(domainOptions(client, "catalog"));
    else await client.invalidateQueries({ queryKey: key("core") });
  }
  async function refreshMarket() {
    await client.invalidateQueries({ queryKey: key("market") });
  }
  const connectionNotice = coreQuery.isError
    ? "Reconnecting - showing last received data" : coreQuery.data ? "Live" : "Connecting...";
  const visible = useVisible();
  useQueries({ queries: [{
    queryKey: ['party', 'aldata-auth'], queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const result = await read<{ auth?: string }>(client, '/aldata/auth', signal);
      if (result.auth === 'CORRECT') { setALDataAuthPending(false); setNotice('ALData authentication confirmed'); }
      return result;
    },
    enabled: visible, refetchInterval: 15000, staleTime: 0, gcTime: 60000,
  }].filter(() => aldataAuthPending) });
  async function aldataAction(action: "generate" | "reveal" | "send" | "check" | "refresh") {
    setALDataBusy(true);
    setActionError(null);
    try {
      if (action === "send") {
        const response = await fetch(`${API}/aldata/key`);
        const result = await response.json() as { key?: string };
        if (!response.ok || !result.key) throw new Error("Generate an ALData key first");
        setMailDraft({ recipient: "earthiverse", subject: "aldata_auth", message: result.key });
        setSettingsOpen(false); setMailOpen(true);
        return;
      }
      const endpoint =
        action === "generate" || action === "reveal"
          ? "/aldata/key"
          : action === "check"
              ? "/aldata/auth"
              : "/aldata/refresh";
      const method = action === "reveal" || action === "check" ? "GET" : "POST";
      const response = await fetch(`${API}${endpoint}`, {
        method,
        headers: { "Content-Type": "application/json" },
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(typeof body.error === "string" ? body.error : "ALData request failed");
      if (typeof body.key === "string") setALDataKey(body.key);
      if (action === "generate") setALDataKeyVisible(true);
      if (action === "check")
        setNotice(`ALData auth: ${typeof body.auth === "string" ? body.auth : "unknown"}`);
      if (action === "refresh") {
        setNotice("ALData marketplace refreshed");
        await refreshMarket();
      }
      await refresh(false);
    } catch (error) {
      setActionError(String((error as Error).message || error));
    } finally {
      setALDataBusy(false);
    }
  }
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: "set_bank_threshold",
          title: "Set bank threshold",
          description: "Set the party gold threshold that triggers a bank run.",
          inputSchema: {
            type: "object",
            properties: { threshold: { type: "integer", minimum: 0 } },
            required: ["threshold"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const value = (input as { threshold?: unknown }).threshold;
            if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error("Invalid threshold");
            await post("/config", { threshold: value });
            return { threshold: value };
          },
        },
        { signal: lifecycle.signal },
      ),
    );
    void Promise.resolve(
      context.registerTool(
        {
          name: "send_character_to_bank",
          title: "Send character to bank",
          description: "Queue a bank run for one active owned character.",
          inputSchema: {
            type: "object",
            properties: { character: { type: "string" } },
            required: ["character"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const name = (input as { character?: unknown }).character;
            if (typeof name !== "string" || !state.characters[name])
              throw Error("Unknown character");
            await post("/command", { character: name, type: "bank" });
            return { character: name, queued: true };
          },
        },
        { signal: lifecycle.signal },
      ),
    );
    return () => lifecycle.abort();
  }, [state.characters, post]);
  async function switchRealm() {
    if (!realmDestination) return;
    setRealmBusy(true);
    try {
      await post("/realm/switch", {
        realm: realmDestination,
        setHome: realmSetHome,
      });
      setRealmConfirmOpen(false);
      setNotice(
        `Switching the party to ${state.realmControl?.realms.find((realm) => realm.key === realmDestination)?.label || realmDestination}`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Realm switch failed");
    } finally {
      setRealmBusy(false);
    }
  }
  async function spawn(slot: number, character: string, hosting: "headless" | "steam" = "headless") {
    try {
      if (hosting === "steam") await post("/steam/action", { character, action: "login" });
      else await post(`/slots/${slot}/spawn`, { character });
      setPickerSlot(null);
      setNotice(`${character} is starting`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Spawn failed");
    }
  }
  async function logout(slot: number) {
    try {
      const entry = state.activeSlots?.find(s => s.index === slot);
      if (entry?.kind === "native") await post("/steam/action", { character: entry.character, action: "logout" });
      else await post(`/slots/${slot}/logout`, {});
      setNotice("Character logged out");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Logout failed");
    }
  }
  async function switchSteam(character: string) {
    try {
      await post("/steam/action", { character, action: "primary" });
      setPickerSlot(null);
      setNotice(`Steam switch to ${character} requested`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Steam switch failed");
    }
  }
  async function joinOrPromoteSteam(character: string, action: "login" | "primary") {
    try {
      await post("/steam/action", { character, action });
      setNotice(`Steam ${action === "login" ? "login" : "primary switch"} for ${character} requested`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Steam handoff failed");
      throw error;
    }
  }
  async function moveSteamToHeadless(character: string) {
    try {
      await post("/steam/action", { character, action: "headless" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Steam handoff failed");
    }
  }
  async function recoverSteamHandoff() {
    try {
      await post("/steam/recover", {});
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Steam recovery failed");
    }
  }
  async function createCharacter() {
    if (!/^[A-Za-z0-9_]{4,12}$/.test(newName))
      return setNotice("Name must be 4-12 letters, numbers, or underscores");
    setCreating(true);
    try {
      const result = await post("/roster/create", {
        name: newName,
        class: newClass,
        look: newLook,
      });
      const assignedSlot = typeof result.slot === "number" ? result.slot : null;
      setCreateOpen(false);
      setNewName("");
      setNotice(
        assignedSlot
          ? `${newName} created in slot ${assignedSlot}`
          : `${newName} created in the roster`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  }
  async function save() {
    const n = Number(threshold);
    if (!Number.isSafeInteger(n) || n < 0) return setNotice("Use a positive whole number");
    try {
      await post("/config", { threshold: n });
      thresholdDirty.current = false;
      setThreshold(String(n));
      setNotice("Threshold saved");
    } catch {
      setNotice("Save failed");
    }
  }
  async function saveItemCollectionThreshold() {
    const value = Number(itemCollectionThreshold);
    if (!Number.isSafeInteger(value) || value < 1 || value > 42)
      return setNotice("Use an item-slot threshold from 1 to 42");
    try {
      await post("/config", { itemCollectionThreshold: value });
      itemCollectionThresholdDirty.current = false;
      setItemCollectionThreshold(String(value));
      setNotice("Automatic item collection saved");
    } catch {
      setNotice("Save failed");
    }
  }
  async function command(
    character: string,
    type:
      | "bank"
      | "town"
      | "go-home"
      | "return-leader"
      | "equip"
      | "use-item"
      | "unequip"
      | "mark"
      | "merchant-mark"
      | "auto-item-mark"
      | "clear-auto-item-marks"
      | "remove-auto-item-mark"
      | "clear-auto-compounds"
      | "clear-auto-upgrades"
      | "update-auto-upgrade-rule"
      | "give"
      | "withdraw"
      | "upgrade-mark"
      | "auto-upgrade-mark"
      | "clear-item-marks"
      | "stat-scroll-mark"
      | "buy-copy"
      | "compound-mark"
      | "auto-compound-mark"
      | "auto-exchange"
      | "merchant-weapon"
      | "gold-target",
    item?: Item,
    extra: Record<string, unknown> = {},
  ) {
    try {
      await post("/command", { character, type, item, ...extra });
      setNotice(
        type === "mark"
          ? "Bank mark updated"
          : type === "merchant-mark"
            ? "Merchant mark updated"
            : type === "auto-item-mark"
              ? "Automatic item mark updated"
              : type === "auto-upgrade-mark"
                ? "Automatic upgrade mark updated"
                : type === "clear-auto-item-marks"
                  ? `Automatic ${String(extra.mode)} marks cleared`
                  : type === "remove-auto-item-mark"
                    ? "Automatic item mark removed"
                    : type === "clear-auto-compounds"
                      ? "Automatic compound rules cleared"
                      : type === "clear-auto-upgrades"
                        ? "Automatic upgrade rules cleared"
                        : type === "update-auto-upgrade-rule"
                          ? "Automatic upgrade target updated"
                          : type === "go-home"
                            ? "Merchant is returning home to Main"
                            : type === "withdraw"
                              ? "Withdrawal mark updated"
                              : type === "upgrade-mark"
                                ? "Upgrade mark updated"
                                : type === "stat-scroll-mark"
                                  ? "Stat scroll request updated"
                                  : type === "merchant-weapon"
                                    ? "Merchant weapon updated"
                                    : type === "auto-exchange"
                                      ? "Automatic exchange updated"
                                      : type === "buy-copy"
                                        ? "Level 0 copy queued"
                                        : type === "compound-mark" || type === "auto-compound-mark"
                                          ? "Compounding marks updated"
                                          : type === "gold-target"
                                            ? "Gold target saved"
                                            : "Command queued",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed";
      setNotice(message);
      if (type === "compound-mark") setActionError(message);
    }
  }
  async function bankParty(group?: string) {
    try {
      const result = (await post("/bank-party", {group})) as {
        leader?: string;
        queued?: string[];
      };
      setNotice(
        `Merchant queued for ${(result.queued || []).join(", ")}`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Leader-group merchant request failed");
    }
  }
  async function townParty() {
    try {
      await post("/town-party", {});
      setNotice("Whole party queued for town");
    } catch {
      setNotice("Party town request failed");
    }
  }
  async function formation(body: unknown) {
    try {
      await post("/formation", body);
      setNotice("Party formation updated");
    } catch {
      setNotice("Formation update failed");
    }
  }
  async function setFarmingPolicy(mode: FarmingPolicy, character = state.leader || "") {
    const profile = state.farmingProfiles?.[character];
    setHuntSetupCharacter(character);
    const selected = profile?.monsterFocus || state.monsterFocusByCharacter?.[character] || (character === state.leader ? state.monsterFocus : []);
    const focus = (Array.isArray(selected) ? selected : []).filter(
      (id) => id !== "all",
    );
    const backup =
      profile?.farmingPolicy === "hunt"
        ? profile.monsterHunt?.returnLocation || profile.location
        : state.characterLocations?.[character] || profile?.location || (character === state.leader ? state.partyLocation : null);
    if (mode === "hunt" && (!backup || !focus.length)) {
      setHuntSetup(focus);
      return;
    }
    try {
      await post("/farming-mode", { mode, character });
      setNotice(state.followers?.[character] && character !== state.leader ? `Saved ${mode} for when Follow is off` : `Farming mode set to ${mode}`);
    } catch (error) {
      if (mode === "hunt" && error instanceof Error && /backup farming/i.test(error.message))
        setHuntSetup(focus);
      else setNotice(error instanceof Error ? error.message : "Farming mode update failed");
    }
  }
  async function setFocus(
    character: string,
    monsterFocus: string[],
    monsterPriorities?: Record<string, number>,
    monsterSearchRadius?: number,
  ) {
    try {
      await post("/focus", {
        character,
        monsterFocus,
        ...(monsterPriorities ? { monsterPriorities } : {}),
        ...(monsterSearchRadius !== undefined ? { monsterSearchRadius } : {}),
      });
      setNotice(`${character} focus updated`);
    } catch {
      setNotice("Focus update failed");
    }
  }
  async function saveRestock(character: string, policy: RestockPolicy) {
    try {
      await post("/restock", { character, hp: policy.hp, mp: policy.mp });
      setNotice(`${character} restock policy saved`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Restock update failed");
    }
  }
  async function gather(mode: string, enabled: boolean) {
    try {
      await post("/merchant/gather", { mode, enabled });
      setNotice(`Merchant ${mode} ${enabled ? "enabled" : "disabled"}`);
    } catch {
      setNotice("Gathering command failed");
    }
  }
  async function clearMerchantWork() {
    try {
      await post("/merchant/clear", {});
      setNotice("Merchant work cleared");
    } catch {
      setNotice("Could not clear merchant work");
    }
  }
  async function setForceStand(enabled: boolean) {
    try {
      await post("/merchant/force-stand", { enabled });
      setNotice(
        enabled
          ? "Force stand enabled; merchant work paused"
          : "Force stand disabled; merchant work resumed",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change force-stand mode");
    }
  }
  async function donateGold() {
    const amount = Number(donationAmount);
    if (!Number.isSafeInteger(amount) || amount < 1)
      return setNotice("Enter a positive whole-number donation");
    try {
      await post("/merchant/donate", { amount });
      setDonationOpen(false);
      setDonationAmount("");
      setNotice("Merchant donation queued");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Donation failed");
    }
  }
  async function joinGiveaway() {
    const realm = giveawayRealm.trim(),
      seller = giveawayMerchant.trim();
    if (!realm || !seller) return setNotice("Enter both a server realm and merchant name");
    try {
      await post("/merchant/join-giveaway", { realm, seller });
      setGiveawayOpen(false);
      setGiveawayRealm("");
      setGiveawayMerchant("");
      setNotice("Giveaway entry queued");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not queue giveaway entry");
    }
  }
  async function submitMerchantOrder(
    buys: {
      id: string;
      quantity: number;
      level?: number;
      budget?: number;
      maxAttempts?: number;
    }[],
    crafts: { id: string; quantity: number }[],
    exchanges: { id: string; quantity: number; level?: number; reward?: string }[] = [],
    removeAutoBankMark = false,
  ) {
    try {
      if (exchanges.length) await post("/merchant/exchange-order", { exchanges });
      else await post("/merchant/order", { buys, crafts, removeAutoBankMark });
      setCommerceMode(null);
      setNotice("Merchant order queued");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Merchant order failed");
      throw error;
    }
  }
  async function buyALDataListing(listing: ALDataListing, buyQuantity: number) {
    await post("/merchant/aldata-order", { listing, buyQuantity });
    setNotice("ALData marketplace purchase queued");
  }
  async function buyPontyListing(listing: PontyListing) {
    const result = await post("/merchant/ponty-order", {
      keys: listing.keys || [listing.key],
      quantity: listing.quantity,
      unitPrice: listing.unitPrice,
    });
    const count = Array.isArray(result.jobIds) ? result.jobIds.length : 1;
    setNotice(`${count} Ponty purchase job${count === 1 ? "" : "s"} queued`);
  }
  async function sellALDataOrder(order: ALDataBuyOrder, sellQuantity: number) {
    await post("/merchant/aldata-sale", { order, sellQuantity });
    setNotice("ALData marketplace sale queued");
  }
  async function saveStandListing(remove = false) {
    if (!standItem) return;
    try {
      if (standItem.auto)
        await post("/merchant/auto-stand", {
          item: standItem.entry.item,
          price: Number(standItem.price),
          action: remove ? "remove" : "set",
        });
      else
        await post("/merchant/stand", {
          id: standItem.id,
          slot: standItem.entry.slot,
          item: standItem.entry.item,
          bankPack: standItem.bankPack,
          price: Number(standItem.price),
          quantity: Number(standItem.quantity),
          markAll: standItem.markAll,
          remove,
        });
      setStandItem(null);
      setNotice(
        remove
          ? "Stand listing removed"
          : standItem.auto
            ? "Automatic stand mark saved"
            : "Stand listing saved",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Stand update failed");
    }
  }
  async function confirmNpcSale() {
    if (!npcSaleItem || npcSaleInFlight.current) return;
    const quantity = Number(npcSaleItem.quantity),
      available = npcSaleItem.targets
        ? npcSaleItem.targets.reduce((sum, target) => sum + Number(target.entry.item.q || 1), 0)
        : Number(npcSaleItem.entry.item.q || 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available)
      return setNotice(`Enter a quantity from 1 to ${available}`);
    const modified =
      Number(npcSaleItem.entry.item.level || 0) > 0 ||
      !!npcSaleItem.entry.item.stat_type ||
      !!npcSaleItem.entry.item.p;
    if (modified && !npcSaleItem.acknowledged)
      return setNotice("Confirm the modified-item warning");
    npcSaleInFlight.current = true;
    setNpcSaleBusy(true);
    try {
      if (npcSaleItem.targets) {
        const pending = [...npcSaleItem.targets];
        while (pending.length) {
          const target = pending[0];
          await post("/merchant/npc-sale", { source: "bank", pack: target.pack,
            slot: target.entry.slot, item: target.entry.item, quantity: Number(target.entry.item.q || 1),
            acknowledged: npcSaleItem.acknowledged });
          pending.shift();
          setNpcSaleItem((old) => old && { ...old, targets: [...pending],
            quantity: String(pending.reduce((sum, next) => sum + Number(next.entry.item.q || 1), 0)) });
        }
      } else await post("/merchant/npc-sale", {
        source: npcSaleItem.source,
        character: npcSaleItem.character,
        pack: npcSaleItem.pack,
        slot: npcSaleItem.entry.slot,
        item: npcSaleItem.entry.item,
        quantity,
        acknowledged: npcSaleItem.acknowledged,
      });
      setNpcSaleItem(null);
      setNotice("NPC sale queued");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "NPC sale failed");
    } finally {
      npcSaleInFlight.current = false;
      setNpcSaleBusy(false);
    }
  }
  async function confirmAutoNpcSale() {
    if (!autoNpcSaleItem) return;
    try {
      await post("/merchant/auto-npc-sale", {
        item: autoNpcSaleItem.item,
        character: autoNpcSaleItem.character,
        action: "set",
      });
      setAutoNpcSaleItem(null);
      setNotice("Automatic NPC sale saved");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Automatic NPC sale failed");
    }
  }
  async function clearAutomaticSales(kind: "npc" | "stand") {
    try {
      await post(kind === "npc" ? "/merchant/auto-npc-sale" : "/merchant/auto-stand", {
        action: "clear-all",
      });
      setNotice(kind === "npc" ? "Automatic NPC sales cleared" : "Automatic stand marks cleared");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not clear automatic sales");
    }
  }
  async function removeAutomaticSale(kind: "npc" | "stand", item: Item) {
    try {
      await post(kind === "npc" ? "/merchant/auto-npc-sale" : "/merchant/auto-stand", {
        action: "remove",
        item,
      });
      setNotice(kind === "npc" ? "Automatic NPC sale removed" : "Automatic stand mark removed");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove automatic sale rule");
    }
  }
  async function saveRoutinePriorities(
    priorities: Record<string, number>,
    enabled: Record<string, boolean>,
  ) {
    await post("/merchant/routine-priorities", { priorities, enabled });
    setRoutinesOpen(false);
    setNotice("Merchant routine priorities saved");
  }
  async function cancelMerchantJob(id?: string) {
    if (!id) return;
    try {
      await post("/merchant/job/cancel", { id });
      setNotice("Queued merchant job cancelled and its pending intent removed");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not cancel merchant job");
    }
  }
  async function removeStandListing(listing: StandListing) {
    await post("/merchant/stand", { ...listing, remove: true });
    setNotice("Stand listing removed");
  }
  async function saveStandBid(
    itemId: string,
    price: number,
    quantity: number,
    minimumQuality = 0,
    clear = false,
    priorityOverride?: number | null,
    options?: WTBOptions,
  ) {
    await post("/merchant/bid", {
      itemId,
      price,
      quantity,
      minimumQuality,
      clear,
      priorityOverride,
      ...options,
    });
    setNotice(clear ? `Bid for ${itemId} cleared` : `Bid for ${itemId} saved`);
  }
  async function sendCharacter(character: string) {
    setTravelCharacter(character);
  }
  async function submitCharacterTravel(character: string, location: Location, label: string) {
    try {
      await post("/command", {
        character,
        type: "character-travel",
        location,
        label,
      });
      setTravelCharacter(null);
      setNotice(`${character} travel queued`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Travel command failed");
    }
  }
  function findMonsterFor(character: string, focus: string[]) {
    if (!canRouteToMonster(state, character)) {
      setNotice(FOLLOWER_ROUTE_MESSAGE);
      return;
    }
    setFarmAreaRequest({
      character,
      ids: [...new Set(focus.filter((id) => id !== "all"))],
    });
  }
  async function startFarmingArea(area: FarmingArea, phoenixRouteOrder?: string[]) {
    setMonsterNavigateBusy(true);
    try {
      const location = { ...area };
      if (phoenixRouteOrder) {
        await post("/navigate-to-monster", { monsterId: "phoenix", location, phoenixRouteOrder });
        setMonsterNavigateTarget(null); setFarmAreaRequest(null);
        setSelectedBestiaryMonster(null); setSelected(null);
      } else if (monsterNavigateTarget) {
        await post("/navigate-to-monster", {
          monsterId: monsterNavigateTarget.id,
          location,
        });
        setMonsterNavigateTarget(null);
        setSelectedBestiaryMonster(null);
        setSelected(null);
      } else if (farmAreaRequest) {
        if (!canRouteToMonster(state, farmAreaRequest.character))
          throw new Error(FOLLOWER_ROUTE_MESSAGE);
        await post("/command", {
          character: farmAreaRequest.character,
          type:
            state.leader === farmAreaRequest.character
              ? "party-monster-travel"
              : "character-travel",
          location,
          farmingMonsterIds: farmAreaRequest.ids,
          label: `the selected farming area in ${area.mapName || area.map}`,
        });
        setFarmAreaRequest(null);
      }
      setNotice(`Farming route set to ${area.mapName || area.map} (${area.x}, ${area.y})`);
    } finally {
      setMonsterNavigateBusy(false);
    }
  }
  const chars = useMemo(() => {
    const bankbois = new Set((state.bankbois || []).map((entry) => entry.name));
    const characters = (state.activeSlots || [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((slot) => (slot.character ? state.characters[slot.character] : undefined))
      .filter((char): char is Char => !!char && !bankbois.has(char.name));
    const slots = state.activeSlots || [];
    const primary = slots.find(slot => slot.primary)?.character ??
      slots.find(slot => slot.kind === "native" && slot.index === 0)?.character;
    const steam = slots.filter(slot => slot.kind === "native" && slot.character)
      .map(slot => slot.character!);
    return orderCharacters(characters, state.roster || [], primary, state.merchantCharacter, steam);
  }, [state]);
  const monsterAchievements = useMemo(
    () => aggregateMonsterAchievements(state.characters),
    [state.characters],
  );
  const places = state.travelPlaces || chars[0]?.travelPlaces || [];
  const monsters = state.monsterChoices || chars[0]?.monsterChoices || [];
  const selectedFocus = Array.isArray(state.monsterFocus)
    ? state.monsterFocus
    : [state.monsterFocus || "goo"];
  const occupiedStandSlots = Object.entries(
    state.merchantCharacter ? state.characters[state.merchantCharacter]?.slots || {} : {},
  ).filter(([slot, entry]) => slot.startsWith("trade") && !!entry).length;
  const detailMeta = (item: Item, live?: ItemMeta | null): ItemMeta | null | undefined => {
    const known = state.merchantCatalog?.allItems?.find((entry) => entry.id === item.name)?.meta;
    if (!known) return live;
    if (!live) return known;
    return { ...known, ...live, world: live.world || known.world };
  };
  const statScrollInventory = useMemo(() => {
    const quantities: Record<string, number> = {};
    const add = (item?: Item | null) => {
      if (item && STAT_SCROLLS.some((entry) => entry.scroll === item.name))
        quantities[item.name] = (quantities[item.name] || 0) + Math.max(1, Number(item.q) || 1);
    };
    const merchantStatus = state.merchantCharacter
      ? state.characters[state.merchantCharacter]
      : undefined;
    (merchantStatus?.items || []).forEach((entry) => add(entry?.item));
    Object.values(state.bank?.packs || {}).forEach((pack) =>
      pack.forEach((entry) => add(entry?.item)),
    );
    return quantities;
  }, [state.bank, state.characters, state.merchantCharacter]);
  const standObserved = standItem
    ? levelPriceHistory(
        state.standPriceHistory?.[standItem.entry.item.name],
        Number(standItem.entry.item.level) || 0,
      )
    : undefined;
  const standMarketReference = standObserved?.marketLow || standObserved?.lowest || 0;
  const standPricingMeta = standItem
    ? detailMeta(standItem.entry.item, standItem.entry.meta)
    : undefined;
  const standNpcSale = standItem ? npcSaleValue(standItem.entry.item, standPricingMeta) : 0;
  const standPontyPrice = standItem ? pontyPrice(standItem.entry.item, standPricingMeta) : 0;
  const standMarketCount = 0;
  const applyStandPrice = (value: number) =>
    setStandItem(
      (old) =>
        old && {
          ...old,
          price: String(Math.max(1, Math.round(value))),
        },
    );
  return {
    connectionNotice,
    setAnniversaryOpen,
    state,
    setMailOpen,
    mailCount,
    setCatalogOpen,
    setBestiaryOpen,
    setSkillsOpen,
    setStandOpen,
    occupiedStandSlots,
    setMarketOpen,
    setBankOpen,
    setSettingsOpen,
    setRealmDestination,
    aldataKey,
    aldataAction,
    aldataAuthPending,
    setALDataAuthPending,
    chars,
    formation,
    setPickerSlot,
    logout,
    monsters,
    post,
    setFarmingPolicy,
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
    setNotice,
    setStandItem,
    setNpcSaleItem,
    setAutoNpcSaleItem,
    clearAutomaticSales,
    removeAutomaticSale,
    statScrollInventory,
    setSelected,
    detailMeta,
    setGearComparison,
    sendCharacter,
    townParty,
    selected,
    monsterAchievements,
    setMonsterNavigateTarget,
    setWtbItem,
    huntSetup, huntSetupCharacter,
    monsterNavigateBusy,
    setHuntSetup,
    setMonsterNavigateBusy,
    monsterNavigateTarget,
    farmAreaRequest,
    setFarmAreaRequest,
    startFarmingArea,
    catalogOpen,
    catalogComparison,
    setCatalogComparison,
    wtbItem,
    saveStandBid,
    selectedCondition,
    travelCharacter,
    places,
    setTravelCharacter,
    submitCharacterTravel,
    pickerSlot,
    switchSteam,
    joinOrPromoteSteam,
    moveSteamToHeadless,
    recoverSteamHandoff,
    spawn,
    createOpen,
    setCreateOpen,
    newName,
    setNewName,
    newClass,
    setNewClass,
    setNewLook,
    newLook,
    creating,
    createCharacter,
    commerceMode,
    submitMerchantOrder,
    mailOpen,
    mailDraft,
    setMailDraft,
    setMailCount,
    bankOpen,
    threshold,
    editThreshold: (value: string) => {
      thresholdDirty.current = true;
      setThreshold(value);
    },
    setThreshold,
    save,
    itemCollectionThreshold,
    editItemCollectionThreshold: (value: string) => {
      itemCollectionThresholdDirty.current = true;
      setItemCollectionThreshold(value);
    },
    setItemCollectionThreshold,
    saveItemCollectionThreshold,
    standOpen,
    marketOpen,
    removeStandListing,
    buyALDataListing,
    buyPontyListing,
    sellALDataOrder,
    settingsOpen,
    realmDestination,
    setRealmSetHome,
    setRealmConfirmOpen,
    aldataBusy,
    aldataKeyVisible,
    setALDataKeyVisible,
    realmConfirmOpen,
    realmBusy,
    realmSetHome,
    switchRealm,
    bestiaryOpen,
    setSelectedBestiaryMonster,
    selectedBestiaryMonster,
    skillsOpen,
    anniversaryOpen,
    setActionError,
    gearComparison,
    actionError,
    donationOpen,
    donationAmount,
    setDonationAmount,
    donateGold,
    giveawayOpen,
    giveawayRealm,
    giveawayMerchantOpen,
    setGiveawayMerchantOpen,
    giveawayMerchant,
    joinGiveaway,
    standItem,
    standMarketCount,
    applyStandPrice,
    standNpcSale,
    standPontyPrice,
    standMarketReference,
    standObserved,
    saveStandListing,
    autoNpcSaleItem,
    confirmAutoNpcSale,
    npcSaleItem,
    npcSaleBusy,
    confirmNpcSale,
    routinesOpen,
    saveRoutinePriorities,
  };
}
export type PartyConsoleModel = ReturnType<typeof usePartyConsole>;
