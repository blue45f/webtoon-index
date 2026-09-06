import { describe, expect, it } from "vitest";

import {
  brushPreviewData,
  filterPreviewData,
  palettePreviewData,
  palettePreviewColors,
  recipePreviewData,
  templatePreviewData,
} from "./market-preview";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

function makeBaseRecord(overrides: Partial<CreatorMarketplaceResourceRecord> = {}): CreatorMarketplaceResourceRecord {
  return {
    schemaVersion: 1,
    id: "123e4567-e89b-12d3-a456-426614174000",
    packageId: "test-pkg-1",
    name: "테스트 리소스",
    description: "테스트 설명",
    tags: ["test"],
    kind: "palette",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    manifestByteSize: 500,
    publisher: { id: "user-1", name: "작가 1", avatar: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isOwner: false,
    access: "free",
    ...overrides,
  };
}

describe("market-preview", () => {
  it("extracts palette preview colors correctly", () => {
    const record = makeBaseRecord({
      kind: "palette",
      entries: [
        {
          id: "palette-1",
          name: "여름 팔레트",
          kind: "palette",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "palette",
              runtime: "studio-palette-v1",
              definition: { colors: ["#ff0000", "#00ff00", "#0000ff"] },
            },
            byteSize: 100,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const colors = palettePreviewColors(record);
    expect(colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("returns null for non-palette in palettePreviewColors", () => {
    const record = makeBaseRecord({ kind: "brush" });
    expect(palettePreviewColors(record)).toBeNull();
  });

  it("preserves every valid palette entry for package-level preview selection", () => {
    const record = makeBaseRecord({
      kind: "palette",
      entries: [
        {
          id: "palette-day",
          name: "낮 장면",
          kind: "palette",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "palette",
              runtime: "studio-palette-v1",
              definition: { colors: ["#112233", "#445566"] },
            },
            byteSize: 90,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
        {
          id: "palette-night",
          name: "밤 장면",
          kind: "palette",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "palette",
              runtime: "studio-palette-v1",
              definition: { colors: ["#0f172a", "#334155"] },
            },
            byteSize: 90,
            sha256: "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    expect(palettePreviewData(record)).toEqual([
      { name: "낮 장면", colors: ["#112233", "#445566"] },
      { name: "밤 장면", colors: ["#0f172a", "#334155"] },
    ]);
    expect(palettePreviewColors(record)).toEqual(["#112233", "#445566"]);
  });

  it("returns null when palette colors are missing or not lowercase #rrggbb", () => {
    const empty = makeBaseRecord({
      kind: "palette",
      entries: [
        {
          id: "palette-empty",
          name: "빈 팔레트",
          kind: "palette",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "palette",
              runtime: "studio-palette-v1",
              definition: { colors: [] },
            },
            byteSize: 80,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });
    expect(palettePreviewColors(empty)).toBeNull();

    const uppercase = makeBaseRecord({
      kind: "palette",
      entries: [
        {
          id: "palette-upper",
          name: "대문자 팔레트",
          kind: "palette",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "palette",
              runtime: "studio-palette-v1",
              definition: { colors: ["#FF0000"] },
            },
            byteSize: 80,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });
    expect(palettePreviewColors(uppercase)).toBeNull();
  });

  it("extracts brush preview snapshot data", () => {
    const record = makeBaseRecord({
      kind: "brush",
      entries: [
        {
          id: "brush-1",
          name: "G펜 잉크",
          kind: "brush",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.brush+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "brush",
              runtime: "studio-brush-v1",
              definition: {
                snapshot: {
                  size: 15,
                  opacity: 0.9,
                  flow: 0.8,
                  family: "pen",
                  color: "#111111",
                },
              },
            },
            byteSize: 120,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const brushData = brushPreviewData(record);
    expect(brushData).toHaveLength(1);
    expect(brushData?.[0]).toEqual({
      name: "G펜 잉크",
      size: 15,
      opacity: 0.9,
      flow: 0.8,
      spacing: undefined,
      family: "pen",
      blendMode: undefined,
      hardness: undefined,
      color: "#111111",
      tip: undefined,
    });
  });

  it("extracts filter preview data", () => {
    const record = makeBaseRecord({
      kind: "filter",
      entries: [
        {
          id: "filter-1",
          name: "황혼 시네마틱",
          kind: "filter",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.filter+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "filter",
              runtime: "studio-filter-v1",
              definition: {
                engine: "color-balance",
                values: { temperature: 35, contrast: 1.2, vignette: true },
              },
            },
            byteSize: 150,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const filterData = filterPreviewData(record);
    expect(filterData).toHaveLength(1);
    expect(filterData?.[0].engine).toBe("color-balance");
    expect(filterData?.[0].values).toEqual({
      temperature: 35,
      contrast: 1.2,
      vignette: true,
    });
  });

  it("extracts template preview data for portable and builtin", () => {
    const record = makeBaseRecord({
      kind: "template",
      entries: [
        {
          id: "template-1",
          name: "웹툰 4단 컷",
          kind: "template",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.template+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "template",
              runtime: "studio-template-v1",
              definition: { templateId: "webtoon-4cut-standard" },
            },
            byteSize: 90,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const templateData = templatePreviewData(record);
    expect(templateData).toHaveLength(1);
    expect(templateData?.[0].templateId).toBe("webtoon-4cut-standard");
  });

  it("returns null from each extractor when the record kind does not match", () => {
    const palette = makeBaseRecord({ kind: "palette" });
    const brush = makeBaseRecord({ kind: "brush" });
    const filter = makeBaseRecord({ kind: "filter" });
    const template = makeBaseRecord({ kind: "template" });
    const _recipe = makeBaseRecord({ kind: "3d-preset" });

    expect(palettePreviewColors(brush)).toBeNull();
    expect(palettePreviewData(brush)).toBeNull();
    expect(brushPreviewData(palette)).toBeNull();
    expect(filterPreviewData(brush)).toBeNull();
    expect(templatePreviewData(filter)).toBeNull();
    expect(recipePreviewData(template)).toBeNull();
    expect(recipePreviewData(palette)).toBeNull();
  });

  it("extracts template preview data from a builtin-ref delivery", () => {
    const record = makeBaseRecord({
      kind: "template",
      entries: [
        {
          id: "template-builtin-1",
          name: "내장 컷 템플릿",
          kind: "template",
          delivery: {
            mode: "builtin-ref",
            runtimeRef: "studio-scene-template:webtoon-4cut",
            byteSize: 0,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const templateData = templatePreviewData(record);
    expect(templateData).toHaveLength(1);
    expect(templateData?.[0]).toEqual({
      name: "내장 컷 템플릿",
      templateId: "studio-scene-template:webtoon-4cut",
    });
  });

  it("extracts recipe preview data for 3d-preset and asset", () => {
    const record = makeBaseRecord({
      kind: "3d-preset",
      entries: [
        {
          id: "3d-1",
          name: "도시 거리 3D",
          kind: "3d-preset",
          delivery: {
            mode: "procedural-recipe",
            mediaType: "application/vnd.toonspectrum.3d-preset+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "3d-preset",
              runtime: "studio-bg3d-preset-v1",
              definition: {
                recipeId: "city-street-corner",
                parameters: { time: "night", rain: true },
              },
            },
            byteSize: 180,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const recipeData = recipePreviewData(record);
    expect(recipeData).toHaveLength(1);
    expect(recipeData?.[0].recipeId).toBe("city-street-corner");
    expect(recipeData?.[0].parameters).toEqual({ time: "night", rain: true });
  });

  it("extracts recipe preview data for an asset builtin-ref", () => {
    const record = makeBaseRecord({
      kind: "asset",
      entries: [
        {
          id: "asset-1",
          name: "거리 소품",
          kind: "asset",
          delivery: {
            mode: "builtin-ref",
            runtimeRef: "studio-asset:street-prop",
            byteSize: 0,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const recipeData = recipePreviewData(record);
    expect(recipeData).toHaveLength(1);
    expect(recipeData?.[0]).toEqual({
      name: "거리 소품",
      recipeId: "studio-asset:street-prop",
      runtimeRef: "studio-asset:street-prop",
    });
  });

  it("extracts recipe preview data for 3d-asset procedural recipe and builtin-ref", () => {
    const proceduralRecord = makeBaseRecord({
      kind: "3d-asset",
      entries: [
        {
          id: "3d-asset-1",
          name: "휴머노이드 캐릭터 3D",
          kind: "3d-asset",
          delivery: {
            mode: "procedural-recipe",
            mediaType: "application/vnd.toonspectrum.3d-asset+json",
            payload: {
              schemaVersion: 1,
              resourceKind: "3d-asset",
              runtime: "studio-3d-asset-v1",
              definition: {
                recipeId: "humanoid-base-male",
                parameters: { height: 180, build: "athletic" },
              },
            },
            byteSize: 190,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const proceduralData = recipePreviewData(proceduralRecord);
    expect(proceduralData).toHaveLength(1);
    expect(proceduralData?.[0].recipeId).toBe("humanoid-base-male");
    expect(proceduralData?.[0].parameters).toEqual({ height: 180, build: "athletic" });

    const builtinRecord = makeBaseRecord({
      kind: "3d-asset",
      entries: [
        {
          id: "3d-asset-builtin-1",
          name: "교실 의자 소품",
          kind: "3d-asset",
          delivery: {
            mode: "builtin-ref",
            runtimeRef: "studio-3d-asset:classroom-chair",
            byteSize: 0,
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
    });

    const builtinData = recipePreviewData(builtinRecord);
    expect(builtinData).toHaveLength(1);
    expect(builtinData?.[0]).toEqual({
      name: "교실 의자 소품",
      recipeId: "studio-3d-asset:classroom-chair",
      runtimeRef: "studio-3d-asset:classroom-chair",
    });
  });
});
