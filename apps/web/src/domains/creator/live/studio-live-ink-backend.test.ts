import { describe, expect, it } from "vitest";

import {
  decideStudioLiveInkBackend,
  resolveStudioLiveInkBackendPreference,
  type StudioLiveInkBackendDecisionInput,
} from "./studio-live-ink-backend";

import type { StudioGpuLiveStrokePreparation } from "../render/studio-webgpu-live-stroke-plan";

function eligible(
  overrides: Partial<StudioLiveInkBackendDecisionInput> = {}
): StudioLiveInkBackendDecisionInput {
  return {
    preference: "webgpu",
    resolvedBackend: "webgpu",
    direct: true,
    postCorrectionActive: false,
    mode: "pen",
    fill: undefined,
    opacity: 1,
    symmetryType: "none",
    ...overrides,
  };
}

function prepared(
  overrides: Partial<StudioGpuLiveStrokePreparation> = {}
): StudioGpuLiveStrokePreparation {
  return {
    composite: "normal",
    opacity: 1,
    symmetry: "identity",
    geometry: "source",
    destination: "transparent-overlay",
    ...overrides,
  };
}

describe("studio live-ink backend policy", () => {
  it("selects WebGPU for absent and legacy auto configuration", () => {
    expect(resolveStudioLiveInkBackendPreference(undefined)).toBe("webgpu");
    expect(resolveStudioLiveInkBackendPreference(null)).toBe("webgpu");
    expect(resolveStudioLiveInkBackendPreference("")).toBe("webgpu");
    expect(resolveStudioLiveInkBackendPreference("auto")).toBe("webgpu");
    expect(decideStudioLiveInkBackend(eligible())).toEqual({
      status: "ready",
      backend: "webgpu",
      selectedBackend: "webgpu",
      reason: "webgpu-ready",
    });
  });

  it("keeps Canvas2D explicit and does not turn typos into a fallback", () => {
    expect(resolveStudioLiveInkBackendPreference("webgpu")).toBe("webgpu");
    expect(resolveStudioLiveInkBackendPreference("canvas2d")).toBe("canvas2d");
    expect(resolveStudioLiveInkBackendPreference("web-gpu")).toBe("webgpu");
    expect(decideStudioLiveInkBackend(eligible({ preference: "canvas2d" }))).toEqual({
      status: "ready",
      backend: "canvas2d",
      selectedBackend: "canvas2d",
      reason: "canvas2d-explicit",
    });
  });

  it("reports selected WebGPU unavailable without starting Canvas2D", () => {
    expect(decideStudioLiveInkBackend(eligible({ resolvedBackend: null }))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason: "backend-unavailable",
    });
    expect(decideStudioLiveInkBackend(eligible({ resolvedBackend: "canvas2d" }))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason: "backend-unavailable",
    });
  });

  it.each([
    ["unsupported draft", { direct: false }, "unsupported-draft"],
    ["post correction", { postCorrectionActive: true }, "post-correction"],
    ["eraser", { mode: "eraser" }, "eraser"],
    ["fill", { fill: "#fff" }, "fill"],
    ["translucency", { opacity: 0.7 }, "opacity"],
    ["invalid opacity", { opacity: Number.NaN }, "opacity"],
    ["symmetry", { symmetryType: "vertical" }, "symmetry"],
  ] as const)("marks selected WebGPU unavailable for %s", (_label, overrides, reason) => {
    expect(decideStudioLiveInkBackend(eligible(overrides))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason,
    });
  });

  it("keeps explicit WebGPU capability-gated rather than substituting Canvas2D", () => {
    expect(decideStudioLiveInkBackend(eligible({ preference: "webgpu" })).backend).toBe("webgpu");
    expect(decideStudioLiveInkBackend(eligible({
      preference: "webgpu",
      resolvedBackend: "canvas2d",
    }))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason: "backend-unavailable",
    });
  });

  it.each([
    [
      "destination-out erasing",
      {
        direct: false,
        mode: "eraser",
        preparedStroke: prepared({ composite: "erase", destination: "retained-layer" }),
      },
    ],
    [
      "premultiplied partial opacity",
      { direct: false, opacity: 0.35, preparedStroke: prepared({ opacity: 0.35 }) },
    ],
    [
      "deterministically expanded symmetry",
      {
        direct: false,
        symmetryType: "kaleidoscope",
        preparedStroke: prepared({ symmetry: "expanded" }),
      },
    ],
    [
      "final post-corrected geometry",
      {
        direct: false,
        postCorrectionActive: true,
        preparedStroke: prepared({ geometry: "post-corrected" }),
      },
    ],
  ] as const)("selects WebGPU for %s only after exact stroke preparation", (_label, overrides) => {
    expect(decideStudioLiveInkBackend(eligible(overrides))).toEqual({
      status: "ready",
      backend: "webgpu",
      selectedBackend: "webgpu",
      reason: "webgpu-ready",
    });
  });

  it.each([
    [
      "eraser composite",
      { mode: "eraser", preparedStroke: prepared() },
      "eraser",
    ],
    [
      "opacity",
      { opacity: 0.4, preparedStroke: prepared({ opacity: 0.5 }) },
      "opacity",
    ],
    [
      "symmetry expansion",
      { symmetryType: "vertical", preparedStroke: prepared() },
      "symmetry",
    ],
    [
      "corrected geometry",
      { postCorrectionActive: true, preparedStroke: prepared() },
      "post-correction",
    ],
  ] as const)("fails safe when prepared %s does not match the requested draft", (
    _label,
    overrides,
    reason
  ) => {
    expect(decideStudioLiveInkBackend(eligible(overrides))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason,
    });
  });

  it("rejects malformed preparation metadata instead of trusting a partial capability claim", () => {
    expect(decideStudioLiveInkBackend(eligible({
      preparedStroke: {
        ...prepared(),
        geometry: "predicted",
      } as unknown as StudioGpuLiveStrokePreparation,
    }))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason: "invalid-preparation",
    });
  });

  it("keeps an eraser off a transparent overlay that cannot punch through committed pixels", () => {
    expect(decideStudioLiveInkBackend(eligible({
      direct: false,
      mode: "eraser",
      preparedStroke: prepared({ composite: "erase" }),
    }))).toEqual({
      status: "unavailable",
      backend: null,
      selectedBackend: "webgpu",
      reason: "eraser",
    });
  });
});
