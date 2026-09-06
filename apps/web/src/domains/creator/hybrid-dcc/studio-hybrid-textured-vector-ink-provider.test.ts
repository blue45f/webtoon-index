import { describe, expect, it } from "vitest";

import {
  createStudioVectorInkGeometry,
  type StudioVectorInkGeometryArtifact,
  type StudioVectorInkSampleCandidate,
} from "../studio-vector-ink-geometry";

import {
  createStudioHybridTexturedVectorInkProvider,
  StudioHybridTexturedVectorInkProviderError,
  type StudioHybridTexturedVectorInkR8AssetInput,
} from "./studio-hybrid-textured-vector-ink-provider";

function geometry(
  samples: readonly StudioVectorInkSampleCandidate[] = Array.from(
    { length: 21 },
    (_, index) => ({
      x: index,
      y: 0,
      pressure: index / 20,
    }),
  ),
): StudioVectorInkGeometryArtifact {
  const result = createStudioVectorInkGeometry({
    samples,
    settings: {
      maxCurveError: 0.1,
      resampleSpacing: 1,
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.artifact;
}

function tip(
  pixels: ArrayBufferView | readonly number[] = Uint8Array.of(
    0, 64,
    128, 255,
  ),
): StudioHybridTexturedVectorInkR8AssetInput {
  return { width: 2, height: 2, pixels };
}

function paper(
  pixels: ArrayBufferView | readonly number[] = Uint8Array.of(
    0, 32, 64, 96,
    128, 160, 192, 255,
  ),
): StudioHybridTexturedVectorInkR8AssetInput {
  return { width: 4, height: 2, pixels };
}

function baseRequest(
  artifact: StudioVectorInkGeometryArtifact = geometry(),
) {
  return {
    geometry: artifact,
    tip: tip(),
    paperTexture: paper(),
    epoch: 0,
    style: {
      baseWidthDocument: 10,
      minimumWidthRatio: 0.2,
      widthPressureExponent: 1,
      minimumOpacity: 0.1,
      maximumOpacity: 0.9,
      opacityPressureExponent: 1,
      referencePixelsPerDocumentUnit: 1,
      stationSpacingReferencePixels: 2,
      maxStationGapCurrent: 2,
      positionJitterDocument: 0.25,
      rotationJitterRadians: 0.2,
      paperPixelsPerDocumentUnit: 1,
      paperPhaseDocument: [3, 5] as const,
      seed: 12345,
    },
    lineage: { mode: "rebuild" as const },
  };
}

describe("Studio hybrid textured-vector ink provider", () => {
  it("copies R8 assets and emits immutable renderer-neutral station, outline, and texture plans", async () => {
    const tipPixels = Uint8Array.of(0, 64, 128, 255);
    const paperPixels = Uint8Array.of(0, 32, 64, 96, 128, 160, 192, 255);
    const provider = createStudioHybridTexturedVectorInkProvider();
    const request = {
      ...baseRequest(),
      tip: tip(tipPixels),
      paperTexture: paper(paperPixels),
    };

    const pending = provider.plan(request);
    tipPixels.fill(7);
    paperPixels.fill(9);
    const plan = await pending;

    expect(plan).toMatchObject({
      kind: "studio-hybrid-textured-vector-ink-plan",
      revision: 1,
      providerId: "hybrid-textured-vector-ink",
      epoch: 0,
      sequence: 1,
      rendererBoundary: {
        rendererNeutral: true,
        opaqueHandles: false,
        centerlineAuthority: "studio-vector-ink-geometry",
        appearanceRegeneration: "deterministic-from-centerline-v1",
      },
      outlinePlan: {
        encoding: "paired-station-edges-v1",
        closed: false,
      },
      texturePlan: {
        tip: "seeded-station-stamp-r8-v1",
        paper: "document-space-repeat-r8-v1",
      },
    });
    expect(plan.assets.tip).toMatchObject({
      kind: "studio-r8-asset",
      role: "tip",
      encoding: "r8-unorm",
      width: 2,
      height: 2,
      byteLength: 4,
      pixels: [0, 64, 128, 255],
    });
    expect(plan.assets.paperTexture.pixels).toEqual([
      0, 32, 64, 96, 128, 160, 192, 255,
    ]);
    expect(plan.assets.tip.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(plan.assets.paperTexture.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(plan.stations.length).toBeGreaterThan(2);
    expect(plan.outlinePlan.stationCount).toBe(plan.stations.length);
    expect(plan.stations[0]?.paperMapping).toMatchObject({
      anchoring: "document-space",
      phaseDocument: [3, 5],
      pixel: [3, 1],
      uv: [0.75, 0.5],
    });
    expect(plan.stations[0]?.tipMapping.assetHash).toBe(plan.assets.tip.hash);
    expect(plan.stations[0]?.tipMapping.basisCurrent).toEqual({
      uHalfExtent: expect.any(Array),
      vHalfExtent: expect.any(Array),
    });
    expect(plan.stations[0]?.outline.leftCurrent).not.toEqual(
      plan.stations[0]?.outline.rightCurrent,
    );
    for (let index = 1; index < plan.stations.length; index += 1) {
      expect(plan.stations[index]!.arcDistanceCurrent).toBeGreaterThan(
        plan.stations[index - 1]!.arcDistanceCurrent,
      );
    }
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.stations)).toBe(true);
    expect(Object.isFrozen(plan.assets.tip.pixels)).toBe(true);
    expect(structuredClone(plan)).toEqual(plan);
    expect(JSON.stringify(plan)).not.toMatch(
      /Canvas|Konva|rendererHandle|vendorHandle/u,
    );
  });

  it("maps pressure monotonically into bounded width and opacity", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const plan = await provider.plan(baseRequest());
    const first = plan.stations[0]!;
    const final = plan.stations.at(-1)!;

    expect(first.pressure).toBeCloseTo(0);
    expect(first.widthDocument).toBeCloseTo(2);
    expect(first.opacity).toBeCloseTo(0.1);
    expect(final.pressure).toBeCloseTo(1);
    expect(final.widthDocument).toBeCloseTo(10);
    expect(final.opacity).toBeCloseTo(0.9);
    for (let index = 1; index < plan.stations.length; index += 1) {
      expect(plan.stations[index]!.widthDocument).toBeGreaterThanOrEqual(
        plan.stations[index - 1]!.widthDocument,
      );
      expect(plan.stations[index]!.opacity).toBeGreaterThanOrEqual(
        plan.stations[index - 1]!.opacity,
      );
    }
  });

  it("regenerates seeded appearance deterministically while keeping the centerline separate", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const request = baseRequest();
    const first = await provider.plan(request);
    const second = await provider.plan(request);
    const zoomed = await provider.plan({
      ...request,
      documentToCurrent: [4, 0, 0, 4, 0, 0],
    });
    const differentSeed = await provider.plan({
      ...request,
      style: { ...request.style, seed: 54321 },
    });

    expect(second.sequence).toBe(2);
    expect(second.centerline).toEqual(first.centerline);
    expect(second.stations).toEqual(first.stations);
    expect(second.fingerprints.appearance).toBe(
      first.fingerprints.appearance,
    );
    expect(second.fingerprints.rebuild).toBe(first.fingerprints.rebuild);
    const referenceStation = first.stations[1]!;
    const matchingZoomStation = zoomed.stations.reduce((best, station) =>
      Math.abs(
        station.arcDistanceDocument - referenceStation.arcDistanceDocument,
      ) < Math.abs(
        best.arcDistanceDocument - referenceStation.arcDistanceDocument,
      )
        ? station
        : best
    );
    expect(matchingZoomStation.arcDistanceDocument).toBeCloseTo(
      referenceStation.arcDistanceDocument,
      8,
    );
    expect(matchingZoomStation.seededAppearance.jitterDocument[0]).toBeCloseTo(
      referenceStation.seededAppearance.jitterDocument[0],
      8,
    );
    expect(matchingZoomStation.seededAppearance.jitterDocument[1]).toBeCloseTo(
      referenceStation.seededAppearance.jitterDocument[1],
      8,
    );
    expect(
      matchingZoomStation.seededAppearance.rotationCurrentRadians,
    ).toBeCloseTo(
      referenceStation.seededAppearance.rotationCurrentRadians,
      8,
    );
    expect(differentSeed.centerline).toEqual(first.centerline);
    expect(differentSeed.stations.map(
      ({ seededAppearance }) => seededAppearance,
    )).not.toEqual(first.stations.map(
      ({ seededAppearance }) => seededAppearance,
    ));
    expect(differentSeed.fingerprints.appearance).not.toBe(
      first.fingerprints.appearance,
    );
  });

  it("snapshots editable cubic controls before deferred appearance generation", async () => {
    const mutableGeometry = structuredClone(geometry());
    const originalStart = {
      ...mutableGeometry.segments[0]!.controls[0],
    };
    const provider = createStudioHybridTexturedVectorInkProvider();
    const pending = provider.plan(baseRequest(mutableGeometry));
    (
      mutableGeometry.segments[0]!.controls[0] as {
        x: number;
        y: number;
      }
    ).x = 999;
    const plan = await pending;

    expect(plan.centerline.segments[0]?.controls[0]).toEqual([
      originalStart.x,
      originalStart.y,
    ]);
    expect(plan.centerline.segments[0]?.controls[0]).not.toEqual([999, 0]);
  });

  it("resamples appearance after affine scaling without rewriting document-space cubic controls", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const request = {
      ...baseRequest(),
      style: {
        ...baseRequest().style,
        positionJitterDocument: 0,
        rotationJitterRadians: 0,
      },
    };
    const identity = await provider.plan(request);
    const scaled = await provider.plan({
      ...request,
      documentToCurrent: [4, 0, 0, 4, 100, -50],
    });

    expect(scaled.centerline).toEqual(identity.centerline);
    expect(scaled.stations.length).toBeGreaterThan(identity.stations.length);
    expect(scaled.quality.currentTransform).toMatchObject({
      determinant: 16,
      singularScaleMinimum: 4,
      singularScaleMaximum: 4,
      effectiveScale: 4,
      nominalStationSpacingCurrent: 8,
      targetStationSpacingCurrent: 2,
      maximumAllowedStationGapCurrent: 2,
      resampleQuality: "target-met",
    });
    expect(
      scaled.quality.currentTransform.actualMaximumStationGapCurrent,
    ).toBeLessThanOrEqual(2.000_01);
    expect(scaled.stations[0]?.centerlineDocument).toEqual(
      identity.stations[0]?.centerlineDocument,
    );
    expect(scaled.stations[0]?.centerlineCurrent).toEqual([100, -50]);
    expect(scaled.stations[0]?.paperMapping.pixel).toEqual(
      identity.stations[0]?.paperMapping.pixel,
    );
    expect(scaled.fingerprints.appearance).not.toBe(
      identity.fingerprints.appearance,
    );
  });

  it("uses the full affine normal transform for outline width", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const plan = await provider.plan({
      ...baseRequest(),
      documentToCurrent: [2, 0, 0, 3, 0, 0],
      style: {
        ...baseRequest().style,
        positionJitterDocument: 0,
        rotationJitterRadians: 0,
      },
    });
    const final = plan.stations.at(-1)!;

    expect(final.widthDocument).toBeCloseTo(10);
    expect(final.widthCurrent).toBeCloseTo(30);
    expect(final.outline.leftCurrent[1]).toBeCloseTo(15);
    expect(final.outline.rightCurrent[1]).toBeCloseTo(-15);
  });

  it("keeps curved/sheared station chords inside the declared current-space quality target", async () => {
    const curved = geometry(Array.from({ length: 101 }, (_, index) => ({
      x: index * 0.5,
      y: Math.sin(index / 100 * Math.PI * 2) * 12,
      pressure: 0.3 + index / 100 * 0.6,
    })));
    const provider = createStudioHybridTexturedVectorInkProvider();
    const plan = await provider.plan({
      ...baseRequest(curved),
      documentToCurrent: [1.5, 0.3, 0.4, 2, 5, -7],
      style: {
        ...baseRequest().style,
        maxStationGapCurrent: 1.25,
        positionJitterDocument: 0,
      },
    });

    expect(plan.stations.length).toBeGreaterThan(curved.segments.length);
    expect(plan.quality.currentTransform).toMatchObject({
      maximumAllowedStationGapCurrent: 1.25,
      qualityMetric: "current-space-centerline-chord-gap-v1",
      arcLengthApproximation:
        "artifact-arc-table-cubic-subdivision-v1",
      resampleQuality: "target-met",
    });
    expect(
      plan.quality.currentTransform.actualMaximumStationGapCurrent,
    ).toBeLessThanOrEqual(1.250_01);
    for (let index = 1; index < plan.stations.length; index += 1) {
      expect(
        plan.stations[index]!.arcDistanceCurrent
          - plan.stations[index - 1]!.arcDistanceCurrent,
      ).toBeLessThanOrEqual(
        plan.quality.currentTransform.targetStationSpacingCurrent + 1e-8,
      );
    }
  });

  it("produces rebuild, append-chain, and verified replay fingerprints", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const request = baseRequest();
    const rebuilt = await provider.plan(request);
    const replayed = await provider.plan({
      ...request,
      lineage: {
        mode: "replay",
        expectedReplayFingerprint: rebuilt.fingerprints.replay,
      },
    });
    const appended = await provider.plan({
      ...request,
      lineage: {
        mode: "append",
        previousFingerprint: rebuilt.fingerprints.active,
      },
    });
    const appendedAgain = await provider.plan({
      ...request,
      lineage: {
        mode: "append",
        previousFingerprint: rebuilt.fingerprints.active,
      },
    });

    expect(replayed.fingerprints).toMatchObject({
      mode: "replay",
      active: rebuilt.fingerprints.replay,
      appearance: rebuilt.fingerprints.appearance,
    });
    expect(appended.fingerprints).toMatchObject({
      mode: "append",
      previous: rebuilt.fingerprints.active,
    });
    expect(appended.fingerprints.active).toBe(
      appendedAgain.fingerprints.active,
    );
    await expect(provider.plan({
      ...request,
      lineage: {
        mode: "replay",
        expectedReplayFingerprint:
          `sha256:${"0".repeat(64)}`,
      },
    })).rejects.toMatchObject({ code: "replay-mismatch" });
  });

  it("emits a single deterministic textured station for a pressure-bearing tap", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    const tapGeometry = geometry([
      { x: 4, y: -2, pressure: 0.2 },
      { x: 4, y: -2, pressure: 0.8 },
    ]);
    const plan = await provider.plan(baseRequest(tapGeometry));

    expect(plan.centerline).toMatchObject({
      geometryKind: "tap",
      tap: {
        point: [4, -2],
        pressureRange: [0.2, 0.8],
      },
      segments: [],
    });
    expect(plan.stations).toHaveLength(1);
    expect(plan.stations[0]).toMatchObject({
      segmentIndex: null,
      centerlineDocument: [4, -2],
      pressure: 0.5,
    });
    expect(plan.quality.currentTransform).toMatchObject({
      stationCount: 1,
      actualMaximumStationGapCurrent: 0,
    });
  });

  it("enforces epochs, cancellation, backpressure, and terminal destroy", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider({
      epoch: 3,
    });
    const request = { ...baseRequest(), epoch: 3 };
    await expect(provider.plan({
      ...request,
      epoch: 2,
    })).rejects.toMatchObject({ code: "epoch-mismatch" });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.plan({
      ...request,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });

    const first = provider.plan(request);
    await expect(provider.plan(request)).rejects.toMatchObject({
      code: "backpressure",
    });
    await expect(first).resolves.toMatchObject({ sequence: 1 });
    await Promise.all([provider.destroy(), provider.destroy()]);
    expect(provider.snapshot()).toMatchObject({
      state: "destroyed",
      epoch: 3,
      sequence: 1,
      activeOperations: 0,
    });
    await expect(provider.plan(request)).rejects.toBeInstanceOf(
      StudioHybridTexturedVectorInkProviderError,
    );
  });

  it("fails closed on malformed assets, geometry, transforms, and excessive station work", async () => {
    const provider = createStudioHybridTexturedVectorInkProvider();
    await expect(provider.plan({
      ...baseRequest(),
      tip: {
        ...tip(),
        expectedHash: `sha256:${"0".repeat(64)}`,
      },
    })).rejects.toMatchObject({ code: "invalid-asset" });
    await expect(provider.plan({
      ...baseRequest(),
      paperTexture: {
        width: 4,
        height: 2,
        pixels: [1, 2],
      },
    })).rejects.toMatchObject({ code: "invalid-asset" });
    await expect(provider.plan({
      ...baseRequest(),
      geometry: {
        ...geometry(),
        contentHash: "fnv1a32:not-real",
      } as StudioVectorInkGeometryArtifact,
    })).rejects.toMatchObject({ code: "invalid-geometry-artifact" });
    await expect(provider.plan({
      ...baseRequest(),
      documentToCurrent: [1, 0, 2, 0, 0, 0],
    })).rejects.toMatchObject({ code: "invalid-request" });

    const veryLongLine = geometry([
      { x: 0, y: 0, pressure: 0.5 },
      { x: 4_000, y: 0, pressure: 0.5 },
    ]);
    await expect(provider.plan({
      ...baseRequest(veryLongLine),
      style: {
        ...baseRequest().style,
        stationSpacingReferencePixels: 0.05,
        maxStationGapCurrent: 0.05,
      },
    })).rejects.toMatchObject({ code: "budget-exceeded" });
  });

  it("reports source, reference, current, and bounded-work quality explicitly", async () => {
    const artifact = geometry();
    const provider = createStudioHybridTexturedVectorInkProvider();
    const plan = await provider.plan(baseRequest(artifact));

    expect(plan.quality.sourceResolution).toEqual({
      geometryResampleSpacingDocument: artifact.settings.resampleSpacing,
      geometryMaxSourceDeviationDocument: artifact.maxSourceDeviation,
      sourceArcSampleCount: artifact.segments.reduce(
        (sum, segment) => sum + segment.arcSamples.length,
        0,
      ),
      sourcePressureSampleCount: artifact.segments.reduce(
        (sum, segment) => sum + segment.pressureSamples.length,
        0,
      ),
      sourceSampleCount: artifact.sourceSampleCount,
      estimatedSourceBytes:
        artifact.sourceSampleCount * 24
        + artifact.segments.reduce(
          (sum, segment) => sum + segment.arcSamples.length,
          0,
        ) * 16
        + artifact.segments.reduce(
          (sum, segment) => sum + segment.pressureSamples.length,
          0,
        ) * 16
        + artifact.segments.length * 256,
    });
    expect(plan.quality.referenceResolution).toMatchObject({
      pixelsPerDocumentUnit: 1,
      stationSpacingReferencePixels: 2,
      stationSpacingDocument: 2,
      nominalWidthReferencePixels: 10,
      tipResolution: [2, 2],
      paperResolution: [4, 2],
    });
    expect(plan.quality.limitations).toEqual([
      "source-geometry-deviation-carried-forward",
      "current-space-chord-gap-not-raster-coverage",
      "append-lineage-uses-full-deterministic-replan",
      "paired-outline-defers-cap-and-join-tessellation",
    ]);
    expect(plan.budgets).toMatchObject({
      assetBytes: 12,
      sourceArcSamples:
        plan.quality.sourceResolution.sourceArcSampleCount,
      sourcePressureSamples:
        plan.quality.sourceResolution.sourcePressureSampleCount,
      sourceBytesEstimate:
        plan.quality.sourceResolution.estimatedSourceBytes,
      denseSamples: plan.quality.currentTransform.denseSampleCount,
      stations: plan.stations.length,
    });
    expect(plan.budgets.workUnits).toBeGreaterThan(0);
    expect(plan.budgets.estimatedOutputBytes).toBeGreaterThan(12);
  });
});
