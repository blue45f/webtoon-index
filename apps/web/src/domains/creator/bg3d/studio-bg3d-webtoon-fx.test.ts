import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import {
  STUDIO_BG3D_WEBTOON_FX_MAX_LT_PIXELS,
  STUDIO_BG3D_WEBTOON_FX_MAX_PASSES,
  STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
  STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
  normalizeStudioBg3dWebtoonFxCaptureRequest,
} from "./studio-bg3d-webtoon-fx";

const validRequest = {
  kind: "webtoon-fx-capture",
  version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
  width: 1_920,
  height: 1_080,
  timeSeconds: 1.25,
  seed: 42,
  quality: "preview",
  outputIntent: "beauty",
  includeDepth: true,
  outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
  effects: [
    {
      kind: "toon-outline",
      thicknessPx: 2,
      depthThreshold: 0.08,
      normalThreshold: 0.32,
      color: "#1A1A1A",
      opacity: 0.9,
    },
    {
      kind: "weather-particles",
      preset: "rain",
      density: 0.5,
      speed: 8,
      sizePx: 2,
      wind: [1, -0.25],
      seed: 99,
    },
  ],
} as const;

describe("Studio BG3D webtoon FX contract", () => {
  it("keeps the LT-bound specialist budget aligned with the canonical LT renderer", () => {
    expect(STUDIO_BG3D_WEBTOON_FX_MAX_LT_PIXELS).toBe(STUDIO_BG3D_LT_RENDER_MAX_PIXELS);
  });

  it("creates a deterministic frozen recipe and strips unknown fields", () => {
    const normalized = normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      injected: new Uint8Array(1_024),
    });

    expect(normalized).toEqual({
      ...validRequest,
      effects: [
        { ...validRequest.effects[0], color: "#1a1a1a" },
        { ...validRequest.effects[1], wind: [1, -0.25] },
      ],
    });
    expect(normalized).not.toHaveProperty("injected");
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.effects)).toBe(true);
    expect(Object.isFrozen(normalized?.effects[1])).toBe(true);
    expect(
      normalized?.effects[1]?.kind === "weather-particles" &&
      Object.isFrozen(normalized.effects[1].wind),
    ).toBe(true);
  });

  it("rejects unsupported, hostile, and work-amplifying recipes", () => {
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      width: 0,
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      version: 2,
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      outputProfile: "unknown-profile",
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      effects: Array.from(
        { length: STUDIO_BG3D_WEBTOON_FX_MAX_PASSES + 1 },
        () => validRequest.effects[0],
      ),
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      effects: [{ kind: "arbitrary-shader", source: "while(true){}" }],
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      effects: [{
        ...validRequest.effects[0],
        thicknessPx: Number.POSITIVE_INFINITY,
      }],
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      get effects(): never {
        throw new Error("hostile getter");
      },
    })).toBeNull();
  });

  it("requires valid depth ranges, colors, seeds, and normalized effect coordinates", () => {
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      effects: [{
        kind: "depth-atmosphere",
        startDepth: 0.8,
        endDepth: 0.2,
        density: 1,
        color: "#ffffff",
        opacity: 1,
      }],
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      effects: [{
        kind: "speed-lines",
        density: 0.5,
        strength: 2,
        center: [1.1, 0.5],
        color: "#fff",
        opacity: 1,
        seed: -1,
      }],
    })).toBeNull();
  });

  it("keeps beauty and LT-source budgets and effect semantics separate", () => {
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      width: 4_096,
      height: 2_049,
      quality: "final",
      outputIntent: "lt-source",
      includeDepth: true,
      effects: [validRequest.effects[0]],
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      outputIntent: "lt-source",
      includeDepth: false,
      effects: [validRequest.effects[0]],
    })).toBeNull();
    expect(normalizeStudioBg3dWebtoonFxCaptureRequest({
      ...validRequest,
      outputIntent: "lt-source",
      includeDepth: true,
      effects: [{
        kind: "emissive-bloom",
        threshold: 1,
        intensity: 1,
        radiusPx: 8,
      }],
    })).toBeNull();
  });
});
