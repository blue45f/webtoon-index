import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import { isValidStudioGpuStroke, planStudioGpuDabUpdate } from "./studio-webgpu-dab-planner";
import {
  planStudioGpuLiveStroke,
  STUDIO_GPU_MAX_LIVE_SYMMETRY_DIRECTIONS,
} from "./studio-webgpu-live-stroke-plan";
import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  buildStudioGpuLiveStroke,
  orderStudioGpuStrokes,
  sameStudioGpuStroke,
  sameStudioGpuStrokes,
  snapshotStudioGpuStroke,
  snapshotStudioGpuStrokes,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";
import { createStudioGpuStrokeFeedBaseline } from "./studio-webgpu-stroke-feed";
import { signatureStudioGpuStroke } from "./studio-webgpu-tile-plan";

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "ink",
    points: [0, 0, 12, 8],
    pressures: [0.25, 0.75],
    color: "#123456",
    size: 6,
    opacity: 1,
    composite: "normal",
    ...overrides,
  };
}

describe("studio WebGPU stroke authority helpers", () => {
  it("keeps every curved live sample immutable when one point is appended", () => {
    const sharedPoints = [0, 0, 8, 5, 17, 13, 25, 6];
    const sharedPressures = [0.2, Number.NaN, 1.4, 0.7];
    const before = buildStudioGpuLiveStroke({
      id: "live-ink",
      points: sharedPoints,
      pressures: sharedPressures,
      color: "#123456",
      size: 6,
      opacity: 0.8,
      composite: "normal",
    });
    const after = buildStudioGpuLiveStroke({
      id: "live-ink",
      points: [...sharedPoints, 31, -4],
      pressures: [...sharedPressures, -0.2],
      color: "#123456",
      size: 6,
      opacity: 0.8,
      composite: "normal",
    });

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.points.slice(0, before!.points.length)).toEqual(before!.points);
    expect(after!.pressures?.slice(0, before!.pressures!.length)).toEqual(before!.pressures);
    expect(before!.pressures).toEqual([0.2, 0.5, 1, 0.7]);
    expect(after!.pressures).toEqual([0.2, 0.5, 1, 0.7, 0]);
    expect(planStudioGpuDabUpdate([before!], [after!]).mode).toBe("append");
  });

  it("copies only the finite coordinate-pair prefix and keeps a one-point tap", () => {
    expect(buildStudioGpuLiveStroke({
      id: "tap",
      points: [4, 7, 12],
      pressures: [0.8],
      color: "#000000",
      size: 4,
    })).toMatchObject({
      points: [4, 7],
      pressures: [0.8],
    });

    expect(buildStudioGpuLiveStroke({
      id: "finite-prefix",
      points: [0, 0, 4, 6, Number.POSITIVE_INFINITY, 8, 10, 12],
      pressures: [0.75],
      color: "#000000",
      size: 4,
    })).toMatchObject({
      points: [0, 0, 4, 6],
      pressures: [0.75, 0.5],
    });

    expect(buildStudioGpuLiveStroke({
      id: "float32-overflow",
      points: [1e100, 0],
      pressures: [0.5],
      color: "#000000",
      size: 4,
    })).toBeNull();
    expect(isValidStudioGpuStroke(stroke({ points: [1e100, 0] }))).toBe(false);
    expect(planStudioGpuLiveStroke({
      id: "overflow-symmetry",
      points: [1, 0],
      pressures: [0.5],
      color: "#000000",
      size: 4,
      symmetry: { type: "vertical", centerX: 1e100, centerY: 0 },
    })).toBeNull();
  });

  it("extends a one-point tap through the append-only GPU update path", () => {
    const tap = buildStudioGpuLiveStroke({
      id: "tap",
      points: [4, 7],
      pressures: [0.8],
      color: "#000000",
      size: 4,
    });
    const moved = buildStudioGpuLiveStroke({
      id: "tap",
      points: [4, 7, 12, 9],
      pressures: [0.8, 0.6],
      color: "#000000",
      size: 4,
    });

    expect(tap).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(planStudioGpuDabUpdate([tap!], [moved!]).mode).toBe("append");
  });

  it("threads the versioned pressure model through live snapshots and authority equality", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const live = buildStudioGpuLiveStroke({
      id: "linear-live",
      points: [1, 2, 3, 4],
      pressures: [0, 1],
      color: "#000000",
      size: 12,
      pressureModel,
    });

    expect(live?.pressureModel).toBe(pressureModel);
    expect(snapshotStudioGpuStrokes([live!])[0]?.pressureModel).toBe(pressureModel);
    expect(sameStudioGpuStroke(live!, { ...live!, pressureModel: undefined })).toBe(false);
    expect(planStudioGpuDabUpdate(
      [{ ...live!, pressureModel: undefined }],
      [live!]
    ).mode).toBe("rebuild");
  });

  it("fills short live pressure arrays with model-specific nominal pressure", () => {
    const linear = buildStudioGpuLiveStroke({
      id: "linear-short",
      points: [0, 0, 10, 0],
      pressures: [0],
      color: "#000000",
      size: 10,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    });
    const legacy = buildStudioGpuLiveStroke({
      id: "legacy-short",
      points: [0, 0, 10, 0],
      pressures: [0],
      color: "#000000",
      size: 10,
    });

    expect(linear?.pressures).toEqual([0, 1]);
    expect(legacy?.pressures).toEqual([0, 0.5]);
  });

  it("accepts independently allocated but exactly equivalent operations", () => {
    expect(sameStudioGpuStroke(stroke(), stroke({
      points: [0, 0, 12, 8],
      pressures: [0.25, 0.75],
    }))).toBe(true);
    expect(sameStudioGpuStrokes([stroke()], [stroke()])).toBe(true);
  });

  it.each([
    ["point", stroke({ points: [0, 0, 12, 9] })],
    ["pressure", stroke({ pressures: [0.25, 0.8] })],
    ["pressure model", stroke({ pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 })],
    ["style", stroke({ opacity: 0.99 })],
    ["order", stroke({ orderKey: "front" })],
  ] as const)("rejects a changed %s without relying on fingerprints", (_label, changed) => {
    expect(sameStudioGpuStroke(stroke(), changed)).toBe(false);
  });

  it.each([
    ["id", { id: "other" }],
    ["color", { color: "#ffffff" }],
    ["size", { size: 7 }],
    ["pressure model", { pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 }],
    ["opacity", { opacity: 0.5 }],
    ["composite", { composite: "erase" as const }],
    ["order", { orderKey: "other-order" }],
  ] as const)("does not let a preserved feed token hide a changed %s", (_label, patch) => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "authority-style")!;
    const fed = baseline[0]!;
    expect(sameStudioGpuStroke(fed, { ...fed, ...patch })).toBe(false);
  });

  it("does not trust feed metadata copied onto an unregistered wrapper", () => {
    const fed = createStudioGpuStrokeFeedBaseline([stroke()], "authority-provenance")![0]!;
    const copied = Object.freeze({
      ...fed,
      points: Object.freeze([99, 99, 100, 100]),
      pressures: Object.freeze([1, 1]),
      [STUDIO_GPU_STROKE_FEED_REVISION]: fed[STUDIO_GPU_STROKE_FEED_REVISION],
    });

    expect(isValidStudioGpuStroke(fed)).toBe(true);
    expect(isValidStudioGpuStroke(copied)).toBe(false);
    expect(signatureStudioGpuStroke(fed)).toMatch(/^feed:/u);
    expect(signatureStudioGpuStroke(copied)).not.toMatch(/^feed:/u);
  });

  it("deep-snapshots mutable arrays even when a caller forges trusted feed metadata", () => {
    const points = [0, 0, 12, 8];
    const pressures = [0.25, 0.75];
    const fake = stroke({
      points,
      pressures,
      [STUDIO_GPU_STROKE_FEED_REVISION]: {
        trustedImmutable: true,
      } as StudioGpuStroke[typeof STUDIO_GPU_STROKE_FEED_REVISION],
    });

    const snapshot = snapshotStudioGpuStroke(fake);
    points[0] = 99;
    pressures[0] = 1;

    expect(snapshot).not.toBe(fake);
    expect(snapshot.points[0]).toBe(0);
    expect(snapshot.pressures?.[0]).toBe(0.25);
  });

  it("keeps genuine registered feed wrappers zero-copy at the snapshot boundary", () => {
    const fed = createStudioGpuStrokeFeedBaseline([stroke()], "authority-zero-copy")![0]!;

    expect(snapshotStudioGpuStroke(fed)).toBe(fed);
  });

  it("deep-snapshots mutable pointer arrays at the receipt boundary", () => {
    const points = [0, 0, 12, 8];
    const pressures = [0.25, 0.75];
    const source = [stroke({ points, pressures })];
    const snapshot = snapshotStudioGpuStrokes(source);

    points.push(20, 20);
    pressures.push(1);

    expect(snapshot[0]?.points).toEqual([0, 0, 12, 8]);
    expect(snapshot[0]?.pressures).toEqual([0.25, 0.75]);
    expect(sameStudioGpuStrokes(snapshot, source)).toBe(false);
  });

  it("prepares translucent destination-out symmetry as independent deterministic operations", () => {
    const plan = planStudioGpuLiveStroke({
      id: "erase-live",
      points: [2, 3, 8, 11],
      pressures: [0.25, 0.75],
      color: "transparent",
      size: 6,
      opacity: 0.4,
      composite: "erase",
      destination: "retained-layer",
      orderKey: "operation:9",
      symmetry: {
        type: "vertical",
        centerX: 10,
        centerY: 20,
      },
    });

    expect(plan).toMatchObject({
      preparation: {
        composite: "erase",
        opacity: 0.4,
        symmetry: "expanded",
        geometry: "source",
        destination: "retained-layer",
      },
      sourcePointCount: 2,
      renderedPointCount: 2,
      variationCount: 2,
    });
    expect(plan?.strokes).toEqual([
      expect.objectContaining({
        id: "erase-live",
        points: [2, 3, 8, 11],
        pressures: [0.25, 0.75],
        composite: "erase",
        opacity: 0.4,
        orderKey: "operation:9",
      }),
      expect.objectContaining({
        id: "erase-live:gpu-symmetry:1",
        points: [18, 3, 12, 11],
        pressures: [0.25, 0.75],
        composite: "erase",
        opacity: 0.4,
        orderKey: "operation:9",
      }),
    ]);
    expect(orderStudioGpuStrokes([
      ...plan!.strokes,
      stroke({ id: "next-operation", orderKey: "operation:9z" }),
    ]).map(({ id }) => id)).toEqual([
      "erase-live",
      "erase-live:gpu-symmetry:1",
      "next-operation",
    ]);
    const dabs = planStudioGpuDabUpdate([], plan!.strokes);
    expect(dabs.complete).toBe(true);
    expect(dabs.batches.map(({ composite }) => composite)).toEqual(["erase"]);
    expect(dabs.dabs.every(({ alpha, composite }) => (
      composite === "erase" && alpha === 0.4
    ))).toBe(true);
  });

  it("expands radial and kaleidoscope variants in stable source-first order", () => {
    const input = {
      id: "kaleido",
      points: [2, 1, 1, 2],
      pressures: [0.5, 0.75],
      color: "#123456",
      size: 6,
      symmetry: {
        type: "kaleidoscope" as const,
        centerX: 1,
        centerY: 1,
        radialCount: 4,
      },
    };
    const first = planStudioGpuLiveStroke(input);
    const second = planStudioGpuLiveStroke(input);

    expect(first?.variationCount).toBe(8);
    expect(first?.strokes.map(({ id }) => id)).toEqual([
      "kaleido",
      "kaleido:gpu-symmetry:1",
      "kaleido:gpu-symmetry:2",
      "kaleido:gpu-symmetry:3",
      "kaleido:gpu-symmetry:4",
      "kaleido:gpu-symmetry:5",
      "kaleido:gpu-symmetry:6",
      "kaleido:gpu-symmetry:7",
    ]);
    expect(first?.strokes.map(({ points }) => points)).toEqual(
      second?.strokes.map(({ points }) => points)
    );
    expect(first?.strokes[1]?.points.map((value) => (
      Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(10))
    ))).toEqual([1, 2, 0, 1]);
  });

  it("uses final post-corrected points and pressures without retaining predicted source geometry", () => {
    const plan = planStudioGpuLiveStroke({
      id: "corrected",
      points: [0, 0, 10, 5, 20, -3],
      pressures: [0.2, 0.4, 0.6],
      correctedPoints: [0, 0, 9, 2, 18, 1, 24, 0],
      correctedPressures: [0.2, 0.5, 0.75, 0.9],
      color: "rgba(10, 20, 30, 0.8)",
      size: 7,
      opacity: 0.5,
    });

    expect(plan).toMatchObject({
      preparation: {
        composite: "normal",
        opacity: 0.5,
        symmetry: "identity",
        geometry: "post-corrected",
        destination: "transparent-overlay",
      },
      sourcePointCount: 3,
      renderedPointCount: 4,
      variationCount: 1,
    });
    expect(plan?.strokes[0]).toMatchObject({
      points: [0, 0, 9, 2, 18, 1, 24, 0],
      pressures: [0.2, 0.5, 0.75, 0.9],
      opacity: 0.5,
      composite: "normal",
    });
    const rendered = planStudioGpuDabUpdate([], plan!.strokes);
    // rgba color alpha (0.8) and element opacity (0.5) are multiplied once before premultiplication.
    expect(rendered.dabs.every(({ alpha }) => Math.abs(alpha - 0.4) < 1e-10)).toBe(true);
  });

  it.each([
    ["invalid color", { color: "currentColor" }],
    ["invalid opacity", { opacity: 1.2 }],
    ["invalid composite", { composite: "multiply" }],
    ["non-finite symmetry center", {
      symmetry: { type: "vertical", centerX: Number.NaN, centerY: 0 },
    }],
    ["unbounded radial count", {
      symmetry: {
        type: "radial",
        centerX: 0,
        centerY: 0,
        radialCount: STUDIO_GPU_MAX_LIVE_SYMMETRY_DIRECTIONS + 1,
      },
    }],
    ["orphan corrected pressure", { correctedPressures: [0.5] }],
    ["odd corrected coordinate", { correctedPoints: [0, 0, 1] }],
    ["mismatched corrected pressure", {
      correctedPoints: [0, 0, 1, 1, 2, 2],
      correctedPressures: [0.5, 0.6],
    }],
    ["unsupported stroke-local paint model", { paintModel: "layered-flow-v1" }],
  ] as const)("fails closed for %s instead of emitting a partial GPU operation", (
    _label,
    overrides
  ) => {
    expect(planStudioGpuLiveStroke({
      id: "invalid",
      points: [0, 0, 1, 1],
      pressures: [0.5, 0.5],
      color: "#000000",
      size: 4,
      ...overrides,
    } as Parameters<typeof planStudioGpuLiveStroke>[0])).toBeNull();
  });
});
