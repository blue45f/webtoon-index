import { describe, expect, it } from "vitest";

import {
  createStudioVectorInkGeometry,
  replayStudioVectorInkGeometryArtifact,
  serializeStudioVectorInkGeometryArtifact,
  type StudioVectorInkGeometryArtifact,
  type StudioVectorInkSampleCandidate,
} from "./studio-vector-ink-geometry";

function requireArtifact(
  result: ReturnType<typeof createStudioVectorInkGeometry>,
): StudioVectorInkGeometryArtifact {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.artifact;
}

function createSCurve(sampleCount = 121): readonly StudioVectorInkSampleCandidate[] {
  return Array.from({ length: sampleCount }, (_, index) => Object.freeze({
    x: index * 2,
    y: Math.sin((index / (sampleCount - 1)) * Math.PI * 2) * 32,
    pressure: 0.15 + (index / (sampleCount - 1)) * 0.8,
  }));
}

describe("studio vector ink geometry", () => {
  it("fits a pressure-bearing G-pen S-curve within the admitted quality budget", () => {
    const source = createSCurve();
    const artifact = requireArtifact(createStudioVectorInkGeometry({
      samples: source,
      settings: {
        maxCurveError: 0.8,
        resampleSpacing: 3,
      },
    }));

    expect(artifact.geometryKind).toBe("path");
    expect(artifact.source.samples).toEqual(source);
    expect(artifact.source.samples).not.toBe(source);
    expect(artifact.maxSourceDeviation).toBeLessThanOrEqual(0.8);
    expect(artifact.totalArcLength).toBeGreaterThan(240);
    expect(artifact.segments.length).toBeGreaterThan(0);
    expect(artifact.segments.length).toBeLessThan(source.length - 1);
    expect(artifact.detectedCornerSourceIndices).toEqual([]);

    for (const segment of artifact.segments) {
      expect(segment.arcSamples[0]).toMatchObject({
        distance: 0,
        t: 0,
        x: segment.controls[0].x,
        y: segment.controls[0].y,
      });
      expect(segment.arcSamples.at(-1)).toMatchObject({
        distance: segment.arcLength,
        t: 1,
        x: segment.controls[3].x,
        y: segment.controls[3].y,
      });
      for (let index = 1; index < segment.arcSamples.length; index += 1) {
        expect(segment.arcSamples[index]!.distance).toBeGreaterThan(
          segment.arcSamples[index - 1]!.distance,
        );
        expect(
          segment.arcSamples[index]!.distance - segment.arcSamples[index - 1]!.distance,
        ).toBeLessThanOrEqual(3.000_001);
      }
    }
  });

  it("preserves a detected sharp corner as an exact segment boundary", () => {
    const samples = [
      ...Array.from({ length: 11 }, (_, index) => ({
        x: index,
        y: 0,
        pressure: 0.5,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        x: 10,
        y: index + 1,
        pressure: 0.5,
      })),
    ];
    const artifact = requireArtifact(createStudioVectorInkGeometry({
      samples,
      settings: { maxCurveError: 0.25 },
    }));

    expect(artifact.detectedCornerSourceIndices).toContain(10);
    const incoming = artifact.segments.find(
      ({ controls }) => controls[3].x === 10 && controls[3].y === 0,
    );
    const outgoing = artifact.segments.find(
      ({ controls }) => controls[0].x === 10 && controls[0].y === 0,
    );
    expect(incoming).toBeDefined();
    expect(outgoing).toBeDefined();
    expect(artifact.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      width: 10,
      height: 10,
    });
  });

  it("keeps every repeated canonical sample while deduplicating geometry work points", () => {
    const samples = [
      { x: 0, y: 0, pressure: 0.1 },
      { x: 0, y: 0, pressure: 0.2 },
      { x: 5, y: 0, pressure: 0.3 },
      { x: 5, y: 0, pressure: 0.4 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.6 },
    ] as const;
    const artifact = requireArtifact(createStudioVectorInkGeometry({ samples }));
    const attached = artifact.segments.flatMap(({ pressureSamples }) => pressureSamples);

    expect(artifact.source.samples).toEqual(samples);
    expect(artifact.sourceSampleCount).toBe(6);
    expect(artifact.workingPointCount).toBe(3);
    expect(attached.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(attached.map(({ pressure }) => pressure)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it("handles a repeated-position stroke as an immutable pressure-bearing tap", () => {
    const artifact = requireArtifact(createStudioVectorInkGeometry({
      samples: [
        { x: 4, y: -2, pressure: 0.2 },
        { x: 4, y: -2, pressure: 0.9 },
        { x: 4, y: -2, pressure: 0.5 },
      ],
    }));

    expect(artifact.geometryKind).toBe("tap");
    expect(artifact.segments).toEqual([]);
    expect(artifact.tap).toEqual({
      point: { x: 4, y: -2 },
      pressureRange: { minimum: 0.2, maximum: 0.9 },
    });
    expect(artifact.bounds).toEqual({
      minX: 4,
      minY: -2,
      maxX: 4,
      maxY: -2,
      width: 0,
      height: 0,
    });
    expect(Object.isFrozen(artifact.tap)).toBe(true);
  });

  it("chunks a very long stroke without losing either endpoint", () => {
    const samples = Array.from({ length: 5_000 }, (_, index) => ({
      x: index * 0.75,
      y: Math.sin(index / 40) * 14 + Math.cos(index / 113) * 3,
      pressure: (index % 250) / 249,
    }));
    const artifact = requireArtifact(createStudioVectorInkGeometry(
      {
        samples,
        settings: {
          maxCurveError: 0.9,
          resampleSpacing: 12,
        },
      },
      {
        limits: {
          maxFitSpanPoints: 128,
        },
      },
    ));

    expect(artifact.sourceSampleCount).toBe(5_000);
    expect(artifact.segments[0]!.controls[0]).toEqual({ x: 0, y: 3 });
    expect(artifact.segments.at(-1)!.controls[3]).toEqual({
      x: samples.at(-1)!.x,
      y: samples.at(-1)!.y,
    });
    expect(artifact.maxSourceDeviation).toBeLessThanOrEqual(0.9);
    expect(artifact.segments.length).toBeGreaterThan(39);
  });

  it("attaches source-ordered monotonic pressure without dropping canonical samples", () => {
    const samples = createSCurve(80);
    const artifact = requireArtifact(createStudioVectorInkGeometry({ samples }));
    const pressure = artifact.segments.flatMap(({ pressureSamples }) => pressureSamples);

    expect(pressure).toHaveLength(samples.length);
    expect(pressure.map(({ sourceIndex }) => sourceIndex)).toEqual(
      samples.map((_, index) => index),
    );
    for (let index = 1; index < pressure.length; index += 1) {
      expect(pressure[index]!.pressure).toBeGreaterThanOrEqual(pressure[index - 1]!.pressure);
    }
    for (const segment of artifact.segments) {
      for (let index = 1; index < segment.pressureSamples.length; index += 1) {
        expect(segment.pressureSamples[index]!.t).toBeGreaterThanOrEqual(
          segment.pressureSamples[index - 1]!.t,
        );
      }
    }
  });

  it("does not mutate input and freezes every persisted geometry layer", () => {
    const samples = createSCurve(24);
    const before = JSON.stringify(samples);
    const artifact = requireArtifact(createStudioVectorInkGeometry({ samples }));

    expect(JSON.stringify(samples)).toBe(before);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.source)).toBe(true);
    expect(Object.isFrozen(artifact.source.samples)).toBe(true);
    expect(Object.isFrozen(artifact.source.samples[0])).toBe(true);
    expect(Object.isFrozen(artifact.segments)).toBe(true);
    expect(Object.isFrozen(artifact.segments[0])).toBe(true);
    expect(Object.isFrozen(artifact.segments[0]!.controls)).toBe(true);
    expect(Object.isFrozen(artifact.segments[0]!.controls[0])).toBe(true);
    expect(Object.isFrozen(artifact.segments[0]!.pressureSamples)).toBe(true);
    expect(Object.isFrozen(artifact.segments[0]!.arcSamples)).toBe(true);
  });

  it("serializes and replays byte-identically without persisting vendor instances", () => {
    const request = {
      samples: createSCurve(48),
      settings: {
        maxCurveError: 0.65,
        cornerAngleRadians: Math.PI / 2,
        resampleSpacing: 2.5,
      },
    } as const;
    const first = requireArtifact(createStudioVectorInkGeometry(request));
    const second = requireArtifact(createStudioVectorInkGeometry(request));
    const serialized = serializeStudioVectorInkGeometryArtifact(first);
    const replayed = replayStudioVectorInkGeometryArtifact(serialized);

    expect(first.contentHash).toBe(second.contentHash);
    expect(serializeStudioVectorInkGeometryArtifact(second)).toBe(serialized);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error(replayed.detail);
    expect(serializeStudioVectorInkGeometryArtifact(replayed.artifact)).toBe(serialized);
    expect(serialized).not.toContain("_lut");
    expect(serialized).not.toContain("dpoints");
    expect(first.provider.vendorTypesPersisted).toBe(false);

    const tampered = serialized.replace('"pressure":0.15', '"pressure":0.16');
    expect(replayStudioVectorInkGeometryArtifact(tampered)).toMatchObject({
      ok: false,
      reason: "replay-mismatch",
    });
  });

  it("uses bezier metrics for an exact line length, bounds and uniform arc samples", () => {
    const artifact = requireArtifact(createStudioVectorInkGeometry({
      samples: [
        { x: -2, y: 3, pressure: 0.25 },
        { x: 8, y: 3, pressure: 0.75 },
      ],
      settings: { resampleSpacing: 2 },
    }));
    const [segment] = artifact.segments;

    expect(segment!.fittingMode).toBe("owned-linear-exact");
    expect(segment!.arcLength).toBeCloseTo(10, 10);
    expect(segment!.bounds).toEqual({
      minX: -2,
      minY: 3,
      maxX: 8,
      maxY: 3,
      width: 10,
      height: 0,
    });
    expect(segment!.arcSamples).toHaveLength(6);
    segment!.arcSamples.forEach(({ x }, index) => {
      expect(x).toBeCloseTo(-2 + index * 2, 5);
    });
    expect(segment!.maxSourceDeviation).toBeLessThan(1e-9);
  });

  it("fails closed for cancellation, numeric violations and bounded execution", () => {
    const controller = new AbortController();
    controller.abort();
    expect(createStudioVectorInkGeometry(
      { samples: createSCurve(12) },
      { signal: controller.signal },
    )).toMatchObject({
      ok: false,
      reason: "cancelled",
    });

    expect(createStudioVectorInkGeometry({
      samples: [{ x: Number.NaN, y: 0, pressure: 0.5 }],
    })).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(createStudioVectorInkGeometry({
      samples: [{ x: 0, y: 0, pressure: 1.1 }],
    })).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(createStudioVectorInkGeometry(
      { samples: createSCurve(20) },
      { limits: { maxInputSamples: 10 } },
    )).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
    expect(createStudioVectorInkGeometry(
      { samples: createSCurve(20) },
      { limits: { maxWorkUnits: 5 } },
    )).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
  });
});
