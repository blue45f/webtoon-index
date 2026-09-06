import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND,
  STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION,
  STUDIO_BG3D_MEASUREMENT_MAX_GUIDES,
  STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES,
  STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE,
  addStudioBg3dMeasurementGuide,
  chooseStudioBg3dMeasurementUnit,
  classifyStudioBg3dMeasurementInference,
  createStudioBg3dMeasurementDocument,
  createStudioBg3dMeasurementGuide,
  deleteStudioBg3dMeasurementGuide,
  formatStudioBg3dMeasurementLength,
  lockStudioBg3dMeasurementLength,
  measureStudioBg3dWorldPoints,
  parseStudioBg3dMeasurementDocument,
  resolveStudioBg3dMeasurementGuide,
  serializeStudioBg3dMeasurementDocument,
  setStudioBg3dMeasurementGuideVisibility,
  setStudioBg3dMeasurementUnit,
  studioBg3dMeasurementValueInUnit,
  studioBg3dMeasurementValueToMeters,
  type StudioBg3dMeasurementDocument,
} from "./studio-bg3d-measurement";

function measurement(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
) {
  const result = measureStudioBg3dWorldPoints(start, end);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.measurement;
}

function addGuide(
  document: StudioBg3dMeasurementDocument,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
) {
  const result = addStudioBg3dMeasurementGuide(document, {
    startWorld: start,
    endWorld: end,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("Studio BG3D world measurement", () => {
  it("computes distance, XYZ delta, absolute delta, midpoint, and direction without mutation", () => {
    const start = Object.freeze([1, 2, 3] as const);
    const end = Object.freeze([4, 6, 3] as const);
    const result = measureStudioBg3dWorldPoints(start, end);
    expect(result).toMatchObject({
      ok: true,
      measurement: {
        startWorld: [1, 2, 3],
        endWorld: [4, 6, 3],
        deltaWorld: [3, 4, 0],
        absoluteDeltaWorld: [3, 4, 0],
        midpointWorld: [2.5, 4, 3],
        distanceMeters: 5,
        directionWorld: [0.6, 0.8, 0],
      },
    });
    expect(start).toEqual([1, 2, 3]);
    expect(end).toEqual([4, 6, 3]);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.measurement.deltaWorld)).toBe(true);
  });

  it("keeps a zero-distance measurement valid but leaves its direction undefined", () => {
    expect(measurement([2, 3, 4], [2, 3, 4])).toMatchObject({
      distanceMeters: 0,
      directionWorld: null,
      midpointWorld: [2, 3, 4],
    });
  });

  it("fails non-finite, malformed, accessor-backed, and out-of-world coordinates closed", () => {
    const accessorPoint = [0, 0, 0];
    Object.defineProperty(accessorPoint, "1", { enumerable: true, get: () => 0 });
    for (const point of [
      [Number.NaN, 0, 0],
      [Number.POSITIVE_INFINITY, 0, 0],
      [STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE + 1, 0, 0],
      [0, 0],
      accessorPoint,
    ]) {
      expect(measureStudioBg3dWorldPoints(point, [0, 0, 0])).toMatchObject({
        ok: false,
        reason: "invalid-point",
      });
    }
  });
});

describe("Studio BG3D axis / parallel / perpendicular inference", () => {
  it("returns all matching inferences and chooses exact axis first deterministically", () => {
    const result = classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [-4, 0, 0],
      references: [
        { id: "wall-y", directionWorld: [0, 1, 0] },
        { id: "edge-x", directionWorld: [1, 0, 0] },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      primary: {
        kind: "axis",
        axis: "x",
        sign: -1,
        angularErrorDegrees: 0,
      },
      evaluatedReferences: 2,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.matches).toEqual([
      { kind: "axis", axis: "x", sign: -1, angularErrorDegrees: 0 },
      { kind: "parallel", referenceId: "edge-x", sign: -1, angularErrorDegrees: 0 },
      { kind: "perpendicular", referenceId: "wall-y", angularErrorDegrees: 0 },
    ]);
  });

  it("uses the explicit angular tolerance and reports free direction outside it", () => {
    const angle = (4 * Math.PI) / 180;
    const end = [Math.cos(angle), Math.sin(angle), 0] as const;
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: end,
      toleranceDegrees: 3,
    })).toMatchObject({
      ok: true,
      primary: { kind: "free" },
      matches: [],
    });
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: end,
      toleranceDegrees: 5,
    })).toMatchObject({
      ok: true,
      primary: { kind: "axis", axis: "x", angularErrorDegrees: 4 },
    });
  });

  it("rejects degenerate segments, invalid tolerance, duplicate/invalid references, and budgets", () => {
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [0, 0, 0],
    })).toMatchObject({ ok: false, reason: "degenerate-direction" });
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
      toleranceDegrees: 30,
    })).toMatchObject({ ok: false, reason: "invalid-tolerance" });
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
      references: [
        { id: "same", directionWorld: [1, 0, 0] },
        { id: "same", directionWorld: [0, 1, 0] },
      ],
    })).toMatchObject({ ok: false, reason: "duplicate-reference-id" });
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
      references: [{ id: "zero", directionWorld: [0, 0, 0] }],
    })).toMatchObject({ ok: false, reason: "invalid-reference" });
    expect(classifyStudioBg3dMeasurementInference({
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
      references: Array.from(
        { length: STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES + 1 },
        (_, index) => ({ id: `ref-${index}`, directionWorld: [1, 0, 0] as const }),
      ),
    })).toMatchObject({ ok: false, reason: "reference-budget-exceeded" });
  });
});

