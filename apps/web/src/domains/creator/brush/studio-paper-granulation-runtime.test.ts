import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_PAPER_SURFACE,
  STUDIO_PAPER_GRANULATION_IDENTITY,
  STUDIO_PAPER_GRANULATION_MAX_MULTIPLIER,
  acquireStudioPaperGranulationTile,
  clearStudioPaperGranulationTileCache,
  normalizeStudioPaperGranulationSettings,
  normalizeStudioPaperSurfaceSettings,
  resetStudioDocumentPaperSurface,
  resolveStudioDocumentPaperSurface,
  resolveStudioPaperGranulationAlphaMultiplierAt,
  sampleStudioPaperGranulationGainAt,
  sampleStudioPaperHeightAt,
  setStudioDocumentPaperSurface,
  studioPaperGranulationEffectiveStrength,
  studioPaperGranulationIsActive,
  studioPaperGranulationTileCacheStats,
} from "./studio-paper-granulation-runtime";
import { PAPER_GRAIN_KINDS } from "./studio-paper-texture";

const STRONG = { granulation: 0.7, staining: 0.04, scale: 1.5 } as const;

beforeEach(() => {
  clearStudioPaperGranulationTileCache();
  resetStudioDocumentPaperSurface();
});

describe("paper granulation settings", () => {
  it("treats a non-object as the exact identity", () => {
    expect(normalizeStudioPaperGranulationSettings(undefined)).toBe(
      STUDIO_PAPER_GRANULATION_IDENTITY,
    );
    expect(normalizeStudioPaperGranulationSettings("rough")).toBe(
      STUDIO_PAPER_GRANULATION_IDENTITY,
    );
  });

  it("clamps every axis into a physically meaningful range", () => {
    expect(
      normalizeStudioPaperGranulationSettings({
        granulation: 9,
        staining: -3,
        scale: 1e9,
      }),
    ).toEqual({ granulation: 1, staining: 0, scale: 16 });
    expect(
      normalizeStudioPaperGranulationSettings({
        granulation: Number.NaN,
        staining: Number.POSITIVE_INFINITY,
        scale: 0,
      }),
    ).toEqual({ granulation: 0, staining: 0, scale: 0.25 });
  });

  it("staining suppresses granulation on the same axis the pigment kernel uses", () => {
    expect(studioPaperGranulationEffectiveStrength({ granulation: 0.8, staining: 0, scale: 1 }))
      .toBeCloseTo(0.8, 12);
    // 완전 염색성 안료(프탈로·기술펜 잉크)는 강도와 무관하게 종이 결을 타지 않는다.
    expect(studioPaperGranulationEffectiveStrength({ granulation: 1, staining: 1, scale: 1 }))
      .toBe(0);
    expect(studioPaperGranulationIsActive({ granulation: 1, staining: 1, scale: 1 })).toBe(false);
    expect(studioPaperGranulationIsActive(STUDIO_PAPER_GRANULATION_IDENTITY)).toBe(false);
  });
});

describe("document paper surface", () => {
  it("defaults to the cold-press sheet the ink-wash filter also uses", () => {
    expect(resolveStudioDocumentPaperSurface()).toEqual(DEFAULT_STUDIO_PAPER_SURFACE);
    expect(DEFAULT_STUDIO_PAPER_SURFACE.kind).toBe("cold-press");
  });

  it("normalizes unknown paper kinds instead of failing open", () => {
    expect(normalizeStudioPaperSurfaceSettings({ kind: "papyrus", seed: -4 })).toEqual({
      kind: "cold-press",
      seed: 0,
    });
    expect(setStudioDocumentPaperSurface({ kind: "rough", seed: 9 })).toEqual({
      kind: "rough",
      seed: 9,
    });
    expect(resolveStudioDocumentPaperSurface()).toEqual({ kind: "rough", seed: 9 });
  });
});

