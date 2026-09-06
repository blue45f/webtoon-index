import { describe, expect, it, vi } from "vitest";

import {
  commitStudioSelectionFilterMaskTransaction,
  createStudioSelectionFilterMaskTransaction,
} from "./studio-selection-filter-mask-transaction";

import type {
  MaskCtx2DLike,
  PixelSelection,
  SelectionCanvasFactory,
} from "./studio-selection-tools";

type CanvasLog = {
  filters: string[];
  fills: number;
  draws: number;
};

function rectangleSelection(overrides: Partial<PixelSelection> = {}): PixelSelection {
  return {
    subpaths: [{
      mode: "add",
      points: [
        { x: 0.2, y: 0.25 },
        { x: 0.8, y: 0.25 },
        { x: 0.8, y: 0.75 },
        { x: 0.2, y: 0.75 },
      ],
    }],
    featherPx: 0,
    invert: false,
    ...overrides,
  };
}

function fakeCanvasFactory(log: CanvasLog): SelectionCanvasFactory {
  return (width, height) => {
    let filter = "none";
    const canvas = { width, height };
    const ctx: MaskCtx2DLike = {
      fillStyle: "",
      strokeStyle: "",
      globalCompositeOperation: "source-over",
      get filter() {
        return filter;
      },
      set filter(value: string) {
        filter = value;
        log.filters.push(value);
      },
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: () => {
        log.fills += 1;
      },
      clearRect: vi.fn(),
      drawImage: () => {
        log.draws += 1;
      },
    };
    return { canvas, ctx };
  };
}

function create(
  selection: PixelSelection | null,
  scope: "inside" | "outside",
  overrides: Partial<Parameters<typeof createStudioSelectionFilterMaskTransaction>[0]> = {},
) {
  const log: CanvasLog = { filters: [], fills: 0, draws: 0 };
  const result = createStudioSelectionFilterMaskTransaction({
    target: { id: "image-1", type: "image", width: 100 },
    selection,
    scope,
    imageWidth: 200,
    imageHeight: 120,
    filterPatch: {
      smartFilters: {
        version: 1,
        entries: [{
          id: "adjustment-1",
          engine: "brightness-contrast",
          enabled: true,
          params: { brightness: 0.2 },
        }],
      },
    },
    createCanvas: fakeCanvasFactory(log),
    serializeMask: (mask) => `data:image/png;base64,${mask.width}x${mask.height}`,
    ...overrides,
  });
  return { result, log };
}

describe("selection -> filter-mask transaction", () => {
  it("keeps inside/outside and an already inverted selection in XOR semantics", () => {
    const inside = create(rectangleSelection(), "inside").result;
    const outside = create(rectangleSelection(), "outside").result;
    const invertedInside = create(rectangleSelection({ invert: true }), "inside").result;
    const invertedOutside = create(rectangleSelection({ invert: true }), "outside").result;

    expect(inside.ok && inside.transaction.maskPlan.invert).toBe(false);
    expect(outside.ok && outside.transaction.maskPlan.invert).toBe(true);
    expect(invertedInside.ok && invertedInside.transaction.maskPlan.invert).toBe(true);
    expect(invertedOutside.ok && invertedOutside.transaction.maskPlan.invert).toBe(false);
  });

  it("preserves display-pixel feathering at the natural-image scale", () => {
    const { result, log } = create(rectangleSelection({ featherPx: 6 }), "inside");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.maskPlan.featherPx).toBe(12);
    expect(log.filters).toContain("blur(12px)");
    expect(log.draws).toBe(1);
  });

  it("commits the filter stack and paintable PNG mask as one undo payload", () => {
    const { result } = create(rectangleSelection(), "inside");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const commit = vi.fn(() => true);

    expect(commitStudioSelectionFilterMaskTransaction(result.transaction, commit)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "image-1",
      historyEntryCount: 1,
      historyLabel: "필터 · 선택 안에 적용",
      patch: expect.objectContaining({
        filterMaskEnabled: true,
        filterMaskSrc: "data:image/png;base64,200x120",
        smartFilters: expect.objectContaining({ version: 1 }),
      }),
    }));
  });

  it("rejects empty selections and locked targets without creating a commit", () => {
    const empty = create(null, "inside").result;
    const subtractOnly = create({
      subpaths: [{
        mode: "subtract",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      }],
      featherPx: 0,
      invert: false,
    }, "inside").result;
    const locked = create(rectangleSelection(), "inside", {
      mutationLocked: true,
    }).result;

    expect(empty).toMatchObject({ ok: false, code: "empty-selection" });
    expect(subtractOnly).toMatchObject({ ok: false, code: "empty-selection" });
    expect(locked).toMatchObject({ ok: false, code: "locked-target" });
  });

  it("emits a portable JSON patch and rejects non-PNG or throwing serializers", () => {
    const { result } = create(rectangleSelection(), "outside");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(result.transaction.patch)) as Record<string, unknown>;

    expect(roundTrip.filterMaskSrc).toBe("data:image/png;base64,200x120");
    expect(roundTrip.filterMaskEnabled).toBe(true);
    expect(roundTrip.smartFilters).toEqual(result.transaction.patch.smartFilters);
    expect(roundTrip).not.toHaveProperty("filterMaskSurfaceId");

    expect(create(rectangleSelection(), "inside", {
      serializeMask: () => "blob:render-only",
    }).result).toMatchObject({ ok: false, code: "mask-serialization-failed" });
    expect(create(rectangleSelection(), "inside", {
      serializeMask: () => {
        throw new Error("tainted");
      },
    }).result).toMatchObject({ ok: false, code: "mask-serialization-failed" });
  });
});
