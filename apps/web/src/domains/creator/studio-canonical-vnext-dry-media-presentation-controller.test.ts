
import { describe, expect, it, vi } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import {
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_LOWERING_VERSION,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION,
  type StudioEngineWebGpuTexturedBrushDab,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import { adaptStudioDrawElementToCanonicalBrushPlan } from "./studio-canonical-brush-draw-adapter";
import { hashStudioCanonicalBrushPlan } from "./studio-canonical-brush-plan";
import {
  StudioCanonicalVNextDryMediaPresentationController,
  validateStudioCanonicalVNextDryMediaCompiledFrame,
  type StudioCanonicalVNextDryMediaCompiledFrame,
  type StudioCanonicalVNextDryMediaPresentationSurfaceBoundary,
  type StudioCanonicalVNextDryMediaTexturedRuntimeBoundary,
} from "./studio-canonical-vnext-dry-media-presentation-controller";
import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

import type {
  StudioEngineWebGpuPresentationFrameLease,
  StudioEngineWebGpuPresentationReceipt,
  StudioEngineWebGpuPresentationSurfaceStats,
} from "./render/studio-engine-webgpu-presentation-surface";
import type {
  StudioEngineWebGpuTexturedBrushFrame,
  StudioEngineWebGpuTexturedBrushReceipt,
} from "./render/studio-engine-webgpu-textured-brush-runtime";
import type { DrawEl } from "./studio-element-model";

function element(): DrawEl {
  return {
    id: "dry-media-vnext-visible-stroke",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [2, 3, 7, 5, 13, 9],
    pressures: [0.2, 0.6, 0.9],
    speeds: [0, 5.4, 7.2],
    stroke: "#334155",
    strokeWidth: 14,
    // Product pointer-start stamps the bounded-flow-v2 seam with causal sampleSpacing on every
    // retained-dynamics pen stroke; the vNext specialist admits only its unit-opacity form.
    opacity: 1,
    paintModel: "bounded-flow-v2",
    sampleSpacing: 1,
    brush: "dry-media",
    brushCatalogId: "dry-media",
    brushDynamics: normalizeStudioBrushDynamicsSettings({
      seed: 91,
      fallbackPressure: 0.45,
      spacingRatio: 0.16,
      scatterRatio: 0,
      taper: { enabled: false },
      tip: { shape: "bristle", softness: 0.15, alphaMapSize: 16 },
      tipLayers: [],
      colorDynamics: {
        backgroundColor: "#ffffff",
        foregroundBackgroundMix: 0,
        foregroundBackgroundJitter: 0,
        hueJitter: 0,
        saturationJitter: 0,
        valueJitter: 0,
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.5,
        scale: 8,
        contrast: 0.65,
        seed: 73,
      },
      width: {
        base: 14,
        min: 0.05,
        max: 4_096,
        mappings: [{
          source: "pressure",
          mode: "multiply",
          from: 0.3,
          to: 1,
          amount: 1,
        }],
        jitter: null,
      },
      opacity: {
        base: 0.9,
        min: 0,
        max: 1,
        mappings: [{
          source: "pressure",
          mode: "multiply",
          from: 0.35,
          to: 1,
          amount: 1,
        }],
        jitter: null,
      },
      flow: { base: 0.75, min: 0, max: 1, mappings: [], jitter: null },
      spacing: { base: 2.24, min: 0.25, max: 4_096, mappings: [], jitter: null },
      scatter: { base: 0, min: 0, max: 4_096, mappings: [], jitter: null },
      angle: { base: -18, min: -180, max: 180, mappings: [], jitter: null },
      roundness: { base: 0.55, min: 0.08, max: 1, mappings: [], jitter: null },
    }),
  };
}

function compiledFrame(): StudioCanonicalVNextDryMediaCompiledFrame {
  const adapted = adaptStudioDrawElementToCanonicalBrushPlan({
    element: element(),
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    firstSampleSequence: 1,
    firstTimeMilliseconds: 0,
    fallbackSampleIntervalMilliseconds: 4,
    colorSpace: "linear-srgb",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
  });
  if (adapted.status !== "ready") {
    throw new Error(`${adapted.reason}:${adapted.path}`);
  }
  const tipPayload = adapted.assets[0];
  if (!tipPayload) throw new Error("expected embedded textured tip");
  const asset = {
    assetIndex: 0,
    role: "tip" as const,
    assetId: tipPayload.assetId,
    contentHash: tipPayload.contentHash,
    width: tipPayload.width,
    height: tipPayload.height,
    channel: tipPayload.channel,
    format: tipPayload.format,
    byteLength: tipPayload.byteLength,
    bytes: new Uint8Array(tipPayload.bytes),
  };
  const composite = Object.freeze({
    porterDuff: "source-over" as const,
    blendMode: "normal" as const,
  });
  const pressures = [0.2, 0.6, 0.9] as const;
  const diameters = [8, 12, 15] as const;
  const alphas = [0.18, 0.5, 0.8] as const;
  const stations = [[2, 3], [7, 5], [13, 9]] as const;
  const dabs = pressures.map((pressure, index) => {
    const previous = stations[Math.max(0, index - 1)]!;
    const next = stations[Math.min(stations.length - 1, index + 1)]!;
    const angleRadians = Math.atan2(next[1] - previous[1], next[0] - previous[0]);
    const majorRadius = diameters[index]! / 2;
    const minorRadius = majorRadius / 2;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    return {
      index,
      stationX: stations[index]![0],
      stationY: stations[index]![1],
      x: stations[index]![0],
      y: stations[index]![1],
      pressure,
      diameter: diameters[index]!,
      opacity: alphas[index]!,
      flow: 1,
      grainDepth: 0.5,
      color: {
        space: "linear-srgb" as const,
        alphaMode: "straight" as const,
        components: [0.04, 0.07, 0.11, alphas[index]!] as const,
      },
      composite,
      tip: {
        hardness: 0.82,
        roundness: 0.5,
        angleRadians,
        localToDocument: [
          cosine * majorRadius,
          sine * majorRadius,
          -sine * minorRadius,
          cosine * minorRadius,
        ] as const,
      },
    };
  });
  const withoutFingerprint: StudioEngineWebGpuTexturedBrushPlan = {
    kind: "studio-engine-webgpu-textured-brush-plan",
    version: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION,
    loweringVersion: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_LOWERING_VERSION,
    mode: "rebuild",
    strokeId: adapted.plan.strokeId,
    commandSequence: adapted.plan.commandSequence,
    dualTip: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY,
    textureFormat: "rgba16float",
    colorModel: "scene-linear-premultiplied",
    tip: {
      assetIndex: 0,
      channel: asset.channel,
      filtering: "bilinear",
      edgeMode: "transparent-zero-border",
      hardnessTransfer: "zero-to-one-smoothstep",
    },
    grain: {
      kind: "procedural-integer-noise",
      assetIndex: null,
      space: "stroke",
      scale: 8,
      depth: 0.5,
      contrast: 0.65,
      invert: false,
      seed: adapted.plan.seed,
      originX: 2,
      originY: 3,
      filtering: "integer-cell",
      edgeMode: "infinite",
    },
    grainSamplingSemantics: "specialist-texture-v1",
    assets: [asset],
    dabs,
    batches: [{
      key: `${asset.contentHash}|noise|source-over`,
      tipAssetIndex: 0,
      grainAssetIndex: null,
      porterDuff: "source-over",
      firstInstance: 0,
      instanceCount: dabs.length,
    }],
  };
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(
      withoutFingerprint,
    );
  if (!semanticFingerprint) throw new Error("missing textured fingerprint");
  const texturedPlan = Object.freeze({
    ...withoutFingerprint,
    semanticFingerprint,
  });
  return Object.freeze({
    kind: "studio-canonical-vnext-dry-media-compiled-frame",
    version: 1,
    catalogId: "dry-media",
    canonicalPlan: adapted.plan,
    canonicalPlanHash: hashStudioCanonicalBrushPlan(adapted.plan),
    texturedPlan,
  });
}

function withTexturedDabs(
  frame: StudioCanonicalVNextDryMediaCompiledFrame,
  dabs: readonly StudioEngineWebGpuTexturedBrushDab[],
): StudioCanonicalVNextDryMediaCompiledFrame {
  const withoutFingerprint: StudioEngineWebGpuTexturedBrushPlan = {
    ...frame.texturedPlan,
    dabs,
    batches: [{
      ...frame.texturedPlan.batches[0]!,
      firstInstance: 0,
      instanceCount: dabs.length,
    }],
    semanticFingerprint: undefined,
  };
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(withoutFingerprint);
  if (!semanticFingerprint) throw new Error("missing replacement fingerprint");
  return Object.freeze({
    ...frame,
    texturedPlan: Object.freeze({
      ...withoutFingerprint,
      semanticFingerprint,
    }),
  });
}

function qualityDabs(
  count: number,
  path: (index: number) => readonly [number, number],
): readonly StudioEngineWebGpuTexturedBrushDab[] {
  const points = Array.from({ length: count }, (_, index) => path(index));
  return Object.freeze(points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const angleRadians = Math.atan2(next[1] - previous[1], next[0] - previous[0]);
    const pressure = 0.16 + index / Math.max(1, count - 1) * 0.78;
    const diameter = 7 + pressure * 9;
    const alpha = 0.12 + pressure * 0.62;
    const majorRadius = diameter / 2;
    const minorRadius = majorRadius * 0.42;
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    return Object.freeze({
      index,
      stationX: point[0],
      stationY: point[1],
      x: point[0],
      y: point[1],
      pressure,
      diameter,
      opacity: alpha,
      flow: 1,
      grainDepth: 0.5,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [0.04, 0.07, 0.11, alpha] as const,
      },
      composite: {
        porterDuff: "source-over",
        blendMode: "normal",
      },
      tip: {
        hardness: 0.82,
        roundness: 0.42,
        angleRadians,
        localToDocument: [
          cosine * majorRadius,
          sine * majorRadius,
          -sine * minorRadius,
          cosine * minorRadius,
        ] as const,
      },
    } satisfies StudioEngineWebGpuTexturedBrushDab);
  }));
}

