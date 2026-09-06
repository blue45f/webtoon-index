import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  planStudioWetInkBrushReplay,
  renderStudioWetInkBrushReplay,
  STUDIO_WET_INK_BRUSH_RUNTIME_VERSION,
  studioWetInkBrushRuntimeSupportsElement,
  type StudioWetInkBrushDestinationContext,
  type StudioWetInkBrushSurface,
  type StudioWetInkBrushSurfaceFactory,
} from "./studio-wet-ink-brush-runtime";

import type { DrawEl } from "../studio-element-model";

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "wet-ink-stroke",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [2, 3, 12, 7, 20, 5],
    pressures: [0.25, 0.8, 0.55],
    stroke: "#284c78",
    strokeWidth: 4,
    opacity: 0.6,
    brush: "watercolor",
    watercolorPipeline: "causal-walker-v2",
    ...overrides,
  };
}

function ready(
  element = stroke(),
  phase: "live" | "committed" = "committed",
) {
  const result = planStudioWetInkBrushReplay(element, { phase });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.value;
}

class FakeSurfaceContext {
  readonly uploads: ImageData[] = [];

  createImageData(width: number, height: number): ImageData {
    return {
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(imageData: ImageData): void {
    this.uploads.push(imageData);
  }
}

interface FakeSurfaceRecord {
  readonly context: FakeSurfaceContext;
  readonly surface: StudioWetInkBrushSurface;
}

function fakeSurface(width: number, height: number): FakeSurfaceRecord {
  const context = new FakeSurfaceContext();
  const surface = {
    width,
    height,
    getContext: () => context,
  } as unknown as StudioWetInkBrushSurface;
  return { context, surface };
}

function recordingFactory(
  records: FakeSurfaceRecord[],
): StudioWetInkBrushSurfaceFactory {
  return (width, height) => {
    const record = fakeSurface(width, height);
    records.push(record);
    return record.surface;
  };
}

class FakeDestination implements StudioWetInkBrushDestinationContext {
  globalAlpha = 1;
  readonly draws: Array<{
    readonly alpha: number;
    readonly args: readonly number[];
  }> = [];
  readonly savedAlpha: number[] = [];
  scale = 1;
  throwOnDraw = false;
  _context = {
    getTransform: () => ({
      a: this.scale,
      b: 0,
      c: 0,
      d: this.scale,
      e: 0,
      f: 0,
    }) as DOMMatrix,
  };

  save(): void {
    this.savedAlpha.push(this.globalAlpha);
  }

  restore(): void {
    const previous = this.savedAlpha.pop();
    if (previous !== undefined) this.globalAlpha = previous;
  }

  drawImage(
    _image: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    destinationX: number,
    destinationY: number,
    destinationWidth: number,
    destinationHeight: number,
  ): void {
    if (this.throwOnDraw) throw new Error("destination rejected draw");
    this.draws.push({
      alpha: this.globalAlpha,
      args: [
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      ],
    });
  }
}

describe("wet-ink rollout gate", () => {
  it("opts in only exact causal watercolor and ink-wash freehand snapshots", () => {
    expect(studioWetInkBrushRuntimeSupportsElement(stroke())).toBe(true);
    expect(studioWetInkBrushRuntimeSupportsElement(stroke({ brush: "ink-wash" }))).toBe(true);

    for (const candidate of [
      stroke({ brush: "gouache" }),
      stroke({ brush: "watercolor", watercolorPipeline: undefined }),
      stroke({ mode: "eraser" }),
      stroke({ kind: "line" }),
    ]) {
      expect(studioWetInkBrushRuntimeSupportsElement(candidate)).toBe(false);
      expect(planStudioWetInkBrushReplay(candidate, { phase: "committed" })).toMatchObject({
        ok: false,
        reason: "unsupported-snapshot",
      });
    }
  });

  it("fails malformed geometry, style and color closed to the legacy renderer", () => {
    expect(planStudioWetInkBrushReplay(
      stroke({ points: [0, 0, Number.NaN, 4] }),
      { phase: "live" },
    )).toMatchObject({ ok: false, reason: "invalid-geometry" });
    expect(planStudioWetInkBrushReplay(
      stroke({ strokeWidth: 0 }),
      { phase: "live" },
    )).toMatchObject({ ok: false, reason: "invalid-style" });
    expect(planStudioWetInkBrushReplay(
      stroke({ stroke: "currentColor" }),
      { phase: "live" },
    )).toMatchObject({ ok: false, reason: "invalid-color" });
  });
});

describe("authoritative live/committed replay", () => {
  it("uses the same runtime, seed, revision, field digest and tile bytes", () => {
    const live = ready(stroke({ brush: "ink-wash" }), "live");
    const committed = ready(stroke({ brush: "ink-wash" }), "committed");

    expect(live.runtimeVersion).toBe(STUDIO_WET_INK_BRUSH_RUNTIME_VERSION);
    expect(committed.runtimeVersion).toBe(live.runtimeVersion);
    expect(committed.seed).toBe(live.seed);
    expect(committed.revision).toBe(live.revision);
    expect(committed.fieldDigest).toBe(live.fieldDigest);
    expect(committed.originX).toBe(live.originX);
    expect(committed.originY).toBe(live.originY);
    expect(committed.uploads).toEqual(live.uploads);
    expect(committed.simulationSteps).toBe(live.simulationSteps);
  });

  it("keeps element opacity out of the physical field and RGBA upload", () => {
    const translucent = ready(stroke({ opacity: 0.2 }), "committed");
    const opaque = ready(stroke({ opacity: 1 }), "committed");

    expect(translucent.fieldDigest).toBe(opaque.fieldDigest);
    expect(translucent.uploads).toEqual(opaque.uploads);
    expect(translucent.compositeOpacity).toBeCloseTo(0.2);
    expect(opaque.compositeOpacity).toBe(1);
  });

  it("rejects a stroke that would truncate deposition instead of returning partial ink", () => {
    const result = planStudioWetInkBrushReplay(
      stroke({ points: [0, 0, 100_000, 100_000], pressures: [1, 1] }),
      { phase: "committed" },
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "deposition-budget",
    });
  });
});

describe("off-destination tile composition", () => {
  it("uploads dirty RGBA tiles and applies inherited × color × element opacity once", () => {
    const plan = ready(stroke({
      opacity: 0.4,
      stroke: "rgba(20, 40, 60, 0.5)",
    }));
    const destination = new FakeDestination();
    destination.globalAlpha = 0.5;
    destination.scale = 2;
    const surfaces: FakeSurfaceRecord[] = [];

    const result = renderStudioWetInkBrushReplay(destination, plan, {
      surfaceFactory: recordingFactory(surfaces),
    });

    expect(result).toMatchObject({
      status: "rendered",
      fieldDigest: plan.fieldDigest,
      nativeScale: 2,
      tileCount: plan.uploads.length,
    });
    expect(surfaces).toHaveLength(plan.uploads.length);
    expect(destination.draws).toHaveLength(plan.uploads.length);
    expect(destination.draws.every((draw) => Math.abs(draw.alpha - 0.1) < 1e-8)).toBe(true);
    expect(destination.globalAlpha).toBe(0.5);
    expect(surfaces.every((record) => record.context.uploads.length === 1)).toBe(true);
    expect(surfaces.every((record) => record.surface.width === 1)).toBe(true);
  });

  it("falls back before destination mutation when native quality or surface budget is unavailable", () => {
    const plan = ready();
    const highScale = new FakeDestination();
    highScale.scale = 4.01;
    expect(renderStudioWetInkBrushReplay(highScale, plan, {
      surfaceFactory: () => {
        throw new Error("must not allocate");
      },
    })).toEqual({ status: "unavailable", reason: "native-scale-unsupported" });
    expect(highScale.draws).toHaveLength(0);

    const overBudget = new FakeDestination();
    expect(renderStudioWetInkBrushReplay(overBudget, plan, {
      maximumSurfaceBytes: 1,
      surfaceFactory: () => {
        throw new Error("must not allocate");
      },
    })).toEqual({ status: "unavailable", reason: "surface-budget" });
    expect(overBudget.draws).toHaveLength(0);
  });

  it("prepares every surface before drawing and keeps factory failure atomic", () => {
    const plan = ready(stroke({ points: [0, 0, 40, 0], pressures: [0.5, 0.5] }));
    expect(plan.uploads.length).toBeGreaterThan(1);
    const destination = new FakeDestination();
    let allocations = 0;

    const result = renderStudioWetInkBrushReplay(destination, plan, {
      surfaceFactory: (width, height) => {
        allocations += 1;
        return allocations === 2 ? null : fakeSurface(width, height).surface;
      },
    });

    expect(result).toEqual({ status: "unavailable", reason: "surface-preparation-failed" });
    expect(destination.draws).toHaveLength(0);
  });

  it("never mutates destination for hidden, aborted or initially stale authority", () => {
    const plan = ready();
    for (const options of [
      { hidden: true },
      { signal: { aborted: true } },
      { expectedRevision: plan.revision + 1 },
      { currentRevision: plan.revision + 1 },
    ]) {
      const destination = new FakeDestination();
      let allocations = 0;
      const result = renderStudioWetInkBrushReplay(destination, plan, {
        ...options,
        surfaceFactory: (width, height) => {
          allocations += 1;
          return fakeSurface(width, height).surface;
        },
      });
      expect(result.status).toBe("skipped");
      expect(destination.draws).toHaveLength(0);
      expect(allocations).toBe(0);
    }
  });

  it("rechecks revision after offscreen preparation and discards stale tiles atomically", () => {
    const plan = ready();
    const destination = new FakeDestination();
    const surfaces: FakeSurfaceRecord[] = [];
    let reads = 0;

    const result = renderStudioWetInkBrushReplay(destination, plan, {
      expectedRevision: plan.revision,
      currentRevision: () => {
        reads += 1;
        return reads === 1 ? plan.revision : plan.revision + 1;
      },
      surfaceFactory: recordingFactory(surfaces),
    });

    expect(result).toEqual({ status: "skipped", reason: "stale-revision" });
    expect(destination.draws).toHaveLength(0);
    expect(surfaces).toHaveLength(plan.uploads.length);
    expect(surfaces.every((record) => record.surface.width === 1)).toBe(true);
  });

  it("marks a destination exception partial so callers cannot double-paint with another renderer", () => {
    const plan = ready();
    const destination = new FakeDestination();
    destination.throwOnDraw = true;
    const result = renderStudioWetInkBrushReplay(destination, plan, {
      surfaceFactory: recordingFactory([]),
    });
    expect(result).toEqual({
      status: "partial",
      reason: "destination-composite-failed",
    });
  });
});

describe("StudioDrawNode leaf integration boundary", () => {
  it("selects physical wet replay without a post-start renderer substitution", () => {
    const source = readFileSync(new URL("./StudioDrawNode.tsx", import.meta.url), "utf8");
    const plan = source.indexOf("planStudioInteractiveWetInkBrushReplay(");
    const ribbonPlan = source.indexOf("planStudioWetRibbonCarrier(", plan);
    const render = source.indexOf("renderStudioWetInkBrushReplay(", plan);
    const ribbonRender = source.indexOf(
      "traceStudioWetRibbonCarrierBatch(",
      render,
    );
    const legacyFallback = source.indexOf("for (const dab of dabs)", ribbonRender);

    expect(plan).toBeGreaterThan(-1);
    expect(ribbonPlan).toBeGreaterThan(plan);
    expect(render).toBeGreaterThan(plan);
    expect(render).toBeGreaterThan(ribbonPlan);
    expect(ribbonRender).toBeGreaterThan(ribbonPlan);
    expect(legacyFallback).toBeGreaterThan(ribbonRender);
    expect(source).toContain("wetInkReplayPlan?.ok");
    expect(source).toContain("if (wetRibbonPlan)");
    expect(source).toContain("A selected wet-ink replay never changes renderer");
    expect(source).not.toContain('wetInkResult.status !== "fallback"');
  });
});
