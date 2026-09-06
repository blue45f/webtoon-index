import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_CATALOG, STUDIO_FILTER_DIALOG_CATALOG, STUDIO_FILTER_GROUP_ORDER,
  searchStudioFilterCatalog, searchStudioFilterDialogCatalog, studioFilterCatalogEntry,
  studioFilterGroupLabel,
} from "./studio-filter-catalog";
import { STUDIO_FILTER_ALL_KINDS, STUDIO_FILTER_ALL_LABELS } from "./studio-filter-pack-registry";

describe("task-based filter discovery", () => {
  it("uses nine distinct, non-empty groups without deleting any engine or dialog kind", () => {
    expect(STUDIO_FILTER_GROUP_ORDER).toHaveLength(9);
    expect(new Set(STUDIO_FILTER_GROUP_ORDER.map(studioFilterGroupLabel)).size).toBe(9);
    for (const group of STUDIO_FILTER_GROUP_ORDER) expect(STUDIO_FILTER_CATALOG.some((entry) => entry.group === group)).toBe(true);
    expect(STUDIO_FILTER_DIALOG_CATALOG.map((entry) => entry.kind)).toEqual([...STUDIO_FILTER_ALL_KINDS]);
    expect(new Set(STUDIO_FILTER_CATALOG.map((entry) => entry.engine)).size).toBe(STUDIO_FILTER_CATALOG.length);
  });
  it("separates restoration, light, style, and sharpening instead of conflating them with blur", () => {
    for (const [engine, group] of [["god-rays", "light"], ["diffuse-glow", "light"], ["jpeg-artifact-reduction", "repair"], ["line-cleanup", "repair"], ["pencil-sketch", "stylize"], ["watercolor", "stylize"], ["sharpen", "detail"], ["gaussian-blur", "blur"]]) {
      expect(studioFilterCatalogEntry(engine)?.group, engine).toBe(group);
    }
    expect(STUDIO_FILTER_DIALOG_CATALOG.find((entry) => entry.kind === "lens-flare")?.group).toBe("light");
  });
  it("shows one canonical label in the menu, selected dialog, and gallery", () => {
    for (const entry of STUDIO_FILTER_DIALOG_CATALOG) expect(entry.title).toBe(STUDIO_FILTER_ALL_LABELS[entry.kind]);
  });
  it("preserves legacy names as search aliases, including full-width Latin", () => {
    for (const [query, kind] of [["필드 아이리스 블러", "field-iris-blur"], ["타일러블 블러", "tileable-blur"], ["포인틸리즘", "pointillize"], ["볼류메트릭 광선", "god-rays"], ["ＪＰＥＧ 아티팩트 감소", "jpeg-artifact-reduction"], ["한계값 (흑백 2값)", "threshold"]]) {
      expect(searchStudioFilterDialogCatalog(query).map((entry) => entry.kind), query).toContain(kind);
    }
    expect(searchStudioFilterCatalog("ＪＰＥＧ 압축 깨짐").map((entry) => entry.engine)).toEqual(["jpeg-artifact-reduction"]);
  });
});