describe("Studio BG3D numeric length lock", () => {
  it("preserves direction and replaces the segment length exactly", () => {
    const result = lockStudioBg3dMeasurementLength({
      startWorld: [1, 2, 3],
      proposedEndWorld: [4, 6, 3],
      lockedLengthMeters: 10,
    });
    expect(result).toMatchObject({
      ok: true,
      lockedLengthMeters: 10,
      endWorld: [7, 10, 3],
      measurement: {
        deltaWorld: [6, 8, 0],
        distanceMeters: 10,
      },
    });
  });

  it("can use a fallback direction before pointer movement", () => {
    expect(lockStudioBg3dMeasurementLength({
      startWorld: [0, 0, 0],
      proposedEndWorld: [0, 0, 0],
      fallbackDirectionWorld: [0, 0, -4],
      lockedLengthMeters: 2.5,
    })).toMatchObject({
      ok: true,
      endWorld: [0, 0, -2.5],
    });
  });

  it("fails zero/NaN length, a missing direction, and a result outside world bounds", () => {
    expect(lockStudioBg3dMeasurementLength({
      startWorld: [0, 0, 0],
      proposedEndWorld: [1, 0, 0],
      lockedLengthMeters: 0,
    })).toMatchObject({ ok: false, reason: "invalid-length" });
    expect(lockStudioBg3dMeasurementLength({
      startWorld: [0, 0, 0],
      proposedEndWorld: [0, 0, 0],
      lockedLengthMeters: 1,
    })).toMatchObject({ ok: false, reason: "degenerate-direction" });
    expect(lockStudioBg3dMeasurementLength({
      startWorld: [STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE, 0, 0],
      proposedEndWorld: [STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE - 1, 0, 0],
      lockedLengthMeters: 20_001,
    })).toMatchObject({ ok: false, reason: "result-out-of-bounds" });
  });
});

describe("Studio BG3D deterministic units", () => {
  it("formats mm/cm/m without locale-dependent grouping or trailing zeroes", () => {
    expect(formatStudioBg3dMeasurementLength(0.001, "mm")).toBe("1 mm");
    expect(formatStudioBg3dMeasurementLength(0.25, "cm")).toBe("25 cm");
    expect(formatStudioBg3dMeasurementLength(1.23456, "m")).toBe("1.235 m");
    expect(formatStudioBg3dMeasurementLength(1, "m", 6)).toBe("1 m");
    expect(formatStudioBg3dMeasurementLength(Number.NaN, "m")).toBeNull();
  });

  it("converts explicit display units and chooses a useful automatic unit", () => {
    expect(studioBg3dMeasurementValueInUnit(1.25, "cm")).toBe(125);
    expect(studioBg3dMeasurementValueToMeters(125, "cm")).toBe(1.25);
    expect(chooseStudioBg3dMeasurementUnit(0.005)).toBe("mm");
    expect(chooseStudioBg3dMeasurementUnit(0.5)).toBe("cm");
    expect(chooseStudioBg3dMeasurementUnit(5)).toBe("m");
  });
});

