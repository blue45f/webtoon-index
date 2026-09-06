import { describe, expect, it } from "vitest";

import { decodeStudioBrushTipAlphaMapBase64 } from "./brush/studio-brush-tip-stamp";
import {
  STUDIO_ABR_IMPORT_LIMITS,
  StudioAbrImportError,
  assertStudioAbrEnvelope,
  convertStudioAbrDocument,
  convertStudioAbrSampleToTip,
} from "./studio-abr-import";

import type { Abr, Brush, SampleInfo } from "ag-psd";

function sampledBrush(name: string, sampleId: string): Brush {
  return {
    name,
    shape: {
      type: "sampled",
      name,
      size: 42,
      angle: 18,
      roundness: 0.62,
      spacingOn: true,
      spacing: 0.24,
      flipX: false,
      flipY: false,
      sampledData: sampleId,
    },
    shapeDynamics: {
      sizeDynamics: { control: "pen pressure", steps: 0, jitter: 0, minimum: 0.2 },
      minimumDiameter: 0.2,
      tiltScale: 1,
      angleDynamics: { control: "pen tilt", steps: 0, jitter: 0.5, minimum: 0 },
      roundnessDynamics: { control: "off", steps: 0, jitter: 0, minimum: 0 },
      minimumRoundness: 0.2,
      flipX: false,
      flipY: false,
      brushProjection: false,
    },
    transfer: {
      flowDynamics: { control: "pen pressure", steps: 0, jitter: 0, minimum: 0.15 },
      opacityDynamics: { control: "pen pressure", steps: 0, jitter: 0, minimum: 0.25 },
      wetnessDynamics: { control: "off", steps: 0, jitter: 0, minimum: 0 },
      mixDynamics: { control: "off", steps: 0, jitter: 0, minimum: 0 },
    },
    spacing: 0.24,
    noise: false,
    wetEdges: false,
    useBrushSize: true,
    toolOptions: {
      type: "brush",
      brushPreset: true,
      flow: 0.7,
      smooth: 20,
      mode: "normal",
      opacity: 0.8,
      smoothing: true,
      smoothingValue: 40,
      smoothingRadiusMode: false,
      smoothingCatchup: true,
      smoothingCatchupAtEnd: true,
      smoothingZoomCompensation: true,
      pressureSmoothing: true,
      usePressureOverridesSize: true,
      usePressureOverridesOpacity: true,
      useLegacy: false,
    },
  };
}

function computedBrush(name: string): Brush {
  return {
    name,
    shape: {
      type: "computed",
      size: 16,
      angle: -25,
      roundness: 0.35,
      hardness: 0.94,
      spacingOn: true,
      spacing: 0.12,
      flipX: false,
      flipY: false,
    },
    spacing: 0.12,
    noise: false,
    wetEdges: false,
    useBrushSize: true,
  };
}

function sample(id = "sample-1", width = 4, height = 2): SampleInfo {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) alpha[y * width + x] = x >= 1 && x <= 2 ? 255 : 0;
  }
  return { id, bounds: { x: 0, y: 0, w: width, h: height }, alpha };
}

describe("Studio ABR envelope and sample conversion", () => {
  it("accepts modern big-endian ABR versions and rejects legacy or oversized payloads", () => {
    for (const version of [6, 7, 9, 10]) {
      assertStudioAbrEnvelope(Uint8Array.of(0, version, 0, 1));
    }
    expect(() => assertStudioAbrEnvelope(Uint8Array.of(0, 2, 0, 1)))
      .toThrowError(StudioAbrImportError);
    expect(() => assertStudioAbrEnvelope(new Uint8Array(STUDIO_ABR_IMPORT_LIMITS.maxBytes + 1)))
      .toThrowError(/32MB/u);
  });

  it("letterboxes rectangular samples and emits a bounded square alpha payload", () => {
    const result = convertStudioAbrSampleToTip(sample());
    expect(result.alphaMapSize).toBe(8);
    const alpha = decodeStudioBrushTipAlphaMapBase64(result.alphaMapBase64)!;
    expect(alpha).toHaveLength(64);
    expect(Math.max(...alpha)).toBe(255);
    expect(alpha.slice(0, 8)).toEqual(new Uint8Array(8));
  });
});

describe("Studio ABR document conversion", () => {
  it("maps sampled tips, dimensions, pressure, opacity, flow, angle and smoothing", () => {
    const result = convertStudioAbrDocument({
      brushes: [sampledBrush("잉크 ABR", "SAMPLE-1")],
      samples: [sample("sample-1")],
      patterns: [],
    });
    expect(result).toMatchObject({
      sourceBrushCount: 1,
      sourceSampleCount: 1,
      skippedBrushCount: 0,
    });
    const candidate = result.brushes[0]!;
    expect(candidate.name).toBe("잉크 ABR");
    expect(candidate.sourceSampleId).toBe("sample-1");
    expect(candidate.snapshot).toMatchObject({
      brushId: "ink-particle",
      strokeWidth: 42,
      brushOpacity: 0.8,
      stabilizer: 4,
      postCorrection: 2,
      tipAngle: 18,
      tipRoundness: 0.62,
    });
    expect(candidate.snapshot.brushDynamics.tip.alphaMapBase64).toBeTruthy();
    expect(candidate.snapshot.brushDynamics.width.mappings[0]).toMatchObject({
      source: "pressure",
      from: 0.2,
      to: 1,
    });
    expect(candidate.snapshot.brushDynamics.opacity.mappings[0]?.source).toBe("pressure");
    expect(candidate.snapshot.brushDynamics.flow.mappings[0]?.source).toBe("pressure");
    expect(candidate.snapshot.brushDynamics.angle.mappings[0]?.source).toBe("tilt-magnitude");
  });

  it("keeps computed brushes with a procedural hard tip and skips missing sampled data", () => {
    const document: Abr = {
      brushes: [computedBrush("하드 원형"), sampledBrush("누락", "absent")],
      samples: [],
      patterns: [],
    };
    const result = convertStudioAbrDocument(document);
    expect(result.brushes).toHaveLength(1);
    expect(result.skippedBrushCount).toBe(1);
    expect(result.brushes[0]?.snapshot.brushDynamics.tip).toMatchObject({
      shape: "hard",
      alphaMapBase64: null,
    });
  });

  it("rejects aggregate sample dimensions before converting brushes", () => {
    const oversized = sample("too-large", STUDIO_ABR_IMPORT_LIMITS.maxSamplePixels + 1, 1);
    const document = { brushes: [sampledBrush("큰 촉", "too-large")], samples: [oversized], patterns: [] };
    expect(() => convertStudioAbrDocument(document)).toThrowError(/안전 처리 한도/u);
  });
});
