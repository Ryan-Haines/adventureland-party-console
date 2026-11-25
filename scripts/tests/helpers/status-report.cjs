// The status owner's character report (runtime/status/character/report.ts) over fake ports. `c` names the game objects
// the test sets; every owner door it leaves out answers nothing. `gameReads` calls the report's
// module-level game reads (Tracktrix, run speed, dolls, starting looks) with the same objects.
const report = require('../../../runtime/status/character/report.ts');

const renderer = c => c.sprite || (c.parent && c.parent.sprite) || null;

function statusReport(c) {
  const root = c.root || {};
  const reads = { itemSheetSprite: () => null, safeItemDefinition: value => value, itemWorldInfo: () => {}, resetCatalog() {},
    cachedWorld: () => null, nativeMonsterDropTables: () => ({}), ...(c.itemReads || {}) };
  return report.createReport({
    me: () => c.character, G: () => c.G, parent: () => c.parent || {}, root: () => root,
    initialTracker: () => c.tracker || null,
    game: { entity: () => null, inRange: () => false, canAttack: () => false, canUse: () => false, cooling: () => false,
      renderer: () => renderer(c), itemProperties: c.itemProperties || (() => ({})),
      log: c.log || (() => {}) },
    current: () => (c.current ? c.current() : true), sleep: ms => (c.sleep ? c.sleep(ms) : Promise.resolve()),
    owners: { items: { reads }, hunting: { spawnCatalog: () => [] } },
  });
}

// The account tracker these reads score is `c.parent.tracker`, where the game's socket puts it.
function gameReads(c) {
  const { sprite } = statusReport(c), imageUrls = {};
  const parent = () => c.parent || {};
  const progress = () => report.achievementProgress(c.G, parent().tracker || {}, c.character.name);
  const doll = (skin, cosmetics, scale, options) =>
    report.renderDoll({ renderer: renderer(c), parent: parent(), G: c.G, imageUrls }, skin, cosmetics, scale, options);
  return {
    tracktrix: () => report.tracktrixBonuses(c.character, parent(), c.G, progress(), sprite),
    runSpeed: conditions => report.runSpeed({ character: c.character, G: c.G, parent: parent(),
      itemProperties: c.itemProperties || (() => ({})) }, progress(), conditions),
    doll, characterDollHtml: () => doll(c.character.skin, c.character.cx, 2),
    dollHtml: html => report.dollHtml(html, c.G, parent(), imageUrls),
    classAppearanceChoices: () => report.classAppearanceChoices(c.G, doll, sprite),
  };
}
module.exports = { statusReport, gameReads };