describe("Studio BG3D persistent measurement guides", () => {
  it("creates a stable guide and derives its line midpoint/distance label at render time", () => {
    const created = createStudioBg3dMeasurementGuide({
      id: "measure-guide-0001",
      startWorld: [0, 0, 0],
      endWorld: [0, 2.5, 0],
      lockedLengthMeters: 2.5,
    });
    expect(created).toMatchObject({
      ok: true,
      guide: {
        id: "measure-guide-0001",
        kind: "distance",
        lockedLengthMeters: 2.5,
        visible: true,
      },
    });
    if (!created.ok) throw new Error(created.message);
    expect(resolveStudioBg3dMeasurementGuide(created.guide, "cm")).toMatchObject({
      ok: true,
      resolved: {
        label: "250 cm",
        measurement: {
          midpointWorld: [0, 1.25, 0],
          distanceMeters: 2.5,
        },
      },
    });
  });

  it("rejects unsafe IDs, zero lines, and locked lengths that disagree with endpoints", () => {
    expect(createStudioBg3dMeasurementGuide({
      id: "__proto__",
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
    })).toMatchObject({ ok: false, reason: "invalid-guide-id" });
    expect(createStudioBg3dMeasurementGuide({
      id: "zero",
      startWorld: [0, 0, 0],
      endWorld: [0, 0, 0],
    })).toMatchObject({ ok: false, reason: "invalid-guide" });
    expect(createStudioBg3dMeasurementGuide({
      id: "wrong-lock",
      startWorld: [0, 0, 0],
      endWorld: [1, 0, 0],
      lockedLengthMeters: 2,
    })).toMatchObject({ ok: false, reason: "invalid-length" });
  });

  it("allocates monotonic IDs, deletes without mutation, and does not reuse a deleted ID", () => {
    const empty = createStudioBg3dMeasurementDocument("cm");
    const first = addGuide(empty, [0, 0, 0], [1, 0, 0]);
    const second = addGuide(first.document, [0, 0, 0], [0, 2, 0]);
    expect(first.guide?.id).toBe("measure-guide-0001");
    expect(second.guide?.id).toBe("measure-guide-0002");
    const deleted = deleteStudioBg3dMeasurementGuide(second.document, "measure-guide-0001");
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.message);
    const third = addGuide(deleted.document, [0, 0, 0], [0, 0, 3]);
    expect(third.guide?.id).toBe("measure-guide-0003");
    expect(empty.guides).toEqual([]);
    expect(second.document.guides).toHaveLength(2);
    expect(third.document.guides.map((guide) => guide.id)).toEqual([
      "measure-guide-0002",
      "measure-guide-0003",
    ]);
  });

  it("updates unit/visibility immutably and reports missing guide deletion", () => {
    const added = addGuide(createStudioBg3dMeasurementDocument(), [0, 0, 0], [1, 0, 0]);
    const hidden = setStudioBg3dMeasurementGuideVisibility(
      added.document,
      added.guide!.id,
      false,
    );
    expect(hidden).toMatchObject({
      ok: true,
      document: { guides: [{ visible: false }] },
    });
    if (!hidden.ok) throw new Error(hidden.message);
    expect(setStudioBg3dMeasurementUnit(hidden.document, "mm")).toMatchObject({
      ok: true,
      document: { unit: "mm" },
    });
    expect(deleteStudioBg3dMeasurementGuide(
      hidden.document,
      "missing-guide",
    )).toMatchObject({ ok: false, reason: "guide-not-found" });
  });

  it("round-trips a canonical bounded document and rejects unknown fields/duplicates/corruption", () => {
    const first = addGuide(createStudioBg3dMeasurementDocument("cm"), [0, 0, 0], [1, 0, 0]);
    const second = addGuide(first.document, [1, 2, 3], [4, 6, 3]);
    const serialized = serializeStudioBg3dMeasurementDocument(second.document);
    expect(serialized).not.toBeNull();
    expect(parseStudioBg3dMeasurementDocument(serialized!)).toEqual(second.document);

    expect(parseStudioBg3dMeasurementDocument(JSON.stringify({
      ...second.document,
      unknown: true,
    }))).toBeNull();
    expect(parseStudioBg3dMeasurementDocument(JSON.stringify({
      ...second.document,
      guides: [second.document.guides[0], second.document.guides[0]],
    }))).toBeNull();
    expect(parseStudioBg3dMeasurementDocument(JSON.stringify({
      ...second.document,
      guides: [{
        ...second.document.guides[0],
        endWorld: [Number.MAX_VALUE, 0, 0],
      }],
    }))).toBeNull();
    const cyclic = { ...second.document } as unknown as { guides: unknown };
    cyclic.guides = [cyclic];
    expect(serializeStudioBg3dMeasurementDocument(cyclic)).toBeNull();
  });

  it("enforces the persistent guide-count budget without discarding existing guides", () => {
    let document = createStudioBg3dMeasurementDocument();
    for (let index = 0; index < STUDIO_BG3D_MEASUREMENT_MAX_GUIDES; index += 1) {
      const result = addStudioBg3dMeasurementGuide(document, {
        startWorld: [0, 0, 0],
        endWorld: [1 + index / 1_000, 0, 0],
      });
      expect(result.ok, `guide ${index + 1}`).toBe(true);
      if (!result.ok) throw new Error(result.message);
      document = result.document;
    }
    expect(document.guides).toHaveLength(STUDIO_BG3D_MEASUREMENT_MAX_GUIDES);
    expect(addStudioBg3dMeasurementGuide(document, {
      startWorld: [0, 0, 0],
      endWorld: [2, 0, 0],
    })).toMatchObject({ ok: false, reason: "guide-budget-exceeded" });
  });

  it("uses an explicit small versioned document root", () => {
    expect(createStudioBg3dMeasurementDocument()).toMatchObject({
      kind: STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND,
      version: STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION,
      unit: "m",
      guides: [],
    });
  });
});