describe("paper granulation tile", () => {
  it("is null for an inactive response so the renderer keeps an exact identity", () => {
    expect(
      acquireStudioPaperGranulationTile(
        DEFAULT_STUDIO_PAPER_SURFACE,
        STUDIO_PAPER_GRANULATION_IDENTITY,
      ),
    ).toBeNull();
    expect(
      resolveStudioPaperGranulationAlphaMultiplierAt(null, 12.5, 40.25, 1),
    ).toBe(1);
  });

  it("builds the noise once per (paper, strength) and shares it across scales", () => {
    const first = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG);
    expect(first).not.toBeNull();
    expect(acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)).toBe(first);
    // scale은 좌표를 나누는 상수라 타일 내용을 바꾸지 않는다 — 같은 타일을 재사용한다.
    expect(
      acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, { ...STRONG, scale: 4 }),
    ).toBe(first);
    // 종이가 다르면 다른 타일이어야 한다.
    expect(
      acquireStudioPaperGranulationTile({ kind: "rough", seed: 41 }, STRONG),
    ).not.toBe(first);
    expect(studioPaperGranulationTileCacheStats().size).toBe(2);
  });

  it("evicts the oldest tile instead of growing without bound", () => {
    const { limit } = studioPaperGranulationTileCacheStats();
    const oldest = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)!;
    for (let index = 0; index < limit; index += 1) {
      acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, {
        granulation: 0.2 + index / (limit * 2),
        staining: 0,
        scale: 1,
      });
    }
    expect(studioPaperGranulationTileCacheStats().size).toBeLessThanOrEqual(limit);
    expect(acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)).not.toBe(
      oldest,
    );
  });

  it("preserves the mean of a uniform wash across the whole tile", () => {
    for (const kind of PAPER_GRAIN_KINDS) {
      const tile = acquireStudioPaperGranulationTile({ kind, seed: 41 }, STRONG)!;
      let sum = 0;
      for (const gain of tile.gain) sum += 1 + gain;
      // 이득의 타일 평균이 0이므로 균일 획의 총 안료량은 정확히 보존된다.
      expect(sum / tile.gain.length, `${kind}`).toBeCloseTo(1, 5);
    }
  });

  it("never reaches the multiplier guard inside the authored strength range", () => {
    for (const kind of PAPER_GRAIN_KINDS) {
      const tile = acquireStudioPaperGranulationTile(
        { kind, seed: 41 },
        { granulation: 0.75, staining: 0, scale: 1 },
      )!;
      let maximum = 0;
      let minimum = Number.POSITIVE_INFINITY;
      for (const gain of tile.gain) {
        maximum = Math.max(maximum, 1 + gain);
        minimum = Math.min(minimum, 1 + gain);
      }
      // 상한에 닿으면 클램프가 평균 보존을 깬다 — 정책 표의 최대치(0.7)는 여유를 둔다.
      expect(maximum, `${kind} max multiplier`).toBeLessThanOrEqual(
        STUDIO_PAPER_GRANULATION_MAX_MULTIPLIER + 0.005,
      );
      expect(minimum, `${kind} min multiplier`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("document-space sampling", () => {
  it("is fixed to the canvas: the same coordinate always reads the same gain", () => {
    const tile = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)!;
    const at = (x: number, y: number) =>
      resolveStudioPaperGranulationAlphaMultiplierAt(tile, x, y, STRONG.scale);
    expect(at(311.5, 204.25)).toBe(at(311.5, 204.25));
    // 획을 옮겨도 종이는 따라오지 않는다 — 다른 좌표는 다른 값이다.
    expect(at(311.5, 204.25)).not.toBeCloseTo(at(311.5 + 37, 204.25 + 23), 6);
  });

  it("wraps seamlessly across the tile period", () => {
    const tile = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)!;
    const period = tile.size * STRONG.scale;
    for (const [x, y] of [[0, 0], [3.25, 91.75], [-17.5, 42.125]] as const) {
      expect(
        sampleStudioPaperGranulationGainAt(tile, x + period, y - period, STRONG.scale),
      ).toBeCloseTo(sampleStudioPaperGranulationGainAt(tile, x, y, STRONG.scale), 5);
    }
  });

  it("settles pigment into the troughs: gain and height are strongly anti-correlated", () => {
    const tile = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)!;
    const heights: number[] = [];
    const gains: number[] = [];
    for (let index = 0; index < 4096; index += 1) {
      const x = (index % 64) * 3.5 + 0.25;
      const y = Math.floor(index / 64) * 3.5 + 0.25;
      heights.push(sampleStudioPaperHeightAt(tile, x, y, STRONG.scale));
      gains.push(sampleStudioPaperGranulationGainAt(tile, x, y, STRONG.scale));
    }
    const mean = (values: readonly number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    const meanH = mean(heights);
    const meanG = mean(gains);
    let covariance = 0;
    let varH = 0;
    let varG = 0;
    for (let index = 0; index < heights.length; index += 1) {
      const a = heights[index]! - meanH;
      const b = gains[index]! - meanG;
      covariance += a * b;
      varH += a * a;
      varG += b * b;
    }
    expect(covariance / Math.sqrt(varH * varG)).toBeLessThan(-0.9);
  });

  it("guards non-finite coordinates and degenerate scales", () => {
    const tile = acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, STRONG)!;
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const multiplier = resolveStudioPaperGranulationAlphaMultiplierAt(tile, value, 0, 1);
      expect(Number.isFinite(multiplier)).toBe(true);
      expect(multiplier).toBeGreaterThanOrEqual(0);
    }
    expect(
      Number.isFinite(resolveStudioPaperGranulationAlphaMultiplierAt(tile, 4, 4, 0)),
    ).toBe(true);
  });
});