function stats(): StudioEngineWebGpuPresentationSurfaceStats {
  return {
    status: "ready",
    configured: true,
    deviceEpoch: 1,
    presentationEpoch: 2,
    resizeEpoch: 3,
    viewportEpoch: 4,
    flipEpoch: 5,
    workSurfaceEpoch: 6,
    lastAcceptedRequestSequence: 0,
    lastPresentedRequestSequence: 0,
    frameActive: false,
    producerWriteInFlight: false,
    presentationInFlight: false,
    contentInitialized: false,
    contentGeneration: 0,
    contentFingerprint: null,
    surfaceTextureAllocations: 1,
    presentations: 0,
  };
}

function lease(requestSequence: number): StudioEngineWebGpuPresentationFrameLease {
  return {
    kind: "studio-engine-webgpu-presentation-frame-lease",
    revision: 2,
    requestSequence,
    deviceEpoch: 1,
    presentationEpoch: 2,
    resizeEpoch: 3,
    viewportEpoch: 4,
    flipEpoch: 5,
    sourceFrameFingerprint: "",
    workSurface: {
      kind: "studio-engine-webgpu-shared-linear-work-surface",
      revision: 2,
      texture: {} as GPUTexture,
      view: {} as GPUTextureView,
      format: "rgba16float",
      usage: 31,
      colorModel: "scene-linear-premultiplied",
      workingColorSpace: "linear-srgb",
      width: 512,
      height: 512,
      byteLength: 512 * 512 * 8,
      workSurfaceEpoch: 6,
    },
    configuration: {
      presentationEpoch: 2,
      resizeEpoch: 3,
      viewportEpoch: 4,
      flipEpoch: 5,
      cssWidth: 512,
      cssHeight: 512,
      dpr: 1,
      physicalWidth: 512,
      physicalHeight: 512,
      surfacePixels: 512 * 512,
      surfaceBytes: 512 * 512 * 8,
      viewport: {
        logicalWidth: 512,
        logicalHeight: 512,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        flipX: false,
        flipY: false,
      },
      documentToSurface: {
        m11: 1,
        m12: 0,
        m21: 0,
        m22: 1,
        dx: 0,
        dy: 0,
      },
    },
    contentAtAcquire: {
      initialized: false,
      generation: 0,
      fingerprint: null,
    },
  };
}

