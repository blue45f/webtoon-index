import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  type StudioBg3dCaptureArtifactV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS,
  StudioBg3dArtifactFxError,
  renderStudioBg3dArtifactWebtoonFx,
} from "./studio-bg3d-artifact-webtoon-fx";
import {
  STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
  STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
  type StudioBg3dWebtoonFxPass,
} from "./studio-bg3d-webtoon-fx";

function capture(
  width: number,
  height: number,
  artifacts: readonly StudioBg3dCaptureArtifactV2[],
) {
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width,
    height,
    artifacts,
  } as const;
}

function beauty(width: number, height: number, data?: Uint8Array) {
  return {
    kind: "beauty",
    width,
    height,
    profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
    data: data ?? new Uint8Array(width * height * 4).fill(255),
  } as const;
}

function depth(width: number, height: number, data: Float32Array) {
  return {
    kind: "depth",
    width,
    height,
    profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
    data,
  } as const;
}

function normal(width: number, height: number, data?: Uint8Array) {
  const packed = data ?? new Uint8Array(width * height * 2);
  if (!data) {
    for (let index = 0; index < packed.length; index += 2) {
      packed[index] = 128;
      packed[index + 1] = 128;
    }
  }
  return {
    kind: "normal",
    width,
    height,
    profile: STUDIO_BG3D_NORMAL_PROFILE,
    coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
    packing: STUDIO_BG3D_NORMAL_PACKING,
    data: packed,
  } as const;
}

function request(
  width: number,
  height: number,
  effects: readonly StudioBg3dWebtoonFxPass[],
  includeDepth = false,
) {
  return {
    kind: "webtoon-fx-capture",
    version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
    width,
    height,
    timeSeconds: 0,
    seed: 1,
    quality: "preview",
    outputIntent: "beauty",
    includeDepth,
    outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
    effects,
  } as const;
}

