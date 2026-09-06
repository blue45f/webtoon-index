import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioSoftFalloffLinearAccumulationProgramPin,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
} from "./brush/studio-brush-dynamics";
import {
  resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt,
} from "./brush/studio-brush-material-dynamics";
import { STUDIO_BRUSH_PACK_CATALOG_IDS } from "./brush/studio-brush-pack-id";
import { materializeStudioBrushPackDynamics } from "./brush/studio-brush-pack-runtime";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
  studioBrushR8GrainRegistryStats,
} from "./brush/studio-brush-r8-grain-runtime";
import {
  clearStudioBrushSoftFalloffStampCache,
  linearizeStudioBrushSoftFalloffCoverageAlpha,
  studioBrushSoftFalloffStampCacheStats,
  STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  type StudioBrushSoftFalloffStampTone,
} from "./brush/studio-brush-soft-falloff-stamp";
import {
  clearStudioBrushTextureStampCache,
  studioBrushTextureStampCacheStats,
} from "./brush/studio-brush-textured-stamp";
import { encodeStudioBrushTipAlphaMapBase64 } from "./brush/studio-brush-tip-stamp";
import {
  resolveStudioDynamicBrushMaterialIdentity,
} from "./brush/studio-dry-media-dynamic-bridge";
import {
  clearStudioDynamicCoverageCommittedCache,
  disposeStudioDynamicCoverageCommittedCache,
  planStudioDynamicBrushCoverageAndLegacyMarks,
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverage,
  renderStudioDynamicBrushCoverageMark,
  renderStudioDynamicBrushLegacyMarks,
  resolveStudioDynamicCoverageCommittedCacheByteBudget,
  studioDynamicCoverageCommittedCacheStats,
  STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET,
  STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_BYTE_BUDGET,
  STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_MOBILE_BYTE_BUDGET,
  STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
  type StudioCoverageSurface,
  type StudioCoverageSurfaceContext,
  type StudioDynamicBrushCoverageMark,
} from "./studio-dynamic-brush-coverage-renderer";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioDynamicBrushDab } from "./brush/studio-brush-dynamics";

interface RecordedGradient {
  readonly args: readonly number[];
  readonly stops: Array<Readonly<{ offset: number; color: string }>>;
}

function recordingGradient(
  args: readonly number[],
  gradients: RecordedGradient[],
): CanvasGradient {
  const record: RecordedGradient = { args, stops: [] };
  gradients.push(record);
  return {
    addColorStop(offset: number, color: string) {
      record.stops.push({ offset, color });
    },
  } as CanvasGradient;
}

class RecordingSurfaceContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  readonly gradients: RecordedGradient[] = [];
  readonly imageDraws: Array<readonly unknown[]> = [];
  imagePixels = new Uint8ClampedArray();
  rectFills = 0;
  readonly fills: Array<{
    alpha: number;
    color: string;
    ellipse: readonly number[];
  }> = [];
  private ellipseValue: readonly number[] = [];

  setTransform(): void {}
  clearRect(): void {}
  createImageData(width: number, height: number): ImageData {
    return {
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }
  putImageData(imageData: ImageData): void {
    this.imagePixels = new Uint8ClampedArray(imageData.data);
  }
  drawImage(...args: readonly unknown[]): void {
    this.imageDraws.push(args);
  }
  fillRect(): void {
    this.rectFills += 1;
  }
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {
    this.ellipseValue = [];
  }
  createRadialGradient(...args: readonly number[]): CanvasGradient {
    return recordingGradient(args, this.gradients);
  }
  arc(
    x: number,
    y: number,
    radius: number,
  ): void {
    this.ellipseValue = [x, y, radius, radius, 0];
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
  ): void {
    this.ellipseValue = [x, y, radiusX, radiusY, rotation];
  }
  fill(): void {
    this.fills.push({
      alpha: this.globalAlpha,
      color: String(this.fillStyle),
      ellipse: this.ellipseValue,
    });
  }
}

class RecordingSurface {
  readonly context = new RecordingSurfaceContext();

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(): StudioCoverageSurfaceContext {
    return this.context as unknown as StudioCoverageSurfaceContext;
  }
}

class CountingCoverageSurfaceContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  fillCount = 0;

  setTransform(): void {}
  clearRect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  arc(): void {}
  ellipse(): void {}
  fill(): void {
    this.fillCount += 1;
  }
}

class CountingCoverageSurface {
  readonly context = new CountingCoverageSurfaceContext();

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(): StudioCoverageSurfaceContext {
    return this.context as unknown as StudioCoverageSurfaceContext;
  }
}

class RecordingDestination {
  globalAlpha = 0.8;
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly draws: Array<{ alpha: number; args: readonly number[] }> = [];
  readonly legacyFills: Array<{ alpha: number; color: string }> = [];
  readonly polygonPaths: Array<readonly { x: number; y: number }[]> = [];
  readonly gradients: RecordedGradient[] = [];
  private alphaStack: number[] = [];
  private activePolygon: Array<{ x: number; y: number }> | null = null;
  _context = {
    getTransform: () => ({
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 0,
      f: 0,
    }) as DOMMatrix,
  };

  save(): void {
    this.alphaStack.push(this.globalAlpha);
  }
  restore(): void {
    this.globalAlpha = this.alphaStack.pop() ?? this.globalAlpha;
  }
  drawImage(
    _surface: CanvasImageSource,
    ...args: [number, number, number, number, number, number, number, number]
  ): void {
    this.draws.push({ alpha: this.globalAlpha, args });
  }
  beginPath(): void {
    this.activePolygon = null;
  }
  moveTo(x: number, y: number): void {
    if (this.activePolygon?.length) {
      this.polygonPaths.push(this.activePolygon);
    }
    this.activePolygon = [{ x, y }];
  }
  lineTo(x: number, y: number): void {
    this.activePolygon?.push({ x, y });
  }
  closePath(): void {
    if (this.activePolygon?.length) {
      this.polygonPaths.push(this.activePolygon);
      this.activePolygon = null;
    }
  }
  arc(): void {}
  ellipse(): void {}
  createRadialGradient(...args: readonly number[]): CanvasGradient {
    return recordingGradient(args, this.gradients);
  }
  fill(): void {
    this.legacyFills.push({ alpha: this.globalAlpha, color: String(this.fillStyle) });
  }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
}

function sourceOverAlpha(destination: number, source: number): number {
  return source + destination * (1 - source);
}

class AlphaOracleSurfaceContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  alpha = 0;

  setTransform(): void {}
  clearRect(): void {
    this.alpha = 0;
  }
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  arc(): void {}
  ellipse(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  createRadialGradient(): CanvasGradient {
    return { addColorStop: () => undefined } as CanvasGradient;
  }
  fill(): void {
    this.alpha = sourceOverAlpha(this.alpha, this.globalAlpha);
  }
}

class AlphaOracleSurface {
  readonly context = new AlphaOracleSurfaceContext();

  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(): StudioCoverageSurfaceContext {
    return this.context as unknown as StudioCoverageSurfaceContext;
  }
}

class AlphaOracleDestination {
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  alpha = 0;
  private readonly alphaStack: number[] = [];
  _context = {
    getTransform: () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }) as DOMMatrix,
  };

  save(): void {
    this.alphaStack.push(this.globalAlpha);
  }
  restore(): void {
    this.globalAlpha = this.alphaStack.pop() ?? this.globalAlpha;
  }
  drawImage(
    surface: CanvasImageSource,
    ..._args: [number, number, number, number, number, number, number, number]
  ): void {
    const sourceAlpha = (
      surface as unknown as AlphaOracleSurface
    ).context.alpha * this.globalAlpha;
    this.alpha = sourceOverAlpha(this.alpha, sourceAlpha);
  }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  arc(): void {}
  ellipse(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  createRadialGradient(): CanvasGradient {
    return { addColorStop: () => undefined } as CanvasGradient;
  }
  fill(): void {
    this.alpha = sourceOverAlpha(this.alpha, this.globalAlpha);
  }
}

function surfaceFactory(surfaces: RecordingSurface[]) {
  return (width: number, height: number): StudioCoverageSurface => {
    const surface = new RecordingSurface(width, height);
    surfaces.push(surface);
    return surface as unknown as StudioCoverageSurface;
  };
}