function runtimeReceipt(
  request: StudioEngineWebGpuTexturedBrushFrame,
): StudioEngineWebGpuTexturedBrushReceipt {
  return {
    kind: "studio-engine-webgpu-textured-brush-receipt",
    revision: 1,
    backend: "webgpu",
    textureFormat: "rgba16float",
    colorModel: "scene-linear-premultiplied",
    requestSequence: request.requestSequence,
    deviceEpoch: request.deviceEpoch,
    mode: request.plan.mode,
    strokeId: request.plan.strokeId,
    commandSequence: request.plan.commandSequence,
    dabCount: request.plan.dabs.length,
    batchCount: request.plan.batches.length,
    assetCount: request.plan.assets.length,
    assetBytes: request.plan.assets.reduce((sum, asset) => sum + asset.byteLength, 0),
    batchKeys: request.plan.batches.map(({ key }) => key),
    planSemanticFingerprint: request.plan.semanticFingerprint ?? null,
    grainSamplingSemantics: "specialist-texture-v1",
    nativeR8GrainSourceKey: null,
    nativeR8GrainTextureBytes: 0,
    renderTarget: "presentation",
    sourceFrameFingerprint: request.plan.semanticFingerprint!,
    workSurfaceEpoch: 6,
    baseContentGeneration: 0,
    baseContentFingerprint: null,
    contentGeneration: request.requestSequence,
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    queueState: "completed",
    complete: true,
  };
}

