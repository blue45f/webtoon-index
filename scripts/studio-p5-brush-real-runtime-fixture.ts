import {
  STUDIO_P5_BRUSH_GOLDEN_QUALITY_POLICIES,
  evaluateStudioP5BrushGoldenQuality,
} from "./studio-p5-brush-golden-quality-policy";

import type {
  StudioP5BrushRealRuntimeCaseEvidence,
  StudioP5BrushRealRuntimeCaseId,
  StudioP5BrushRealRuntimePixelEvidence,
} from "./studio-p5-brush-real-runtime-protocol";
import type {
  StudioProceduralArtisticBrushArtifact,
  StudioProceduralArtisticBrushParameter,
} from "../apps/web/src/domains/creator/studio-procedural-artistic-brush-provider";
import type {
  StudioProceduralArtisticBrushWorkerRequest,
} from "../apps/web/src/domains/creator/studio-procedural-artistic-brush-worker-protocol";


export const STUDIO_P5_BRUSH_REAL_RUNTIME_ENGINE_EPOCH = 9_501;
export const STUDIO_P5_BRUSH_REAL_RUNTIME_WIDTH = 160;
export const STUDIO_P5_BRUSH_REAL_RUNTIME_HEIGHT = 128;
export const STUDIO_P5_BRUSH_REAL_RUNTIME_SEED = 0x5a17_c0de;

function parametersFor(
  technique: StudioP5BrushRealRuntimeCaseId,
): Readonly<Record<string, StudioProceduralArtisticBrushParameter>> {
  switch (technique) {
    case "flow-field":
      return Object.freeze({
        brush: "HB",
        color: "#173f5f",
        curvature: 0.62,
        field: "waves",
        fieldTime: 2.5,
        weight: 2.4,
      });
    case "hatch":
      return Object.freeze({
        angle: 32,
        brush: "pen",
        color: "#7b2f4f",
        continuous: false,
        distance: 5,
        gradient: 0.12,
        randomness: 0.08,
        weight: 1.35,
      });
    case "mass":
      return Object.freeze({
        brush: "charcoal",
        color: "#2b2118",
        gradient: 0.16,
        outline: false,
        precision: 0.72,
        strength: 0.86,
      });
    case "watercolor-fill":
      return Object.freeze({
        angle: Math.PI / 6,
        color: "#315f8f",
        density: 0.64,
        opacity: 0.72,
        strength: 0.34,
      });
    case "flat-wash":
      return Object.freeze({
        color: "#c46f3d",
        opacity: 0.68,
      });
  }
}

export function studioP5BrushRealRuntimeRequest(
  technique: StudioP5BrushRealRuntimeCaseId,
  requestSequence: number,
): StudioProceduralArtisticBrushWorkerRequest {
  const polygon = [
    [24, 24, 0.3],
    [136, 22, 0.55],
    [146, 82, 0.8],
    [112, 108, 0.95],
    [32, 104, 0.65],
    [16, 62, 0.45],
  ] as const;
  const flow = [
    [16, 36, 0.25],
    [34, 24, 0.4],
    [54, 40, 0.55],
    [76, 72, 0.75],
    [98, 94, 0.9],
    [122, 82, 0.7],
    [144, 48, 0.45],
  ] as const;
  const coordinates = technique === "flow-field" ? flow : polygon;
  const presetId = technique === "watercolor-fill" || technique === "flat-wash"
    ? `studio-procedural-${technique}-v1`
    : `real-runtime-${technique}`;
  return Object.freeze({
    kind: "studio-procedural-artistic-brush/request",
    version: 1,
    requestSequence,
    engineEpoch: STUDIO_P5_BRUSH_REAL_RUNTIME_ENGINE_EPOCH,
    strokeId: `real-runtime-${technique}-${requestSequence}`,
    stage: "settled",
    seed: STUDIO_P5_BRUSH_REAL_RUNTIME_SEED,
    width: STUDIO_P5_BRUSH_REAL_RUNTIME_WIDTH,
    height: STUDIO_P5_BRUSH_REAL_RUNTIME_HEIGHT,
    pixelRatio: 1,
    plan: Object.freeze({
      technique,
      presetId,
      samples: Object.freeze(
        coordinates.map(([x, y, pressure], index) => Object.freeze({
          x,
          y,
          pressure,
          tiltX: index % 2 === 0 ? -12 : 14,
          tiltY: index % 3 === 0 ? 18 : -8,
          timeMilliseconds: index * 8,
        })),
      ),
      parameters: parametersFor(technique),
    }),
  });
}