function mark(overrides: Partial<StudioDynamicBrushCoverageMark> = {}) {
  return {
    x: 10,
    y: 20,
    radiusX: 8,
    radiusY: 4,
    angleRadians: 0.25,
    alpha: 0.5,
    color: "#336699",
    ...overrides,
  } satisfies StudioDynamicBrushCoverageMark;
}

function dab(overrides: Partial<StudioDynamicBrushDab> = {}): StudioDynamicBrushDab {
  return {
    index: 0,
    progress: 0,
    sourceX: 10,
    sourceY: 20,
    x: 10,
    y: 20,
    size: 16,
    opacity: 0.5,
    flow: 0.4,
    spacing: 4,
    scatter: 0,
    angle: 0,
    roundness: 1,
    ...overrides,
  };
}

function r8GrainSource(
  bytes: Uint8Array,
  width: number,
  height: number,
) {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: "paper.coverage-checker.v1",
      encodedSha256: `sha256:${"e".repeat(64)}`,
      decodedSha256: `sha256:${sha256HexPortable(bytes)}`,
      byteLength: 137,
      mediaType: "image/png",
      width,
      height,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

describe("studio dynamic brush bounded coverage renderer", () => {
  it("keeps airbrush-grand-soft as one analytic elliptical mark across committed and legacy rendering", () => {
    const dynamics = materializeStudioBrushPackDynamics("airbrush-grand-soft");
    if (!dynamics) throw new Error("missing airbrush-grand-soft dynamics");
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 48, roundness: 0.55, angle: 32 })]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 1,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected analytic soft-tip mark");
    expect(plan.marks).toHaveLength(1);
    expect(plan.marks[0]).toMatchObject({
      radiusX: 24,
      angleRadians: 32 * Math.PI / 180,
      falloff: {
        kind: "analytic-radial",
        exponent: 1.4 + dynamics.tip.softness * 2.2,
      },
    });
    expect(plan.marks[0]!.radiusY).toBeCloseTo(13.2, 12);

    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    const committedDestination = new RecordingDestination();
    const committed = renderStudioDynamicBrushCoverage(
      committedDestination,
      plan.marks,
      {
        activeDraft: false,
        opacity: 0.6,
        surfaceFactory: factory,
      },
    );
    expect(committed).toMatchObject({ status: "rendered" });
    // Two world tiles, one immutable radial mask and one reusable exact-colour tint scratch.
    expect(surfaces).toHaveLength(4);
    const tileSurfaces = surfaces.filter(({ context }) =>
      context.imageDraws.length > 0 && context.rectFills === 0
    );
    const maskSurfaces = surfaces.filter(({ context }) =>
      context.imagePixels.length > 0
    );
    const tintedSurfaces = surfaces.filter(({ context }) =>
      context.rectFills > 0
    );
    expect(tileSurfaces).toHaveLength(2);
    expect(tileSurfaces.every(({ context }) =>
      context.gradients.length === 0 && context.imageDraws.length === 1
    )).toBe(true);
    expect(maskSurfaces).toHaveLength(1);
    expect(tintedSurfaces).toHaveLength(1);
    expect(committedDestination.draws).toHaveLength(2);

    const legacy = new RecordingDestination();
    renderStudioDynamicBrushLegacyMarks(legacy, plan.marks, 0.6, factory);
    expect(legacy.legacyFills).toHaveLength(0);
    expect(legacy.gradients).toHaveLength(0);
    expect(legacy.draws).toHaveLength(1);
    expect(legacy.draws[0]!.alpha).toBeCloseTo(
      0.8 * 0.6 * plan.marks[0]!.alpha,
      12,
    );
    expect(studioBrushSoftFalloffStampCacheStats()).toMatchObject({
      entries: 1,
      tintedEntries: 1,
      scratchSurfaces: 0,
      surfaceAllocations: 2,
      hits: 0,
      tintedHits: 2,
    });
  });

  it.each([
    {
      name: "custom alpha",
      settings: {
        tip: {
          shape: "soft" as const,
          softness: 0.82,
          alphaMapSize: 8,
          alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(
            new Uint8Array(8 * 8).fill(255),
          ),
        },
        grain: { amount: 0 },
      },
    },
    {
      name: "dual tip",
      settings: {
        tip: { shape: "soft" as const, softness: 0.82 },
        grain: { amount: 0 },
        dualBrush: {
          enabled: true,
          tip: { shape: "hard" as const, softness: 0.1 },
          blendMode: "multiply" as const,
          sizeRatio: 0.8,
        },
      },
    },
  ])("preserves the sampled stamp path for $name", ({ settings }) => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...settings,
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 48 })]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 1_000,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected sampled marks");
    expect(plan.marks.length).toBeGreaterThan(1);
    expect(plan.marks.every((candidate) => candidate.falloff === undefined)).toBe(true);
  });

  it("preserves a sparse centre-transparent custom tip as one full causal texture command", () => {
    const alphaBytes = new Uint8Array(8 * 8);
    alphaBytes[0] = 255;
    alphaBytes[7] = 191;
    alphaBytes[56] = 128;
    alphaBytes[63] = 64;
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: {
        shape: "hard",
        softness: 0,
        alphaMapSize: 8,
        alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
      },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 48, roundness: 0.6, angle: 35 })]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 3,
      markBudget: 1,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected full texture mark");
    expect(plan.marks).toHaveLength(1);
    const plannedMark = plan.marks[0]!;
    expect(plannedMark).toMatchObject({
      radiusX: 24,
      angleRadians: 35 * Math.PI / 180,
      texture: { kind: "alpha-map" },
    });
    expect(plannedMark.radiusY).toBeCloseTo(14.4, 12);
    expect(plannedMark.falloff).toBeUndefined();
    const alphaMap = plannedMark.texture!.alphaMap;
    expect(alphaMap.alphas[0]).toBe(1);
    expect(alphaMap.alphas[3 * 8 + 3]).toBe(0);
    expect(alphaMap.alphas[4 * 8 + 4]).toBe(0);

    clearStudioBrushTextureStampCache();
    const surfaces: RecordingSurface[] = [];
    const destination = new RecordingDestination();
    renderStudioDynamicBrushCoverageMark(
      destination,
      plannedMark,
      1,
      surfaceFactory(surfaces),
    );
    expect(destination.draws).toHaveLength(1);
    expect(destination.draws[0]!.args.slice(0, 5)).toEqual([0, 0, 8, 8, -24]);
    expect(destination.draws[0]!.args[5]).toBeCloseTo(-14.4, 12);
    expect(destination.draws[0]!.args[6]).toBe(48);
    expect(destination.draws[0]!.args[7]).toBeCloseTo(28.8, 12);
    // One immutable alpha mask plus one reusable exact-colour tint scratch.
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]!.context.imagePixels[3]).toBe(255);
    expect(surfaces[0]!.context.imagePixels[(3 * 8 + 3) * 4 + 3]).toBe(0);
  });

  it("keeps causal live-prefix and retained replay texture primitives identical", () => {
    const dynamics = materializeStudioBrushPackDynamics("pencil-4b-rough");
    if (!dynamics) throw new Error("missing pencil-4b-rough dynamics");
    const dabs = [
      dab({ index: 0, x: 10, y: 20, sourceX: 10, sourceY: 20, size: 18 }),
      dab({ index: 1, x: 22, y: 25, sourceX: 22, sourceY: 25, size: 20 }),
    ];
    const plan = (plannedDabs: readonly StudioDynamicBrushDab[]) =>
      planStudioDynamicBrushCoverageMarks({
        dabVariations: [plannedDabs],
        strokeOrigins: [{ x: 10, y: 20 }],
        dynamics,
        dynamicSeed: 77,
        stroke: "#335577",
        stampGrid: 3,
        markBudget: 8,
      });
    const livePrefix = plan(dabs.slice(0, 1));
    const retained = plan(dabs);

    expect(livePrefix.ok).toBe(true);
    expect(retained.ok).toBe(true);
    if (!livePrefix.ok || !retained.ok) throw new Error("expected causal texture plans");
    expect(livePrefix.marks).toHaveLength(1);
    expect(retained.marks).toHaveLength(2);
    expect(retained.marks[0]).toEqual(livePrefix.marks[0]);
    expect(retained.marks.every(({ texture }) => texture?.kind === "alpha-map")).toBe(true);
  });

  it("plans all 160 causal pack tips with bounded commands and real alpha-map shape diversity", () => {
    const primitiveKinds = new Set<string>();
    const alphaMapRevisions = new Set<string>();
    const rasterShapeFingerprints = new Set<string>();

    for (const catalogId of STUDIO_BRUSH_PACK_CATALOG_IDS) {
      const dynamics = materializeStudioBrushPackDynamics(catalogId);
      if (!dynamics) throw new Error(`missing ${catalogId} dynamics`);
      const plan = planStudioDynamicBrushCoverageMarks({
        dabVariations: [[dab({ size: 32, angle: 23, roundness: 0.72 })]],
        dynamics,
        dynamicSeed: 91,
        stroke: "#335577",
        stampGrid: 3,
        markBudget: 3,
      });
      expect(plan.ok, catalogId).toBe(true);
      if (!plan.ok) continue;
      const expectedCommands = 1
        + dynamics.tipLayers.filter((layer) => layer.opacity > 0).length;
      expect(plan.marks, catalogId).toHaveLength(expectedCommands);
      for (const plannedMark of plan.marks) {
        if (plannedMark.texture) {
          primitiveKinds.add("texture");
          const map = plannedMark.texture.alphaMap;
          alphaMapRevisions.add(String(map.revision));
          let occupied = 0;
          let edgeEnergy = 0;
          let alphaSum = 0;
          for (let y = 0; y < map.size; y += 1) {
            for (let x = 0; x < map.size; x += 1) {
              const alpha = map.alphas[y * map.size + x] ?? 0;
              if (alpha > 0.02) occupied += 1;
              alphaSum += alpha;
              if (x === 0 || y === 0 || x === map.size - 1 || y === map.size - 1) {
                edgeEnergy += alpha;
              }
            }
          }
          rasterShapeFingerprints.add([
            map.size,
            occupied,
            alphaSum.toFixed(3),
            edgeEnergy.toFixed(3),
            (map.alphas[Math.floor(map.alphas.length / 2)] ?? 0).toFixed(3),
          ].join(":"));
        } else if (plannedMark.falloff) {
          primitiveKinds.add("analytic-radial");
        } else {
          primitiveKinds.add("solid-ellipse");
        }
      }
    }

    expect(primitiveKinds).toEqual(new Set([
      "texture",
      "analytic-radial",
      "solid-ellipse",
    ]));
    expect(alphaMapRevisions.size).toBeGreaterThan(30);
    expect(rasterShapeFingerprints.size).toBeGreaterThan(20);
  });

  it("keeps a grained soft medium continuous with footprint-integrated world grain", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "soft", softness: 0.82 },
      grain: {
        amount: 0.55,
        scale: 5.5,
        contrast: 0.4,
        seed: 303,
        space: "canvas-fixed",
      },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[
        dab({ index: 0, x: 10, y: 20, sourceX: 10, sourceY: 20, size: 48 }),
        dab({ index: 1, x: 27, y: 33, sourceX: 27, sourceY: 33, size: 48 }),
      ]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 2,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected analytic grained soft-tip marks");
    expect(plan.marks).toHaveLength(2);
    expect(plan.marks.every((candidate) =>
      candidate.falloff?.kind === "analytic-radial"
    )).toBe(true);
    expect(plan.marks[0]!.alpha).not.toBe(plan.marks[1]!.alpha);
    expect(plan.marks[0]!.alpha).toBeCloseTo(
      0.5 * 0.4 * resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
        10,
        20,
        24,
        24,
        0,
        10,
        20,
        42,
        dynamics.grain,
      ),
      12,
    );
  });

  it("rejects a valid R8 reference explicitly until its decoded bytes are verified", () => {
    resetStudioBrushR8GrainRegistry();
    const bytes = new Uint8Array([
      0, 64, 128, 255,
      255, 128, 64, 0,
      32, 96, 160, 224,
      224, 160, 96, 32,
    ]);
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "hard", softness: 0, alphaMapSize: 8 },
      grain: {
        amount: 0.8,
        scale: 24,
        contrast: 0.55,
        seed: 17,
        space: "canvas-fixed",
        source: r8GrainSource(bytes, 4, 4),
      },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 24 })]],
      dynamics,
      dynamicSeed: 71,
      stroke: "#335577",
      stampGrid: 7,
      markBudget: 8,
    });

    expect(plan).toEqual({ ok: false, reason: "r8-grain-unavailable" });
    expect(studioBrushR8GrainRegistryStats()).toMatchObject({
      entries: 0,
      misses: 1,
    });
  });

  it("gives Canvas and SVG consumers one deterministic verified R8 tip×paper mark plan", () => {
    resetStudioBrushR8GrainRegistry();
    const bytes = new Uint8Array([
      0, 64, 128, 255,
      255, 128, 64, 0,
      32, 96, 160, 224,
      224, 160, 96, 32,
    ]);
    const source = r8GrainSource(bytes, 4, 4);
    expect(hydrateStudioBrushR8GrainAsset(source, bytes)).toMatchObject({
      status: "ready",
      receipt: {
        assetId: "paper.coverage-checker.v1",
        decodedByteLength: 16,
      },
    });
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "hard", softness: 0, alphaMapSize: 8 },
      grain: {
        amount: 0.8,
        scale: 24,
        contrast: 0.55,
        seed: 17,
        space: "canvas-fixed",
        source,
      },
      taper: { enabled: false },
    });
    const input = {
      dabVariations: [[dab({
        x: 18,
        y: 27,
        sourceX: 18,
        sourceY: 27,
        size: 24,
        roundness: 0.7,
        angle: 23,
      })]],
      strokeOrigins: [{ x: 18, y: 27 }],
      dynamics,
      dynamicSeed: 71,
      stroke: "#335577",
      stampGrid: 7 as const,
      markBudget: 8,
    };
    const canvasPlan = planStudioDynamicBrushCoverageMarks(input);
    const svgPlan = planStudioDynamicBrushCoverageMarks({
      ...input,
      dabVariations: input.dabVariations.map((variation) => (
        variation.map((candidate) => ({ ...candidate }))
      )),
    });

    expect(canvasPlan.ok).toBe(true);
    expect(svgPlan.ok).toBe(true);
    if (!canvasPlan.ok || !svgPlan.ok) throw new Error("expected verified R8 plans");
    expect(canvasPlan.marks).toHaveLength(1);
    expect(svgPlan.marks).toHaveLength(1);
    const canvasMap = canvasPlan.marks[0]!.texture?.alphaMap;
    const svgMap = svgPlan.marks[0]!.texture?.alphaMap;
    expect(canvasMap?.revision).toMatch(/^r8-tip-paper-v1:sha256:[0-9a-f]{64}$/u);
    expect(svgMap?.revision).toBe(canvasMap?.revision);
    expect([...svgMap!.alphas]).toEqual([...canvasMap!.alphas]);
    expect(new Set([...canvasMap!.alphas].map((alpha) => alpha.toFixed(5))).size)
      .toBeGreaterThan(4);
    expect(canvasPlan.r8TextureAlphaMapReceipt).toEqual({
      policy: "r8-texture-alpha-map-bytes-v1",
      uniqueAlphaMapCount: 1,
      alphaMapBytes: canvasMap!.alphas.byteLength,
      alphaMapByteBudget: STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
    });
    expect(svgPlan.r8TextureAlphaMapReceipt).toEqual(
      canvasPlan.r8TextureAlphaMapReceipt,
    );
    expect(canvasPlan.marks[0]!.alpha).toBeCloseTo(0.5 * 0.4, 12);
    expect(svgPlan.marks[0]).toEqual(canvasPlan.marks[0]);
  });

  it("rejects R8 retained-map memory before allocating a catastrophic v3-sized plan", () => {
    resetStudioBrushR8GrainRegistry();
    const bytes = new Uint8Array([
      0, 64, 128, 255,
      255, 128, 64, 0,
      32, 96, 160, 224,
      224, 160, 96, 32,
    ]);
    const source = r8GrainSource(bytes, 4, 4);
    expect(hydrateStudioBrushR8GrainAsset(source, bytes).status).toBe("ready");
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "hard", softness: 0, alphaMapSize: 256 },
      grain: {
        amount: 0.8,
        scale: 24,
        contrast: 0.55,
        seed: 17,
        space: "canvas-fixed",
        source,
      },
      taper: { enabled: false },
    });
    const bytesPerDab = 256 * 256 * Float32Array.BYTES_PER_ELEMENT;
    const firstRejectedDabCount = Math.floor(
      STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET / bytesPerDab,
    ) + 1;
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [Array.from(
        { length: firstRejectedDabCount },
        (_, index) => dab({
          index,
          x: 10 + index,
          sourceX: 10 + index,
          progress: index / Math.max(1, firstRejectedDabCount - 1),
        }),
      )],
      dynamics,
      dynamicSeed: 71,
      stroke: "#335577",
      stampGrid: 3,
      markBudget: firstRejectedDabCount,
    });

    expect(firstRejectedDabCount).toBe(65);
    expect(plan).toEqual({ ok: false, reason: "r8-grain-memory-budget" });
  });

  it("keeps a causal screen-dual wet wash as one full composed alpha-map command", () => {
    const dynamics = materializeStudioBrushPackDynamics("watercolor-wet-wash");
    if (!dynamics) throw new Error("missing watercolor-wet-wash dynamics");
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 56, roundness: 0.78, angle: 18 })]],
      dynamics,
      dynamicSeed: 73,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 1_000,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected textured wet-wash mark");
    expect(plan.marks).toHaveLength(1);
    expect(plan.marks[0]).toMatchObject({
      radiusX: 28,
      radiusY: 28 * 0.78,
      texture: {
        kind: "alpha-map",
      },
    });
    expect(plan.marks[0]!.falloff).toBeUndefined();
    expect(plan.marks[0]!.texture?.alphaMap.alphas.length).toBe(
      plan.marks[0]!.texture!.alphaMap.size ** 2,
    );
  });

  it("deposits flow locally and applies inherited × stroke opacity once at tile composite", () => {
    const destination = new RecordingDestination();
    const surfaces: RecordingSurface[] = [];
    const marks = [
      mark(),
      mark({ x: 12, alpha: 0.25 }),
    ];
    const result = renderStudioDynamicBrushCoverage(destination, marks, {
      activeDraft: false,
      opacity: 0.4,
      surfaceFactory: surfaceFactory(surfaces),
    });

    expect(result).toMatchObject({ status: "rendered", scale: 2, tileCount: 1 });
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.context.fills.map(({ alpha }) => alpha)).toEqual([0.5, 0.25]);
    expect(destination.draws).toHaveLength(1);
    expect(destination.draws[0]!.alpha).toBeCloseTo(0.8 * 0.4, 12);
    expect(destination.globalAlpha).toBe(0.8);
  });

  it("keeps bounded overlap alpha at 0.375 instead of legacy per-dab 0.4375", () => {
    const marks = [
      mark({ x: 96, y: 96, radiusX: 8, radiusY: 8, angleRadians: 0, alpha: 0.5 }),
      mark({ x: 96, y: 96, radiusX: 8, radiusY: 8, angleRadians: 0, alpha: 0.5 }),
    ];
    const factory = (width: number, height: number) => (
      new AlphaOracleSurface(width, height) as unknown as StudioCoverageSurface
    );
    clearStudioDynamicCoverageCommittedCache();
    for (const physicalScale of [1, 12]) {
      const first = new AlphaOracleDestination();
      first._context.getTransform = () => ({
        a: physicalScale,
        b: 0,
        c: 0,
        d: physicalScale,
        e: 0,
        f: 0,
      }) as DOMMatrix;
      const firstResult = renderStudioDynamicBrushCoverage(first, marks, {
        activeDraft: false,
        opacity: 0.5,
        surfaceFactory: factory,
        committedCacheKey: `alpha-oracle:${physicalScale}`,
      });
      expect(firstResult).toMatchObject({
        status: "rendered",
        scale: physicalScale > 4 ? 4 : physicalScale,
        tileCount: 1,
      });
      // Local coverage: .5 source-over .5 = .75; stroke opacity is then applied once.
      expect(first.alpha).toBeCloseTo(0.375, 12);

      const replay = new AlphaOracleDestination();
      replay._context.getTransform = first._context.getTransform;
      const replayResult = renderStudioDynamicBrushCoverage(replay, marks, {
        activeDraft: false,
        opacity: 0.5,
        surfaceFactory: factory,
        committedCacheKey: `alpha-oracle:${physicalScale}`,
      });
      expect(replayResult).toEqual(firstResult);
      expect(replay.alpha).toBeCloseTo(0.375, 12);
    }

    const legacy = new AlphaOracleDestination();
    renderStudioDynamicBrushLegacyMarks(legacy, marks, 0.5);
    // Frozen legacy semantics multiply opacity into both dabs: .25 over .25 = .4375.
    expect(legacy.alpha).toBeCloseTo(0.4375, 12);
    expect(0.375).not.toBeCloseTo(legacy.alpha, 12);
    clearStudioDynamicCoverageCommittedCache();
  });

  it("uses a lower committed-cache ceiling for coarse-pointer and low-memory devices", () => {
    expect(resolveStudioDynamicCoverageCommittedCacheByteBudget({
      coarsePointer: false,
      deviceMemoryGb: 8,
    })).toBe(STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_BYTE_BUDGET);
    expect(resolveStudioDynamicCoverageCommittedCacheByteBudget({
      coarsePointer: true,
      deviceMemoryGb: 8,
    })).toBe(STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_MOBILE_BYTE_BUDGET);
    expect(resolveStudioDynamicCoverageCommittedCacheByteBudget({
      coarsePointer: false,
      deviceMemoryGb: 4,
    })).toBe(STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_MOBILE_BYTE_BUDGET);
    expect(resolveStudioDynamicCoverageCommittedCacheByteBudget({
      coarsePointer: false,
      deviceMemoryGb: null,
    })).toBe(STUDIO_DYNAMIC_COVERAGE_COMMITTED_CACHE_BYTE_BUDGET);
  });

  it("reuses immutable committed coverage tiles across retained layer redraws", () => {
    clearStudioDynamicCoverageCommittedCache();
    const cacheKey = "draw-stroke-1";
    const marks = [
      mark(),
      mark({ x: 12, alpha: 0.25 }),
    ];
    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    const firstDestination = new RecordingDestination();
    const secondDestination = new RecordingDestination();

    const first = renderStudioDynamicBrushCoverage(firstDestination, marks, {
      activeDraft: false,
      opacity: 0.4,
      surfaceFactory: factory,
      committedCacheKey: cacheKey,
    });
    const second = renderStudioDynamicBrushCoverage(
      secondDestination,
      marks.map((candidate) => ({
        ...candidate,
        ...(candidate.falloff ? { falloff: { ...candidate.falloff } } : {}),
      })),
      {
        activeDraft: false,
        opacity: 0.4,
        surfaceFactory: factory,
        committedCacheKey: cacheKey,
      },
    );

    expect(first).toMatchObject({ status: "rendered", scale: 2, tileCount: 1 });
    expect(second).toEqual(first);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.context.fills).toHaveLength(2);
    expect(firstDestination.draws).toHaveLength(1);
    expect(secondDestination.draws).toHaveLength(1);
    expect(studioDynamicCoverageCommittedCacheStats()).toEqual({
      bytes: 260 * 260 * 4,
      entries: 1,
      tiles: 1,
    });

    clearStudioDynamicCoverageCommittedCache();
    expect(studioDynamicCoverageCommittedCacheStats()).toEqual({
      bytes: 0,
      entries: 0,
      tiles: 0,
    });
    expect(surfaces[0]).toMatchObject({ width: 1, height: 1 });
  });

  it("uses rectangular texture bounds so rotated opaque corner pixels reach adjacent tiles", () => {
    clearStudioDynamicCoverageCommittedCache();
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "grain", softness: 0.1, alphaMapSize: 24 },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({
        x: 230,
        y: 128,
        sourceX: 230,
        sourceY: 128,
        size: 40,
        angle: 45,
      })]],
      dynamics,
      dynamicSeed: 5,
      stroke: "#336699",
      stampGrid: 3,
      markBudget: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected texture mark");

    const destination = new RecordingDestination();
    destination._context.getTransform = () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }) as DOMMatrix;
    const surfaces: RecordingSurface[] = [];
    const result = renderStudioDynamicBrushCoverage(destination, plan.marks, {
      activeDraft: true,
      opacity: 1,
      surfaceFactory: surfaceFactory(surfaces),
    });

    expect(result).toMatchObject({
      status: "rendered",
      scale: 1,
      tileCount: 2,
      tileMarkReferences: 2,
    });
    expect(studioBrushTextureStampCacheStats()).toMatchObject({
      entries: 2,
      maskEntries: 1,
      tintEntries: 1,
      scratchSurfaces: 1,
      surfaceAllocations: 3,
    });
  });

  it("reuses committed textured tiles for equal immutable alpha-map revisions", () => {
    clearStudioDynamicCoverageCommittedCache();
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "bristle", softness: 0.25, alphaMapSize: 24 },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ x: 100, y: 100, size: 32, angle: 17 })]],
      dynamics,
      dynamicSeed: 5,
      stroke: "#336699",
      stampGrid: 3,
      markBudget: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected texture mark");
    const firstMark = plan.marks[0]!;
    const firstMap = firstMark.texture!.alphaMap;
    const replayMarks: readonly StudioDynamicBrushCoverageMark[] = [{
      ...firstMark,
      texture: {
        kind: "alpha-map",
        alphaMap: {
          ...firstMap,
          alphas: new Float32Array(firstMap.alphas),
        },
      },
    }];
    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    const first = renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      plan.marks,
      {
        activeDraft: false,
        opacity: 1,
        surfaceFactory: factory,
        committedCacheKey: "textured-replay",
      },
    );
    const replay = renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      replayMarks,
      {
        activeDraft: false,
        opacity: 1,
        surfaceFactory: factory,
        committedCacheKey: "textured-replay",
      },
    );

    expect(first).toMatchObject({ status: "rendered", tileCount: 1 });
    expect(replay).toEqual(first);
    // One tile plus an immutable alpha mask and one reusable tint scratch; replay allocates none.
    expect(surfaces).toHaveLength(3);
    expect(studioBrushTextureStampCacheStats()).toMatchObject({
      entries: 1,
      maskEntries: 1,
      tintEntries: 0,
      scratchSurfaces: 1,
      surfaceAllocations: 2,
    });
  });

  it("disposes every document-owned backing surface at the Studio lifecycle boundary", () => {
    clearStudioDynamicCoverageCommittedCache();
    clearStudioBrushSoftFalloffStampCache();
    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    for (const committedCacheKey of ["document-a:stroke-1", "document-a:stroke-2"]) {
      expect(renderStudioDynamicBrushCoverage(
        new RecordingDestination(),
        [mark({ x: committedCacheKey.endsWith("1") ? 10 : 300 })],
        {
          activeDraft: false,
          opacity: 1,
          surfaceFactory: factory,
          committedCacheKey,
        },
      ).status).toBe("rendered");
    }

    expect(studioDynamicCoverageCommittedCacheStats()).toMatchObject({
      entries: 2,
      tiles: 2,
    });
    expect(surfaces.every((surface) => surface.width > 1 && surface.height > 1)).toBe(true);

    const falloffMark = mark({
      falloff: { kind: "analytic-radial", exponent: 3.2 },
    });
    expect(renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      [falloffMark],
      {
        activeDraft: false,
        opacity: 1,
        surfaceFactory: factory,
        committedCacheKey: "document-a:soft-stroke",
      },
    ).status).toBe("rendered");
    expect(studioBrushSoftFalloffStampCacheStats()).toMatchObject({
      entries: 1,
      tintedEntries: 1,
      scratchSurfaces: 0,
      surfaceAllocations: 2,
    });

    disposeStudioDynamicCoverageCommittedCache();

    expect(studioDynamicCoverageCommittedCacheStats()).toEqual({
      bytes: 0,
      entries: 0,
      tiles: 0,
    });
    expect(surfaces).toHaveLength(5);
    expect(surfaces.every((surface) => surface.width === 1 && surface.height === 1)).toBe(true);
    expect(studioBrushSoftFalloffStampCacheStats()).toEqual({
      entries: 0,
      tintedEntries: 0,
      scratchSurfaces: 0,
      bytes: 0,
      surfaceAllocations: 0,
      hits: 0,
      misses: 0,
      tintedHits: 0,
      tintPasses: 0,
    });
  });

  it("binds cache disposal to the keyed editor work/auth lifecycle", () => {
    const studioPageSource = readFileSync(
      new URL("./StudioCuttoonEditorHost.tsx", import.meta.url),
      "utf8",
    );
    // The keyed lifecycle teardown moved out of the host into the raster publication runtime hook;
    // the host still owns the component the hook is keyed by.
    const rasterPublicationSource = readFileSync(
      new URL(
        "./studio-cuttoon-editor/runtime/useStudioRasterPublicationRuntime.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(studioPageSource).toContain("function StudioCuttoonEditor(");
    expect(rasterPublicationSource).toContain(
      "disposeStudioDynamicCoverageCommittedCache();",
    );
    expect(rasterPublicationSource.indexOf("disposeStudioDynamicCoverageCommittedCache();"))
      .toBeGreaterThan(rasterPublicationSource.indexOf("useLayoutEffect(() => () => {"));
  });

  it("uses identical 2x live and committed surface scale at the handoff", () => {
    const marks = [mark()];
    const activeDestination = new RecordingDestination();
    const committedDestination = new RecordingDestination();
    const active = renderStudioDynamicBrushCoverage(activeDestination, marks, {
      activeDraft: true,
      opacity: 0.6,
      surfaceFactory: surfaceFactory([]),
    });
    const committed = renderStudioDynamicBrushCoverage(committedDestination, marks, {
      activeDraft: false,
      opacity: 0.6,
      surfaceFactory: surfaceFactory([]),
    });

    expect(active).toMatchObject({ status: "rendered", scale: 2, tileCount: 1 });
    expect(committed).toMatchObject({ status: "rendered", scale: 2, tileCount: 1 });
    expect(activeDestination.draws[0]?.args).toEqual(committedDestination.draws[0]?.args);
  });

  it("streams committed coverage beyond 262,144 tile references with one final opacity", () => {
    const repeatedMark = mark({
      x: 64,
      y: 64,
      radiusX: 1,
      radiusY: 1,
      angleRadians: 0,
      alpha: 0.03,
    });
    const marks = Array<StudioDynamicBrushCoverageMark>(262_145).fill(repeatedMark);
    const activeDestination = new RecordingDestination();
    const activeSurfaces: CountingCoverageSurface[] = [];
    const active = renderStudioDynamicBrushCoverage(activeDestination, marks, {
      activeDraft: true,
      opacity: 0.5,
      surfaceFactory: (width, height) => {
        const surface = new CountingCoverageSurface(width, height);
        activeSurfaces.push(surface);
        return surface as unknown as StudioCoverageSurface;
      },
    });

    expect(active).toMatchObject({
      status: "rejected",
      reason: "tile-mark-budget",
    });
    expect(activeDestination.draws).toHaveLength(0);
    expect(activeSurfaces).toHaveLength(0);

    const committedDestination = new RecordingDestination();
    const committedSurfaces: CountingCoverageSurface[] = [];
    const committed = renderStudioDynamicBrushCoverage(
      committedDestination,
      marks,
      {
        activeDraft: false,
        opacity: 0.5,
        surfaceFactory: (width, height) => {
          const surface = new CountingCoverageSurface(width, height);
          committedSurfaces.push(surface);
          return surface as unknown as StudioCoverageSurface;
        },
      },
    );

    expect(committed).toMatchObject({
      status: "rendered",
      scale: 2,
      tileCount: 1,
      allocatedBytes: 260 * 260 * 4,
      tileMarkReferences: 262_145,
    });
    expect(committedSurfaces).toHaveLength(1);
    expect(committedSurfaces[0]!.context.fillCount).toBe(262_145);
    expect(committedSurfaces[0]).toMatchObject({ width: 1, height: 1 });
    expect(committedDestination.draws).toEqual([
      expect.objectContaining({ alpha: 0.8 * 0.5 }),
    ]);
  }, 30_000);

  it("streams aggregate committed coverage above 64 MiB through one reusable tile", () => {
    clearStudioDynamicCoverageCommittedCache();
    // At 2x, each 128-logical-pixel station occupies its own 260×260 surface tile. 249 tiles
    // exceed the historical 64 MiB aggregate allocation ceiling (248 tiles fit).
    const marks = Array.from({ length: 249 }, (_, tileIndex) => mark({
      x: tileIndex * 128 + 64,
      y: 64,
      radiusX: 1,
      radiusY: 1,
      angleRadians: 0,
      alpha: 0.4,
    }));
    const destination = new RecordingDestination();
    const surfaces: CountingCoverageSurface[] = [];
    const result = renderStudioDynamicBrushCoverage(destination, marks, {
      activeDraft: false,
      opacity: 0.25,
      committedCacheKey: "streaming-above-64mib",
      surfaceFactory: (width, height) => {
        const surface = new CountingCoverageSurface(width, height);
        surfaces.push(surface);
        return surface as unknown as StudioCoverageSurface;
      },
    });

    expect(result).toMatchObject({
      status: "rendered",
      scale: 2,
      tileCount: 249,
      allocatedBytes: 260 * 260 * 4,
      tileMarkReferences: 249,
    });
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.context.fillCount).toBe(249);
    expect(surfaces[0]).toMatchObject({ width: 1, height: 1 });
    expect(destination.draws).toHaveLength(249);
    expect(destination.draws.every(({ alpha }) => alpha === 0.8 * 0.25)).toBe(true);
    // Streaming plans are intentionally not retained in the multi-surface committed cache.
    expect(studioDynamicCoverageCommittedCacheStats()).toMatchObject({
      bytes: 0,
      entries: 0,
      tiles: 0,
    });
  });

  it("retains exact 4x physical quality for both live and committed coverage", () => {
    const makeDestination = () => {
      const destination = new RecordingDestination();
      destination._context.getTransform = () => ({
        a: 4,
        b: 0,
        c: 0,
        d: 4,
        e: 0,
        f: 0,
      }) as DOMMatrix;
      return destination;
    };
    const active = renderStudioDynamicBrushCoverage(makeDestination(), [mark()], {
      activeDraft: true,
      opacity: 0.6,
      surfaceFactory: surfaceFactory([]),
    });
    const committed = renderStudioDynamicBrushCoverage(makeDestination(), [mark()], {
      activeDraft: false,
      opacity: 0.6,
      surfaceFactory: surfaceFactory([]),
    });

    expect(active).toMatchObject({ status: "rendered", scale: 4 });
    expect(committed).toMatchObject({ status: "rendered", scale: 4 });
  });

  it("caps transforms above 4x without changing bounded-flow alpha semantics", () => {
    const destination = new RecordingDestination();
    destination._context.getTransform = () => ({
      a: 12,
      b: 0,
      c: 0,
      d: 12,
      e: 0,
      f: 0,
    }) as DOMMatrix;
    const result = renderStudioDynamicBrushCoverage(destination, [mark()], {
      activeDraft: false,
      opacity: 0.6,
      surfaceFactory: surfaceFactory([]),
    });

    expect(result).toMatchObject({ status: "rendered", scale: 4 });
    expect(destination.draws).toHaveLength(1);
    expect(destination.draws[0]!.alpha).toBeCloseTo(0.8 * 0.6, 12);
  });

  it("preserves committed raster quality by streaming when preferred scale exceeds tile budget", () => {
    const destination = new RecordingDestination();
    destination._context.getTransform = () => ({
      a: 8,
      b: 0,
      c: 0,
      d: 8,
      e: 0,
      f: 0,
    }) as DOMMatrix;
    const result = renderStudioDynamicBrushCoverage(
      destination,
      [mark({
        x: 0,
        y: 0,
        radiusX: 1_300,
        radiusY: 1_300,
        angleRadians: 0,
        alpha: 0.5,
      })],
      {
        activeDraft: false,
        opacity: 0.5,
        surfaceFactory: surfaceFactory([]),
      },
    );

    expect(result).toMatchObject({ status: "rendered", scale: 4 });
    if (result.status !== "rendered") throw new Error("expected coverage");
    expect(result.allocatedBytes).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET,
    );
    expect(destination.draws.length).toBeGreaterThan(0);
    expect(destination.draws.every(({ alpha }) => alpha === 0.8 * 0.5)).toBe(true);
  });

  it("rasterizes a sub-1x view at full resolution without changing destination-space geometry", () => {
    const destination = new RecordingDestination();
    destination._context.getTransform = () => ({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: 0,
      f: 0,
    }) as DOMMatrix;
    const result = renderStudioDynamicBrushCoverage(destination, [mark()], {
      activeDraft: false,
      opacity: 1,
      surfaceFactory: surfaceFactory([]),
    });

    // 텍스처 스탬프 피크는 타일 래스터를 한 번만 리샘플해야 살아남는다(ADR 0010).
    // 0.5× 줌이라도 타일은 1×로 조판하고 목적지 변환으로 축소한다 — 실측 0.8× 타일은
    // 겹침 코어 sumAlpha가 216→81로 무너졌다(패리티 리포트 §8, 2026-08-24).
    expect(result).toMatchObject({ status: "rendered", scale: 1 });
    expect(destination.draws[0]?.args.slice(-2)).toEqual([256, 256]);
  });

  it("allocates only dab-intersecting sparse tiles instead of the marks' bounding rectangle", () => {
    const destination = new RecordingDestination();
    destination._context.getTransform = () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }) as DOMMatrix;
    const result = renderStudioDynamicBrushCoverage(
      destination,
      [mark({ x: 4, y: 4 }), mark({ x: 2_052, y: 2_052 })],
      {
        activeDraft: false,
        opacity: 1,
        surfaceFactory: surfaceFactory([]),
      },
    );

    // Each edge-adjacent dab touches four tiles because antialias bleed crosses the world origin;
    // the empty 8×8 diagonal rectangle between them is still never allocated.
    expect(result).toMatchObject({ status: "rendered", scale: 1, tileCount: 8 });
    if (result.status !== "rendered") throw new Error("expected coverage");
    expect(result.allocatedBytes).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_COVERAGE_ACTIVE_BYTE_BUDGET,
    );
    expect(destination.draws).toHaveLength(8);
  });

  it("fails before destination mutation when a mark exceeds the surface/reference budget", () => {
    const destination = new RecordingDestination();
    const marks = [mark({ radiusX: 1_000_000, radiusY: 1_000_000 })];
    const sourceSnapshot = structuredClone(marks);
    const result = renderStudioDynamicBrushCoverage(
      destination,
      marks,
      {
        activeDraft: true,
        opacity: 0.5,
        surfaceFactory: surfaceFactory([]),
      },
    );

    expect(result).toMatchObject({ status: "rejected" });
    expect(destination.draws).toHaveLength(0);
    expect(destination.legacyFills).toHaveLength(0);
    // Rejection never mutates the authoritative source or implicitly selects the legacy
    // compositor for the same operation.
    expect(marks).toEqual(sourceSnapshot);
  });

  it("keeps a complete visible legacy plan when coverage mark preflight exhausts its budget", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const input = {
      dabVariations: [[dab(), dab({ index: 1, x: 30, sourceX: 30 })]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#123456",
      stampGrid: 7 as const,
      markBudget: 1,
    };
    const plan = planStudioDynamicBrushCoverageAndLegacyMarks(input);

    expect(plan.coveragePlan).toEqual({ ok: false, reason: "mark-budget" });
    expect(plan.legacyMarks).toHaveLength(2);
    const destination = new RecordingDestination();
    renderStudioDynamicBrushLegacyMarks(destination, plan.legacyMarks, 0.5);
    expect(destination.legacyFills).toHaveLength(2);
  });

  it("keeps a complete causal dab-wave prefix instead of rejecting the whole stroke", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushCoverageAndLegacyMarks({
      dabVariations: [{
        kind: "studio-dynamic-brush-segmented-dab-variation",
        segments: [
          [dab()],
          [dab({ index: 1, x: 30, sourceX: 30 })],
        ],
      }],
      dynamics,
      dynamicSeed: 42,
      stroke: "#123456",
      stampGrid: 3,
      markBudget: 1,
    });

    expect(plan.coveragePlan).toMatchObject({
      ok: true,
      marks: [expect.objectContaining({ x: 10, y: 20 })],
      acceptedPrefixReceipt: {
        policy: "accepted-prefix-v1",
        requestedDabsPerVariation: 2,
        acceptedDabsPerVariation: 1,
        rejectedDabsPerVariation: 1,
        acceptedMarkBudget: 1,
      },
    });
    expect(plan.legacyMarks).toEqual(
      plan.coveragePlan.ok ? plan.coveragePlan.marks : [],
    );
  });

  it("never splits symmetry or three-tip material layers at a causal ceiling", () => {
    const tip = { shape: "round" as const, softness: 0 };
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip,
      tipLayers: [
        { tip, opacity: 1 },
        { tip, opacity: 0.5 },
      ],
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const first = dab();
    const second = dab({ index: 1, x: 30, sourceX: 30 });
    const mirroredFirst = dab({ x: -10, sourceX: -10 });
    const mirroredSecond = dab({ index: 1, x: -30, sourceX: -30 });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [
        [first, second],
        [mirroredFirst, mirroredSecond],
      ],
      dynamics,
      dynamicSeed: 42,
      stroke: "#123456",
      stampGrid: 3,
      // One complete base-dab wave = 2 symmetry copies × 3 enabled tips.
      markBudget: 6,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected accepted causal prefix");
    expect(plan.marks).toHaveLength(6);
    expect(plan.marks.map(({ x }) => x)).toEqual([10, 10, 10, -10, -10, -10]);
    expect(plan.acceptedPrefixReceipt).toMatchObject({
      requestedDabsPerVariation: 2,
      acceptedDabsPerVariation: 1,
      rejectedDabsPerVariation: 1,
      acceptedMarkBudget: 6,
    });
  });

  it.each(["pastel", "oil-pastel"] as const)(
    "charges every %s fibre lane before admitting a causal prefix",
    (brushId) => {
      const dynamics = normalizeStudioBrushDynamicsSettings({
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
        tip: { shape: "hard", softness: 0 },
        grain: { amount: 0 },
        taper: { enabled: false },
      });
      const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(brushId);
      expect(materialIdentity?.dryMediaPresetId).toBe("pastel");

      const plan = planStudioDynamicBrushCoverageMarks({
        dabVariations: [[
          dab(),
          dab({ index: 1, x: 30, sourceX: 30 }),
          dab({ index: 2, x: 50, sourceX: 50 }),
        ]],
        dynamics,
        materialIdentity: materialIdentity ?? undefined,
        dynamicSeed: 42,
        stroke: "#765432",
        stampGrid: 3,
        // Two complete source dabs × five physical pastel fibres fit. The third authored dab must
        // become a causal prefix receipt, never a late all-or-nothing bridge failure.
        markBudget: 10,
      });

      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(`expected bounded ${brushId} prefix`);
      expect(plan.marks).toHaveLength(10);
      expect(plan.acceptedPrefixReceipt).toMatchObject({
        policy: "accepted-prefix-v1",
        requestedDabsPerVariation: 3,
        acceptedDabsPerVariation: 2,
        rejectedDabsPerVariation: 1,
        marksPerDab: 5,
        acceptedMarkBudget: 10,
      });
      expect(plan.marks.every(({ radiusX, radiusY }) => (
        radiusX / radiusY >= 3 - 1e-10
      ))).toBe(true);
    },
  );

  it("keeps explicit full-stroke origins stable for suffix-only stroke-fixed grain plans", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "hard", softness: 0 },
      grain: {
        space: "stroke-fixed",
        amount: 0.8,
        scale: 7,
        contrast: 0.7,
        seed: 33,
      },
      taper: { enabled: false },
    });
    const fullDabs = [
      dab({ x: 10, sourceX: 10 }),
      dab({ index: 1, x: 30, sourceX: 30 }),
    ];
    const full = planStudioDynamicBrushCoverageMarks({
      dabVariations: [fullDabs],
      dynamics,
      dynamicSeed: 91,
      stroke: "#123456",
      stampGrid: 7,
      markBudget: 100,
    });
    const suffix = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[fullDabs[1]!]],
      strokeOrigins: [{ x: 10, y: 20 }],
      dynamics,
      dynamicSeed: 91,
      stroke: "#123456",
      stampGrid: 7,
      markBudget: 100,
    });

    expect(full.ok).toBe(true);
    expect(suffix.ok).toBe(true);
    if (!full.ok || !suffix.ok) throw new Error("expected marks");
    expect(suffix.marks.map(({ alpha }) => alpha)).toEqual(
      full.marks.slice(-suffix.marks.length).map(({ alpha }) => alpha),
    );
  });

  it("preserves tip layers, grain, dual texture, colour dynamics and symmetry in v2 marks", () => {
    const richInput = {
      tip: { shape: "round" as const, softness: 0.2 },
      dualBrush: {
        enabled: true,
        tip: { shape: "star" as const, softness: 0.1 },
        blendMode: "screen" as const,
        sizeRatio: 0.7,
      },
      tipLayers: [
        {
          tip: { shape: "hard" as const, softness: 0.1 },
          scale: 0.55,
          opacity: 0.7,
          offsetY: -0.4,
        },
      ],
      grain: {
        space: "canvas-fixed" as const,
        amount: 0.75,
        scale: 5,
        contrast: 0.8,
        seed: 77,
      },
      colorDynamics: {
        backgroundColor: "#ff8844",
        foregroundBackgroundMix: 0.65,
        hueJitter: 35,
        saturationJitter: 0.2,
      },
      taper: { enabled: false },
    };
    const richDynamics = normalizeStudioBrushDynamicsSettings(richInput);
    const noLayersDynamics = normalizeStudioBrushDynamicsSettings({
      ...richInput,
      tipLayers: [],
    });
    const noDualDynamics = normalizeStudioBrushDynamicsSettings({
      ...richInput,
      dualBrush: { enabled: false },
    });
    const variations = [
      [dab({ index: 4, x: 12, y: 18, sourceX: 10, sourceY: 20 })],
      [dab({ index: 4, x: 88, y: 18, sourceX: 90, sourceY: 20, angle: 180 })],
    ];
    const plan = (dynamics: typeof richDynamics) => planStudioDynamicBrushCoverageMarks({
      dabVariations: variations,
      dynamics,
      dynamicSeed: 1234,
      stroke: "#2468ac",
      stampGrid: 3,
      markBudget: 1_000,
    });
    const rich = plan(richDynamics);
    const noLayers = plan(noLayersDynamics);
    const noDual = plan(noDualDynamics);

    expect(rich.ok).toBe(true);
    expect(noLayers.ok).toBe(true);
    expect(noDual.ok).toBe(true);
    if (!rich.ok || !noLayers.ok || !noDual.ok) throw new Error("expected rich marks");
    expect(rich.marks.length).toBeGreaterThan(noLayers.marks.length);
    expect(rich.marks.map(({ alpha }) => alpha)).not.toEqual(
      noDual.marks.map(({ alpha }) => alpha),
    );
    expect(new Set(rich.marks.map(({ alpha }) => alpha.toFixed(6))).size).toBeGreaterThanOrEqual(4);
    expect(new Set(rich.marks.map(({ color }) => color))).not.toEqual(new Set(["#2468ac"]));
    expect(rich.marks.some(({ x }) => x < 50)).toBe(true);
    expect(rich.marks.some(({ x }) => x > 50)).toBe(true);
  });
});