function presentationReceipt(
  requestSequence: number,
  sourceFrameFingerprint: string,
): StudioEngineWebGpuPresentationReceipt {
  return {
    kind: "studio-engine-webgpu-presentation-receipt",
    revision: 2,
    backend: "webgpu",
    requestSequence,
    sourceFrameFingerprint,
    deviceEpoch: 1,
    presentationEpoch: 2,
    resizeEpoch: 3,
    viewportEpoch: 4,
    flipEpoch: 5,
    workSurfaceEpoch: 6,
    mode: "rebuild",
    baseContentGeneration: 0,
    baseContentFingerprint: null,
    contentGeneration: requestSequence,
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    width: 512,
    height: 512,
    textureFormat: "rgba16float",
    canvasFormat: "bgra8unorm",
    colorModel: "scene-linear-premultiplied",
    workingColorSpace: "linear-srgb",
    presentationColorSpace: "srgb",
    alphaMode: "premultiplied",
    queueState: "completed",
    presentationState: "presented",
    visible: true,
    complete: true,
  };
}

function boundaries() {
  let currentStats = stats();
  const frames = new Map<number, StudioEngineWebGpuPresentationFrameLease>();
  const abortFrame = vi.fn(() => ({ status: "aborted" as const }));
  const surface: StudioCanonicalVNextDryMediaPresentationSurfaceBoundary = {
    stats: () => currentStats,
    beginFrame(request) {
      const frame = {
        ...lease(request.requestSequence),
        sourceFrameFingerprint: request.sourceFrameFingerprint,
      };
      frames.set(request.requestSequence, frame);
      currentStats = {
        ...currentStats,
        lastAcceptedRequestSequence: request.requestSequence,
      };
      return { status: "ready", frame };
    },
    abortFrame,
    async presentFrame(frame) {
      const receipt = presentationReceipt(
        frame.requestSequence,
        frame.sourceFrameFingerprint,
      );
      currentStats = {
        ...currentStats,
        lastPresentedRequestSequence: frame.requestSequence,
        contentInitialized: true,
        contentGeneration: frame.requestSequence,
      };
      return { status: "presented", receipt };
    },
    authorizesVisibility: () => true,
  };
  const executions: StudioEngineWebGpuTexturedBrushFrame[] = [];
  const runtime: StudioCanonicalVNextDryMediaTexturedRuntimeBoundary = {
    async execute(request) {
      executions.push(request);
      return { status: "completed", receipt: runtimeReceipt(request) };
    },
  };
  return { surface, runtime, executions, abortFrame, frames };
}

