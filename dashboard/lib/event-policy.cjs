// Generated from TypeScript. Run npm run build:shared -- --publish; do not edit.

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dashboard/lib/event-policy.ts
var event_policy_exports = {};
__export(event_policy_exports, {
  eventDisplayNames: () => eventDisplayNames,
  eventEnabled: () => eventEnabled,
  eventLimits: () => eventLimits,
  eventPolicy: () => eventPolicy,
  eventPriorityOrder: () => eventPriorityOrder,
  octoberEvents: () => octoberEvents,
  selectedEvents: () => selectedEvents,
  supportedEvents: () => supportedEvents,
  validEventLimits: () => validEventLimits
});
module.exports = __toCommonJS(event_policy_exports);

// runtime/events/october.ts
var cipherIngredients = ["verdantspore", "frostscale", "embercoal", "gloomfeather"];
function validMix(mix) {
  return Array.isArray(mix) && mix.length === 5 && mix.every((item) => cipherIngredients.includes(item));
}
var recipes = Array.from({ length: 1024 }, (_, n) => Array.from({ length: 5 }, (_2, i) => cipherIngredients[Math.floor(n / 4 ** i) % 4]));

// dashboard/lib/event-policy.ts
function validEventLimits(value) {
  if (!value || typeof value !== "object") return false;
  const { deathLimit, timeLimitMinutes, monsters, cipher } = value;
  if (monsters !== void 0 && (!Array.isArray(monsters) || new Set(monsters).size !== monsters.length || monsters.some((id) => !["zombie", "ghoul", "gargoyle"].includes(id)))) return false;
  if (cipher !== void 0 && (!cipher || typeof cipher.automatic !== "boolean" || cipher.gatherMinutes !== void 0 && (!Number.isFinite(cipher.gatherMinutes) || cipher.gatherMinutes < 0 || cipher.gatherMinutes > 20) || !Number.isSafeInteger(cipher.minClues) || cipher.minClues < 0 || cipher.minClues > 1024 || cipher.gatherMonsters !== void 0 && (!Array.isArray(cipher.gatherMonsters) || cipher.gatherMonsters.length !== 4 || cipher.gatherMonsters.some((id) => typeof id !== "string" || !id)) || cipher.manual !== void 0 && (!cipher.manual || typeof cipher.manual.id !== "string" || !cipher.manual.id || typeof cipher.manual.round !== "string" || !cipher.manual.round || !Number.isSafeInteger(cipher.manual.cracks) || cipher.manual.cracks < 0 || !validMix(cipher.manual.mix)))) return false;
  return (deathLimit === null || Number.isSafeInteger(deathLimit) && deathLimit >= 0) && (timeLimitMinutes === null || typeof timeLimitMinutes === "number" && Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0);
}
var legacyDefaultEvents = ["anniversary", "abtesting", "goobrawl", "crabxx", "franky", "icegolem", "snowman"];
var octoberEvents = ["horseman", "graveyard", "trickortreat", "witchcipher"];
var supportedEvents = [...legacyDefaultEvents, "slenderman", "mrgreen", "mrpumpkin", ...octoberEvents];
var eventDisplayNames = {
  anniversary: "Anniversary",
  abtesting: "A/B Testing",
  goobrawl: "Goobrawl",
  crabxx: "Crabxx",
  franky: "Franky",
  icegolem: "Ice Golem",
  snowman: "Snowman",
  slenderman: "Slenderman",
  mrgreen: "Mr. Green",
  mrpumpkin: "Mr. Pumpkin",
  horseman: "Headless Horseman",
  graveyard: "Graveyard Rising",
  trickortreat: "Trick or Treat",
  witchcipher: "Witch's Cipher"
};
function selectedEvents(party, name) {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...party.eventsByCharacter?.[source] ? legacyDefaultEvents.filter((id) => id !== "anniversary") : []];
  const accountCipher = name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes("witchcipher");
  return eventPriorityOrder(party, name).filter((id) => selections.includes(id) || accountCipher && id === "witchcipher");
}
function eventEnabled(party, name, event) {
  return selectedEvents(party, name).includes(event);
}
function eventPolicy(party, name) {
  const inherited = Boolean(
    party.leader && name !== party.leader && name !== party.merchantCharacter && party.followers?.[name]
  );
  const source = inherited ? party.leader : name;
  return {
    inherited,
    source,
    enabled: !!(name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes("witchcipher")) || (party.eventSelectionsByCharacter?.[source] ? party.eventSelectionsByCharacter[source].some((id) => id !== "anniversary" && supportedEvents.includes(id)) : Boolean(party.eventsByCharacter?.[source]))
  };
}
function eventPriorityOrder(party, name) {
  const source = eventPolicy(party, name).source;
  return [.../* @__PURE__ */ new Set([...party.eventPrioritiesByCharacter?.[source] ?? [], ...supportedEvents])].filter((id) => supportedEvents.includes(id));
}
function eventLimits(party, name) {
  const limits = party.eventLimitsByCharacter?.[eventPolicy(party, name).source] ?? {};
  if (name === party.merchantCharacter && party.leader && party.eventSelectionsByCharacter?.[party.leader]?.includes("witchcipher"))
    return { ...limits, witchcipher: party.eventLimitsByCharacter?.[party.leader]?.witchcipher ?? { deathLimit: null, timeLimitMinutes: null } };
  return limits;
}
