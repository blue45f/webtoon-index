// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  studioBrushDynamicsSeedFromKey,
  type StudioDynamicBrushDab,
} from "../brush/studio-brush-dynamics";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
} from "../brush/studio-brush-r8-grain-runtime";
import { resolveStudioDynamicBrushMaterialIdentity } from "../brush/studio-dry-media-dynamic-bridge";
import {
  STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
  planStudioDynamicBrushCoverageMarks,
} from "../studio-dynamic-brush-coverage-renderer";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET,
  visitStudioSvgR8StreamingCoverage,
  type StudioSvgR8StreamingCoverageMark,
} from "./studio-svg-r8-streaming-export";

import type { StudioBrushR8TextureGrainSource } from "../brush/studio-brush-r8-grain-asset-contract";

const paperBytes = new Uint8Array([
  0, 64, 128, 255,
  255, 128, 64, 0,
  32, 96, 160, 224,
  224, 160, 96, 32,
]);

function source(): StudioBrushR8TextureGrainSource {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: "paper.svg-streaming.v1",
      encodedSha256: `sha256:${"e".repeat(64)}`,
      decodedSha256: `sha256:${sha256HexPortable(paperBytes)}`,
      byteLength: 137,
      mediaType: "image/png",
      width: 4,
      height: 4,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

function dynamics(alphaMapSize = 8) {
  return normalizeStudioBrushDynamicsSettings({
    depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
    seed: 71,
    tip: { shape: "hard", softness: 0, alphaMapSize },
    grain: {
      amount: 0.8,
      scale: 24,
      contrast: 0.55,
      seed: 17,
      space: "canvas-fixed",
      source: source(),
    },
    taper: { enabled: false },
  });
}

function dab(
  index: number,
  overrides: Partial<StudioDynamicBrushDab> = {},
): StudioDynamicBrushDab {
  const x = 10 + index;
  return {
    index,
    progress: index / 100,
    sourceX: x,
    sourceY: 20,
    x,
    y: 20,
    size: 16,
    opacity: 0.5,
    flow: 0.4,
    spacing: 4,
    scatter: 0,
    angle: index % 2 === 0 ? 13 : -17,
    roundness: 0.72,
    ...overrides,
  };
}

function snapshotMark(mark: Readonly<StudioSvgR8StreamingCoverageMark>) {
  return {
    x: mark.x,
    y: mark.y,
    radiusX: mark.radiusX,
    radiusY: mark.radiusY,
    angleRadians: mark.angleRadians,
    alpha: mark.alpha,
    color: mark.color,
    revision: mark.texture.alphaMap.revision,
    size: mark.texture.alphaMap.size,
    alphas: [...mark.texture.alphaMap.alphas],
  };
}

function isZeroed(map: Float32Array | null): boolean {
  return map !== null && map.every((value) => value === 0);
}

describe("SVG R8 bounded streaming coverage", () => {
  afterEach(() => {
    resetStudioBrushR8GrainRegistry();
  });

  it("preserves segmented variation/dab order and exact retained-planner CPU samples", () => {
    const grainSource = source();
    expect(hydrateStudioBrushR8GrainAsset(grainSource, paperBytes).status)
      .toBe("ready");
    const normalized = dynamics(8);
    const dabVariations = [
      {
        kind: "studio-dynamic-brush-segmented-dab-variation" as const,
        segments: [[dab(0)], [dab(1), dab(2)]],
      },
      [dab(0, { x: 90, sourceX: 90 }), dab(1, { x: 89, sourceX: 89 })],
    ];
    const retained = planStudioDynamicBrushCoverageMarks({
      dabVariations,
      dynamics: normalized,
      dynamicSeed: 91,
      stroke: "#335577",
      stampGrid: 3,
      markBudget: 8,
    });
    expect(retained.ok).toBe(true);
    if (!retained.ok) throw new Error(retained.reason);

    const streamedMarks: ReturnType<typeof snapshotMark>[] = [];
    const visitedOrder: string[] = [];
    const streamed = visitStudioSvgR8StreamingCoverage({
      dabVariations,
      dynamics: normalized,
      dynamicSeed: 91,
      stroke: "#335577",
      markBudget: 8,
    }, (mark, variationIndex, markIndexInVariation) => {
      visitedOrder.push(`${variationIndex}:${markIndexInVariation}:${mark.x}`);
      streamedMarks.push(snapshotMark(mark));
      return true;
    });

    expect(streamed.ok).toBe(true);
    if (!streamed.ok) throw new Error(streamed.reason);
    expect(streamed.marksPerVariation).toEqual([3, 2]);
    expect(visitedOrder).toEqual([
      "0:0:10",
      "0:1:11",
      "0:2:12",
      "1:0:90",
      "1:1:89",
    ]);
    expect(streamedMarks).toEqual(retained.marks.map((mark) => ({
      x: mark.x,
      y: mark.y,
      radiusX: mark.radiusX,
      radiusY: mark.radiusY,
      angleRadians: mark.angleRadians,
      alpha: mark.alpha,
      color: mark.color,
      revision: mark.texture?.alphaMap.revision,
      size: mark.texture?.alphaMap.size,
      alphas: [...(mark.texture?.alphaMap.alphas ?? [])],
    })));
  });

  it("uses the same anisotropic catalogue dabs as retained coverage", () => {
    const grainSource = source();
    expect(hydrateStudioBrushR8GrainAsset(grainSource, paperBytes).status)
      .toBe("ready");
    const normalized = dynamics(8);
    const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
      "dry-media",
      "pastel-paper-soft",
    );
    if (!materialIdentity) throw new Error("missing pastel material identity");
    const dabVariations = [{
      kind: "studio-dynamic-brush-segmented-dab-variation" as const,
      segments: [
        [dab(0)],
        [dab(1), dab(2)],
      ],
    }];
    const retained = planStudioDynamicBrushCoverageMarks({
      dabVariations,
      dynamics: normalized,
      materialIdentity,
      dynamicSeed: 91,
      stroke: "#6b486f",
      stampGrid: 3,
      // Pastel lowers every source dab into five deterministic pigment lanes.
      markBudget: 15,
    });
    expect(retained.ok).toBe(true);
    if (!retained.ok) throw new Error(retained.reason);

    const streamedMarks: ReturnType<typeof snapshotMark>[] = [];
    const streamed = visitStudioSvgR8StreamingCoverage({
      dabVariations,
      dynamics: normalized,
      materialIdentity,
      dynamicSeed: 91,
      stroke: "#6b486f",
      markBudget: 15,
    }, (mark) => {
      streamedMarks.push(snapshotMark(mark));
      return true;
    });
    expect(streamed.ok).toBe(true);
    if (!streamed.ok) throw new Error(streamed.reason);
    expect(streamedMarks).toEqual(retained.marks.map((mark) => ({
      x: mark.x,
      y: mark.y,
      radiusX: mark.radiusX,
      radiusY: mark.radiusY,
      angleRadians: mark.angleRadians,
      alpha: mark.alpha,
      color: mark.color,
      revision: mark.texture?.alphaMap.revision,
      size: mark.texture?.alphaMap.size,
      alphas: [...(mark.texture?.alphaMap.alphas ?? [])],
    })));
    expect(streamedMarks.every((mark) => mark.radiusX > mark.radiusY * 3))
      .toBe(true);
  });

  it("streams beyond the old 16 MiB retained-map ceiling with one Float32 map live", () => {
    const grainSource = source();
    expect(hydrateStudioBrushR8GrainAsset(grainSource, paperBytes).status)
      .toBe("ready");
    const normalized = dynamics(256);
    const firstRejectedDabCount = Math.floor(
      STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET
        / (256 * 256 * Float32Array.BYTES_PER_ELEMENT),
    ) + 1;
    const dabs = Array.from(
      { length: firstRejectedDabCount },
      (_, index) => dab(index),
    );
    const retained = planStudioDynamicBrushCoverageMarks({
      dabVariations: [dabs],
      dynamics: normalized,
      dynamicSeed: 91,
      stroke: "#335577",
      stampGrid: 3,
      markBudget: firstRejectedDabCount,
    });
    expect(retained).toEqual({
      ok: false,
      reason: "r8-grain-memory-budget",
    });

    let previousMap: Float32Array | null = null;
    let peakRetainedBySink = 0;
    const streamed = visitStudioSvgR8StreamingCoverage({
      dabVariations: [dabs],
      dynamics: normalized,
      dynamicSeed: 91,
      stroke: "#335577",
      markBudget: firstRejectedDabCount,
    }, (mark) => {
      if (previousMap) {
        expect(previousMap.every((value) => value === 0)).toBe(true);
      }
      previousMap = mark.texture.alphaMap.alphas;
      peakRetainedBySink = Math.max(
        peakRetainedBySink,
        mark.texture.alphaMap.alphas.byteLength,
      );
      return true;
    });

    expect(firstRejectedDabCount).toBe(65);
    expect(streamed.ok).toBe(true);
    if (!streamed.ok) throw new Error(streamed.reason);
    expect(streamed.totalMarks).toBe(firstRejectedDabCount);
    expect(streamed.generatedAlphaMapBytes)
      .toBeGreaterThan(STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET);
    expect(streamed.peakTransientAlphaMapBytes)
      .toBe(256 * 256 * Float32Array.BYTES_PER_ELEMENT);
    expect(peakRetainedBySink).toBe(streamed.peakTransientAlphaMapBytes);
    expect(streamed.embeddedRgbaBytes)
      .toBe(256 * 256 * 4 * firstRejectedDabCount);
    expect(streamed.embeddedRgbaBytes)
      .toBeLessThan(STUDIO_SVG_R8_STREAMING_RGBA_BYTE_BUDGET);
    expect(isZeroed(previousMap)).toBe(true);
  });

  it("fails closed before visiting when verified source bytes are unavailable", () => {
    let visits = 0;
    const streamed = visitStudioSvgR8StreamingCoverage({
      dabVariations: [[dab(0)]],
      dynamics: dynamics(8),
      dynamicSeed: 91,
      stroke: "#335577",
      markBudget: 1,
    }, () => {
      visits += 1;
      return true;
    });

    expect(streamed).toEqual({
      ok: false,
      reason: "r8-grain-unavailable",
    });
    expect(visits).toBe(0);
  });

  it("zeroizes the current map when the synchronous encoder rejects it", () => {
    const grainSource = source();
    expect(hydrateStudioBrushR8GrainAsset(grainSource, paperBytes).status)
      .toBe("ready");
    let rejectedMap: Float32Array | null = null;
    const streamed = visitStudioSvgR8StreamingCoverage({
      dabVariations: [[dab(0), dab(1)]],
      dynamics: dynamics(8),
      dynamicSeed: 91,
      stroke: "#335577",
      markBudget: 2,
    }, (mark) => {
      rejectedMap = mark.texture.alphaMap.alphas;
      return false;
    });

    expect(streamed).toEqual({ ok: false, reason: "sink-rejected" });
    expect(isZeroed(rejectedMap)).toBe(true);
  });

  it("uses the exact stroke identity seed deterministically", () => {
    const grainSource = source();
    expect(hydrateStudioBrushR8GrainAsset(grainSource, paperBytes).status)
      .toBe("ready");
    const normalized = dynamics(8);
    const strokeSeed = studioBrushDynamicsSeedFromKey(
      `svg-r8-streaming:${normalized.seed}`,
    );
    const run = () => {
      const fingerprints: string[] = [];
      const result = visitStudioSvgR8StreamingCoverage({
        dabVariations: [[dab(0), dab(1)]],
        dynamics: normalized,
        dynamicSeed: strokeSeed,
        stroke: "#335577",
        markBudget: 2,
      }, (mark) => {
        fingerprints.push(
          `${mark.texture.alphaMap.revision}:${[...mark.texture.alphaMap.alphas].join(",")}`,
        );
        return true;
      });
      expect(result.ok).toBe(true);
      return fingerprints;
    };

    expect(run()).toEqual(run());
  });
});