describe("canonical vNext dry-media presentation controller", () => {
  it("stays unmounted until a product host can atomically gate fallback visibility", () => {
    const page = readStudioPageCompositionSource();
    const viewport = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
    expect(page).not.toContain("StudioCanonicalVNextDryMediaPresentationController");
    expect(viewport).not.toContain("StudioCanonicalVNextDryMediaPresentationController");
  });

  it("admits only visibly textured, directional, pressure-responsive continuous material", () => {
    const frame = compiledFrame();
    expect(validateStudioCanonicalVNextDryMediaCompiledFrame(frame)).toEqual({
      status: "ready",
      fingerprint: frame.texturedPlan.semanticFingerprint,
    });
    const uniformBytes = new Uint8Array(
      frame.texturedPlan.assets[0]!.bytes.length,
    ).fill(255);
    const uniformPlan = {
      ...frame.texturedPlan,
      assets: [{
        ...frame.texturedPlan.assets[0]!,
        bytes: uniformBytes,
      }],
    };
    const uniformFingerprint =
      fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(uniformPlan);
    expect(uniformFingerprint).not.toBeNull();
    expect(validateStudioCanonicalVNextDryMediaCompiledFrame({
      ...frame,
      texturedPlan: {
        ...uniformPlan,
        semanticFingerprint: uniformFingerprint!,
      },
    })).toEqual({
      status: "rejected",
      reason: "nonuniform-tip-required",
    });
  });

  it("quality-gates long curves and short flicks without round joints or missing endpoints", () => {
    const base = compiledFrame();
    const longCurve = withTexturedDabs(
      base,
      qualityDabs(320, (index) => [
        index * 2.1,
        Math.sin(index / 26) * 14 + Math.sin(index / 71) * 5,
      ]),
    );
    const slowCurve = withTexturedDabs(
      base,
      qualityDabs(180, (index) => [
        index * 0.42,
        Math.sin(index / 33) * 4,
      ]),
    );
    const shortFlick = withTexturedDabs(
      base,
      qualityDabs(2, (index) => [index * 2.8, index * -0.9]),
    );

    for (const frame of [longCurve, slowCurve, shortFlick]) {
      expect(validateStudioCanonicalVNextDryMediaCompiledFrame(frame)).toEqual({
        status: "ready",
        fingerprint: frame.texturedPlan.semanticFingerprint,
      });
      expect(frame.texturedPlan.dabs.every((dab) => {
        const [xx, xy, yx, yy] = dab.tip.localToDocument;
        const axes = [Math.hypot(xx, xy), Math.hypot(yx, yy)];
        return Math.max(...axes) / Math.min(...axes) > 2;
      })).toBe(true);
      let accumulatedAlpha = 0;
      for (const dab of frame.texturedPlan.dabs) {
        const nextAlpha =
          dab.color.components[3] + accumulatedAlpha * (1 - dab.color.components[3]);
        expect(nextAlpha + Number.EPSILON).toBeGreaterThanOrEqual(accumulatedAlpha);
        accumulatedAlpha = nextAlpha;
      }
    }
  });

  it("rejects destructive overlap, tangent drift and uncovered flick endpoints", () => {
    const base = compiledFrame();
    const destructive = withTexturedDabs(
      base,
      base.texturedPlan.dabs.map((dab, index) => index === 1
        ? {
            ...dab,
            composite: {
              porterDuff: "destination-out" as const,
              blendMode: "normal" as const,
            },
          }
        : dab),
    );
    expect(validateStudioCanonicalVNextDryMediaCompiledFrame(destructive)).toEqual({
      status: "rejected",
      reason: "source-over-required",
    });

    const tangentDrift = withTexturedDabs(
      base,
      base.texturedPlan.dabs.map((dab) => {
        const basis = dab.tip.localToDocument;
        return {
          ...dab,
          tip: {
            ...dab.tip,
            localToDocument: [
              -basis[1],
              basis[0],
              -basis[3],
              basis[2],
            ] as const,
          },
        };
      }),
    );
    expect(validateStudioCanonicalVNextDryMediaCompiledFrame(tangentDrift)).toEqual({
      status: "rejected",
      reason: "tangent-alignment-required",
    });

    const uncoveredEndpoint = withTexturedDabs(
      base,
      base.texturedPlan.dabs.map((dab, index) => index === 0
        ? { ...dab, x: dab.x + 100, y: dab.y + 100 }
        : dab),
    );
    expect(validateStudioCanonicalVNextDryMediaCompiledFrame(uncoveredEndpoint)).toEqual({
      status: "rejected",
      reason: "endpoint-coverage-required",
    });
  });

  it("presents final-live and commit from the exact same canonical and textured plan objects", async () => {
    const frame = compiledFrame();
    const { surface, runtime, executions, abortFrame } = boundaries();
    const controller = new StudioCanonicalVNextDryMediaPresentationController({
      surface,
      runtime,
    });
    const result = await controller.presentFinalLiveAndCommit(frame);

    expect(result.status).toBe("completed");
    expect(executions).toHaveLength(2);
    expect(executions[0]!.plan).toBe(frame.texturedPlan);
    expect(executions[1]!.plan).toBe(frame.texturedPlan);
    expect(executions.map(({ requestSequence }) => requestSequence)).toEqual([1, 2]);
    expect(abortFrame).not.toHaveBeenCalled();
    if (result.status !== "completed") return;
    expect(result.receipt).toMatchObject({
      sameCanonicalPlan: true,
      sameCanonicalPlanHash: true,
      samePersistedSeed: true,
      sameTexturedPlan: true,
      sameTexturedPlanFingerprint: true,
      sameOutputLineage: true,
      samePresentationConfiguration: true,
      specialistSurfaceVisible: true,
      retainedCanvasAuthority: "recoverable-last-good",
      persistentAuthority: "draw-el-vector",
      rasterPromotion: "not-promoted",
    });
    expect(result.receipt.live.canonicalPlan).toBe(frame.canonicalPlan);
    expect(result.receipt.commit.canonicalPlan).toBe(frame.canonicalPlan);
    expect(result.receipt.live.texturedPlan).toBe(frame.texturedPlan);
    expect(result.receipt.commit.texturedPlan).toBe(frame.texturedPlan);
    expect(result.receipt.live.texturedPlanFingerprint).toBe(
      result.receipt.commit.texturedPlanFingerprint,
    );
    expect(result.receipt.live.runtime.contentFingerprint).toBe(
      result.receipt.commit.runtime.contentFingerprint,
    );
    expect(result.receipt.live.presentation.contentFingerprint).toBe(
      result.receipt.commit.presentation.contentFingerprint,
    );
  });

  it("retains Canvas when final-live and commit output lineage diverges", async () => {
    const frame = compiledFrame();
    const {
      surface,
      runtime: baseRuntime,
    } = boundaries();
    let executionCount = 0;
    const runtime: StudioCanonicalVNextDryMediaTexturedRuntimeBoundary = {
      async execute(request, signal) {
        const result = await baseRuntime.execute(request, signal);
        executionCount += 1;
        if (result.status !== "completed" || executionCount !== 2) return result;
        return {
          status: "completed",
          receipt: {
            ...result.receipt,
            contentFingerprint: `sha256:${"f".repeat(64)}`,
          },
        };
      },
    };
    const controller = new StudioCanonicalVNextDryMediaPresentationController({
      surface,
      runtime,
    });

    await expect(controller.presentFinalLiveAndCommit(frame)).resolves.toEqual({
      status: "unavailable",
      reason: "presentation-not-authorized",
      detail: "final-parity",
    });
  });

  it("retains Canvas when the presentation configuration drifts before commit", async () => {
    const frame = compiledFrame();
    const {
      surface: baseSurface,
      runtime,
    } = boundaries();
    let presentationCount = 0;
    const surface: StudioCanonicalVNextDryMediaPresentationSurfaceBoundary = {
      ...baseSurface,
      async presentFrame(frameLease, producerReceipt) {
        const result = await baseSurface.presentFrame(
          frameLease,
          producerReceipt,
        );
        presentationCount += 1;
        if (result.status !== "presented" || presentationCount !== 2) return result;
        return {
          status: "presented",
          receipt: {
            ...result.receipt,
            viewportEpoch: result.receipt.viewportEpoch + 1,
          },
        };
      },
    };
    const controller = new StudioCanonicalVNextDryMediaPresentationController({
      surface,
      runtime,
    });

    await expect(controller.presentFinalLiveAndCommit(frame)).resolves.toEqual({
      status: "unavailable",
      reason: "presentation-not-authorized",
      detail: "final-parity",
    });
  });

  it("aborts the frame and retains Canvas when the specialist runtime rejects", async () => {
    const frame = compiledFrame();
    const { surface, abortFrame } = boundaries();
    const runtime: StudioCanonicalVNextDryMediaTexturedRuntimeBoundary = {
      async execute() {
        return { status: "rejected", reason: "presentation-lease-required" };
      },
    };
    const controller = new StudioCanonicalVNextDryMediaPresentationController({
      surface,
      runtime,
    });
    await expect(controller.presentPointerPreview(frame)).resolves.toEqual({
      status: "unavailable",
      reason: "runtime-rejected",
      detail: "presentation-lease-required",
    });
    expect(abortFrame).toHaveBeenCalledTimes(1);
  });

  it("aborts a still-owned lease when presentation rejects after rendering", async () => {
    const frame = compiledFrame();
    const {
      surface,
      runtime,
      abortFrame,
    } = boundaries();
    const rejectingSurface: StudioCanonicalVNextDryMediaPresentationSurfaceBoundary = {
      ...surface,
      async presentFrame() {
        return { status: "rejected", reason: "invalid-frame" };
      },
    };
    const controller = new StudioCanonicalVNextDryMediaPresentationController({
      surface: rejectingSurface,
      runtime,
    });

    await expect(controller.presentPointerPreview(frame)).resolves.toEqual({
      status: "unavailable",
      reason: "presentation-rejected",
      detail: "invalid-frame",
    });
    expect(abortFrame).toHaveBeenCalledTimes(1);
  });
});
