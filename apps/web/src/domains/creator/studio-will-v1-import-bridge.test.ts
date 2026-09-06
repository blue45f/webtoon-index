import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  inspectStudioWillV1Import,
  prepareStudioWillV1ImportCommit,
  STUDIO_WILL_V1_IMPORT_DISCLAIMER,
  STUDIO_WILL_V1_IMPORT_MAX_SAMPLES_PER_ELEMENT,
  STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH,
  STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES,
} from "./studio-will-v1-import-bridge";
import {
  STUDIO_WILL_V1_OPC_ASSURANCE,
} from "./studio-will-v1-opc-interchange";

import type { StudioWillV1Path } from "./studio-will-v1-interchange";
import type { StudioWillV1OpcImportResult } from "./studio-will-v1-opc-interchange";

const importStudioWillV1OpcInWorker = vi.fn();

vi.mock("./studio-will-v1-opc-worker-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./studio-will-v1-opc-worker-client")
  >();
  return {
    ...actual,
    importStudioWillV1OpcInWorker,
  };
});

function path(overrides: Partial<StudioWillV1Path> = {}): StudioWillV1Path {
  return {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ],
    // The public profile permits fewer widths than points and repeats the final width.
    strokeWidths: [2],
    strokeColor: { r: 51, g: 102, b: 153, a: 128 },
    startParameter: 0,
    endParameter: 1,
    decimalPrecision: 2,
    segmentCount: 1,
    ...overrides,
  };
}

function result(
  overrides: Partial<StudioWillV1OpcImportResult> = {},
): StudioWillV1OpcImportResult {
  return {
    width: 360,
    height: 540,
    title: "검증된 WILL",
    createdAt: "2026-07-30T00:00:00Z",
    application: "ToonSpectrum",
    applicationVersion: "1.0",
    paths: [path()],
    assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
    ...overrides,
  };
}

function inspectOptions(
  overrides: Partial<Parameters<typeof inspectStudioWillV1Import>[2]> = {},
): Parameters<typeof inspectStudioWillV1Import>[2] {
  return {
    canvasWidth: 720,
    currentPageElementCount: 0,
    canAddPage: true,
    ...overrides,
  };
}

beforeEach(() => {
  importStudioWillV1OpcInWorker.mockReset();
  importStudioWillV1OpcInWorker.mockResolvedValue(result());
});

