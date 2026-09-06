import { describe, expect, it } from "vitest";

import { hasActiveImageFilters as hasLightweightActiveImageFilters } from "../render/studio-konva-filter-fields";
import {
  applyImageFilters,
  buildImageFilters,
  hasActiveImageFilters,
  registerStudioKonvaFilters,
} from "../render/studio-konva-filters";

import {
  createStudioFilterDraft,
  studioFilterDraftToPatch,
} from "./studio-filter-menu";
import {
  STUDIO_FILTER_PACK_DEFS,
  createStudioFilterPackValues,
  studioFilterPackValuesToPatch,
} from "./studio-filter-pack";
import {
  STUDIO_FILTER_UNION_WAVE_EDGE_POLICY,
  STUDIO_FILTER_UNION_WAVE_KINDS,
  STUDIO_FILTER_UNION_WAVE_MAX_PIXELS,
  applyStudioFilterUnionWave,
  isIdentityStudioFilterUnionWave,
  normalizeStudioFilterUnionWave,
  studioFilterUnionWaveKonvaFilter,
} from "./studio-filter-union-wave";

import type { StudioFilterUnionWaveKind } from "./studio-filter-union-wave";
import type { ImageFilterFields, KonvaLike } from "../render/studio-konva-filters";
import type { StudioImageDataLike } from "../studio-filters";

function patternedImage(width = 31, height = 23): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 37 + y * 19 + (x * y) % 53) % 256;
      data[offset + 1] = (x * 13 + y * 47 + (x + y) * 3) % 256;
      data[offset + 2] = (x * 71 + y * 5 + (x * y) % 97) % 256;
      data[offset + 3] = (x * 29 + y * 17) % 256;
    }
  }
  return { data, width, height };
}

function cloneImage(image: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  };
}

