import {CoordinatorJsonlStore} from '../persistence/jsonl-store.ts';
import * as rareHunting from "../navigation/rare-hunting.ts";
import { createSharedConvoyNavigation, sharedCommand } from "../navigation/shared-navigation.ts";
import type { SharedState } from "../navigation/shared-route-types.ts";
/** Resolve modules through the installed launcher, preserving load order and getter evaluation. */
export function loadCoordinatorDependencies(require: NodeRequire) {
  const huntPolicy: typeof import("../../hunt/policy.ts") = require("../../.build/runtime/hunt.cjs");
  const {
    watchGenerations,
    classScript,
  }: typeof import("../../lifecycle/index.ts") = require("../../.build/runtime/lifecycle.cjs");
  const {
    evaluateGroup,
  }: typeof import("../../combat/grouped.ts") = require("../../.build/runtime/grouped-combat.cjs");
  const {
    installRosterRoutes,
    reservedForSteam: _reservedForSteam,
    publicHandoff,
  }: typeof import("../../roster/index.ts") = require("../../.build/runtime/roster.cjs");
  const {
    requestReload,
  }: typeof import("../../lifecycle/index.ts") = require("../../.build/runtime/lifecycle.cjs");
  const {
    eventPolicy,
    selectedEvents,
    eventEnabled,
    supportedEvents,
  }: typeof import("../../../dashboard/lib/event-policy.ts") = require("../../dashboard/lib/event-policy.cjs");
  const child_process: typeof import("node:child_process") = require("node:child_process");
  const account_info: (
    session: string | undefined,
  ) => Promise<import("./platform-contracts.ts").CoordinatorAccount> = require("../account_info");
  const game_files: import("./platform-contracts.ts").CoordinatorGameFiles = require("../game_files");
  const bwi: import("./web-platform.ts").MonitorConstructor = require("bot-web-interface");
  const monitoring_util: import("./web-platform.ts").MonitoringPlatform = require("../monitoring_util");
  const express: import("./web-platform.ts").ExpressPlatform = require("express");
  const fs_regular: typeof import("node:fs") = require("node:fs");
  const crypto: typeof import("node:crypto") = require("node:crypto");
  const vm: typeof import("node:vm") = require("node:vm");
  const pontyMarket: import("./ponty-platform.ts").PontyPlatform = require("../../scripts/ponty-market.cjs");
  const huntSafety: import("./hunt-platform.ts").HuntSafetyPlatform = require("../../scripts/hunt-safety.cjs");
  const farmZones: typeof import("../../../dashboard/lib/farming-zones.ts") = require("../../characters/farming-zones.cjs");
  const farmAreaControl: import("./hunt-platform.ts").FarmAreaControlPlatform = require("../../scripts/farm-area-control.cjs");

  const createFarmingNavigation: import("./navigation-platform.ts").CreateFarmingNavigation = require("../../scripts/farming-navigation.cjs");
  const legacyConvoy: import("./convoy-platform.ts").ConvoyNavigationPlatform = require("../../scripts/convoy-navigation.cjs");
  const merchantInventoryStacks: import("./storage-platform.ts").InventoryStacksPlatform = require("../../scripts/merchant-inventory-stacks.cjs");
  const bankStackRouting: import("./storage-platform.ts").BankStackRoutingPlatform = require("../../scripts/bank-stack-routing.cjs");
  const createMailInbox: import("./mail-platform.ts").CreateMailInbox = require("../../scripts/mail-inbox.cjs");
  const {
    validFarmingLocation,
    farmingAreas,
  }: typeof import("../../../dashboard/lib/farming-areas.ts") = require("../../dashboard/lib/farming-areas.cjs");
  const createEscape: import("./recovery-platform.ts").CreateEscape = require("../../scripts/party-escape.cjs");
  const convoyDefense: import("./convoy-platform.ts").ConvoyDefensePlatform & {
    step(state: SharedState, now: number, command: typeof sharedCommand): boolean;
  } = require("../../scripts/convoy-defense.cjs");
  const convoyNavigation = createSharedConvoyNavigation(legacyConvoy, (state, now, command) => convoyDefense.step(state, now, command));
  const createDisengagement: import("./recovery-platform.ts").CreateCombatDisengagement = require("../../scripts/combat-disengagement.cjs");
  const {
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
  }: import("./platform-contracts.ts").CoordinatorConstants = require("../src/CONSTANTS");
  const {
    log,
    console,
    ctype_to_clid,
  }: import("./platform-contracts.ts").CoordinatorLogging = require("../src/LogUtils");

  const FileStoredKeyValues: import("./platform-contracts.ts").CoordinatorFileStoreConstructor = CoordinatorJsonlStore;
  return {
    huntPolicy,
    watchGenerations,
    classScript,
    evaluateGroup,
    installRosterRoutes,
    publicHandoff,
    requestReload,
    eventPolicy,
    selectedEvents,
    eventEnabled,
    supportedEvents,
    child_process,
    account_info,
    game_files,
    bwi,
    monitoring_util,
    express,
    fs_regular,
    crypto,
    vm,
    pontyMarket,
    huntSafety,
    farmZones,
    farmAreaControl,
    rareHunting,
    createFarmingNavigation,
    convoyNavigation,
    merchantInventoryStacks,
    bankStackRouting,
    createMailInbox,
    validFarmingLocation,
    farmingAreas,
    createEscape,
    convoyDefense,
    createDisengagement,
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
    log,
    console,
    ctype_to_clid,
    FileStoredKeyValues,
  };
}