describe("Studio BG3D artifact webtoon FX", () => {
  it("creates an outline from canonical depth and normal artifacts without mutating them", () => {
    const width = 3;
    const height = 1;
    const beautyData = new Uint8Array([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    const source = capture(width, height, [
      beauty(width, height, beautyData),
      depth(width, height, new Float32Array([0.2, 0.2, 0.9])),
      normal(width, height),
    ]);

    const result = renderStudioBg3dArtifactWebtoonFx(source, request(width, height, [{
      kind: "toon-outline",
      thicknessPx: 1,
      depthThreshold: 0.05,
      normalThreshold: 0.2,
      color: "#000000",
      opacity: 1,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect([...result.rgba.slice(4, 12)]).not.toEqual([
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    expect([...beautyData]).toEqual([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
  });

  it("uses view-normal discontinuity when depth is flat", () => {
    const normals = new Uint8Array([
      128, 128,
      255, 128,
    ]);
    const result = renderStudioBg3dArtifactWebtoonFx(capture(2, 1, [
      beauty(2, 1),
      depth(2, 1, new Float32Array([0.5, 0.5])),
      normal(2, 1, normals),
    ]), request(2, 1, [{
      kind: "toon-outline",
      thicknessPx: 1,
      depthThreshold: 1,
      normalThreshold: 0.05,
      color: "#ff0000",
      opacity: 1,
    }]));

    expect(result.kind === "capture" && result.rgba[1]).toBeLessThan(255);
  });

  it("outlines alpha silhouettes into transparent pixels with straight-alpha color", () => {
    const result = renderStudioBg3dArtifactWebtoonFx(capture(2, 1, [
      beauty(2, 1, new Uint8Array([
        255, 255, 255, 255,
        0, 0, 0, 0,
      ])),
      depth(2, 1, new Float32Array([0.5, 0.5])),
      normal(2, 1),
    ]), request(2, 1, [{
      kind: "toon-outline",
      thicknessPx: 1,
      depthThreshold: 1,
      normalThreshold: 1,
      color: "#ff0000",
      opacity: 0.5,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect([...result.rgba.slice(4, 8)]).toEqual([255, 0, 0, 128]);
  });

  it("composites depth atmosphere in linear light and preserves requested depth", () => {
    const result = renderStudioBg3dArtifactWebtoonFx(capture(2, 1, [
      beauty(2, 1, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255])),
      depth(2, 1, new Float32Array([0, 1])),
    ]), request(2, 1, [{
      kind: "depth-atmosphere",
      startDepth: 0.25,
      endDepth: 0.75,
      density: 4,
      color: "#ffffff",
      opacity: 1,
    }], true));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect(result.rgba[0]).toBe(0);
    expect(result.rgba[4]).toBeGreaterThan(200);
    expect([...result.depthFloat32!]).toEqual([0, 1]);
  });

  it("spreads emissive bloom beyond a bright source pixel", () => {
    const emission = {
      kind: "emission",
      width: 3,
      height: 1,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array([
        0, 0, 0, 0,
        255, 255, 255, 255,
        0, 0, 0, 0,
      ]),
    } as const;
    const result = renderStudioBg3dArtifactWebtoonFx(capture(3, 1, [
      beauty(3, 1, new Uint8Array(12)),
      emission,
    ]), request(3, 1, [{
      kind: "emissive-bloom",
      threshold: 0.1,
      intensity: 1,
      radiusPx: 1,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect(result.rgba[0]).toBeGreaterThan(0);
    expect(result.rgba[8]).toBeGreaterThan(0);
    expect(result.rgba[3]).toBeGreaterThan(0);
  });

  it("does not bloom transparent RGB garbage and honors a zero-radius self glow", () => {
    const transparentEmission = {
      kind: "emission",
      width: 2,
      height: 1,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array([
        255, 255, 255, 0,
        255, 255, 255, 255,
      ]),
    } as const;
    const result = renderStudioBg3dArtifactWebtoonFx(capture(2, 1, [
      beauty(2, 1, new Uint8Array(8)),
      transparentEmission,
    ]), request(2, 1, [{
      kind: "emissive-bloom",
      threshold: 0,
      intensity: 1,
      radiusPx: 0,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect([...result.rgba.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(result.rgba[4]).toBeGreaterThan(0);
  });

  it("applies partial emission coverage exactly once", () => {
    const partialEmission = {
      kind: "emission",
      width: 1,
      height: 1,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array([255, 255, 255, 128]),
    } as const;
    const result = renderStudioBg3dArtifactWebtoonFx(capture(1, 1, [
      beauty(1, 1, new Uint8Array(4)),
      partialEmission,
    ]), request(1, 1, [{
      kind: "emissive-bloom",
      threshold: 0,
      intensity: 1,
      radiusPx: 0,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect([...result.rgba]).toEqual([255, 255, 255, 128]);
  });

  it("uses a constant zero-padded blur kernel without brightening image edges", () => {
    const centerEmission = {
      kind: "emission",
      width: 3,
      height: 1,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array([
        0, 0, 0, 0,
        255, 255, 255, 255,
        0, 0, 0, 0,
      ]),
    } as const;
    const result = renderStudioBg3dArtifactWebtoonFx(capture(3, 1, [
      beauty(3, 1, new Uint8Array(12)),
      centerEmission,
    ]), request(3, 1, [{
      kind: "emissive-bloom",
      threshold: 0,
      intensity: 1,
      radiusPx: 1,
    }]));

    expect(result.kind).toBe("capture");
    if (result.kind !== "capture") return;
    expect([...result.rgba.slice(0, 4)]).toEqual([...result.rgba.slice(4, 8)]);
    expect([...result.rgba.slice(4, 8)]).toEqual([...result.rgba.slice(8, 12)]);
  });

  it("fails closed for missing artifacts and unsupported recipe passes", () => {
    expect(() => renderStudioBg3dArtifactWebtoonFx(
      capture(1, 1, [beauty(1, 1)]),
      request(1, 1, [{
        kind: "toon-outline",
        thicknessPx: 1,
        depthThreshold: 0.1,
        normalThreshold: 0.1,
        color: "#000000",
        opacity: 1,
      }]),
    )).toThrowError(expect.objectContaining({ code: "missing-artifact" }));

    expect(() => renderStudioBg3dArtifactWebtoonFx(
      capture(1, 1, [beauty(1, 1)]),
      request(1, 1, [{
        kind: "speed-lines",
        density: 0.5,
        strength: 1,
        center: [0.5, 0.5],
        color: "#ffffff",
        opacity: 1,
        seed: 1,
      }]),
    )).toThrowError(expect.objectContaining({ code: "unsupported-effect" }));

    expect(() => renderStudioBg3dArtifactWebtoonFx(
      capture(1, 1, [beauty(1, 1)]),
      request(1, 1, [{
        kind: "emissive-bloom",
        threshold: 0.5,
        intensity: 1,
        radiusPx: 1,
      }], true),
    )).toThrowError(expect.objectContaining({ code: "missing-artifact" }));
  });

  it("honors an already-aborted transaction before allocating output", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => renderStudioBg3dArtifactWebtoonFx(
      capture(1, 1, [beauty(1, 1)]),
      request(1, 1, [{
        kind: "emissive-bloom",
        threshold: 0.5,
        intensity: 1,
        radiusPx: 1,
      }]),
      { signal: controller.signal },
    )).toThrowError(StudioBg3dArtifactFxError);
  });

  it("rejects previews larger than the synchronous 512-square budget before normalization", () => {
    const width = 513;
    const height = 512;
    expect(width * height).toBeGreaterThan(STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS);

    expect(() => renderStudioBg3dArtifactWebtoonFx(
      { width, height },
      request(width, height, []),
    )).toThrowError(expect.objectContaining({ code: "pixel-budget-exceeded" }));
  });
});
