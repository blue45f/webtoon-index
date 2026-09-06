import { describe, expect, it } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { isStudioBrushMaterialGroup } from "./studio-brush-material-group";
import {
  STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS,
  STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS,
} from "./studio-brush-pack-expansion";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./studio-brush-pack-id";
import {
  STUDIO_BRUSH_PACK_DESCRIPTORS,
  studioBrushPackDescriptorById,
  studioBrushPackMaterialGroup,
} from "./studio-brush-pack-index";
import { filterStudioBrushLibraryItems } from "./studio-draw-ux";

const EXTENDED_MEDIA_IDS = [
  "technical-needle-ink",
  "broken-nib-ink",
  "side-graphite-shade",
  "compressed-charcoal-edge",
  "watercolor-detail-round",
  "watercolor-flat-wash",
  "opaque-gouache",
  "oil-filbert",
  "alcohol-chisel-marker",
  "taper-brush-marker",
  "pixel-square",
  "pixel-dither",
  "cross-hatch",
  "speed-hatch",
  "dense-halftone",
  "bokeh-scatter",
  "canvas-weave",
  "fine-hair-strands",
  "cloth-fold-rake",
  "pine-needle-cluster",
] as const;

describe("procedural brush pack catalogue", () => {
  it("describes all 160 ids with unique Korean labels and searchable preview metadata", () => {
    expect(STUDIO_BRUSH_PACK_DESCRIPTORS).toHaveLength(160);
    expect(STUDIO_BRUSH_PACK_DESCRIPTORS.map((item) => item.catalogId)).toEqual(
      STUDIO_BRUSH_PACK_CATALOG_IDS
    );
    expect(new Set(STUDIO_BRUSH_PACK_DESCRIPTORS.map((item) => item.catalogName)).size).toBe(160);

    for (const descriptor of STUDIO_BRUSH_PACK_DESCRIPTORS) {
      expect(descriptor.catalogName).toMatch(/[가-힣]/);
      expect(descriptor.shortName).toMatch(/[가-힣]/);
      expect(descriptor.hint.length).toBeGreaterThan(12);
      expect(["ink-particle", "airbrush", "dry-media"]).toContain(descriptor.runtimeBrushId);
      expect(isStudioBrushMaterialGroup(descriptor.mediaGroup)).toBe(true);
      // 재질은 (카테고리, 런타임)에서 파생된다 — 행에 손으로 적히지 않는다.
      expect(descriptor.mediaGroup).toBe(
        studioBrushPackMaterialGroup(descriptor.category, descriptor.runtimeBrushId),
      );
      expect(descriptor.defaultWidth).toBeGreaterThanOrEqual(1);
      expect(descriptor.defaultWidth).toBeLessThanOrEqual(80);
      expect(descriptor.defaultOpacity).toBeGreaterThanOrEqual(0.05);
      expect(descriptor.defaultOpacity).toBeLessThanOrEqual(1);
      expect(descriptor.previewWeight).toBeGreaterThan(0);
      expect(descriptor.previewWeight).toBeLessThanOrEqual(1);
      expect(studioBrushPackDescriptorById(descriptor.catalogId)).toBe(descriptor);
      expect(Object.isFrozen(descriptor)).toBe(true);
    }
  });

  it("adds 20 non-branded production media across every requested general-purpose family", () => {
    // The 2024 extension wave occupies fixed catalogue positions 67..86; later waves append after.
    expect(STUDIO_BRUSH_PACK_CATALOG_IDS.slice(67, 87)).toEqual(EXTENDED_MEDIA_IDS);
    const extension = STUDIO_BRUSH_PACK_DESCRIPTORS.slice(67, 87);
    expect(new Set(extension.map((item) => item.catalogName)).size).toBe(20);
    expect(new Set(extension.map((item) => item.shortName)).size).toBe(20);
    expect(new Set(extension.map((item) => item.category))).toEqual(new Set([
      "ink",
      "sketch",
      "chalk",
      "paint",
      "marker",
      "pixel",
      "tone",
      "effect",
      "texture",
      "rake",
      "foliage",
    ]));
    expect(new Set(extension.map((item) => item.mediaGroup))).toEqual(new Set([
      "ink",
      "pencil",
      "marker",
      "oil",
      "airbrush",
      "pastel",
      "texture",
      "tone",
      "fx",
    ]));
  });

  it("finds every extended brush through a human-facing Korean behavior term", () => {
    const searchTerms = [
      ["technical-needle-ink", "제도선"],
      ["broken-nib-ink", "닳은 펜촉"],
      ["side-graphite-shade", "종이결"],
      ["compressed-charcoal-edge", "압축 목탄"],
      ["watercolor-detail-round", "세부 묘사"],
      ["watercolor-flat-wash", "물고임"],
      ["opaque-gouache", "매트한"],
      ["oil-filbert", "강모 결"],
      ["alcohol-chisel-marker", "알코올"],
      ["taper-brush-marker", "섬유형"],
      ["pixel-square", "픽셀 계단선"],
      ["pixel-dither", "디더링"],
      ["cross-hatch", "교차"],
      ["speed-hatch", "속도감"],
      ["dense-halftone", "스크린톤"],
      ["bokeh-scatter", "빛망울"],
      ["canvas-weave", "직조"],
      ["fine-hair-strands", "머리카락"],
      ["cloth-fold-rake", "옷주름"],
      ["pine-needle-cluster", "침엽수"],
    ] as const;

    for (const [id, query] of searchTerms) {
      const results = filterStudioBrushLibraryItems({
        catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
        category: "all",
        query,
      });
      expect(
        results.some((item) => item.id === id),
        `${id}: missing semantic search term ${query}`
      ).toBe(true);
    }
  });

  it("appends the 73-preset 2026-07 expansion waves after every earlier stable id", () => {
    expect(STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS).toHaveLength(73);
    expect(STUDIO_BRUSH_PACK_CATALOG_IDS.slice(87)).toEqual([
      ...STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS,
    ]);

    const expansion = STUDIO_BRUSH_PACK_DESCRIPTORS.slice(87);
    expect(new Set(expansion.map((item) => item.catalogName)).size).toBe(73);
    expect(new Set(expansion.map((item) => item.shortName)).size).toBe(73);
    expect(new Set(expansion.map((item) => item.category))).toEqual(new Set([
      "sketch",
      "ink",
      "paint",
      "chalk",
      "texture",
      "marker",
      "effect",
      "foliage",
      "stamp",
      "tone",
      "rake",
      "pattern",
    ]));
    expect(new Set(expansion.map((item) => item.mediaGroup))).toEqual(new Set([
      "ink",
      "pencil",
      "marker",
      "oil",
      "airbrush",
      "pastel",
      "texture",
      "tone",
      "fx",
    ]));
  });

  it("finds every 2026-07 expansion brush through a human-facing Korean behavior term", () => {
    const searchTerms = [
      ["pencil-4b-rough", "러프 스케치"],
      ["pencil-hb-mechanical", "샤프심"],
      ["pencil-colored-soft", "혼색"],
      ["pencil-charcoal-stick", "소묘"],
      ["pencil-tilt-shading", "틸트 반응"],
      ["g-pen-flex", "잉킹"],
      ["maru-pen-fine", "세필 펜촉"],
      ["spoon-pen-round", "효과선"],
      ["brush-pen-ink", "모필"],
      ["calligraphy-tilt-nib", "레터링"],
      ["milli-pen-uniform", "제도용"],
      ["watercolor-wet-bleed", "습식"],
      ["watercolor-edge-stain", "워터마크"],
      ["oil-impasto-heavy", "고점도"],
      ["oil-dry-scumble", "스컴블"],
      ["pastel-paper-soft", "종이 이빨"],
      ["crayon-wax-bold", "그림책"],
      ["airbrush-grand-soft", "분사 노즐"],
      ["sponge-stipple-dab", "두들김"],
      ["marker-colorless-blender", "저유량 마커"],
      ["marker-wide-chisel", "포스터"],
      ["spray-noise-fine", "노이즈 질감"],
      ["stardust-star-scatter", "별 조각"],
      ["leaf-fall-flurry", "가을 낙엽"],
      ["cloud-billow-soft", "연기 볼륨"],
      ["rope-twist-stamp", "밧줄"],
      ["halftone-sparse-dot", "밝은 스크린톤"],
      ["rain-streak-diagonal", "빗줄기"],
      ["sparkle-glint-cross", "십자 빛"],
      ["snow-flurry-flake", "함박눈"],
      ["ink-splatter-burst", "잉크 튀김"],
      ["fur-soft-clumps", "모피"],
      ["wood-grain-flow", "나이테"],
    ] as const;

    for (const [id, query] of searchTerms) {
      const results = filterStudioBrushLibraryItems({
        catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
        category: "all",
        query,
      });
      expect(
        results.some((item) => item.id === id),
        `${id}: missing semantic search term ${query}`
      ).toBe(true);
    }
  });

  it("keeps the 40-preset original material wave append-only and semantically searchable", () => {
    expect(STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS).toHaveLength(40);
    expect(STUDIO_BRUSH_PACK_CATALOG_IDS.slice(-40)).toEqual([
      ...STUDIO_BRUSH_PACK_MATERIAL_WAVE_IDS,
    ]);

    const searchTerms = [
      ["bristle-round-loaded", "강모 다발"],
      ["bristle-fan-dry", "부채꼴"],
      ["bristle-flat-streak", "굵기의 강모"],
      ["palette-knife-edge", "물감이 뭉친"],
      ["watercolor-dry-granule", "안료 알갱이"],
      ["watercolor-salt-bloom", "소금 결정"],
      ["watercolor-backrun-ring", "되밀려"],
      ["watercolor-wet-wash", "물층"],
      ["gouache-grain-flat", "매트한"],
      ["acrylic-stiff-flat", "합성모"],
      ["oil-linen-filbert", "캔버스 직조"],
      ["sumi-wash-fray", "모필 가장자리"],
      ["ribbon-satin-fold", "명암 띠"],
      ["rope-double-cord", "두 가닥"],
      ["chain-link-alternate", "금속 고리"],
      ["lace-scallop-trim", "반원 물결"],
      ["stitch-running-thread", "실땀"],
      ["stitch-cross-seam", "교차 실밥"],
      ["fabric-knit-loop", "뜨개 표면"],
      ["metal-scratch-brush", "사선 흠집"],
      ["smoke-wisp-layered", "연기 가닥"],
      ["flame-tongue-spark", "불꽃 혀"],
      ["rain-mist-combo", "물안개"],
      ["snow-powder-drift", "눈가루"],
      ["dust-mote-depth", "공간 깊이"],
      ["stage-safe-splatter", "연출용"],
      ["bokeh-ring-glow", "원형 빛"],
      ["cloud-cirrus-stream", "구름 가닥"],
      ["foliage-broad-canopy", "풍성한 수관"],
      ["tree-bark-crack", "수직 섬유"],
      ["flower-petal-scatter", "낱잎"],
      ["rock-shard-texture", "각진 조각"],
      ["brick-mortar-pattern", "모르타르"],
      ["wood-knot-rake", "옹이"],
      ["fur-undercoat-soft", "겉털"],
      ["hair-curl-ribbon", "잔머리"],
      ["food-sesame-sprinkle", "음식"],
      ["halftone-gradient-dot", "점 크기와 간격"],
      ["hatching-contour-rake", "평행선 각도"],
      ["focus-ray-streak", "방사선"],
    ] as const;

    for (const [id, query] of searchTerms) {
      const results = filterStudioBrushLibraryItems({
        catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
        category: "all",
        query,
      });
      expect(
        results.some((item) => item.id === id),
        `${id}: missing semantic search term ${query}`
      ).toBe(true);
    }
  });

  it("does not silently resolve unknown catalogue identities", () => {
    expect(studioBrushPackDescriptorById("pen")).toBeNull();
    expect(studioBrushPackDescriptorById(0)).toBeNull();
    expect(studioBrushPackDescriptorById(undefined)).toBeNull();
  });
});
