import { describe, expect, it } from "vitest";

import { filterStudio2dScenes, STUDIO_2D_ASSET_METADATA } from "./studio-2d-asset-quality";
import { BG_SCENES, groupBgScenes } from "./studio-bg-scenes";

const groups = groupBgScenes(BG_SCENES);
const scene = (id: string) => BG_SCENES.find((item) => item.id === id)!;

describe("2D reviewed content filters", () => {
  it("combines source metadata instead of guessing from a scene name", () => {
    const result = filterStudio2dScenes(groups, { environment: "실내", timeOfDay: "밤", textFreeOnly: true, emptySceneOnly: true, quality: "large" });
    expect(result.map((item) => item.id).sort()).toEqual(["webtoon-creator-room", "webtoon-palace"]);
  });
  it("checks every environment/time/text combination against the original metadata", () => {
    for (const environment of ["all", "실내", "실외"] as const) {
      for (const timeOfDay of ["all", "낮", "노을", "밤"] as const) {
        for (const textFreeOnly of [false, true]) {
          const actual = filterStudio2dScenes(groups, { quality: "raster", environment, timeOfDay, textFreeOnly });
          const expected = STUDIO_2D_ASSET_METADATA.filter((item) => (environment === "all" || item.environment === environment)
            && (timeOfDay === "all" || item.timeOfDay === timeOfDay) && (!textFreeOnly || item.containsText === false));
          expect(actual.map((item) => item.id).sort()).toEqual(expected.map((item) => item.id).sort());
        }
      }
    }
  });
  it("never admits unknown or replaced sources into reviewed-content filters", () => {
    const original = scene("webtoon-creator-room");
    const unknown = { ...original, id: "unknown", label: "실내 밤 문자 없는 배경", imgSrc: "/unknown.png" };
    const replaced = { ...original, imgSrc: "/different.png" };
    const vector = { id: "new-vector", label: "실내 밤", genre: "daily", svg: "<svg/>" };
    const collection = [{ genre: "일상·학원", scenes: [unknown, replaced, vector] }];
    expect(filterStudio2dScenes(collection, { textFreeOnly: true })).toEqual([]);
    expect(filterStudio2dScenes(collection, { environment: "실내" })).toEqual([]);
    expect(filterStudio2dScenes(collection, { timeOfDay: "밤" })).toEqual([]);
    expect(filterStudio2dScenes(collection)).toHaveLength(3);
  });
  it("keeps descriptive filters AND-combined with search and does not mutate the catalog", () => {
    const before = JSON.stringify(groups);
    expect(filterStudio2dScenes(groups, { environment: "실외", timeOfDay: "밤", query: "태블릿" })).toEqual([]);
    expect(filterStudio2dScenes(groups, { environment: "실내", timeOfDay: "밤", query: "태블릿" })).toEqual([scene("webtoon-creator-room")]);
    expect(filterStudio2dScenes(groups, { quality: "vector", textFreeOnly: true })).toEqual([]);
    expect(JSON.stringify(groups)).toBe(before);
  });
});