function fingerprint(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function defaultEffect(kind: StudioFilterUnionWaveKind) {
  const patch = studioFilterPackValuesToPatch(kind, {});
  return normalizeStudioFilterUnionWave(patch.filterUnionWave);
}

describe("studio filter union wave", () => {
  it("adds seventeen real engines with schema-driven defaults and active non-destructive patches", () => {
    expect(STUDIO_FILTER_UNION_WAVE_KINDS).toHaveLength(17);
    expect(new Set(STUDIO_FILTER_UNION_WAVE_KINDS).size).toBe(17);
    for (const kind of STUDIO_FILTER_UNION_WAVE_KINDS) {
      const definition = STUDIO_FILTER_PACK_DEFS[kind];
      expect(definition.kind).toBe(kind);
      expect(definition.params.length).toBeGreaterThan(0);
      const patch = studioFilterPackValuesToPatch(kind, {});
      expect(patch.filterUnionWave).toMatchObject({ kind });
      expect(hasActiveImageFilters(patch as ImageFilterFields)).toBe(true);
    }
  });

  it("every kind produces a distinct deterministic pixel fingerprint", () => {
    const source = patternedImage();
    const baseline = fingerprint(source.data);
    const fingerprints = new Map<StudioFilterUnionWaveKind, string>();

    for (const kind of STUDIO_FILTER_UNION_WAVE_KINDS) {
      const first = cloneImage(source);
      const second = cloneImage(source);
      expect(applyStudioFilterUnionWave(first, defaultEffect(kind))).toBe(true);
      expect(applyStudioFilterUnionWave(second, defaultEffect(kind))).toBe(true);
      const digest = fingerprint(first.data);
      expect(digest, `${kind} must not be an identity alias`).not.toBe(baseline);
      expect(second.data, `${kind} must be deterministic`).toEqual(first.data);
      fingerprints.set(kind, digest);
    }

    expect(new Set(fingerprints.values()).size).toBe(
      STUDIO_FILTER_UNION_WAVE_KINDS.length,
    );
  });

  it("keeps representative golden fingerprints stable", () => {
    const source = patternedImage();
    const golden = Object.fromEntries(
      (["wave-warp", "film-grain-pro", "stained-glass", "normal-map"] as const)
        .map((kind) => {
          const output = cloneImage(source);
          applyStudioFilterUnionWave(output, defaultEffect(kind));
          return [kind, fingerprint(output.data)];
        }),
    );

    expect(golden).toEqual({
      "wave-warp": "3c6d9940",
      "film-grain-pro": "a8d17388",
      "stained-glass": "93682c36",
      "normal-map": "d8ed2135",
    });
  });

  it("preserves every destination alpha byte for every engine, including transparent pixels", () => {
    const source = patternedImage(19, 17);
    const expectedAlpha = Array.from(
      { length: source.width * source.height },
      (_, index) => source.data[index * 4 + 3],
    );
    for (const kind of STUDIO_FILTER_UNION_WAVE_KINDS) {
      const output = cloneImage(source);
      applyStudioFilterUnionWave(output, defaultEffect(kind));
      expect(
        Array.from(
          { length: output.width * output.height },
          (_, index) => output.data[index * 4 + 3],
        ),
        `${kind} alpha`,
      ).toEqual(expectedAlpha);
    }
  });

  it("uses the same seed deterministically while making another seed visibly different", () => {
    for (const kind of [
      "film-grain-pro",
      "salt-pepper",
      "rgb-noise",
      "perlin-texture",
      "pointillize",
      "stained-glass",
    ] as const) {
      const base = defaultEffect(kind)!;
      const first = cloneImage(patternedImage());
      const repeated = cloneImage(patternedImage());
      const changed = cloneImage(patternedImage());
      applyStudioFilterUnionWave(first, { ...base, seed: 17 });
      applyStudioFilterUnionWave(repeated, { ...base, seed: 17 });
      applyStudioFilterUnionWave(changed, { ...base, seed: 18 });
      expect(repeated.data).toEqual(first.data);
      expect(changed.data, `${kind} seed must affect pixels`).not.toEqual(first.data);
    }
  });

  it("normalizes bounds but fails closed for malformed kind/amount and exact identity", () => {
    expect(normalizeStudioFilterUnionWave(null)).toBeNull();
    expect(normalizeStudioFilterUnionWave({ kind: "unknown", amount: 20 })).toBeNull();
    expect(normalizeStudioFilterUnionWave({ kind: "wave-warp", amount: Number.NaN }))
      .toBeNull();
    expect(normalizeStudioFilterUnionWave({ kind: "wave-warp" })).toBeNull();
    expect(
      normalizeStudioFilterUnionWave({
        kind: "wave-warp",
        amount: 20,
        scale: "oversized",
      }),
    ).toBeNull();
    expect(
      normalizeStudioFilterUnionWave({
        kind: "twirl",
        amount: 999,
        scale: -2,
        detail: 999,
        seed: 99_999,
        centerX: -4,
        centerY: 140,
        angle: 999,
      }),
    ).toEqual({
      kind: "twirl",
      amount: 100,
      scale: 1,
      detail: 255,
      seed: 9999,
      centerX: 0,
      centerY: 100,
      angle: 180,
      mode: "rectangular-to-polar",
      interpolation: "bilinear",
    });

    const image = patternedImage();
    const before = new Uint8ClampedArray(image.data);
    const identity = normalizeStudioFilterUnionWave({
      kind: "wave-warp",
      amount: 0,
    });
    expect(isIdentityStudioFilterUnionWave(identity)).toBe(true);
    expect(applyStudioFilterUnionWave(image, identity)).toBe(false);
    expect(image.data).toEqual(before);

    const negative = {
      filterUnionWave: {
        ...defaultEffect("pinch-bloat")!,
        amount: -40,
      },
    };
    expect(hasLightweightActiveImageFilters(negative)).toBe(true);
    expect(hasActiveImageFilters(negative)).toBe(true);
  });

  it("is safe for 1×1, malformed dimensions, short buffers, and over-budget work", () => {
    const tiny: StudioImageDataLike = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([20, 40, 60, 0]),
    };
    for (const kind of STUDIO_FILTER_UNION_WAVE_KINDS) {
      expect(() =>
        applyStudioFilterUnionWave(cloneImage(tiny), defaultEffect(kind)),
      ).not.toThrow();
    }

    for (const malformed of [
      { width: 1.5, height: 1, data: new Uint8ClampedArray(8) },
      { width: 3, height: 3, data: new Uint8ClampedArray(4) },
      {
        width: STUDIO_FILTER_UNION_WAVE_MAX_PIXELS + 1,
        height: 1,
        data: new Uint8ClampedArray(4),
      },
    ] satisfies StudioImageDataLike[]) {
      const before = new Uint8ClampedArray(malformed.data);
      expect(applyStudioFilterUnionWave(malformed, defaultEffect("wave-warp")))
        .toBe(false);
      expect(malformed.data).toEqual(before);
    }
  });

  it("matches the flat Konva adapter and builds one live filter with serializable attrs", () => {
    const effect = defaultEffect("ripple-warp")!;
    const direct = patternedImage();
    const viaKonva = patternedImage();
    applyStudioFilterUnionWave(direct, effect);
    studioFilterUnionWaveKonvaFilter.call(
      {
        attrs: {
          filterUnionKind: effect.kind,
          filterUnionAmount: effect.amount,
          filterUnionScale: effect.scale,
          filterUnionDetail: effect.detail,
          filterUnionSeed: effect.seed,
          filterUnionCenterX: effect.centerX,
          filterUnionCenterY: effect.centerY,
          filterUnionAngle: effect.angle,
        },
      },
      viaKonva,
    );
    expect(viaKonva.data).toEqual(direct.data);

    const konva: KonvaLike = { Filters: {} };
    registerStudioKonvaFilters(konva);
    const built = buildImageFilters({ filterUnionWave: effect }, konva);
    expect(built.filters).toHaveLength(1);
    expect(built.attrs).toMatchObject({
      filterUnionKind: "ripple-warp",
      filterUnionAmount: effect.amount,
    });
    const viaPipeline = patternedImage();
    applyImageFilters(viaPipeline, built.filters, built.attrs);
    expect(viaPipeline.data).toEqual(direct.data);
  });

  it("round-trips persisted fields through dialog reopen, preview patch, and reset defaults", () => {
    for (const kind of STUDIO_FILTER_UNION_WAVE_KINDS) {
      const firstPatch = studioFilterPackValuesToPatch(kind, {});
      const reopened = createStudioFilterDraft(kind, firstPatch);
      expect(studioFilterDraftToPatch(reopened)).toEqual(firstPatch);
      expect(createStudioFilterPackValues(kind, firstPatch)).toEqual(
        STUDIO_FILTER_PACK_DEFS[kind].defaults,
      );
    }
    expect(STUDIO_FILTER_UNION_WAVE_EDGE_POLICY).toBe("clamp-to-edge");
  });
});