export function studioP5BrushExactPixelsEqual(
  left: Uint8Array | Uint8ClampedArray,
  right: Uint8Array | Uint8ClampedArray,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function pixelEvidence(
  artifact: StudioProceduralArtisticBrushArtifact,
): StudioP5BrushRealRuntimePixelEvidence {
  const { pixels, width, height } = artifact;
  let alphaSum = 0;
  let nonTransparentPixels = 0;
  let paintedPixels = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0;
    alphaSum += alpha;
    if (alpha > 0) nonTransparentPixels += 1;
    if (
      alpha > 0
      && (
        alpha < 250
        || (pixels[offset] ?? 255) < 248
        || (pixels[offset + 1] ?? 255) < 248
        || (pixels[offset + 2] ?? 255) < 248
      )
    ) {
      paintedPixels += 1;
      const pixelIndex = offset / 4;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return Object.freeze({
    byteLength: pixels.byteLength,
    pixelHash: artifact.receipt.pixelHash,
    alphaSum,
    nonTransparentPixels,
    paintedPixels,
    paintedBounds: paintedPixels > 0
      ? Object.freeze({ left, top, right, bottom })
      : null,
  });
}

export function studioP5BrushRealRuntimeCaseEvidence(
  technique: StudioP5BrushRealRuntimeCaseId,
  first: StudioProceduralArtisticBrushArtifact,
  replay: StudioProceduralArtisticBrushArtifact,
): StudioP5BrushRealRuntimeCaseEvidence {
  const exactPixelReplay = studioP5BrushExactPixelsEqual(
    first.pixels,
    replay.pixels,
  );
  const quality = evaluateStudioP5BrushGoldenQuality(
    STUDIO_P5_BRUSH_GOLDEN_QUALITY_POLICIES[technique],
    {
      rgba: first.pixels,
      width: first.width,
      height: first.height,
    },
    {
      firstPixelHash: first.receipt.pixelHash,
      replayPixelHash: replay.receipt.pixelHash,
      independentWorkerPixelHash: replay.receipt.pixelHash,
      exactPixelReplay,
    },
  );
  return Object.freeze({
    id: technique,
    technique,
    width: first.width,
    height: first.height,
    seed: STUDIO_P5_BRUSH_REAL_RUNTIME_SEED,
    first: pixelEvidence(first),
    replay: pixelEvidence(replay),
    exactPixelReplay,
    quality: Object.freeze({
      ok: quality.ok,
      findings: quality.findings,
      metrics: quality.metrics === null
        ? null
        : Object.freeze({
            paintedCoverage: quality.metrics.paintedCoverage,
            boundsCanvasCoverage: quality.metrics.boundsCanvasCoverage,
            boundsOccupancy: quality.metrics.boundsOccupancy,
            colorBucketCount: quality.metrics.colorBucketCount,
            luminanceStandardDeviation:
              quality.metrics.luminanceStandardDeviation,
            neighborLinkRatio: quality.metrics.neighborLinkRatio,
            edgeDensity: quality.metrics.edgeDensity,
            textureScore: quality.metrics.textureScore,
            scratchByteLength: quality.metrics.scratchByteLength,
          }),
    }),
    capability: `procedural:${technique}`,
    adapterId: first.receipt.adapter.id as "p5-brush-standalone-worker",
    adapterCompatibility: first.receipt.adapter.compatibility,
    execution: first.receipt.execution,
  });
}
