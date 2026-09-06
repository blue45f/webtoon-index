import { describe, expect, it } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./brush/studio-brush-catalog";
import { isStudioBrushMaterialGroup } from "./brush/studio-brush-material-group";
import {
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
  isStudioBrushQuarantinedPresetId,
} from "./brush/studio-brush-quarantine";
import { BRUSH_PRESETS } from "./studio-brush";
import {
  listStudioBrushTrayItems,
  listStudioQuickBrushTrayItems,
  STUDIO_BEGINNER_BRUSH_IDS,
  STUDIO_CREATIVE_STARTER_CARDS,
  studioBrushTrayItem,
} from "./studio-creative-ux";

describe("studio creative ux", () => {
  it("orders beginner brushes first for Canva/Express-style kits", () => {
    const beginner = listStudioBrushTrayItems("beginner");
    expect(beginner.map((item) => item.id)).toEqual([...STUDIO_BEGINNER_BRUSH_IDS]);
    expect(beginner.every((item) => item.category === "beginner")).toBe(true);
    expect(beginner.slice(0, 2).map((item) => item.id)).toEqual(["pen", "gpen"]);
  });

  it("covers every BRUSH_PRESETS entry exactly once in the full tray", () => {
    const all = listStudioBrushTrayItems("all");
    expect(all).toHaveLength(BRUSH_PRESETS.length);
    expect(new Set(all.map((item) => item.id)).size).toBe(BRUSH_PRESETS.length);
  });

  it("keeps the Pro pack out of the eager core tray so its full dynamics stay lazy", () => {
    // 팩 브러시는 게으른 카탈로그에서만 들어온다. 코어 트레이는 BRUSH_PRESETS 와 1:1.
    const all = listStudioBrushTrayItems("all");
    expect(all).toHaveLength(BRUSH_PRESETS.length);
    expect(all.some((item) => item.id === "heart-stamp")).toBe(false);
    expect(BRUSH_PRESETS.length).toBeGreaterThan(99);
  });

  it("assigns every core preset a material group derived from its render contract", () => {
    const all = listStudioBrushTrayItems("all");
    const groups = new Map<string, number>();
    for (const item of all) {
      expect(isStudioBrushMaterialGroup(item.mediaGroup), item.id).toBe(true);
      groups.set(item.mediaGroup, (groups.get(item.mediaGroup) ?? 0) + 1);
    }
    // 재질이 한 갈래로 쏠려 있으면 분류가 정보를 주지 못한다. 예전 표는 88개를 "선"으로 흘렸다.
    expect(groups.size).toBeGreaterThanOrEqual(9);
    for (const [group, count] of groups) {
      expect(count, `${group}: 코어 전체의 절반을 넘는 쏠림`).toBeLessThan(all.length / 2);
    }

    const markers = listStudioBrushTrayItems("marker");
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((item) => item.mediaGroup === "marker")).toBe(true);
    expect(markers.some((item) => item.id === "alcohol-marker")).toBe(true);
    const fx = listStudioBrushTrayItems("fx");
    expect(fx.some((item) => item.id === "glow")).toBe(true);
    expect(fx.some((item) => item.id === "glitter")).toBe(true);
    expect(fx.some((item) => item.id === "neon")).toBe(true);
    expect(fx.every((item) => item.mediaGroup === "fx")).toBe(true);

    // 이전에 손표에서 누락돼 "선"으로 떨어지던 코어 프리셋들.
    const groupOf = (id: string) => all.find((item) => item.id === id)?.mediaGroup;
    expect(groupOf("technical-pen")).toBe("ink");
    expect(groupOf("pencil-6b")).toBe("pencil");
    expect(groupOf("gouache")).toBe("watercolor");
    expect(groupOf("acrylic")).toBe("oil");
    expect(groupOf("splatter")).toBe("airbrush");
    expect(groupOf("oil-pastel")).toBe("pastel");
    expect(groupOf("crosshatch")).toBe("tone");
    // 지우개는 재료가 아니라 도구 경계라 자기 그룹을 가진다.
    expect(groupOf("standard-eraser")).toBe("eraser");
  });

  it("builds short labels and preview weights for tray chips", () => {
    const pen = studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "pen")!);
    expect(pen.shortName).toBe("펜");
    expect(pen.previewWeight).toBeGreaterThan(0);
    expect(pen.hint.length).toBeGreaterThan(4);
    expect(pen.previewStyle).toBe("solid");
    const neon = studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "neon")!);
    expect(neon.previewStyle).toBe("neon");
    const tone = studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "screentone")!);
    expect(tone.previewStyle).toBe("tone");
    const gpen = studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "gpen")!);
    expect(gpen.previewStyle).toBe("calligraphy");
    expect(studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "liner")!).previewStyle).toBe("calligraphy");
    expect(studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "marker-bold")!).previewStyle).toBe("solid");
    expect(studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "highlighter")!).previewStyle).toBe("solid");
    expect(studioBrushTrayItem(BRUSH_PRESETS.find((p) => p.id === "spray")!).previewStyle).toBe("dots");
  });

  it("builds a deduplicated favorite and recent quick shelf with beginner fallback", () => {
    const quick = listStudioQuickBrushTrayItems({
      favoriteIds: ["glow", "missing", "pen"],
      recentIds: ["marker", "glow", "gpen"],
      limit: 8,
    });

    expect(quick.map((item) => item.id)).toEqual([
      "glow",
      "pen",
      "marker",
      "gpen",
      "fountain-pen",
      "watercolor",
      "airbrush",
      "brush",
    ]);
    expect(quick.map((item) => item.quickSource)).toEqual([
      "favorite",
      "favorite",
      "recent",
      "recent",
      "starter",
      "starter",
      "starter",
      "starter",
    ]);
    expect(new Set(quick.map((item) => item.id)).size).toBe(quick.length);
  });

  it("uses the beginner kit when quick brush history is empty and respects zero limit", () => {
    const quickIds = listStudioQuickBrushTrayItems().map((item) => item.id);
    expect(quickIds).toEqual([...STUDIO_BEGINNER_BRUSH_IDS.slice(0, 8)]);
    // Wash + air must stay on the empty-history shelf so bleed brushes are one tap away.
    expect(quickIds).toContain("watercolor");
    expect(quickIds).toContain("airbrush");
    expect(listStudioQuickBrushTrayItems({ limit: 0 })).toEqual([]);
  });

  it("resolves Pro favorites and recent brushes from the expanded catalogue", () => {
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS).toHaveLength(BRUSH_PRESETS.length + 160);

    const quick = listStudioQuickBrushTrayItems({
      catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
      favoriteIds: ["heart-stamp"],
      recentIds: ["hair-fiber", "heart-stamp", "pen"],
      limit: 4,
    });

    expect(quick.map((item) => item.id)).toEqual([
      "heart-stamp",
      "hair-fiber",
      "pen",
      "gpen",
    ]);
    expect(quick.map((item) => item.quickSource)).toEqual([
      "favorite",
      "recent",
      "recent",
      "starter",
    ]);
    expect(quick[0]?.name).toBe("하트 도장");
    expect(quick[1]?.name).toBe("머리카락 결");
  });

  it("keeps quarantined favorites/MRU off the default quick shelf without holes", () => {
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS.length).toBeGreaterThan(0);
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;

    const quick = listStudioQuickBrushTrayItems({
      favoriteIds: [quarantinedId, "pen"],
      recentIds: [quarantinedId, "marker"],
      limit: 4,
    });
    expect(quick.some((item) => item.id === quarantinedId)).toBe(false);
    // Skipped, never a hole: listed neighbours keep their slots and the shelf stays full.
    expect(quick.map(({ id, quickSource }) => [id, quickSource])).toEqual([
      ["pen", "favorite"],
      ["marker", "recent"],
      ["gpen", "starter"],
      ["fountain-pen", "starter"],
    ]);
  });

  it("filters the default lane exactly once and never re-filters injected catalogues", () => {
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;

    // The bare default is the quarantine-filtered SSOT — byte-identical to filtering it by hand,
    // so the lanes cannot drift apart on what "listed" means.
    expect(listStudioQuickBrushTrayItems({ favoriteIds: [quarantinedId, "glow"] })).toEqual(
      listStudioQuickBrushTrayItems({
        catalogItems: listStudioBrushTrayItems("all").filter(
          (item) => !isStudioBrushQuarantinedPresetId(item.id)
        ),
        favoriteIds: [quarantinedId, "glow"],
      })
    );

    // Injected catalogItems are used verbatim: the injecting caller owns its lane's filtering,
    // proving no second quarantine filter is layered inside.
    const unfiltered = listStudioQuickBrushTrayItems({
      catalogItems: listStudioBrushTrayItems("all"),
      favoriteIds: [quarantinedId],
      limit: 2,
    });
    expect(unfiltered[0]?.id).toBe(quarantinedId);
    expect(unfiltered[0]?.quickSource).toBe("favorite");
  });

  it("exposes drawing-first starter cards without publish marketing", () => {
    const ids = STUDIO_CREATIVE_STARTER_CARDS.map((card) => card.id);
    expect(ids).toContain("smart-shape");
    expect(ids).toContain("brush-kit");
    expect(ids).toContain("collab-focus");
    expect(ids).toContain("draw");
    expect(ids).not.toContain("publish");
    expect(STUDIO_CREATIVE_STARTER_CARDS.every((card) => card.label && card.hint)).toBe(true);
  });
});
