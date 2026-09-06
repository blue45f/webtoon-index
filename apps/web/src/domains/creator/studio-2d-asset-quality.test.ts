import { describe, expect, it } from "vitest";

import {
  filterStudio2dScenes,
  getStudio2dAssetMetadata,
  isLargeStudio2dAsset,
  isRecommendedStudio2dScene,
  STUDIO_2D_ASSET_METADATA,
  studio2dOrientation,
  studio2dResolutionLabel,
} from "./studio-2d-asset-quality";
import { BG_SCENES, bgSceneSections, groupBgScenes } from "./studio-bg-scenes";

import type { Studio2dScene } from "./studio-2d-asset-quality";

const groups = groupBgScenes(BG_SCENES);
const scene = (id: string) => BG_SCENES.find((item) => item.id === id)!;

describe("2D scene quality and discovery", () => {
  it("recommends only the five individually reviewed large originals", () => {
    const result = filterStudio2dScenes(groups, { quality: "recommended" });
    expect(result).toHaveLength(5);
    expect(result.every(isRecommendedStudio2dScene)).toBe(true);
    expect(result).not.toContain(scene("webtoon-bedroom"));
  });
  it("retains all original IDs exactly once after recommendation regrouping", () => {
    const sections = bgSceneSections(BG_SCENES);
    expect(sections[0].genre).toBe("추천");
    expect(sections[0].scenes).toHaveLength(5);
    const ids = sections.flatMap((group) => group.scenes.map((item) => item.id));
    expect(new Set(ids).size).toBe(BG_SCENES.length);
    expect(ids).toHaveLength(BG_SCENES.length);
  });
  it("does not mistake every raster for a large original", () => {
    expect(filterStudio2dScenes(groups, { quality: "large" })).toHaveLength(9);
    expect(filterStudio2dScenes(groups, { quality: "raster" })).toHaveLength(29);
  });
  it("keeps all raster scenes discoverable in their normalized genre", () => {
    expect(filterStudio2dScenes(groups, { genre: "일상·학원", quality: "raster" })).toContain(scene("webtoon-classroom"));
    expect(filterStudio2dScenes(groups, { genre: "로맨스", quality: "recommended" })).toEqual([scene("webtoon-rooftop-sunset")]);
  });
  it("searches multiple terms across tags and time of day", () => {
    expect(filterStudio2dScenes(groups, { query: " 비   밤 " })).toContain(scene("webtoon-neon-alley"));
    expect(filterStudio2dScenes(groups, { query: "실내 태블릿" })).toEqual([scene("webtoon-creator-room")]);
    expect(filterStudio2dScenes(groups, { query: "판타지 숲" })).toContain(scene("webtoon-moonlit-forest"));
  });
  it("handles case and full-width normalization", () => {
    expect(filterStudio2dScenes(groups, { query: "ｓｆ" })).toEqual(filterStudio2dScenes(groups, { query: "SF" }));
  });
  it("filters original aspect ratios without guessing unknown dimensions", () => {
    expect(filterStudio2dScenes(groups, { orientation: "landscape" })).toHaveLength(4);
    expect(filterStudio2dScenes(groups, { orientation: "square" })).toHaveLength(5);
    expect(filterStudio2dScenes(groups, { orientation: "portrait" })).toHaveLength(20);
  });
  it("does not advertise crowd scenes or unknown vectors as person-free images", () => {
    const result = filterStudio2dScenes(groups, { emptySceneOnly: true });
    expect(result).not.toContain(scene("webtoon-cafe"));
    expect(result).not.toContain(scene("webtoon-corridor"));
    expect(result).toContain(scene("webtoon-rooftop-sunset"));
    expect(result.every((item) => getStudio2dAssetMetadata(item)?.containsPeople === false)).toBe(true);
  });
  it("preserves metadata for verified compatibility aliases but not unrelated replacements", () => {
    const asset = STUDIO_2D_ASSET_METADATA.find((item) => item.legacySrc)!;
    const original = scene(asset.id);
    expect(getStudio2dAssetMetadata({ ...original, imgSrc: asset.legacySrc! })).toBe(asset);
    expect(getStudio2dAssetMetadata({ ...original, imgSrc: "/unreviewed.jpg" })).toBeUndefined();
  });
  it("does not recommend new or unregistered raster IDs", () => {
    const unknown: Studio2dScene = { id: "unreviewed", label: "새 배경", genre: "daily", imgSrc: "/new.png" };
    expect(isRecommendedStudio2dScene(unknown)).toBe(false);
    expect(studio2dResolutionLabel(unknown)).toBe("원본 정보 미확인");
  });
  it("deduplicates overlapping collections and leaves inputs unchanged", () => {
    const before = JSON.stringify(groups);
    const result = filterStudio2dScenes([...groups, ...groups]);
    expect(result).toHaveLength(BG_SCENES.length);
    expect(JSON.stringify(groups)).toBe(before);
  });
  it("sorts by actual original pixel count and provides stable name ordering", () => {
    const result = filterStudio2dScenes(groups, { quality: "raster", sort: "resolution" });
    const sizes = result.map((item) => getStudio2dAssetMetadata(item)!).map((item) => item.width * item.height);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(filterStudio2dScenes(groups, { sort: "name" })).toHaveLength(BG_SCENES.length);
  });
  it("checks original resolution boundaries without NaN or fractional promotion", () => {
    expect(isLargeStudio2dAsset({ width: 1672, height: 941 })).toBe(true);
    expect(isLargeStudio2dAsset({ width: 4096, height: 200 })).toBe(false);
    expect(isLargeStudio2dAsset({ width: NaN, height: 1024 })).toBe(false);
    expect(isLargeStudio2dAsset({ width: 1024.5, height: 1024 })).toBe(false);
    expect(studio2dOrientation(1024, 1024)).toBe("square");
  });
  it("returns zero results for incompatible filters instead of silently relaxing them", () => {
    expect(filterStudio2dScenes(groups, { quality: "recommended", orientation: "portrait" })).toEqual([]);
    expect(filterStudio2dScenes(groups, { query: "존재하지않는배경" })).toEqual([]);
  });
});
