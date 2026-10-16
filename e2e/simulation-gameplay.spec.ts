import { test } from "./simulation-fixtures";
import {
  ranger,
  iceRoamer,
  booBoo,
  followerReward,
  convoy,
  unequalQuests,
  gooHunt,
} from "./gameplay-scenarios";
import { readFileSync } from "node:fs";
const titles: string[] = JSON.parse(
  readFileSync(new URL("./gameplay-titles.json", import.meta.url), "utf8"),
);

test.setTimeout(600000);
test.describe("accelerated singleton farming", () => {
  test.use({ simulationClass: "ranger" });
  test(titles[0], async ({ gameplay }, info) => ranger(gameplay, info));
});
test(titles[1], async ({ gameplay }, info) => iceRoamer(gameplay, info));
test(titles[2], async ({ gameplay }, info) => booBoo(gameplay, info));
test(titles[3], async ({ gameplay }, info) => followerReward(gameplay, info));
test(titles[4], async ({ gameplay }, info) => convoy(gameplay, info));

test(titles[5], async ({ gameplay }, info) => unequalQuests(gameplay, info));
test(titles[6], async ({ gameplay }, info) => gooHunt(gameplay, info));
