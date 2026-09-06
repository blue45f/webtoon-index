import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import {
  planStudioWebGpuCommittedSuffix,
  studioWebGpuCommittedBarrierReason,
  type StudioWebGpuCommittedElementInput,
  type StudioWebGpuCommittedGateReason,
  type StudioWebGpuCommittedPlanGates,
} from "./studio-webgpu-committed-plan";

function draw(
  id: string,
  overrides: Partial<StudioWebGpuCommittedElementInput> = {}
): StudioWebGpuCommittedElementInput {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 20, 10],
    pressures: [0.5, 0.8],
    stroke: "#221100",
    strokeWidth: 6,
    opacity: 1,
    brush: "pen",
    sampleSpacing: 0,
    panelClip: "none",
    ...overrides,
  };
}

function scene(
  id: string,
  overrides: Partial<StudioWebGpuCommittedElementInput> = {}
): StudioWebGpuCommittedElementInput {
  return {
    id,
    type: "text",
    panelClip: "none",
    ...overrides,
  };
}

describe("planStudioWebGpuCommittedSuffix", () => {
  it("selects only the frontmost visible eligible suffix and preserves back-to-front order", () => {
    const lowerPen = draw("lower-pen");
    const sceneBarrier = scene("scene-barrier");
    const frontPenA = draw("front-a");
    const hiddenScene = scene("hidden-scene", { hidden: true });
    const frontPenB = draw("front-b", { brush: "fineliner" });

    const plan = planStudioWebGpuCommittedSuffix({
      elements: [lowerPen, sceneBarrier, frontPenA, hiddenScene, frontPenB],
    });

    expect(plan).toMatchObject({
      status: "ready",
      elementIds: ["front-a", "front-b"],
      gateReason: null,
      frontBarrier: null,
      lowerBarrier: { elementId: "scene-barrier", reason: "non-draw" },
    });
    expect(plan.elements).toEqual([frontPenA, frontPenB]);
    expect(plan.elements[0]).toBe(frontPenA);
    expect(plan.elements[1]).toBe(frontPenB);
  });

  it("treats a legacy segment stroke as a lower barrier only when requireCausalGeometry is set", () => {
    const lowerLegacy = draw("lower-legacy", { sampleSpacing: undefined, pressureModel: undefined });
    const frontCausal = draw("front-causal");

    expect(planStudioWebGpuCommittedSuffix({
      elements: [lowerLegacy, frontCausal],
    }).elementIds).toEqual(["lower-legacy", "front-causal"]);

    expect(planStudioWebGpuCommittedSuffix({
      elements: [lowerLegacy, frontCausal],
      barrierOptions: { requireCausalGeometry: true },
    })).toMatchObject({
      elementIds: ["front-causal"],
      lowerBarrier: { elementId: "lower-legacy", reason: "invalid-geometry" },
    });
  });

  it("fails closed when the frontmost visible element is a non-draw barrier", () => {
    const plan = planStudioWebGpuCommittedSuffix({
      elements: [draw("ink"), scene("caption")],
    });

    expect(plan).toEqual({
      status: "empty",
      elements: [],
      elementIds: [],
      gateReason: null,
      frontBarrier: { elementId: "caption", reason: "non-draw" },
      lowerBarrier: null,
    });
  });

  it("skips hidden barriers but returns empty for an entirely hidden scene", () => {
    expect(planStudioWebGpuCommittedSuffix({
      elements: [draw("ink"), scene("hidden-front", { hidden: true })],
    }).elementIds).toEqual(["ink"]);

    expect(planStudioWebGpuCommittedSuffix({
      elements: [draw("hidden-ink", { hidden: true }), scene("hidden-scene", { hidden: true })],
    })).toMatchObject({ status: "empty", frontBarrier: null, elementIds: [] });
  });

  it.each([
    ["exportActive", "export"],
    ["masterEditActive", "master-edit"],
    ["editActive", "edit"],
    ["specialDraftActive", "special-draft"],
    ["postProcessingActive", "post-processing"],
  ] as const)("gates the whole handoff when %s is active", (gate, reason) => {
    const gates: StudioWebGpuCommittedPlanGates = { [gate]: true };
    const plan = planStudioWebGpuCommittedSuffix({ elements: [draw("ink")], gates });

    expect(plan).toEqual({
      status: "gated",
      elements: [],
      elementIds: [],
      gateReason: reason satisfies StudioWebGpuCommittedGateReason,
      frontBarrier: null,
      lowerBarrier: null,
    });
  });

  it.each([
    ["eraser", { mode: "eraser" }, "non-pen-mode"],
    ["shape", { kind: "rect" }, "non-freehand"],
    ["partial opacity", { opacity: 0.8 }, "opacity"],
    ["multiply", { blendMode: "multiply" }, "blend-mode"],
    ["panel clip", { panelClip: "clipped" }, "panel-clip"],
    ["unknown panel clip", { panelClip: "unknown" }, "panel-clip"],
    ["mask source", { maskSrc: "data:image/png;base64,mask" }, "mask"],
    ["enabled mask", { maskEnabled: true }, "mask"],
    ["clip below", { clipBelow: true }, "mask"],
    ["alpha lock", { alphaLocked: true }, "mask"],
    ["symmetry", { symmetry: { type: "vertical" } }, "symmetry"],
    ["malformed symmetry", { symmetry: null }, "symmetry"],
    ["unknown brush", { brush: "future-super-brush" }, "unsupported-brush"],
    ["dynamic brush", { brush: "ink-particle" }, "unsupported-brush"],
    ["pixel pencil", { brush: "pixel-grid-v1" }, "unsupported-brush"],
    ["unknown pressure model", { pressureModel: "linear-full-v2" }, "unsupported-pressure-model"],
    ["layered paint model", { paintModel: "layered-flow-v1", sampleSpacing: 0 }, "paint-model"],
    ["layered marker paint model", { brush: "marker", paintModel: "layered-flow-v1", sampleSpacing: 0 }, "paint-model"],
    ["unknown paint model", { paintModel: "layered-flow-v2" }, "unsupported-style"],
    ["fill metadata", { fill: "#ff0000" }, "unsupported-style"],
  ] as const)("treats %s as a hard front barrier", (_label, overrides, reason) => {
    const blocked = draw("blocked", overrides);
    const plan = planStudioWebGpuCommittedSuffix({ elements: [draw("lower"), blocked] });

    expect(plan).toMatchObject({
      status: "empty",
      elementIds: [],
      frontBarrier: { elementId: "blocked", reason },
    });
  });

  it.each([
    ["single point", { points: [0, 0], pressures: [0.5] }],
    ["odd points", { points: [0, 0, 10] }],
    ["non-finite points", { points: [0, 0, Number.NaN, 10] }],
    ["missing pressure", { pressures: undefined }],
    ["misaligned pressure", { pressures: [0.5] }],
    ["out-of-range pressure", { pressures: [0.5, 1.1] }],
    ["non-finite pressure", { pressures: [0.5, Number.POSITIVE_INFINITY] }],
    ["empty stroke", { stroke: "" }],
    ["named CSS color", { stroke: "red" }],
    ["HSL color", { stroke: "hsl(0 100% 50%)" }],
    ["malformed hex", { stroke: "#ggg" }],
    ["empty RGB numbers", { stroke: "rgb(. . .)" }],
    ["ambiguous RGB number", { stroke: "rgba(1.2.3, 0, 0, 1)" }],
    ["signed empty RGB numbers", { stroke: "rgb(+. +. +.)" }],
    ["zero width", { strokeWidth: 0 }],
  ] as const)("rejects invalid GPU geometry: %s", (_label, overrides) => {
    expect(studioWebGpuCommittedBarrierReason(draw("invalid", overrides))).toBe("invalid-geometry");
  });

  it("allows legacy segment geometry when the caller does not require causal geometry", () => {
    expect(studioWebGpuCommittedBarrierReason(draw("legacy-segments", {
      sampleSpacing: undefined,
      pressureModel: undefined,
    }))).toBeNull();
  });

  it("rejects legacy segment geometry only when the caller requires causal geometry", () => {
    const options = { requireCausalGeometry: true };
    expect(studioWebGpuCommittedBarrierReason(draw("legacy-segments", {
      sampleSpacing: undefined,
      pressureModel: undefined,
    }), options)).toBe("invalid-geometry");
    expect(studioWebGpuCommittedBarrierReason(draw("legacy-segments-nan", {
      sampleSpacing: Number.NaN,
      pressureModel: undefined,
    }), options)).toBe("invalid-geometry");
    expect(studioWebGpuCommittedBarrierReason(draw("causal-spacing-only", {
      sampleSpacing: 0,
      pressureModel: undefined,
    }), options)).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("causal-pressure-model-only", {
      sampleSpacing: undefined,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    }), options)).toBeNull();
  });

  it("allows the explicit supported brushes and the omitted brush alias only", () => {
    expect(studioWebGpuCommittedBarrierReason(draw("pen"))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("fineliner", { brush: "fineliner" }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("legacy", { brush: undefined }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("null", { brush: null }))).toBe("unsupported-brush");
  });

  it("allows only the explicit versioned pressure model or omitted legacy semantics", () => {
    expect(studioWebGpuCommittedBarrierReason(draw("legacy"))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("linear", {
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("linear-missing", {
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      pressures: undefined,
    }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("linear-short", {
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      pressures: [0],
    }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("null", { pressureModel: null })))
      .toBe("unsupported-pressure-model");
  });

  it("accepts only color forms with exact compositor parser parity", () => {
    expect(studioWebGpuCommittedBarrierReason(draw("hex", { stroke: "#f06a" }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("rgba", {
      stroke: "rgba(255, 0, 128, 0.75)",
    }))).toBeNull();
    expect(studioWebGpuCommittedBarrierReason(draw("rgb-space", {
      stroke: "rgb(255 0 128 / 75%)",
    }))).toBeNull();
  });
});