describe("studio dynamic brush soft-falloff linear-accumulation tone", () => {
  const legacyMaskOracleByte = (x: number, y: number, exponent: number): number => {
    const surfaceSize = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION
      + STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS * 2;
    const centre = surfaceSize / 2;
    const unitRadius = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION / 2;
    const radius = Math.hypot(
      (x + 0.5 - centre) / unitRadius,
      (y + 0.5 - centre) / unitRadius,
    );
    const coverage = radius < 1 ? Math.pow(1 - radius, exponent) : 0;
    return Math.min(255, Math.max(0, Math.round(coverage * 255)));
  };
  const linearMaskOracleByte = (x: number, y: number, exponent: number): number => {
    const surfaceSize = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION
      + STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS * 2;
    const centre = surfaceSize / 2;
    const unitRadius = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION / 2;
    const radius = Math.hypot(
      (x + 0.5 - centre) / unitRadius,
      (y + 0.5 - centre) / unitRadius,
    );
    const coverage = radius < 1 ? Math.pow(1 - radius, exponent) : 0;
    return Math.min(255, Math.max(0, Math.round(
      linearizeStudioBrushSoftFalloffCoverageAlpha(coverage) * 255,
    )));
  };

  it("mints the versioned tone only from the exact fresh-authoring pin", () => {
    const pinned = studioBrushDynamicsSettingsForBrushId("airbrush");
    if (!pinned) throw new Error("missing airbrush dynamics");
    expect(pinned.softFalloffLinearProgram).toEqual(
      studioSoftFalloffLinearAccumulationProgramPin(),
    );
    const plan = (dynamics: typeof pinned) => planStudioDynamicBrushCoverageMarks({
      dabVariations: [[
        dab({ size: 48 }),
        dab({ index: 1, x: 26, y: 24, sourceX: 26, sourceY: 24, size: 44 }),
      ]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 8,
    });

    const pinnedPlan = plan(pinned);
    expect(pinnedPlan.ok).toBe(true);
    if (!pinnedPlan.ok) throw new Error("expected pinned analytic marks");
    expect(pinnedPlan.marks.length).toBeGreaterThan(0);
    for (const plannedMark of pinnedPlan.marks) {
      expect(plannedMark.falloff).toMatchObject({
        kind: "analytic-radial",
        tone: STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
      });
    }

    // A persisted pre-wave snapshot is the same settings without the pin: it must plan the exact
    // historical marks — the pin changes ONLY the versioned tone tag, never geometry or alpha.
    const legacyPlan = plan(normalizeStudioBrushDynamicsSettings({
      ...pinned,
      softFalloffLinearProgram: undefined,
    }));
    expect(legacyPlan.ok).toBe(true);
    if (!legacyPlan.ok) throw new Error("expected legacy analytic marks");
    expect(legacyPlan.marks.every(
      (candidate) => candidate.falloff?.tone === undefined,
    )).toBe(true);
    expect(pinnedPlan.marks.map((candidate) => ({
      ...candidate,
      falloff: {
        kind: candidate.falloff!.kind,
        exponent: candidate.falloff!.exponent,
      },
    }))).toEqual(legacyPlan.marks);
  });

  it("mints the tone on both halves of the decomposed legacy screen dual", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      softFalloffLinearProgram: studioSoftFalloffLinearAccumulationProgramPin(),
      tip: { shape: "soft", softness: 0.82 },
      grain: { amount: 0 },
      taper: { enabled: false },
      dualBrush: {
        enabled: true,
        tip: { shape: "soft", softness: 0.6 },
        blendMode: "screen",
        sizeRatio: 0.8,
      },
    });
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [[dab({ size: 48 })]],
      dynamics,
      dynamicSeed: 42,
      stroke: "#336699",
      stampGrid: 7,
      markBudget: 8,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected decomposed dual marks");
    expect(plan.marks).toHaveLength(2);
    expect(plan.marks.every((candidate) => (
      candidate.falloff?.kind === "analytic-radial"
      && candidate.falloff.tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
    ))).toBe(true);
  });

  it("keeps tone-less marks on the byte-identical legacy mask and gives the tone its own", () => {
    clearStudioBrushSoftFalloffStampCache();
    const exponent = 3.2;
    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    const destination = new RecordingDestination();

    renderStudioDynamicBrushCoverageMark(
      destination,
      mark({ falloff: { kind: "analytic-radial", exponent } }),
      1,
      factory,
    );
    const legacyMask = surfaces.find(
      ({ context }) => context.imagePixels.length > 0,
    );
    if (!legacyMask) throw new Error("expected a legacy mask surface");
    const centreRow = Math.floor(legacyMask.width / 2);
    const alphaAt = (surface: RecordingSurface, x: number): number =>
      surface.context.imagePixels[(centreRow * surface.width + x) * 4 + 3]!;
    for (let x = 0; x < legacyMask.width; x += 1) {
      expect(alphaAt(legacyMask, x)).toBe(
        legacyMaskOracleByte(x, centreRow, exponent),
      );
    }
    expect(studioBrushSoftFalloffStampCacheStats()).toMatchObject({ entries: 1 });

    renderStudioDynamicBrushCoverageMark(
      destination,
      mark({
        falloff: {
          kind: "analytic-radial",
          exponent,
          tone: STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
        },
      }),
      1,
      factory,
    );
    const linearMask = surfaces.find(
      (surface) => surface !== legacyMask && surface.context.imagePixels.length > 0,
    );
    if (!linearMask) throw new Error("expected a separate linear mask surface");
    expect(studioBrushSoftFalloffStampCacheStats()).toMatchObject({ entries: 2 });
    let midTexels = 0;
    for (let x = 0; x < linearMask.width; x += 1) {
      const linearByte = linearMaskOracleByte(x, centreRow, exponent);
      expect(alphaAt(linearMask, x)).toBe(linearByte);
      const legacyByte = legacyMaskOracleByte(x, centreRow, exponent);
      if (legacyByte > 13 && legacyByte < 242) {
        midTexels += 1;
        expect(linearByte).toBeLessThan(legacyByte);
      }
    }
    expect(midTexels).toBeGreaterThan(16);
  });

  it("fails closed instead of substituting a mask for an unknown tone", () => {
    const destination = new RecordingDestination();
    expect(() => renderStudioDynamicBrushCoverageMark(
      destination,
      mark({
        falloff: {
          kind: "analytic-radial",
          exponent: 3.2,
          tone: "linear-accumulation-v2" as unknown as StudioBrushSoftFalloffStampTone,
        },
      }),
      1,
      surfaceFactory([]),
    )).toThrow("studio-brush-soft-falloff-stamp-unavailable");
    expect(destination.draws).toHaveLength(0);
  });

  it("invalidates a committed coverage entry whose marks change only in tone", () => {
    clearStudioDynamicCoverageCommittedCache();
    clearStudioBrushSoftFalloffStampCache();
    const surfaces: RecordingSurface[] = [];
    const factory = surfaceFactory(surfaces);
    const committedCacheKey = "document-a:soft-linear-upgrade";
    const legacyMarks = [mark({
      x: 64,
      y: 64,
      radiusX: 8,
      radiusY: 8,
      angleRadians: 0,
      falloff: { kind: "analytic-radial", exponent: 3.2 },
    })];

    expect(renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      legacyMarks,
      { activeDraft: false, opacity: 1, surfaceFactory: factory, committedCacheKey },
    ).status).toBe("rendered");
    const firstRenderSurfaces = surfaces.length;
    const legacyTiles = surfaces.filter(
      ({ context }) => context.imageDraws.length > 0 && context.rectFills === 0,
    );
    expect(legacyTiles.length).toBeGreaterThan(0);

    // Identical marks replay from the retained entry without allocating.
    expect(renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      legacyMarks.map((candidate) => ({
        ...candidate,
        falloff: { ...candidate.falloff! },
      })),
      { activeDraft: false, opacity: 1, surfaceFactory: factory, committedCacheKey },
    ).status).toBe("rendered");
    expect(surfaces).toHaveLength(firstRenderSurfaces);

    // The same stroke re-planned under the pin differs only in tone: the retained sRGB tiles
    // must be discarded and re-rendered from the linear mask, never served stale.
    expect(renderStudioDynamicBrushCoverage(
      new RecordingDestination(),
      legacyMarks.map((candidate) => ({
        ...candidate,
        falloff: {
          ...candidate.falloff!,
          tone: STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
        },
      })),
      { activeDraft: false, opacity: 1, surfaceFactory: factory, committedCacheKey },
    ).status).toBe("rendered");
    expect(surfaces.length).toBeGreaterThan(firstRenderSurfaces);
    expect(studioDynamicCoverageCommittedCacheStats()).toMatchObject({ entries: 1 });
    expect(legacyTiles.every(
      (surface) => surface.width === 1 && surface.height === 1,
    )).toBe(true);
    expect(studioBrushSoftFalloffStampCacheStats()).toMatchObject({ entries: 2 });

    clearStudioDynamicCoverageCommittedCache();
    clearStudioBrushSoftFalloffStampCache();
  });
});
