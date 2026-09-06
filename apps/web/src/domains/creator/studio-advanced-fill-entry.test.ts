import { describe, expect, it, vi } from "vitest";

import { resolveStudioAdvancedFillEntry } from "./studio-advanced-fill-entry";

import type { DrawEl, El } from "./studio-element-model";
import type { StudioAdvancedFillVectorTargetInput } from "./studio-vector-fill-reference";

interface RasterCandidate {
  readonly id: string;
  readonly unusableReason?: string;
}

function line(id = "line-1"): DrawEl {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 40, 40],
    stroke: "#111111",
    strokeWidth: 4,
  };
}

function vectorInput(elements: readonly El[] = [line()]): StudioAdvancedFillVectorTargetInput {
  return {
    pageId: "page-1",
    width: 800,
    height: 1200,
    elements,
    name: "벡터 채색",
  };
}

function resolve(
  rasterLayers: readonly RasterCandidate[],
  options: {
    readonly selectedRasterId?: string | null;
    readonly elements?: readonly El[];
    readonly unsupportedReason?: (raster: RasterCandidate) => string | null;
  } = {},
) {
  return resolveStudioAdvancedFillEntry({
    selectedRasterId: options.selectedRasterId ?? null,
    rasterLayers,
    getRasterUnsupportedReason:
      options.unsupportedReason ?? ((raster) => raster.unusableReason ?? null),
    vectorInput: vectorInput(options.elements),
  });
}

describe("Studio Advanced Fill entry decision", () => {
  it("prefers the selected eligible raster even when other raster targets exist", () => {
    const decision = resolve([{ id: "image-a" }, { id: "image-b" }], {
      selectedRasterId: "image-b",
    });

    expect(decision).toMatchObject({
      mode: "selected-raster",
      target: { id: "image-b" },
    });
  });

  it("auto-selects exactly one eligible raster and evaluates each target policy once", () => {
    const getRasterUnsupportedReason = vi.fn((raster: RasterCandidate) =>
      raster.unusableReason ?? null);
    const decision = resolve(
      [{ id: "hidden", unusableReason: "숨긴 레이어" }, { id: "editable" }],
      { unsupportedReason: getRasterUnsupportedReason },
    );

    expect(decision).toMatchObject({
      mode: "auto-select-raster",
      target: { id: "editable" },
      ineligibleRasters: [{ raster: { id: "hidden" }, reason: "숨긴 레이어" }],
    });
    expect(getRasterUnsupportedReason).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit choice for multiple eligible rasters before considering vectors", () => {
    const decision = resolve([{ id: "image-a" }, { id: "image-b" }]);

    expect(decision).toMatchObject({
      mode: "ambiguous-raster",
      candidates: [{ id: "image-a" }, { id: "image-b" }],
    });
    expect("target" in decision ? decision.target : null).toBeNull();
  });

  it.each([
    ["hidden", "숨긴 레이어"],
    ["locked", "잠긴 레이어"],
    ["animated", "애니메이션 레이어"],
    ["immutable", "원본 소재는 직접 편집할 수 없음"],
  ])("falls back to visible vectors when the only raster is %s", (id, unusableReason) => {
    const decision = resolve([{ id, unusableReason }]);

    expect(decision).toMatchObject({
      mode: "virtual-vector-fill",
      target: { pageId: "page-1", sourceElementCount: 1 },
      ineligibleRasters: [{ raster: { id }, reason: unusableReason }],
    });
  });

  it("returns the vector planner failure when neither eligible rasters nor visible vectors exist", () => {
    const decision = resolve(
      [{ id: "locked", unusableReason: "잠긴 레이어" }],
      { selectedRasterId: "locked", elements: [] },
    );

    expect(decision).toMatchObject({
      mode: "unavailable",
      vectorFailure: { ok: false, code: "no-visible-vector-draw" },
      ineligibleRasters: [{ raster: { id: "locked" }, reason: "잠긴 레이어" }],
    });
  });

  it("does not let a selected ineligible raster outrank another unique eligible target", () => {
    const decision = resolve(
      [
        { id: "selected-hidden", unusableReason: "숨긴 레이어" },
        { id: "editable" },
      ],
      { selectedRasterId: "selected-hidden" },
    );

    expect(decision).toMatchObject({
      mode: "auto-select-raster",
      target: { id: "editable" },
    });
  });
});
