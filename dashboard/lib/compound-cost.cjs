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

// dashboard/lib/compound-cost.ts
var compound_cost_exports = {};
__export(compound_cost_exports, {
  compoundPassCost: () => compoundPassCost
});
module.exports = __toCommonJS(compound_cost_exports);
function compoundPassCost(grades, targetLevel, catalog) {
  const thresholds = Array.isArray(grades) ? grades : [9, 10, 11, 12];
  const prices = new Map((catalog || []).map((item) => [item.id, item.cost]));
  let gold = 0, scrolls = 0;
  for (let level = 0; level < targetLevel; level++) {
    let grade = 0;
    for (let index = 0; index < thresholds.length; index++) {
      if (level >= thresholds[index]) grade = index + 1;
    }
    const price = prices.get("cscroll" + grade);
    if (price === void 0 || !Number.isFinite(price) || price < 0)
      return null;
    const count = 3 ** (targetLevel - level - 1);
    gold += count * price;
    scrolls += count;
  }
  return { gold, scrolls };
}