describe("Studio WILL v1 safe import bridge", () => {
  it("decodes only through the Worker and preserves a single repeated width", async () => {
    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([80, 75, 3, 4]),
      "episode.will",
      inspectOptions(),
    );

    expect(importStudioWillV1OpcInWorker).toHaveBeenCalledTimes(1);
    expect(importStudioWillV1OpcInWorker).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        signal: undefined,
        willLimits: expect.objectContaining({
          maxPointsPerPath:
            STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH,
          maxTotalPoints: STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES,
        }),
      }),
    );
    expect(pending).toMatchObject({
      kind: "will-v1",
      fileName: "episode.will",
      pageHeight: 1_080,
      currentPageAllowed: true,
      newPageAllowed: true,
      disclaimer: STUDIO_WILL_V1_IMPORT_DISCLAIMER,
    });
    expect(pending.sourceFingerprint).toMatch(/^willfp:[0-9a-f]{16}$/u);
    expect(pending.skipped).toEqual([]);

    const committed = prepareStudioWillV1ImportCommit(pending, {
      destination: "new-page",
      currentPageElementCount: 0,
      existingElementIds: new Set(),
    });
    expect(committed.elements).toHaveLength(1);
    expect(committed.elements[0]).toMatchObject({
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 100, 100, 200, 200],
      stroke: "#336699",
      strokeWidth: 4,
      opacity: 128 / 255,
      pressures: [1, 1, 1],
      pressureModel: "linear-residual-path-v3",
      paintModel: "layered-flow-v1",
    });
  });

  it("clamps permissive host limits without discarding tighter Worker settings", async () => {
    await inspectStudioWillV1Import(
      Uint8Array.from([80, 75, 3, 4]),
      "bounded-ui.will",
      inspectOptions({
        workerOptions: {
          willLimits: {
            maxCoordinateMagnitude: 500_000,
            maxPointsPerPath: 100_000,
            maxTotalPoints: 300_000,
          },
        },
      }),
    );

    expect(importStudioWillV1OpcInWorker).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        willLimits: expect.objectContaining({
          maxCoordinateMagnitude: 500_000,
          maxPointsPerPath:
            STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH,
          maxTotalPoints: STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES,
        }),
      }),
    );
  });

  it("maps variable widths to pressure and reports every semantic adaptation", async () => {
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      paths: [path({ strokeWidths: [1, 2, 4, 8] })],
    }));

    const pending = await inspectStudioWillV1Import(
      new ArrayBuffer(4),
      "pressure.will",
      inspectOptions(),
    );
    const committed = prepareStudioWillV1ImportCommit(pending, {
      destination: "current-page",
      currentPageElementCount: 2,
      existingElementIds: new Set(["existing"]),
    });

    expect(committed.elements[0]).toMatchObject({
      strokeWidth: 4,
      pressures: [0.5, 0.75, 1],
    });
    expect(pending.adaptations.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "catmull-rom-resampled-to-studio-polyline",
        "stroke-width-mapped-to-pressure",
      ]),
    );
    expect(pending.preview.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "editability",
          message: expect.stringContaining("Catmull–Rom"),
        }),
        expect.objectContaining({
          category: "editability",
          message: STUDIO_WILL_V1_IMPORT_DISCLAIMER,
        }),
      ]),
    );
  });

  it("derives repeatable element IDs and resolves document collisions deterministically", async () => {
    const first = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "stable.will",
      inspectOptions(),
    );
    const second = await inspectStudioWillV1Import(
      Uint8Array.from([2]),
      "renamed.will",
      inspectOptions(),
    );
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);

    const initial = prepareStudioWillV1ImportCommit(first, {
      destination: "new-page",
      currentPageElementCount: 0,
      existingElementIds: new Set(),
    });
    const collided = prepareStudioWillV1ImportCommit(second, {
      destination: "current-page",
      currentPageElementCount: 1,
      existingElementIds: new Set([initial.elements[0]!.id]),
    });
    expect(collided.elements[0]!.id).toBe(`${initial.elements[0]!.id}-2`);
  });

  it("rejects a result that does not carry the exact bounded public-profile assurance", async () => {
    importStudioWillV1OpcInWorker.mockResolvedValue({
      ...result(),
      assurance: {
        ...STUDIO_WILL_V1_OPC_ASSURANCE,
        vendorCertified: true,
      },
    });

    await expect(
      inspectStudioWillV1Import(
        Uint8Array.from([1]),
        "vendor-claim.will",
        inspectOptions(),
      ),
    ).rejects.toThrow(/bounded WILL v1 공개 명세 프로필/u);
  });

  it("blocks confirmation when neither destination can hold the imported elements", async () => {
    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "full.will",
      inspectOptions({
        canAddPage: false,
        currentPageElementCount: 10_000,
      }),
    );
    expect(pending.currentPageAllowed).toBe(false);
    expect(pending.newPageAllowed).toBe(false);
    expect(pending.preview.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "pages", gate: "blocking" }),
      ]),
    );
    expect(() => prepareStudioWillV1ImportCommit(pending, {
      destination: "current-page",
      currentPageElementCount: 10_000,
      existingElementIds: new Set(),
    })).toThrow(/차단된 WILL v1/u);
  });

  it("does not let callers bypass a destination that inspection disabled", async () => {
    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "current-only.will",
      inspectOptions({ canAddPage: false }),
    );
    expect(pending.currentPageAllowed).toBe(true);
    expect(pending.newPageAllowed).toBe(false);
    expect(() => prepareStudioWillV1ImportCommit(pending, {
      destination: "new-page",
      currentPageElementCount: 0,
      existingElementIds: new Set(),
    })).toThrow(/새 페이지/u);
  });

  it("splits long paths below the CRDT element budget without changing ordering", async () => {
    const controlPoints = Array.from({ length: 260 }, (_, index) => ({
      x: index,
      y: index % 7,
    }));
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      paths: [path({
        points: controlPoints,
        strokeWidths: [3],
        segmentCount: controlPoints.length - 3,
      })],
    }));
    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "long.will",
      inspectOptions(),
    );
    const committed = prepareStudioWillV1ImportCommit(pending, {
      destination: "new-page",
      currentPageElementCount: 0,
      existingElementIds: new Set(),
    });

    expect(committed.elements.length).toBeGreaterThan(1);
    expect(
      committed.elements.every(
        ({ pressures }) =>
          (pressures?.length ?? 0) <= STUDIO_WILL_V1_IMPORT_MAX_SAMPLES_PER_ELEMENT,
      ),
    ).toBe(true);
    expect(pending.adaptations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "path-split-for-collaboration-budget" }),
      ]),
    );
  });

  it("handles a 100k-control-point constant-width path without spread or Set allocation failure", async () => {
    const controlPoints = Array.from({ length: 100_000 }, (_, index) => ({
      x: index % 500,
      y: Math.floor(index / 500),
    }));
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      height: 720,
      paths: [path({
        points: controlPoints,
        strokeWidths: [2],
        segmentCount: controlPoints.length - 3,
      })],
    }));

    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "hundred-thousand.will",
      inspectOptions(),
    );
    expect(pending.skipped).toEqual([]);
    expect(pending.drafts.length).toBeGreaterThan(1_000);
    expect(
      pending.drafts.every(({ element }) =>
        element.pressures?.every(Number.isFinite)
      ),
    ).toBe(true);
  }, 20_000);

  it("does not let one over-budget path consume admission for a later small path", async () => {
    // The midpoint/end sampler emits `2 * controlPointCount - 5` retained
    // samples for this monotonic path. This count is therefore just over the
    // Studio-side 200k admission budget.
    const tooManyPoints = Array.from({ length: 100_003 }, (_, index) => ({
      x: index % 400,
      y: Math.floor(index / 400),
    }));
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      paths: [
        path({
          points: tooManyPoints,
          strokeWidths: [2],
          segmentCount: tooManyPoints.length - 3,
        }),
        path({ strokeColor: { r: 1, g: 2, b: 3, a: 255 } }),
      ],
    }));

    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "budget.will",
      inspectOptions(),
    );
    expect(pending.skipped).toEqual([
      { pathIndex: 0, reason: "sample-budget-exceeded" },
    ]);
    expect(pending.drafts).toHaveLength(1);
    expect(pending.drafts[0]!.sourcePathIndex).toBe(1);
  }, 20_000);

  it("rejects a future million-point path before reading or allocating its samples", async () => {
    let indexedPointReads = 0;
    const sparseMillionPointPath = new Proxy(
      new Array<{ x: number; y: number }>(1_000_000),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) {
            indexedPointReads += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      paths: [
        path({
          points: sparseMillionPointPath,
          strokeWidths: [2],
          segmentCount: sparseMillionPointPath.length - 3,
        }),
        path({ strokeColor: { r: 4, g: 5, b: 6, a: 255 } }),
      ],
    }));

    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "future-million-point.will",
      inspectOptions(),
    );
    expect(STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH).toBe(100_000);
    expect(indexedPointReads).toBe(0);
    expect(pending.skipped).toEqual([
      { pathIndex: 0, reason: "sample-budget-exceeded" },
    ]);
    expect(pending.drafts).toHaveLength(1);
    expect(pending.drafts[0]!.sourcePathIndex).toBe(1);
  });

  it("stops sampling at the remaining aggregate budget and still admits a later small path", async () => {
    const controlPoints = Array.from({ length: 100_000 }, (_, index) => ({
      x: index,
      y: index % 5,
    }));
    let secondPathIndexedReads = 0;
    const observedSecondPath = new Proxy(controlPoints, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) {
          secondPathIndexedReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    importStudioWillV1OpcInWorker.mockResolvedValue(result({
      width: 720,
      paths: [
        path({
          points: controlPoints,
          strokeWidths: [2],
          segmentCount: controlPoints.length - 3,
        }),
        path({
          points: observedSecondPath,
          strokeWidths: [2],
          segmentCount: observedSecondPath.length - 3,
        }),
        path({ strokeColor: { r: 7, g: 8, b: 9, a: 255 } }),
      ],
    }));

    const pending = await inspectStudioWillV1Import(
      Uint8Array.from([1]),
      "aggregate-budget.will",
      inspectOptions(),
    );
    expect(secondPathIndexedReads).toBeLessThan(20);
    expect(pending.skipped).toEqual([
      { pathIndex: 1, reason: "sample-budget-exceeded" },
    ]);
    expect(pending.drafts.at(-1)!.sourcePathIndex).toBe(2);
  }, 20_000);
});
